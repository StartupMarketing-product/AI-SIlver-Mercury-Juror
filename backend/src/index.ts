import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  insertCase,
  getCase,
  listCases,
  insertVerdict,
  getVerdict,
  listVerdicts,
  updateCaseStatus,
  appendAuditLog,
  getVerdictRichRow,
  listEvidenceForCase,
  setVerdictApproval,
  setVerdictSpeech,
  setVerdictApprovedForRender,
  setVerdictAvatarVideo,
  listRenderingVerdicts,
  getVerdictAvatarScript,
} from "./db.js";
import { createVideo as heygenCreateVideo, getVideoStatus as heygenGetVideoStatus } from "./heygen.js";
import {
  generateSummarySpeech, getSummary, upsertSummary,
  listRenderingSummaries, setSummaryAvatarVideo,
} from "./nominationSummary.js";
import { uploadCaseFile, type StoredFileRef } from "./storage.js";
import { buildCaseBundle } from "./ingestion.js";
import { runAnalysis } from "./runAnalysis.js";
import { resolveNomination } from "./caseLookup.js";
import { moderatorAuth } from "./auth.js";
import { fetchManyPdfs } from "./pdfFetch.js";
import { insertEvidenceBatch, type NewEvidenceInput } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT ?? 3002;

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "*" }));
app.use(express.json({ limit: "2mb" }));

// In-memory upload buffers — files are streamed straight to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB per file
});

/** Health check for frontend and deploy. */
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "synthetic-jury-api" });
});

/** Methodology config (versioned). */
app.get("/api/config/methodology", (_req, res) => {
  try {
    const path = join(__dirname, "config", "methodology.json");
    const raw = readFileSync(path, "utf-8");
    const config = JSON.parse(raw);
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: "Failed to load methodology config" });
  }
});

/** Upload case: multipart form with text fields + optional files. Returns case_id. */
app.post("/api/cases/upload", moderatorAuth, upload.any(), async (req, res) => {
  try {
    const text_fields: Record<string, string> = {};
    const fields = [
      "project_id", "project_name", "nomination_id", "block_id", "year",
      "project_info", "project_product", "project_auditory", "project_insight",
      "project_targets", "project_task", "project_strategy", "project_channels",
      "project_realisation", "project_results", "project_start_info", "project_additional_factors",
    ];
    for (const k of fields) {
      const v = req.body[k];
      if (v != null && typeof v === "string") text_fields[k] = v;
    }

    const resolvedNomination = resolveNomination(
      typeof req.body.project_id === "string" ? req.body.project_id : undefined,
      typeof req.body.project_name === "string" ? req.body.project_name : undefined
    );
    const providedNomination = typeof req.body.nomination_id === "string" ? req.body.nomination_id.trim() : "";
    const nominationId = resolvedNomination && (!providedNomination || providedNomination === "982")
      ? resolvedNomination
      : (providedNomination || "982");

    // Step 1: insert case row to get a case_id (Supabase generates UUID).
    const caseId = await insertCase({
      external_case_id: typeof req.body.project_id === "string" ? req.body.project_id : undefined,
      project_name: typeof req.body.project_name === "string" ? req.body.project_name : undefined,
      nomination_id: nominationId,
      block_id: typeof req.body.block_id === "string" ? req.body.block_id : "50",
      year: typeof req.body.year === "string" ? req.body.year : "2025",
      text_fields,
      storage_paths: [], // will be patched after files upload
    });

    // Step 2: upload files to Supabase Storage under {case_id}/...
    const storagePaths: StoredFileRef[] = [];
    for (const f of (req.files as Express.Multer.File[]) ?? []) {
      try {
        const ref = await uploadCaseFile(caseId, f.buffer, f.originalname, f.mimetype);
        storagePaths.push(ref);
      } catch (err) {
        console.warn(`Storage upload failed for ${f.originalname}:`, err);
      }
    }

    // Step 3: patch storage_paths back onto the case row.
    if (storagePaths.length > 0) {
      const { getSupabase } = await import("./supabase.js");
      const sb = getSupabase();
      const { error } = await sb.from("cases").update({ storage_paths: storagePaths }).eq("id", caseId);
      if (error) console.warn("storage_paths update failed:", error.message);
    }

    await appendAuditLog({
      action: "case.created",
      entity_type: "case",
      entity_id: caseId,
      details: {
        project_name: text_fields.project_name ?? req.body.project_name ?? null,
        nomination_id: nominationId,
        block_id: typeof req.body.block_id === "string" ? req.body.block_id : "50",
        files: storagePaths.length,
      },
    });

    res.status(201).json({ case_id: caseId });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed", detail: String((err as Error).message) });
  }
});

