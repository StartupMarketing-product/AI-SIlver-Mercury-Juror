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
import { uploadCaseFile, type StoredFileRef } from "./storage.js";
import { buildCaseBundle } from "./ingestion.js";
import { runAnalysis } from "./runAnalysis.js";
import { resolveNomination } from "./caseLookup.js";
import { moderatorAuth } from "./auth.js";

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

    for (const nom of nominations) {
      const code = (nom?.code ?? "").toUpperCase();
      if (!TARGET_NOMINATIONS.has(code)) {
        skippedNotInTarget += Array.isArray(nom?.projects) ? nom.projects.length : 0;
        continue;
      }
      const blockId = String(nom?.block_id ?? "53");
      const year = String(nom?.year ?? new Date().getFullYear());

      for (const p of nom?.projects ?? []) {
        scanned++;
        const projectId = p?.project_id ?? p?.id;
        if (!projectId) continue;
        const externalId = `SM-${year}-${projectId}`;
        const text = pickTextFields(p);
        if (!text.project_info && !text.project_strategy && !text.project_results && !text.project_business_results) {
          // Empty submission — keep it but mark as "uploaded" so Grand Moderator can see it
          // (some festival entries genuinely come in with skeletal text).
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
}

setInterval(() => {
  pollHeyGenOnce().catch((e) => console.warn(`[heygen-poll] tick failed: ${(e as Error).message}`));
}, POLL_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
