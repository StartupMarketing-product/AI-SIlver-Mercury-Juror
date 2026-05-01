import type { CaseBundle, ExtractedSegment } from "./types/case.js";
import { type StoredCase, insertEvidenceBatch, type NewEvidenceInput } from "./db.js";
import { downloadCaseFile } from "./storage.js";
import { PDFParse } from "pdf-parse";
import Tesseract from "tesseract.js";

let ocrWorkerPromise: Promise<any> | null = null;

function isSparsePdfText(text: string): boolean {
  const cleaned = text
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length < 1000;
}

async function getOcrWorker(): Promise<any> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = Tesseract.createWorker("rus+eng");
  }
  return ocrWorkerPromise;
}

async function extractOcrSegments(
  parser: PDFParse,
  sourceName: string,
  maxImages = 6
): Promise<ExtractedSegment[]> {
  const out: ExtractedSegment[] = [];
  const images = await parser.getImage();
  const candidates: Array<{ pageNumber: number; name: string; data: Uint8Array; width: number; height: number }> = [];
  for (const page of images.pages ?? []) {
    for (const img of page.images ?? []) {
      // Skip tiny assets/icons to reduce OCR noise and latency.
      if ((img.width ?? 0) * (img.height ?? 0) < 120_000) continue;
      candidates.push({
        pageNumber: page.pageNumber,
        name: img.name,
        data: img.data,
        width: img.width,
        height: img.height,
      });
    }
  }

  const worker = await getOcrWorker();
  let processed = 0;
  for (const c of candidates) {
    if (processed >= maxImages) break;
    try {
      const ocr = await worker.recognize(Buffer.from(c.data));
      const text = String(ocr?.data?.text ?? "").replace(/\s+\n/g, "\n").trim();
      if (text.length < 80) continue;
      out.push({
        text: text.slice(0, 8000),
        source: `ocr:${sourceName}:p${c.pageNumber}:${c.name}`,
        page_or_slide: c.pageNumber,
        kind: "extracted_text",
      });
      processed += 1;
    } catch (err) {
      console.warn(`OCR failed for ${sourceName} page ${c.pageNumber}:`, err);
    }
  }

  return out;
}

async function extractOcrFromScreenshots(
  parser: PDFParse,
  sourceName: string,
  maxPages = 4
): Promise<ExtractedSegment[]> {
  const out: ExtractedSegment[] = [];
  const shots = await parser.getScreenshot({
    first: maxPages,
    desiredWidth: 1400,
    imageDataUrl: false,
    imageBuffer: true,
  });
  const worker = await getOcrWorker();
  for (const page of shots.pages ?? []) {
    if ((page.width ?? 0) * (page.height ?? 0) < 120_000) continue;
    try {
      const ocr = await worker.recognize(Buffer.from(page.data));
      const text = String(ocr?.data?.text ?? "").replace(/\s+\n/g, "\n").trim();
      if (text.length < 80) continue;
      out.push({
        text: text.slice(0, 10000),
        source: `ocr_page:${sourceName}:p${page.pageNumber}`,
        page_or_slide: page.pageNumber,
        kind: "extracted_text",
      });
    } catch (err) {
      console.warn(`Page OCR failed for ${sourceName} page ${page.pageNumber}:`, err);
    }
  }
  return out;
}

/** Build CaseBundle from stored case (text fields + PDF extraction + OCR fallback).
 *
 * Phase 3: every retained segment is also persisted as a public.evidence row
 * and tagged with cite_key (E1, E2, ...) + evidence_id so L2 can cite them and
 * verdicts can carry evidence_ids that point back into the DB.
 */
export async function buildCaseBundle(stored: StoredCase): Promise<CaseBundle> {
  const extracted: ExtractedSegment[] = [];
  const tf = stored.text_fields;
  if (tf.project_results) {
    extracted.push({ text: tf.project_results.slice(0, 2000), source: "project_results", kind: "text_field" });
  }
  if (tf.project_strategy) {
    extracted.push({ text: tf.project_strategy.slice(0, 1500), source: "project_strategy", kind: "text_field" });
  }
  if (tf.project_info) {
    extracted.push({ text: tf.project_info.slice(0, 1500), source: "project_info", kind: "text_field" });
  }

  // Parse uploaded PDFs so judging can use submission documents, not only form fields.
  for (const f of stored.storage_paths ?? []) {
    const looksLikePdf =
      /\.pdf$/i.test(f.original_name ?? "") ||
      /\.pdf$/i.test(f.path ?? "") ||
      f.kind === "application/pdf";
    if (!looksLikePdf) continue;
    let parser: PDFParse | null = null;
    try {
      const buf = await downloadCaseFile(f.path);
      parser = new PDFParse({ data: buf });
      const parsed = await parser.getText();
      const text = (parsed.text ?? "").replace(/\s+\n/g, "\n").trim();
      const sourceName = f.original_name ?? "uploaded.pdf";
      if (text) {
        extracted.push({
          text: text.slice(0, 30000),
          source: `pdf:${sourceName}`,
          kind: "pdf_page",
          storage_path: f.path,
        });
      }

      // OCR fallback for image-heavy PDFs when native extraction is too sparse.
      if (isSparsePdfText(text)) {
        let gotOcr = false;
        try {
          const ocrSegments = await extractOcrSegments(parser, sourceName);
          extracted.push(...ocrSegments);
          gotOcr = ocrSegments.length > 0;
        } catch (err) {
          console.warn(`OCR fallback failed for ${f.path}:`, err);
        }
        // If embedded-image OCR yielded nothing, OCR rendered page screenshots.
        if (!gotOcr) {
          try {
            const pageOcr = await extractOcrFromScreenshots(parser, sourceName);
            extracted.push(...pageOcr);
          } catch (err) {
            console.warn(`Screenshot OCR fallback failed for ${f.path}:`, err);
          }
        }
      }
    } catch (err) {
      // Keep analysis running even if one file fails to parse / download.
      console.warn(`PDF parse failed for ${f.path}:`, err);
    } finally {
      if (parser) {
        try {
          await parser.destroy();
        } catch {
          // ignore parser cleanup errors
        }
      }
    }
  }

  // Persist evidence rows for every retained segment so verdicts can cite them by id.
  const evidenceInputs: NewEvidenceInput[] = extracted.map((s) => ({
    case_id: stored.case_id,
    kind: s.kind ?? "extracted_text",
    source: s.source,
    snippet: s.text.slice(0, 2000),
    page_or_slide: s.page_or_slide,
    storage_path: s.storage_path,
  }));
  let evidenceIds: string[] = [];
  try {
    evidenceIds = await insertEvidenceBatch(evidenceInputs);
  } catch (err) {
    console.warn("insertEvidenceBatch failed; proceeding without DB ids:", err);
  }
  // Tag each segment with cite_key + evidence_id so the L2 prompt can render them.
  for (let i = 0; i < extracted.length; i += 1) {
    extracted[i].cite_key = `E${i + 1}`;
    if (evidenceIds[i]) extracted[i].evidence_id = evidenceIds[i];
  }

  return {
    metadata: {
      case_id: stored.case_id,
      year: String(stored.year),
      nomination_id: stored.nomination_id,
      block_id: stored.block_id,
      project_id: stored.external_case_id,
      project_name: stored.project_name,
    },
    text_fields: stored.text_fields as import("./types/case.js").CaseTextFields,
    extracted_text: extracted,
    config_hash: "stub-v1",
  };
}