/** List cases. */
app.get("/api/cases", async (_req, res) => {
  try {
    res.json(await listCases());
  } catch (err) {
    res.status(500).json({ error: "List cases failed", detail: String((err as Error).message) });
  }
});

/** Get one case. */
app.get("/api/cases/:id", async (req, res) => {
  try {
    const c = await getCase(req.params.id);
    if (!c) return res.status(404).json({ error: "Case not found" });
    res.json(c);
  } catch (err) {
    res.status(500).json({ error: "Get case failed", detail: String((err as Error).message) });
  }
});

/** Start analysis: build bundle, run L2, insert verdict, return evaluation_id. */
app.post("/api/analyze-case", moderatorAuth, async (req, res) => {
  const { case_id } = req.body ?? {};
  if (!case_id) return res.status(400).json({ error: "case_id required" });

  try {
    const stored = await getCase(case_id);
    if (!stored) return res.status(404).json({ error: "Case not found" });

    await updateCaseStatus(case_id, "processing");
    const bundle = await buildCaseBundle(stored);
    const output = await runAnalysis(bundle);
    const evaluationId = await insertVerdict(output);
    await appendAuditLog({
      action: "verdict.created",
      entity_type: "verdict",
      entity_id: evaluationId,
      details: {
        case_id,
        block_code: output.block_code,
        nomination_code: output.nomination_code,
        award_level: output.l2.award_level,
        total_score: output.l2.total_score,
        caps_applied: output.l2.caps_applied?.length ?? 0,
        model_id: output.model_id,
      },
    });
    res.status(201).json({ evaluation_id: evaluationId, case_id });
  } catch (e) {
    console.error("Analyze error:", e);
    try { await updateCaseStatus(case_id, "failed"); } catch { /* noop */ }
    res.status(500).json({ error: "Analysis failed", detail: String((e as Error).message) });
  }
});

/** Get evaluation result. */
app.get("/api/evaluations/:id", async (req, res) => {
  try {
    const e = await getVerdict(req.params.id);
    if (!e) return res.status(404).json({ error: "Evaluation not found" });
    res.json(e);
  } catch (err) {
    res.status(500).json({ error: "Get evaluation failed", detail: String((err as Error).message) });
  }
});

/**
 * List evaluations. Returns enriched rows: nomination_code, avatar_status,
 * avatar_video_url, avatar_script, one_paragraph_verdict — frontend uses
 * these for the Grand Moderator console and per-category Moderator screens.
 *
 * Optional query: `?nomination=D10` filters server-side by nomination code.
 */
app.get("/api/evaluations", async (req, res) => {
  try {
    const nomination = typeof req.query.nomination === "string"
      ? req.query.nomination.toUpperCase()
      : undefined;
    res.json(await listVerdicts({ nomination }));
  } catch (err) {
    res.status(500).json({ error: "List evaluations failed", detail: String((err as Error).message) });
  }
});

/**
 * Rich verdict view: verdict + approval_state + evidence rows joined by id.
 * Frontend uses this on the reviewer detail page so it can render a citation
 * card for every evidence_id mentioned in criteria_scores.
 */
app.get("/api/verdicts/:id", async (req, res) => {
  try {
    const rich = await getVerdictRichRow(req.params.id);
    if (!rich) return res.status(404).json({ error: "Verdict not found" });
    const evidence = await listEvidenceForCase(rich.case_id);
    res.json({ ...rich, evidence });
  } catch (err) {
    res.status(500).json({ error: "Get verdict failed", detail: String((err as Error).message) });
  }
});

/** Helper: extract the reviewer identity from headers (best-effort, no real auth yet). */
function reviewerActor(req: express.Request): { actor_id?: string; actor_role: "reviewer" | "moderator" } {
  const role = (req.header("X-Reviewer-Role") ?? "reviewer").toLowerCase() as "reviewer" | "moderator";
  const id = req.header("X-Reviewer-Id") ?? undefined;
  return { actor_id: id, actor_role: role === "moderator" ? "moderator" : "reviewer" };
}

