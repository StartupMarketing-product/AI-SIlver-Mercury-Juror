# Synthetic AI Juror — External Review Package

**Purpose:** This document is for handing the project to ChatGPT, Gemini, Claude, or any other LLM for a second opinion. Paste the entire document into a fresh chat, then use the prompt at the very bottom.

---

## 1. Problem statement

I'm building a **synthetic AI juror for the Silver Mercury XXVII Russian advertising festival**. The system reads a submitted case (text fields describing a campaign — strategy, results, channels, etc.), scores it on 1-10 per criterion against the festival's regulation, weights the criteria per nomination, and outputs a final award band: gold (9-10), silver (7-8), bronze (5-6), shortlist (3-4), longlist (1-2), or none.

The goal is to match how the human jury panel (~7-15 expert humans per case) actually scored the same cases at last year's festival (XXVI, dataset of 1696 real cases with full evaluations).

## 2. The core problem I keep hitting: clustering

Every AI prompt iteration ends up clustering all cases around 4-6 regardless of actual quality. Real human jurors at the festival use the full 1-10 scale (project-medians: gold=9.27, silver=7.78, bronze=5.82, shortlist=3.93, longlist=2.19), but the AI compresses to a 1-point spread.

After ~6 iterations, current best is **24% exact-band match** on a 17/30-case backtest (still in progress). For comparison, a top-calibrated human juror (judge ID 8837 in the data) had **0.987 correlation** between her individual scores and final awards across 12 cases — using the full 1.15-10 range.

## 3. What's been tried (chronologically)

- **v1**: hostile persona ("be tough", "presumes case lies"), variance penalties → all classes collapsed to mean 3.7
- **v2**: loosened evidence-grade caps + softer critic → still collapsed, mean 5.1
- **v3**: explicit per-band triggers + "fair not hostile" persona, removed flat-distribution penalty → exact match 23%, real spread restored
- **v4**: added 5 hardcoded synthetic few-shot examples + "critique-then-score" two-step protocol → went up too far, none cases overscored
- **v5**: added numeric-evidence floor (cap results criteria at 3 if `project_results` text has <2 quantitative tokens) → exact match 13%, regressed
- **v6 (current)**: replaced all my invented rules with **empirical anchors** retrieved per-case from the data — for each case being scored, the prompt fetches 5 real comments from the same nomination at different score bands, written by the top-184 calibrated human jurors. Plus persona voice cloned from top-5 jurors specifically. → exact match 24% (partial), gold-class scoring is now correctly highest, but well-written empty cases still inflate to silver
- **v7 (just landed, not tested)**: tightened numeric floor to FLOOR_CAP=2 with THRESHOLD=3, removed redundant generic anchors, relaxed schema min lengths to match real top-jury terseness

## 4. Empirical data the system uses

`backend/src/data/judgeAnchors.json` — built from `SM_2025.json` (the historical festival dataset). Contains:
- 2104 real human-judge L2 evaluations
- From the top-184 calibrated jurors (correlation ≥ 0.80 between their individual L2 score and final award)
- Each anchor: `{judge_id, project_id, project_name, nomination_code, block_id, total, diplom, comment, per_criterion}`
- Indexed by nomination and by block for retrieval
- Covers 10 of 12 blocks, 78 of 157 nominations

Top 5 jurors used as voice template: 8837, 8918, 9774, 10369, 9600. Their stats: avg comment length 270 chars, score range 1-10, correlation ≥0.976.

## 5. Phase 1 empirical findings (from `phase1_report.md`)

Real human juror behavior on SM_2025 (8777 evaluations, 781 projects, 937 judges):

