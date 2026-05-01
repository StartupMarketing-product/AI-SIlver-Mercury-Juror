# AI Jury Avatar — Plan for External Review

This document describes a project in progress and a forward plan for an AI juror avatar system.
It is intended for critical review by ChatGPT, Claude, or other AI systems.
Please critique the plan, identify gaps, suggest improvements, and flag any risks not yet addressed.

---

## 1. Project Context

We are building a **Synthetic AI Juror** for the Silver Mercury advertising festival.
The AI juror evaluates marketing case submissions and produces structured verdicts,
replacing or supplementing human judges in the shortlisting and scoring process.

The platform currently exists and judges cases using a two-stage pipeline:
- **L1 (Longlist Gate):** passes or rejects a case before detailed scoring.
- **L2 (Criteria Scoring):** scores each case on 5 criteria with weighted total, assigns award level.

Cases come from the Silver Mercury submission system. A submission typically contains:
- Text form fields (task, strategy, results, insight, channels, etc.)
- PDF files (presentation deck, results proof documents)
- Video links (not yet processed)

Human judge reference data is available in SM_2025.json (historical Silver Mercury judging data),
containing all cases with L1 votes, L2 scores, human judge comments, and award outcomes.

---

## 2. Current Platform State

### Tech Stack
- Backend: Node.js + Express + TypeScript (port 3010)
- Frontend: Vite + React + TypeScript (port 5173)
- LLM: OpenAI gpt-4o-mini (L1 and L2 analysis)
- Storage: file-based (backend/data/cases, backend/data/evaluations)
- PDF parsing: pdf-parse library
- OCR fallback: tesseract.js (local, no paid OCR API)

### Key Backend Modules
- `l1.ts` — longlist decision logic
- `l2.ts` — criteria scoring logic
- `runAnalysis.ts` — orchestration: L1 → L2 → calibration → consistency
- `ingestion.ts` — PDF text extraction + OCR fallback pipeline
- `judgePriors.ts` — extracts recurring rejection tags from SM_2025.json judge comments
- `historicalKnowledge.ts` — retrieves nearest historical cases by text similarity, calibrates scores
- `caseLookup.ts` — resolves correct nomination ID from SM_2025.json by project ID or name
- `methodologyLoader.ts` — loads scoring methodology config (blocks, criteria, weights, thresholds)
- `scripts/replayBenchmark.ts` — replays SM_2025 cases and reports L1 agreement metrics

### Current Scoring Results (latest benchmark on 50 cases from SM_2025.json)
- L1 agreement with human judges: 64%
- False positive rate (AI says long when human says not_long): 0%
- False negative rate (AI too strict, rejects when humans accepted): 36%
- Medal precision: n/a (no medals predicted in this run)

### Key known gap
The model is **too conservative** in some nominations (987, 984, 988).
It correctly eliminates false positives but over-rejects strong cases.
Root cause: forensic evidence gates require explicit YoY baselines and attribution text,
but many strong cases submit this evidence via image-heavy PDF slides rather than plain text,
and OCR of those slides does not always capture the right signals.

---

## 3. Judging Methodology (how the system decides)

### L1 Decision Logic
1. Extract PDF text + OCR fallback from uploaded files.
2. Run deterministic forensic checks on all text (form fields + extracted PDF content):
   - `has_yoy_baseline`: year-on-year comparison found?
   - `causality_proven`: attribution language found?
   - `proof_docs_present`: confirmed by PDF uploaded?
   - `periods_consistent`: no inconsistent period signals?
3. If `results_required=true` (most blocks) and evidence is absent → force `not_long`.
4. If `proof_docs_present=false` → treat as forensic weak → force `not_long`.
5. Otherwise: call OpenAI with case text + deterministic signals + historical priors + nearest precedents.
6. Parse response; if decision unrecognized → fallback to deterministic (fail-closed).
7. Enforce: if `results_required=true` and grade is `absent` → always `not_long`.

### L2 Scoring Logic
1. If L1 = `not_long` → cascade: award = `not_long`, all caps applied.
2. Score 5 criteria: challenge, idea, execution, results, strategy.
3. Default for missing/invalid criterion: score 3 (penalty, not neutral 5).
4. Apply deterministic caps:
   - results criterion capped at 3 if evidence absent, 5 if claimed.
   - idea criterion capped at 6 if historical novelty rejection pattern detected.
   - 9–10 scores blocked unless evidence grade is verified.
   - total score capped at 5.8 if forensic is weak.
   - award capped at shortlist/longlist if claimed evidence and no baseline.
5. Calibrate total score against human score distribution for this nomination.
6. Recompute award level from calibrated score and methodology thresholds.

### Methodology Config (block 50, FMCG/general)
- Criteria weights: challenge 15%, idea 25%, execution 25%, results 25%, strategy 10%
- Award thresholds: gold ≥ 8.5, silver ≥ 7.5, bronze ≥ 6.5, shortlist ≥ 5.5, longlist = pass
- results_required: true
- if_results_missing: not_long

### Historical Knowledge Integration
- On each analysis, nearest 4–6 historical cases from same nomination are retrieved by Jaccard text similarity.
- Injected into L1 and L2 system prompts as precedents (project_id, to_long, diplom_text, L1 votes, L2 avg).
- Top recurring rejection tags injected as priors (e.g. NO_BASELINE, NO_NOVELTY_BENCHMARK, NO_CAUSALITY).
- Score calibrated against historical L2 avg distribution for this nomination using quantile mapping.