/** Approve a verdict. Sets approval_state='approved' and writes audit_log. */
app.post("/api/verdicts/:id/approve", moderatorAuth, async (req, res) => {
  try {
    const updated = await setVerdictApproval(req.params.id, "approved");
    if (!updated) return res.status(404).json({ error: "Verdict not found" });
    const actor = reviewerActor(req);
    await appendAuditLog({
      action: "verdict.approved",
      entity_type: "verdict",
      entity_id: req.params.id,
      actor_id: actor.actor_id,
      actor_role: actor.actor_role,
      details: { case_id: updated.case_id, previous: updated.previous, note: req.body?.note ?? null },
    });
    res.json({ ok: true, verdict_id: req.params.id, approval_state: "approved" });
  } catch (err) {
    res.status(500).json({ error: "Approve failed", detail: String((err as Error).message) });
  }
});

/** Reject a verdict. Sets approval_state='rejected' and writes audit_log. */
app.post("/api/verdicts/:id/reject", moderatorAuth, async (req, res) => {
  try {
    const updated = await setVerdictApproval(req.params.id, "rejected");
    if (!updated) return res.status(404).json({ error: "Verdict not found" });
    const actor = reviewerActor(req);
    await appendAuditLog({
      action: "verdict.rejected",
      entity_type: "verdict",
      entity_id: req.params.id,
      actor_id: actor.actor_id,
      actor_role: actor.actor_role,
      details: { case_id: updated.case_id, previous: updated.previous, note: req.body?.note ?? null },
    });
    res.json({ ok: true, verdict_id: req.params.id, approval_state: "rejected" });
  } catch (err) {
    res.status(500).json({ error: "Reject failed", detail: String((err as Error).message) });
  }
});

// ---------------------------------------------------------------------------
// Grand Moderator admin routes (festival prep — runs before the live session)
// ---------------------------------------------------------------------------

const TARGET_NOMINATIONS = new Set(["D01", "D10", "D13", "D15"]);
const TEXT_FIELDS = [
  "project_name",
  "project_product",
  "project_info",
  "project_unique",
  "project_info_client",
  "project_start_info",
  "project_targets",
  "project_task",
  "project_call",
  "project_auditory",
  "project_insight",
  "project_strategy_idea_or_actuality",
  "project_strategy",
  "project_creative",
  "project_big_idea",
  "project_channels",
  "project_realisation",
  "project_results",
  "project_business_results",
  "project_effectivity",
  "project_results_text",
  "project_additional_factors",
] as const;

