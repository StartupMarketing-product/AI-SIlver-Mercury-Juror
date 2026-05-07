/**
 * Phase 1: best-effort fetch + text extraction for PDFs linked from JSON
 * submissions. Used by the bulk-import path to enrich a case's evidence with
 * the actual deck text, so L2 scoring sees more than the bare text fields.
 *
 * Design choices:
 *   - Graceful failure. ANY problem (404, auth, timeout, oversize, malformed
 *     PDF) returns an empty result — never throws. Scoring proceeds with
 *     whatever else we have.
 *   - 30s per-URL timeout via AbortSignal.
 *   - 20MB hard cap on body size (Render Starter has 512MB RAM; we don't want
 *     a single huge slide deck to OOM the worker scoring 50 cases).
 *   - Lazy import of pdf-parse so the cold-start cost is paid only when a
 *     case actually has a PDF link.
 */

const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
const FETCH_TIMEOUT_MS = 30_000;

export interface PdfExtractResult {
  /** Source URL that was fetched (echoed back for logging). */
  url: string;
  /** Extracted plain text, or "" on any failure. */
  text: string;
  /** Number of pages, when known; 0 on failure. */
  pages: number;
  /** Filled when fetch/parse failed — short human-readable reason. */
  error?: string;
}

const PDF_MAGIC = "%PDF-";

function isLikelyPdf(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  return buffer.slice(0, 5).toString("ascii") === PDF_MAGIC;
}

export async function fetchAndExtractPdf(url: string): Promise<PdfExtractResult> {
  const empty = (error: string): PdfExtractResult => ({ url, text: "", pages: 0, error });

  if (!url || typeof url !== "string") return empty("invalid url");
  // Quick gate: HeyGen/Supabase signed URLs and most CDN PDF links use http(s).
  if (!/^https?:\/\//i.test(url)) return empty("non-http url");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: ac.signal,
      // Some hosts inspect UA; the default Node UA gets blocked occasionally.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AI-Jury-Bot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) return empty(`HTTP ${res.status}`);

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    // application/pdf is normal; some servers return application/octet-stream
    // or text/html (when redirected to a login page). We accept anything that
    // sniffs as PDF after download.
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_PDF_BYTES) return empty(`oversize ${len} bytes`);

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > MAX_PDF_BYTES) return empty(`oversize after read ${arrayBuf.byteLength}`);
    const buffer = Buffer.from(arrayBuf);

    if (!isLikelyPdf(buffer)) {
      return empty(`not a PDF (content-type=${ct})`);
    }

    // Lazy import — pdf-parse pulls in a multi-MB dependency tree.
    // pdf-parse v2 ships ESM with a named export `pdf` plus default; pick whichever exists.
    const mod: any = await import("pdf-parse");
    const pdfParse = mod.default ?? mod.pdf ?? mod;
    const parsed: { text?: string; numpages?: number } = await pdfParse(buffer);
    return {
      url,
      text: (parsed.text || "").trim(),
      pages: parsed.numpages || 0,
    };
  } catch (e) {
    return empty(`exception: ${(e as Error).message?.slice(0, 120) ?? "unknown"}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + extract a list of URLs in parallel, with a concurrency cap so we
 *  don't pin the Render worker. Returns results in input order, one entry per
 *  URL — failures included so the caller can log them. */
export async function fetchManyPdfs(urls: string[], concurrency = 3): Promise<PdfExtractResult[]> {
  const out: PdfExtractResult[] = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= urls.length) return;
      out[i] = await fetchAndExtractPdf(urls[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}