---

## 4. PDF Ingestion and OCR Pipeline

Upload flow:
1. User uploads case via web form (text fields + PDF files).
2. PDFs saved to backend/uploads/{case_id}/.
3. On analysis trigger, ingestion.ts builds CaseBundle:
   a. Text fields added as extracted segments.
   b. Each PDF: native text extraction via pdf-parse.
   c. If extracted text is sparse (<1000 chars after cleanup) → OCR fallback:
      - Layer 1: OCR on embedded images within the PDF.
      - Layer 2: if embedded images fail → render page screenshots → OCR each page.
   d. OCR uses local Tesseract.js (Russian + English).
4. All extracted segments (form text + PDF text + OCR text) passed to L1 and L2.

Known limitation:
- Some PDF presentations render as images with no native text layer and also fail embedded-image extraction (e.g. complex slide decks). Layer 2 page-screenshot OCR handles these, but text yield can still be limited.

---

## 5. Avatar Juror Plan (next phase)

### Goal
Build an AI juror that:
- presents its verdict and scoring arguments in a live Zoom call,
- can answer 1–2 short questions from the moderator when explicitly prompted,
- stays strictly grounded in case evidence and methodology (no hallucination),
- works in hybrid mode (moderator controls when avatar speaks).

### Agreed constraints
- Avatar will NOT behave like a human in open debate.
- Avatar only speaks when moderator triggers it.
- Q&A limited to 1–2 questions per case, short answers (2–4 sentences).
- Strict mode by default: answer only from case evidence + methodology.
- Discussion mode optional (moderator toggle only).

### Recommended Tech Stack (Buy 80%, Customize 20%)

| Layer | Tool | Why |
|-------|------|-----|
| Zoom bot participant | Recall.ai | Joins Zoom as native participant, handles audio/video streams |
| Avatar face + voice | HeyGen Interactive Avatar | Live lip-synced avatar, real-time speech output |
| LLM reasoning | OpenAI API | Q&A grounding, verdict generation |
| Logs/audit | Supabase or Postgres | Per-response evidence trail |
| Custom layer | This backend | Jury rubric, hard gates, RAG, moderator controls |

### Zoom participation model
- Avatar joins as second participant ("AI Juror").
- Recommended: second laptop as dedicated avatar operator device (cleaner audio routing).
- Fallback: moderator laptop runs avatar app in parallel.
- Verdict presentation triggered by operator UI button.
- Q&A triggered by operator only (push-to-listen, not always-on).

### End-to-end runtime flow
1. Moderator triggers "Present verdict" in Operator Console.
2. Backend fetches evaluation verdict_package (L1 decision, L2 scores, evidence, arguments).
3. TTS renders scripted verdict → HeyGen lip-syncs avatar → audio streamed into Zoom.
4. Moderator asks question → clicks "Answer now" → app captures/transcribes question.
5. Q&A engine fetches answer from case verdict_package (RAG over case evidence).
6. Safety/guardrail check → TTS → avatar speaks answer.
7. All interactions logged: question, evidence used, answer, moderator action, timestamps.

### Moderator controls
- `Play verdict`
- `Answer on command` (moderator pastes or speaks question)
- `Regenerate shorter`
- `Interrupt/Stop`
- `Strict mode toggle` (keep ON by default)

### What must be built custom
- `verdict_package` schema (extend existing evaluation output)
- RAG over extracted case evidence (PDF text + form fields)
- Strict refusal policy (no claims without evidence reference)
- Moderator operator console UI
- Audit log schema and UI
- Integration: Recall.ai ↔ HeyGen ↔ OpenAI orchestration

### What can be bought off-the-shelf
- Zoom bot joining + audio/video routing: Recall.ai
- Live avatar rendering: HeyGen
- LLM reasoning: OpenAI (already in use)
- Meeting infrastructure: Zoom Pro/Business

---

## 6. Open Questions for Reviewer

1. Is the Recall.ai + HeyGen combination well-documented enough to build reliably in 2026?
   Are there known integration failures or latency issues between them?

2. Is deterministic forensic gating (hard caps before LLM) the right pattern for evidence-grounded scoring,
   or does it introduce too many false negatives for edge cases?

3. Is Jaccard text similarity sufficient for historical case retrieval, or should we use embeddings (dense retrieval)?

4. For the calibration layer (quantile mapping of AI scores to human score distribution per nomination):
   is this sound methodology for aligning LLM outputs to human judge behavior?
   What are the risks of this approach?

5. For the Q&A layer: what is the safest and most reliable way to ground short live answers
   in evidence from PDF/form content without hallucination, given a 2–5 second latency budget?

6. What is missing from this plan that would cause it to fail in production?

---

## 7. Summary of Risks

| Risk | Severity | Status |
|------|----------|--------|
| Over-rejection of strong cases with image-heavy PDF evidence | High | Known, partially mitigated via OCR |
| Calibration divergence if nomination sample is small | Medium | Known, fallback to global priors |
| Recall.ai + HeyGen latency in live Zoom | Medium | Not yet tested |
| Moderator UX complexity (operator console not built) | Medium | Planned |
| LLM hallucination during live Q&A | High | Guardrails designed, not implemented |
| Audio routing issues on single laptop | Low | Documented fallback to second device |
| SM_2025.json data coverage gaps for some nominations | Medium | Known, global fallback exists |