/** Pull text fields from a raw SM submission, keeping only non-empty strings. */
function pickTextFields(p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TEXT_FIELDS) {
    const v = p[k];
    if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

/**
 * POST /api/admin/import-json
 *
 * Grand Moderator uploads the SM_2026-shaped JSON (the same structure as
 * SM_2025.json: a list whose first element is a dict of nominations, each with
 * a projects array). We filter to D01 / D10 / D13 / D15, create one case per
 * project, and kick off scoring asynchronously so the API returns quickly.
 *
 * Idempotent: re-uploading the same file skips already-imported cases by
 * external_case_id.
 */
app.post("/api/admin/import-json", moderatorAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    let parsed: any;
    try {
      parsed = JSON.parse(req.file.buffer.toString("utf-8"));
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON", detail: String((e as Error).message) });
    }

    // Normalise the shape: SM_2026 test.json is a single-element list whose
    // element is a dict keyed by index → nomination object. Older SM_2025
    // shape is a list of arrays of nominations. Accept either.
    const nominations: any[] = [];
    if (Array.isArray(parsed)) {
      for (const top of parsed) {
        if (Array.isArray(top)) nominations.push(...top);
        else if (top && typeof top === "object") nominations.push(...Object.values(top));
      }
    } else if (parsed && typeof parsed === "object") {
      nominations.push(...Object.values(parsed));
    }

    let scanned = 0;
    let imported = 0;
    let skippedExisting = 0;
    let skippedNotInTarget = 0;
    let queued = 0;
    const errors: Array<{ project_id?: string; error: string }> = [];
    const importedCaseIds: string[] = [];
    // Phase 1: PDF URLs to fetch + extract per case before scoring.
    const pdfUrlsByCaseId = new Map<string, string[]>();

    for (const nom of nominations) {
      const code = (nom?.code ?? "").toUpperCase();
      // The festival JSON has been observed in two shapes:
      //   • old (SM_2025, SM_2026_sample8):  projects is an ARRAY
      //   • new (SM_2026_1stage):           projects is an OBJECT
      //     keyed by index ({"1": {...}, "3": {...}, ...})
      // Normalise to a plain array so the rest of the import loop doesn't
      // need to care which shape arrived.
      const projectsList: any[] = Array.isArray(nom?.projects)
        ? nom.projects
        : nom?.projects && typeof nom.projects === "object"
          ? Object.values(nom.projects)
          : [];
      if (!TARGET_NOMINATIONS.has(code)) {
        skippedNotInTarget += projectsList.length;
        continue;
      }
      const blockId = String(nom?.block_id ?? "53");
      const year = String(nom?.year ?? new Date().getFullYear());

      for (const p of projectsList) {
        scanned++;
        const projectId = p?.project_id ?? p?.id;
        if (!projectId) continue;
        const externalId = `SM-${year}-${projectId}`;
        const text = pickTextFields(p);
        if (!text.project_info && !text.project_strategy && !text.project_results && !text.project_business_results) {
          // Empty submission — keep it but mark as "uploaded" so Grand Moderator can see it
          // (some festival entries genuinely come in with skeletal text).
        }
        // Phase 1: collect PDF URLs from the project record so the scoring
        // loop can fetch + extract them before L2 sees the case.
        const pdfUrls: string[] = [];
        for (const k of ["project_presentation_pdf", "project_results_file"] as const) {
          const v = (p as any)?.[k];
          if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) {
            pdfUrls.push(v.trim());
          }
        }
        try {
          const caseId = await insertCase({
            external_case_id: externalId,
            project_name: typeof p?.project_name === "string" ? p.project_name : null,
            nomination_id: code,
            block_id: blockId,
            year,
            text_fields: text,
            storage_paths: [],
            source: "sm2026_import",
          } as any);
          importedCaseIds.push(caseId);
          if (pdfUrls.length) pdfUrlsByCaseId.set(caseId, pdfUrls);
          imported++;
        } catch (e) {
          const msg = String((e as Error).message ?? "");
          if (/duplicate|external_case_id/i.test(msg)) {
            skippedExisting++;
          } else {
            errors.push({ project_id: String(projectId), error: msg });
          }
        }
      }
    }

    // Kick off scoring asynchronously — do not block the response. Each case
    // is scored independently; failures are logged and the rest continue.
    setImmediate(async () => {
      for (const caseId of importedCaseIds) {
        try {
          const stored = await getCase(caseId);
          if (!stored) continue;
          const bundle = await buildCaseBundle(stored);

          // Phase 1: fetch + extract any PDFs linked from the JSON, append
          // their text to the bundle's evidence so L2 sees deck content too.
          //
          // Critical pattern (mirrors ingestion.ts): every segment we add to
          // the bundle MUST be persisted to public.evidence and tagged with
          // BOTH cite_key + evidence_id. Otherwise resolveCiteKeys() in l2.ts
          // can't map model citations like "PDF1" back to a DB row, the
          // criterion's evidence_ids array is silently dropped to empty, and
          // scoring degrades because the model "appeared to cite no evidence".
          const urls = pdfUrlsByCaseId.get(caseId) ?? [];
          if (urls.length) {
            const results = await fetchManyPdfs(urls);
            // Cap each PDF's text at 12k chars so a single huge deck doesn't
            // blow the L2 prompt budget. Anything longer is truncated; the
            // first 12k almost always contains the strategy + results sections.
            const PDF_CHAR_CAP = 12_000;

            type NewSeg = { text: string; url: string; pages: number };
            const newSegs: NewSeg[] = [];
            for (const r of results) {
              if (r.text && r.text.length > 100) {
                newSegs.push({ text: r.text.slice(0, PDF_CHAR_CAP), url: r.url, pages: r.pages });
                console.log(
                  `[import-json] case=${caseId} pdf ok url=${r.url} pages=${r.pages} chars=${r.text.length}${r.text.length > PDF_CHAR_CAP ? " (truncated)" : ""}`
                );
              } else {
                console.warn(
                  `[import-json] case=${caseId} pdf failed url=${r.url} reason=${r.error ?? "empty text"}`
                );
              }
            }

            if (newSegs.length) {
              const evidenceInputs: NewEvidenceInput[] = newSegs.map((s) => ({
                case_id: caseId,
                kind: "extracted_text",
                source: s.url,
                snippet: s.text.slice(0, 2000),
                page_or_slide: undefined,
                storage_path: undefined,
              }));
              let evidenceIds: string[] = [];
              try {
                evidenceIds = await insertEvidenceBatch(evidenceInputs);
              } catch (err) {
                console.warn(
                  `[import-json] case=${caseId} insertEvidenceBatch for PDFs failed: ${(err as Error).message}`
                );
              }
              const baseIdx = bundle.extracted_text.length;
              newSegs.forEach((s, i) => {
                bundle.extracted_text.push({
                  text: s.text,
                  source: s.url,
                  cite_key: `PDF${baseIdx + i + 1}`,
                  evidence_id: evidenceIds[i], // may be undefined if insert failed
                  kind: "extracted_text",
                });
              });
            }
          }

          const out = await runAnalysis(bundle);
          await insertVerdict(out);
          queued++;
        } catch (e) {
          console.warn(`[admin/import-json] scoring failed for case ${caseId}: ${(e as Error).message}`);
        }
      }
    });

    res.json({
      ok: true,
      scanned,
      imported,
      queued: importedCaseIds.length,
      skipped_existing: skippedExisting,
      skipped_not_in_target: skippedNotInTarget,
      errors,
    });
  } catch (err) {
    res.status(500).json({ error: "Import failed", detail: String((err as Error).message) });
  }
});