**Project-median total score by final award (the regulation's actual mechanism):**
- Gold: 9.27 (range 8.8-9.9)
- Silver: 7.78 (range 7.0-8.5)
- Bronze: 5.82 (range 5.0-6.7)
- Shortlist: 3.93 (range 3.1-4.8)
- Longlist: 2.19 (range 1.6-2.8)

**Individual judge scores span the FULL 1-10 range** for all award classes. Clustering is purely an LLM artifact, not a methodology artifact. The regulation's mechanism for handling clustering is N≥7 judges + median aggregation.

## 6. Architecture (current, v7)

```
backend/src/
├── runAnalysis.ts          — orchestrator: ingestion → L2 → critic → caps
├── l2.ts                   — main scoring (calls gpt-4o), 600+ lines
├── critic.ts               — asymmetric "downgrade-only" second-pass
├── judgeAnchorsLoader.ts   — retrieves real-judge comments per nomination
├── methodologyLoader.ts    — loads regulation criteria/weights/thresholds
├── anchorsLoader.ts        — generic 2/5/8 anchors (now unused in prompt)
├── data/judgeAnchors.json  — 2104 real evaluations from calibrated humans
├── config/methodology.json — extracted from Регламент Silver Mercury XXVII.pdf
├── types/l2Schema.ts       — strict zod schema for model JSON output
├── types/case.ts           — case bundle structure
├── types/evaluation.ts     — output schema
└── scripts/
    ├── backtestSM2025.ts   — runs 30-300 cases, supports --resume
    ├── phase1_analyze.mjs  — generates phase1_report.md
    └── phase2_extract.mjs  — generates judgeAnchors.json
```

**Key flow (one case):**
1. Bundle case text from DB
2. Resolve nomination → block + criterion weights
3. Build prompt: persona + scale-bands + retrieved anchors + criteria list + JSON schema demand
4. Call gpt-4o once (with one retry on schema validation fail)
5. Apply post-hoc caps: per-criterion evidence_grade caps → numeric_evidence_floor → block-level evidence cap
6. Optional: critic pass (asymmetric downgrade-only)
7. Compute weighted block_score → award_level via methodology thresholds

## 7. The L2 prompt structure (in `l2.ts`)

```
HOSTILE_PERSONA           — voice cloned from top-5 calibrated jurors
SCALE_BANDS               — empirical distribution from human data + regulation
[retrieved anchors]       — 5 real top-judge comments at different bands from same nomination
ANTI_SYCOPHANCY_RULES     — 6 rules: anchor matching, distribution, comment style, evidence_grade, why_not_higher, fatal_flaws
[two-step protocol]       — explicit "критика → балл" instruction
[JSON schema demand]      — strict shape with all required fields
```

Total prompt size: ~6-8k tokens. One call with gpt-4o-mini takes 25-35s and ~$0.10. Critic adds another call.

## 8. Evidence/cap stack (post-model)

After the model returns:
1. **Per-criterion evidence_grade caps** — if model flagged `no_baseline` (cap=6), `no_causality` (cap=5), `no_attribution` (cap=7) on results-type criteria, apply those caps.
2. **Numeric evidence floor** — if `project_results` text has <3 quantitative tokens (digits with scale words / %), cap results-type criteria at 2.
3. **Block-level evidence cap** — if 2+ evidence_grade flags, cap final block_score at 5.5; if 3 flags, cap at 4.5.
4. **Critic pass (optional, env-gated)** — second call asks a critic persona "did the L2 judge over-rate?" and can only downgrade.

## 9. Current results (v6 partial, 17/30 cases)

| Class | v3 mean | v6 mean | Change |
|---|---|---|---|
| none | 5.72 | 6.12 | ↑ 0.40 (worse) |
| shortlist | 5.24 | 5.66 | ↑ 0.42 (worse) |
| silver | 5.90 | 6.64 | ↑ 0.74 (better) |
| gold | 4.95 | 6.40 | ↑ 1.45 (much better) |

For the first time in v6, gold-class cases score higher than none-class cases. Class ordering is now correct, but absolute spread between top and bottom is still only ~1 point. Top-calibrated humans get a ~7-point spread (gold-median 9.27 vs longlist-median 2.19).

**Specific observed failures in v6:**
- "Авито Работа: Твой опыт в жизни тоже считается" — actually `none`, AI gave 8.6 (false silver)
- "Наш, как все мы" — actually `shortlist`, AI gave 8.3 (false silver)
- Rich-prose-but-empty cases inflate up
- Some genuine silvers under-scored (e.g., "Мультвселенная" got 5.5, was 7.4 in v3)

## 10. Open questions for the reviewer

I'd like an outside opinion on:

1. **Is the empirical-anchor retrieval approach sound?** Is there a cleaner architecture for "imitation learning" from a small set of expert demonstrations? Should I be doing fine-tuning instead?

2. **Should I be running an ensemble (5 personas, median aggregate) or single-judge?** The user pushed back on the ensemble idea because the personas would still be prompt-engineered and might just amplify the same bias. But the regulation's anti-clustering mechanism IS multi-judge median. Is single-judge a structural ceiling?

3. **Is the cap stack (4 layers) overengineered?** Should I delete some of these and trust the prompt? Or are they the only thing preventing collapse?

4. **The critic pass — is it doing real work or adding noise?** Asymmetric downgrade-only sounded smart but I haven't measured its delta independently.

5. **Could I be missing a fundamental feature in the case data I should be using?** Currently I use text fields (project_info, project_results, project_strategy, etc.). The dataset also has video links (Whisper transcript pipeline not built), presentation PDFs (parsed if present), and project_business_results. Is text-only the bottleneck?

6. **Specific bug check.** Is anything in `l2.ts` or `runAnalysis.ts` likely to silently fail and produce wrong scores? Is the critic_deltas application chain correct? Does the schema retry actually retry, or does it skip to fallback too eagerly?

7. **Is 24% exact-match achievable with this approach, or am I pursuing a dead end?** What's the realistic ceiling given (a) only text input, (b) one LLM call per case, (c) no fine-tuning?

8. **Is there a Russian-specific concern?** All cases are in Russian. Does gpt-4o handle Russian-language scoring less reliably than English? Should I be using a different model (Claude, Yandex GPT, Gemini in Russian)?

## 11. Files for the reviewer to look at

In priority order:

1. `backend/src/l2.ts` — the heart of it, scoring prompt + caps (~600 lines)
2. `backend/src/judgeAnchorsLoader.ts` — retrieval logic (~140 lines)
3. `backend/src/critic.ts` — asymmetric critic (~230 lines)
4. `backend/src/runAnalysis.ts` — orchestration (~150 lines)
5. `backend/src/types/l2Schema.ts` — output schema (~60 lines)
6. `phase1_report.md` — empirical analysis of human jury behavior
7. `phase2_voice_analysis.md` — top-5 juror voice patterns
8. `Регламент Silver Mercury XXVII.pdf` — the official regulation (page 69 has scoring procedure)

## 12. Things explicitly outside the review scope

- The Cowork sandbox / hosting / Supabase / frontend — those work fine
- The avatar script generation (DigitalAvatar, lip-sync, etc.) — separate later phase
- Document upload pipeline / S3 / OCR — separate phase
- TheTypeScript compiler errors — there are none currently

---

# THE PROMPT TO PASTE AFTER THIS DOCUMENT

```
You're a senior ML/LLM engineer doing an external review. Read the document above carefully, then load the file paths it references (the user will paste them or you can request them).

Don't summarize what you read — that's not useful. Instead:

1. Pick the SINGLE biggest reason this system is at 24% exact-match and not 60%+. Be specific. Tell me which file and which lines, and what the fundamental issue is. Disagree with the analysis above if you think it's wrong.

2. Propose ONE concrete change you would make first. Not "consider trying X". A specific code-level change with a hypothesis about why it would move the metric.

3. Tell me which of the 8 open questions above is the most important one to answer empirically, and how you'd design the simplest test to answer it (with rough cost estimate in $ and hours).

4. Tell me what you'd CUT. The system has accumulated 6 iterations of complexity. What can I delete without losing signal?

5. Tell me one thing the human user (a non-engineer) should personally verify before paying for a 200-case backtest. Something they can eyeball in 10 minutes that would catch a fundamental error.

Be direct. No filler. Push back where you disagree. If you think the entire approach is wrong, say so and propose an alternative.
```