/**
 * PATCH /api/admin/cases/:id/speech
 * Body: { avatar_script: string }
 * Grand Moderator edits the speech text before approving for render.
 */
app.patch("/api/admin/cases/:id/speech", moderatorAuth, async (req, res) => {
  try {
    const script = String(req.body?.avatar_script ?? "");
    const updated = await setVerdictSpeech(req.params.id, script);
    if (!updated) return res.status(404).json({ error: "Verdict not found" });
    await appendAuditLog({
      action: "verdict.speech.edited",
      entity_type: "verdict",
      entity_id: req.params.id,
      actor_role: "moderator",
      details: { case_id: updated.case_id, length: script.length },
    });
    res.json({ ok: true, verdict_id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: "Save speech failed", detail: String((err as Error).message) });
  }
});

/**
 * POST /api/admin/cases/:id/approve-and-render
 * Marks verdict approved, then immediately submits a HeyGen render job.
 * Returns fast (no waiting for the render to finish). The background poller
 * below picks up rendering verdicts and writes the video URL when ready.
 */
app.post("/api/admin/cases/:id/approve-and-render", moderatorAuth, async (req, res) => {
  try {
    const verdictId = req.params.id;
    const speech = await getVerdictAvatarScript(verdictId);
    if (speech === null) return res.status(404).json({ error: "Verdict not found" });
    if (!speech.trim()) {
      return res.status(400).json({ error: "Cannot render: avatar_script is empty" });
    }
    // Mark approved first so the row's state is consistent even if HeyGen errors.
    const updated = await setVerdictApprovedForRender(verdictId);
    if (!updated) return res.status(404).json({ error: "Verdict not found" });

    // Submit to HeyGen — fire-and-forget. The poller catches the result.
    let videoId: string | null = null;
    let renderError: string | null = null;
    try {
      videoId = await heygenCreateVideo(speech);
      await setVerdictAvatarVideo(verdictId, {
        status: "rendering",
        video_id: videoId,
        error: null,
      });
    } catch (e) {
      renderError = String((e as Error).message);
      await setVerdictAvatarVideo(verdictId, {
        status: "failed",
        video_id: null,
        error: renderError,
      });
    }

    await appendAuditLog({
      action: "verdict.approved_for_render",
      entity_type: "verdict",
      entity_id: verdictId,
      actor_role: "moderator",
      details: { case_id: updated.case_id, heygen_video_id: videoId, error: renderError },
    });

    if (renderError) {
      return res.status(502).json({ ok: false, verdict_id: verdictId, error: "HeyGen submission failed", detail: renderError });
    }
    res.json({ ok: true, verdict_id: verdictId, avatar_status: "rendering", heygen_video_id: videoId });
  } catch (err) {
    res.status(500).json({ error: "Approve-and-render failed", detail: String((err as Error).message) });
  }
});

/**
 * POST /api/admin/render-all
 * Kicks off HeyGen renders for every verdict that has a non-empty avatar_script
 * and isn't already rendering / ready. Fire-and-forget — returns immediately
 * with a count of how many were queued; the background poller surfaces results
 * as videos finish. Use this from the Grand Moderator screen to avoid clicking
 * "Запустить рендер" on each row individually.
 */
/**
 * GET /api/nominations/:code/summary
 * Returns current state of the nomination-level summary speech (text + video).
 * Public read so the Home page can show «Готово / Не готово» without auth.
 */
app.get("/api/nominations/:code/summary", async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const row = await getSummary(code);
    res.json({ ok: true, nomination_code: code, summary: row });
  } catch (e) {
    res.status(500).json({ error: "summary fetch failed", detail: String((e as Error).message) });
  }
});

/**
 * POST /api/admin/nominations/:code/summary/generate
 * Generates the speech text from current verdicts in the nomination.
 * Saves it to nomination_summaries (creates row if absent). Does NOT render
 * the video — that's a separate step so the moderator can review the text.
 */
app.post("/api/admin/nominations/:code/summary/generate", moderatorAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { speech_text, prompt_hash, model_id } = await generateSummarySpeech(
      code,
      process.env.OPENAI_API_KEY
    );
    const row = await upsertSummary(code, {
      speech_text,
      prompt_hash,
      model_id,
      // Reset any prior render state — the text changed.
      heygen_video_id: null,
      avatar_video_url: null,
      avatar_status: "pending",
      avatar_error: null,
      speech_generated_at: new Date().toISOString(),
    });
    res.json({ ok: true, summary: row });
  } catch (e) {
    res.status(500).json({ error: "generate failed", detail: String((e as Error).message) });
  }
});

/**
 * POST /api/admin/nominations/:code/summary/render
 * Submits the saved speech text to HeyGen. Fire-and-forget — the poller
 * picks up the result and writes the URL back.
 */
app.post("/api/admin/nominations/:code/summary/render", moderatorAuth, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const row = await getSummary(code);
    if (!row || !row.speech_text || !row.speech_text.trim()) {
      return res.status(400).json({ error: "no speech_text — generate first" });
    }
    let videoId: string | null = null;
    let renderError: string | null = null;
    try {
      videoId = await heygenCreateVideo(row.speech_text);
      await upsertSummary(code, {
        heygen_video_id: videoId,
        avatar_status: "rendering",
        avatar_error: null,
        avatar_updated_at: new Date().toISOString(),
      });
    } catch (e) {
      renderError = String((e as Error).message);
      await upsertSummary(code, {
        avatar_status: "failed",
        avatar_error: renderError,
        avatar_updated_at: new Date().toISOString(),
      });
    }
    if (renderError) {
      return res.status(502).json({ ok: false, error: "HeyGen submission failed", detail: renderError });
    }
    res.json({ ok: true, nomination_code: code, avatar_status: "rendering", heygen_video_id: videoId });
  } catch (e) {
    res.status(500).json({ error: "render failed", detail: String((e as Error).message) });
  }
});

app.post("/api/admin/render-all", moderatorAuth, async (_req, res) => {
  try {
    const all = await listVerdicts({ limit: 1000 });
    // Eligible: has a non-empty script, not already in flight or finished.
    const eligible = all.filter(
      (v) =>
        v.avatar_script &&
        v.avatar_script.trim().length > 0 &&
        v.avatar_status !== "rendering" &&
        v.avatar_status !== "ready"
    );

    // Respond immediately — the loop runs in the background. Each HeyGen
    // submission takes ~1s, so 50 cases take ~1 minute; we don't want to
    // block the Grand Moderator's browser for that.
    res.json({
      ok: true,
      total_verdicts: all.length,
      queued: eligible.length,
      already_rendering_or_ready: all.length - eligible.length,
    });

    setImmediate(async () => {
      let succeeded = 0;
      let failed = 0;
      for (const v of eligible) {
        try {
          await setVerdictApprovedForRender(v.evaluation_id);
          const videoId = await heygenCreateVideo(v.avatar_script as string);
          await setVerdictAvatarVideo(v.evaluation_id, {
            status: "rendering",
            video_id: videoId,
            error: null,
          });
          await appendAuditLog({
            action: "verdict.approved_for_render",
            entity_type: "verdict",
            entity_id: v.evaluation_id,
            actor_role: "moderator",
            details: { case_id: v.case_id, heygen_video_id: videoId, source: "render-all" },
          });
          succeeded++;
        } catch (e) {
          const msg = String((e as Error).message);
          console.warn(`[admin/render-all] failed for verdict ${v.evaluation_id}: ${msg}`);
          await setVerdictAvatarVideo(v.evaluation_id, {
            status: "failed",
            video_id: null,
            error: msg,
          }).catch(() => { /* swallow secondary failure */ });
          failed++;
        }
      }
      console.log(`[admin/render-all] done: ${succeeded} queued, ${failed} failed`);
    });
  } catch (err) {
    res.status(500).json({ error: "render-all failed", detail: String((err as Error).message) });
  }
});

// ---------------------------------------------------------------------------
// Background poller: every 30s, check all verdicts in 'rendering' state and
// pull their HeyGen status. When a render completes, save the URL and flip
// avatar_status to 'ready'. When it fails, set 'failed' + error message.
//
// Runs in-process — fine for the festival-scale workload (~50 cases). For
// higher volume we'd extract this to a separate worker.
// ---------------------------------------------------------------------------
const POLL_INTERVAL_MS = 30_000;

async function pollHeyGenOnce(): Promise<void> {
  if (!process.env.HEYGEN_API_KEY) return; // poller is a no-op until key is set
  let rendering: Array<{ id: string; case_id: string; avatar_video_id: string | null }> = [];
  try {
    rendering = await listRenderingVerdicts();
  } catch (e) {
    console.warn(`[heygen-poll] listRenderingVerdicts failed: ${(e as Error).message}`);
    return;
  }
  if (rendering.length === 0) return;
  console.log(`[heygen-poll] checking ${rendering.length} rendering verdict(s)`);
  for (const v of rendering) {
    if (!v.avatar_video_id) continue;
    try {
      const s = await heygenGetVideoStatus(v.avatar_video_id);
      if (s.status === "completed" && s.video_url) {
        await setVerdictAvatarVideo(v.id, { status: "ready", url: s.video_url, error: null });
        console.log(`[heygen-poll] verdict ${v.id.slice(0, 8)} → ready`);
      } else if (s.status === "failed") {
        await setVerdictAvatarVideo(v.id, { status: "failed", error: s.error ?? "HeyGen render failed" });
        console.warn(`[heygen-poll] verdict ${v.id.slice(0, 8)} → failed: ${s.error}`);
      }
      // pending / processing / waiting — leave as-is, will poll again
    } catch (e) {
      console.warn(`[heygen-poll] verdict ${v.id} status check failed: ${(e as Error).message}`);
    }
  }

  // Also poll nomination-level summary renders.
  try {
    const renderingSummaries = await listRenderingSummaries();
    for (const s of renderingSummaries) {
      if (!s.heygen_video_id) continue;
      try {
        const st = await heygenGetVideoStatus(s.heygen_video_id);
        if (st.status === "completed" && st.video_url) {
          await setSummaryAvatarVideo(s.nomination_code, {
            status: "ready", video_url: st.video_url, error: null,
          });
          console.log(`[heygen-poll] summary ${s.nomination_code} → ready`);
        } else if (st.status === "failed") {
          await setSummaryAvatarVideo(s.nomination_code, {
            status: "failed", error: st.error ?? "HeyGen render failed",
          });
          console.warn(`[heygen-poll] summary ${s.nomination_code} → failed: ${st.error}`);
        }
      } catch (e) {
        console.warn(`[heygen-poll] summary ${s.nomination_code} status check failed: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.warn(`[heygen-poll] listRenderingSummaries failed: ${(e as Error).message}`);
  }
}

setInterval(() => {
  pollHeyGenOnce().catch((e) => console.warn(`[heygen-poll] tick failed: ${(e as Error).message}`));
}, POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
