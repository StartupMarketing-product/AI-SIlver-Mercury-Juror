# Synthetic AI Juror — FULL External Review Package (self-contained)
This is the complete project state for external review. All code, empirical data, and context are below — no need to ask for files.
**Document map:**
1. Project context, problem, attempts, results (sections 1-10)
2. Inlined source code for all critical files (section 11)
3. Empirical analysis outputs (section 12)
4. Configuration data samples (section 13)
5. The review prompt to use (section 14)

---

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

## 11. Original — Files for the reviewer to look at (now inlined below)

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

# (review prompt below — see section 14)

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


---

# 12. Inlined source code

## `backend/src/l2.ts`

*Main scoring module — calls gpt-4o, applies caps. THE HEART OF THE SYSTEM.*

```typescript
import OpenAI from "openai";
import { createHash } from "crypto";
import type { CaseBundle } from "./types/case.js";
import type { MethodologyBlock, NominationDef } from "./types/methodology.js";
import type { CriterionScore, EvidenceGrade } from "./types/evaluation.js";
import { resolveCriterionWeights, scoreToAwardLevel, getMethodology } from "./methodologyLoader.js";
import { getAnchorSet, getSocialOutcomesAnchors } from "./anchorsLoader.js";
import { L2ResponseSchema, type L2Response } from "./types/l2Schema.js";
import { retrieveAnchors, renderAnchorBlock } from "./judgeAnchorsLoader.js";

/**
 * L2 scoring — Phase 3 implementation.
 *
 * What landed in Phase 3:
 *   - Strict zod validation of model JSON; one retry then fall back.
 *   - Evidence-id citation: prompt renders each evidence segment with a cite_key
 *     (E1, E2, ...) and the model is required to cite them in evidence_ids.
 *     Cite keys are mapped back to public.evidence row ids before persistence.
 *   - Evidence-grade caps: model can flag no_baseline / no_causality /
 *     no_attribution; results-type criteria are capped accordingly before
 *     scoreToAwardLevel runs.
 *   - prompt_hash + model_id stamped onto the L2 result for full reproducibility.
 *
 * Future: streaming partials for live UI; multi-judge ensemble; image-grounded
 * scoring on visual-craft criteria.
 */

export type AwardLevel = "gold" | "silver" | "bronze" | "shortlist" | "longlist";

export interface CapApplied {
  criterion: string;
  original_score: number;
  capped_score: number;
  reason: string;
}

export interface L2Result {
  criteria_scores: CriterionScore[];
  block_score: number;
  social_outcomes_score?: number;
  total_score: number;
  award_level: AwardLevel;
  one_paragraph_verdict: string;
  avatar_script: string;
  avatar_script_structured?: {
    short: string;
    long: string;
    sections: { hook: string; verdict: string; steelman: string; fatal_flaw: string; close: string };
  };
  evidence_grade?: EvidenceGrade;
  caps_applied: CapApplied[];
  case_fatal_flaw?: string;
  why_not_higher_band_overall?: string;
  prompt_hash: string;
  model_id: string;
}

// EMPIRICAL distribution from SM_2025.json (Phase 1 analytics): real human
// jurors at the festival use the FULL 1–10 scale with confident spread.
// Project-level medians: gold=9.27, silver=7.78, bronze=5.82, shortlist=3.93,
// longlist=2.19. Individual judge scores span 1–10 with std ~3 for top jurors.
//
// This block tells the model what the human distribution actually looks like
// — not invented thresholds, just observed reality from 8777 evaluations.
const SCALE_BANDS = `
Шкала 1–10 — КАК НА САМОМ ДЕЛЕ ОЦЕНИВАЛИ ЧЛЕНЫ ЖЮРИ XXVI (это твой бенчмарк):

Эмпирическая медиана итогового балла на ПРОЕКТЫ-победители:
  • золото:    9.27   (диапазон по проектам: 8.8–9.9, по жюри: 7–10)
  • серебро:   7.78   (диапазон: 7.0–8.5, по жюри: 4.8–9.4)
  • бронза:    5.82   (диапазон: 5.0–6.7, по жюри: 3.3–8.0)
  • шорт-лист: 3.93   (диапазон: 3.1–4.8, по жюри: 2.0–6.5)
  • лонг-лист: 2.19   (диапазон: 1.6–2.8, по жюри: 1.0–4.6)

Регламент XXVII (обязательная привязка):
  • 9–10  балл → золото
  • 7–8   балл → серебро
  • 5–6   балл → бронза
  • 3–4   балл → шорт-лист
  • 1–2   балл → лонг-лист

Распределение реальных оценок: ~25% всех баллов в диапазоне 1–3, ~25% в 4–5,
~25% в 6–7, ~25% в 8–10. Никакой "безопасной середины" 4–6 — реальные эксперты
смело ставят и единицы, и десятки. Если ты группируешь все баллы в 4–6 —
это сбой, не оценка.
`.trim();

// Persona voice cloned from top-5 calibrated jurors (judges 8837, 8918, 9774,
// 10369, 9600 — corr ≥ 0.976 between their scores and final awards). Their
// actual writing patterns observed in Phase 2 analysis:
//   • Average comment length ~270 chars (not 600+).
//   • Direct opening verdict: "Шикарный кейс…", "Отличный пример…",
//     "Хороший крепкий кейс…", "Не очевидно, как…", "Слабая идея…".
//   • Structure: verdict → 2–3 strengths with named KPIs / craft elements →
//     "Но/Однако…" → specific named gap → optional category-fit comment.
//   • Russian colloquialisms ok ("крепкое серебро", "не дотягивает", "молодцы").
//   • No hedge filler, no "в целом", no "проект демонстрирует", no "уважаемые".
//   • Asks specific questions when evidence is thin: "В чём бенчмарк?",
//     "Какие KPI стояли?", "Откуда эти цифры?".
const HOSTILE_PERSONA = `
Ты — опытный член жюри Silver Mercury XXVII. Твой ориентир — стиль топ-5
калиброванных экспертов XXVI (их балл на кейсе предсказывал итоговую медаль с
корреляцией ≥0.97). Ты пишешь как они: коротко, прямо, с названными KPI, с
"крепкой" / "не дотягивает" / "не очевидно" вместо вежливого хеджирования.

Голос:
  • Открытие фразой-вердиктом: "Шикарный кейс…", "Отличный пример индустриального
    бенчмарка", "Хороший крепкий кейс", "Не очевидно, как…", "Слабая идея".
    НЕ "в целом", НЕ "проект демонстрирует", НЕ "уважаемое жюри".
  • После вердикта — 2–3 конкретных факта (KPI, ремесло, стратегия), затем
    "Но / Однако / Не хватило…" + конкретный пропущенный элемент.
  • Если данных мало — задавай прямые вопросы: "В чём бенчмарк?", "Какие KPI?",
    "Откуда эти цифры?", "Что это даёт бизнесу?". Это не риторика — это сигнал
    низкого балла.
  • Длина обоснования критерия: 150–350 символов. Это норма от реальных топ-жюри.
  • Готов к крайностям. Если кейс — это шедевр с отцифрованными результатами и
    бизнес-импактом, ставь 9–10 и пиши "Шикарный кейс". Если кейс — пустая
    риторика без цифр, ставь 1–2 и пиши "Слабый, не отцифрован, не фестивальный".

Поведение:
  • Ты СМОТРИШЬ на якоря (примеры реальных оценок ниже). Когда видишь похожий
    по силе кейс — выставляй похожий балл. Не "защищай свой средний балл" —
    привязывайся к якорям.
  • Маркетинговый жаргон без цифр ("уникальный", "беспрецедентный", "вирусный",
    "успешный") = балл 1–3 на критерии "результаты".
  • Конкретные числа + сравнение (vs прошлый период / рынок / цель) +
    атрибуция = балл 6+. Если ещё и оригинальная идея — балл 8+.
`.trim();

const ANTI_SYCOPHANCY_RULES = `
Жёсткие требования к ответу:

1. ПРИВЯЗКА К ЯКОРЯМ. Перед тем как выставить балл, сравни кейс с
   приведёнными ниже реальными примерами оценок топ-жюри. Если кейс по
   уровню похож на пример с баллом X — твой балл должен быть в той же
   полосе ±0.5. Якоря важнее любых других правил.

2. РАСПРЕДЕЛЕНИЕ БАЛЛОВ. В реальной выборке XXVI ~25% всех баллов было в
   диапазоне 1–3, ~25% в 4–5, ~25% в 6–7, ~25% в 8–10. Если все твои
   критерии в полосе 4–6 — ты не справился. Реальные эксперты используют
   всю шкалу.

3. ОБОСНОВАНИЕ КРИТЕРИЯ — 150–350 символов в стиле топ-жюри:
     • вердикт-открытие ("Шикарный кейс…", "Хороший крепкий…", "Слабая…"),
     • 1–2 конкретных факта (KPI, ремесло, числа, сравнения),
     • "Но/Однако/Не хватило…" + конкретный пропущенный элемент.
   Без вступлений "в целом", "проект демонстрирует". Без перечисления
   общих фраз без цифр.

4. EVIDENCE_GRADE — флаги true ТОЛЬКО при реальном отсутствии данных:
     • no_baseline=true → нет ни одного сравнения (vs прошлый период / рынок / цель).
     • no_causality=true → результат мог быть достигнут и без этой кампании.
     • no_attribution=true → результат относится к нескольким активностям сразу.
   "На всякий случай" не ставь — флаги применяют жёсткие потолки на балл.

5. why_not_higher_band и why_not_higher_band_overall — конкретно, какого
   KPI или элемента не хватает для следующей полосы. Без общих формулировок.

6. fatal_flaws / case_fatal_flaw — конкретный дефект, по одному предложению.
   "Безупречно" не принимается — у любого кейса есть слабые места.
`.trim();

/** Criteria treated as "results-type" for evidence-grade caps. Matches all
 *  XXVII methodology criterion ids whose semantics are "did this work" — caps
 *  apply regardless of whether the model also flagged evidence_grade for soft
 *  criteria like idea/strategy. */
const RESULTS_LIKE_CRITERIA = new Set([
  "results",
  "effectiveness_results",
  "impact",
]);
/** Pattern fallback so we don't silently miss future criterion ids that include
 *  "result" / "impact" / "effective". */
const RESULTS_LIKE_PATTERN = /(result|impact|effective)/i;
function isResultsLikeCriterion(id: string): boolean {
  return RESULTS_LIKE_CRITERIA.has(id) || RESULTS_LIKE_PATTERN.test(id);
}

/** Hard ceilings applied to results-type criteria when evidence quality is flagged. */
const EVIDENCE_GRADE_CAPS = {
  no_baseline: 6,
  no_causality: 5,
  no_attribution: 7,
} as const;

/**
 * Numeric-evidence floor for results-type criteria. Looks at the case's
 * project_results text and counts genuinely quantitative tokens (digits with
 * scale words, percentages, currency, multipliers). If the count is below a
 * threshold, results-type criteria are capped at 3 — a case that claims
 * "значительный рост охвата" without any numbers cannot earn a results score
 * higher than shortlist, no matter how convincing the prose is.
 *
 * This is code-level, not prompt-level — the model can't bypass it. Added
 * after the v4 backtest showed few-shot examples lifting weak cases (none →
 * silver) when no quantitative anchor existed.
 */
function countQuantitativeTokens(text: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  // Strip 4-digit years so "в 2024 году" doesn't read as a quantitative claim.
  const stripped = t.replace(/\b(19|20)\d{2}\b/g, " ");
  let count = 0;
  // Percentages: 12%, 12.5%, 12 %.
  count += (stripped.match(/\d[\d\s.,]*\s*%/g) ?? []).length;
  // Currency / scale: 1,2 млн, 500 тыс, 5 млрд, 100 руб, $5, €100.
  count += (stripped.match(/\d[\d\s.,]*\s*(млн|млрд|тыс|тысяч|миллион|миллиард|руб|₽|\$|€|usd|eur)/g) ?? []).length;
  // Multipliers: x2, в 3 раза, в 5x.
  count += (stripped.match(/(в\s+\d+[\d\s.,]*\s+раз)|(\bx\s*\d+)|(\d+\s*x\b)/g) ?? []).length;
  // Counts with units: 100 человек, 2000 кликов, 50 000 показов.
  count += (stripped.match(/\d[\d\s.,]*\s*(человек|чел\.?|клик|просмотр|показ|регистр|подписчик|пользоват|посет|охват|конверс|заявк|продаж)/g) ?? []).length;
  // Bare big numbers (≥4 digits) that aren't years — likely impressions/reach.
  count += (stripped.match(/\b\d{4,}\b/g) ?? []).length;
  return count;
}

/** Apply numeric-evidence floor: if results text has too few quantitative
 *  tokens, cap results-type criteria at 3. Returns mutated copy + log. */
function applyNumericEvidenceFloor(
  criteriaScores: CriterionScore[],
  bundle: CaseBundle
): { scores: CriterionScore[]; caps: CapApplied[] } {
  const caps: CapApplied[] = [];
  const resultsText = bundle.text_fields?.project_results ?? "";
  const tokenCount = countQuantitativeTokens(resultsText);
  // Tightened after v6 backtest: weak cases with 1-2 stray numbers were
  // still scoring 7+ on results. Now requires ≥3 quantitative tokens to
  // unlock anything above 2 on results-type criteria. Forces empty-evidence
  // cases into longlist territory regardless of prose quality.
  const THRESHOLD = 3;
  const FLOOR_CAP = 2;
  if (tokenCount >= THRESHOLD) return { scores: criteriaScores, caps };
  const next = criteriaScores.map((c) => ({ ...c }));
  for (const c of next) {
    if (!isResultsLikeCriterion(c.criterion)) continue;
    if (c.score > FLOOR_CAP) {
      caps.push({
        criterion: c.criterion,
        original_score: c.score,
        capped_score: FLOOR_CAP,
        reason: `numeric_evidence_floor (only ${tokenCount} quantitative tokens in project_results)`,
      });
      c.score = FLOOR_CAP;
    }
  }
  return { scores: next, caps };
}

function buildCaseText(bundle: CaseBundle): string {
  const parts: string[] = [];
  const tf = bundle.text_fields;
  if (tf.project_info) parts.push(`## Описание / контекст\n${tf.project_info}`);
  if (tf.project_results) parts.push(`## Результаты\n${tf.project_results}`);
  if (tf.project_strategy) parts.push(`## Стратегия\n${tf.project_strategy}`);
  if (tf.project_task) parts.push(`## Задача\n${tf.project_task}`);
  if (tf.project_targets) parts.push(`## Цели\n${tf.project_targets}`);
  if (tf.project_channels) parts.push(`## Каналы\n${tf.project_channels}`);
  if (tf.project_realisation) parts.push(`## Реализация\n${tf.project_realisation}`);
  if (bundle.extracted_text?.length) {
    parts.push(
      "## Доказательная база (используй cite_key в evidence_ids):\n" +
        bundle.extracted_text
          .map((s) => `[${s.cite_key ?? "?"}] (${s.source}): ${s.text.slice(0, 1500)}`)
          .join("\n\n")
    );
  }
  return parts.join("\n\n") || "(нет текста)";
}

function computeBlockScore(
  block: MethodologyBlock,
  nomination: NominationDef,
  criteriaScores: CriterionScore[]
): number {
  const weights = resolveCriterionWeights(block, nomination);
  const byId = new Map(criteriaScores.map((c) => [c.criterion, c.score]));
  let total = 0;
  let totalWeight = 0;
  for (const { id, weight } of weights) {
    const s = byId.get(id);
    if (typeof s === "number") {
      total += s * weight;
      totalWeight += weight;
    }
  }
  return totalWeight > 0 ? Math.round((total / totalWeight) * 10) / 10 : 0;
}

function applySocialFormula(blockScore: number, socialScore: number): number {
  return Math.round(((blockScore + socialScore) / 2) * 10) / 10;
}

/** Map cite_keys (E1, E2, …) cited by the model back to public.evidence row ids. */
function resolveCiteKeys(citeKeys: string[], bundle: CaseBundle): string[] {
  const lookup = new Map<string, string>();
  for (const seg of bundle.extracted_text ?? []) {
    if (seg.cite_key && seg.evidence_id) lookup.set(seg.cite_key, seg.evidence_id);
  }
  const out: string[] = [];
  for (const key of citeKeys) {
    const id = lookup.get(key);
    if (id) out.push(id);
  }
  return out;
}

/** Apply evidence-grade caps to results-type criteria. Returns mutated copy + log. */
function applyEvidenceGradeCaps(
  criteriaScores: CriterionScore[],
  grade: EvidenceGrade | undefined
): { scores: CriterionScore[]; caps: CapApplied[] } {
  if (!grade) return { scores: criteriaScores, caps: [] };
  const caps: CapApplied[] = [];
  const next = criteriaScores.map((c) => ({ ...c }));
  for (const c of next) {
    if (!isResultsLikeCriterion(c.criterion)) continue;
    let cap = 10;
    let reason = "";
    if (grade.no_attribution && EVIDENCE_GRADE_CAPS.no_attribution < cap) {
      cap = EVIDENCE_GRADE_CAPS.no_attribution;
      reason = "no_attribution";
    }
    if (grade.no_baseline && EVIDENCE_GRADE_CAPS.no_baseline < cap) {
      cap = EVIDENCE_GRADE_CAPS.no_baseline;
      reason = "no_baseline";
    }
    if (grade.no_causality && EVIDENCE_GRADE_CAPS.no_causality < cap) {
      cap = EVIDENCE_GRADE_CAPS.no_causality;
      reason = "no_causality";
    }
    if (reason && c.score > cap) {
      caps.push({ criterion: c.criterion, original_score: c.score, capped_score: cap, reason });
      c.score = cap;
    }
  }
  return { scores: next, caps };
}

function sha256_16(s: string): string {
  return "sha256-" + createHash("sha256").update(s).digest("hex").slice(0, 16);
}

/** Wrap an OpenAI call with exponential backoff on 429. Caps at 4 retries. */
async function callWith429Retry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      const is429 = e?.status === 429 || /\b429\b|rate limit/i.test(e?.message ?? "");
      if (!is429 || attempt === maxRetries) throw err;
      // Try to read retry-after hint from message; otherwise exponential.
      const m = e?.message?.match(/try again in (\d+(?:\.\d+)?)s/i);
      const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 250 : 1500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  // Unreachable.
  throw new Error("callWith429Retry: exhausted");
}

export async function runL2(
  bundle: CaseBundle,
  block: MethodologyBlock,
  nomination: NominationDef,
  apiKey: string | undefined
): Promise<L2Result> {
  const modelId = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  if (!apiKey) return runL2Fallback(bundle, block, nomination, modelId);

  const caseText = buildCaseText(bundle);
  const weights = resolveCriterionWeights(block, nomination);
  const wByCriterion = new Map(weights.map((w) => [w.id, w.weight]));
  // Note: inline generic anchors removed in v7 — they contradicted the
  // empirical retrieved anchors below. The empirical anchors are the only
  // anchor source the model sees now.
  const criteriaList = block.criteria
    .filter((c) => (wByCriterion.get(c.id) ?? 0) > 0)
    .map((c) => {
      return `- ${c.id} (${c.name_ru}): вес ${wByCriterion.get(c.id) ?? 0}. ${c.description_ru}`;
    })
    .join("\n");

  const isSocial = nomination.is_social;
  const cfg = getMethodology();
  const socialCrit = cfg.social_formula.social_criterion;
  let socialClause = "";
  if (isSocial) {
    const sa = getSocialOutcomesAnchors();
    socialClause = `\nЭто СОЦИАЛЬНО-ОРИЕНТИРОВАННАЯ номинация. Дополнительно оцени критерий "${socialCrit.id}" (${socialCrit.name_ru}): ${socialCrit.description_ru}
Якоря для social_outcomes: 2 — ${sa["2"]} | 5 — ${sa["5"]} | 8 — ${sa["8"]}
Балл по шкале 1–10. Итоговый балл = среднее арифметическое стандартного балла блока и social_outcomes.`;
  }

  // Retrieve real top-jury anchors from the same nomination/block. These
  // become the per-case calibration reference — the model sees what
  // calibrated humans actually scored and how they wrote about similar
  // projects in the same category.
  const retrievedAnchors = retrieveAnchors(nomination.code, block.id, 1);
  const anchorBlock = renderAnchorBlock(retrievedAnchors);

  const sys = `${HOSTILE_PERSONA}

Кейс: блок ${block.code} (${block.name_ru}), номинация ${nomination.code} (${nomination.name_ru}).

Критерии блока (с весами для этой номинации):
${criteriaList}
${socialClause}

${SCALE_BANDS}

${anchorBlock}

${ANTI_SYCOPHANCY_RULES}

ПРОТОКОЛ ОЦЕНКИ — два шага в твоей голове, прежде чем заполнять JSON:

ШАГ 1 — КРИТИКА (без баллов).
Перед тем как ставить любой балл, мысленно перечисли:
  (a) 2–3 КОНКРЕТНЫЕ сильные стороны кейса с привязкой к цитатам/числам.
  (b) 2–4 КОНКРЕТНЫЕ слабости — чего не хватает, что подано размыто, какие
      KPI не закрыты, где маркетинг вместо результата.
  (c) Какие методологические дефекты есть (нет базы, нет атрибуции, нет
      причинно-следственной связи) — реально, а не "на всякий случай".
Без этого шага твои баллы будут средними и неотличимыми. Сделай этот шаг.

ШАГ 2 — БАЛЛ ПО КАЖДОМУ КРИТЕРИЮ.
Для КАЖДОГО критерия:
  (i) Выбери полосу 1–10 на основе SCALE_BANDS триггеров — какой триггер
      срабатывает (нет цифр / есть цифры без сравнения / есть всё / есть всё
      + оригинальность / + внешнее подтверждение).
  (ii) Внутри полосы выбери конкретный балл (например, в полосе 7–8: 7 если
       минимально соответствует триггеру, 8 если устойчиво).
  (iii) В rationale напиши ТРИ части в одном абзаце:
       — "Сильные стороны: ..." (2–3 факта),
       — "Слабые стороны: ..." (1–2 факта),
       — "Что нужно для следующей полосы: ..." (конкретно).
  (iv) why_not_higher_band и fatal_flaws заполни по результатам шага 1(b).

ЗАПРЕЩЕНО ставить балл, не пройдя оба шага. Запрещено писать rationale
без явных "Сильные стороны / Слабые стороны / Что нужно для следующей полосы".

ОБЯЗАТЕЛЬНО: для каждого критерия укажи evidence_ids — массив cite_key из
доказательной базы (например, ["E1", "E3"]). Если конкретных свидетельств нет,
верни пустой массив и снизь балл до ≤4.

Дополнительно оцени качество доказательной базы по результатам:
- no_baseline: true, если нет базы для сравнения (до/после, контрольная группа).
- no_causality: true, если нет причинно-следственной связи между активностью и результатом.
- no_attribution: true, если результат нельзя однозначно отнести именно к этому проекту.

one_paragraph_verdict: 2–3 предложения. Сначала вердикт (медаль), затем
главная причина — конкретно. Без вступлений типа "в целом" или "проект
демонстрирует". Прямо.

avatar_script — структурированный монолог цифрового жюриста. Ты возвращаешь:
- short: 60–90 секунд произнесённого текста (≈150–220 слов на русском).
  Жёсткая структура из 5 секций по порядку:
    (1) hook — одно предложение-крючок: что в этом кейсе главное.
    (2) verdict — вердикт + балл/медаль + однопредложенная причина.
    (3) steelman — лучшее, что есть в кейсе (стилмэн защиты, чтобы не
        выглядеть голословно — назови сильнейшее место с цифрой/фактом
        если есть).
    (4) fatal_flaw — главный фатальный недостаток (тот же, что в
        case_fatal_flaw, но в живой речи).
    (5) close — что нужно сделать, чтобы кейс получил следующую медаль.
- long: 3 минуты (≈450–550 слов). Та же структура, но с разбором каждого
  критерия и ссылками на конкретные места в кейсе.
- sections: каждое поле — отдельный кусок (hook/verdict/steelman/
  fatal_flaw/close). Тексты в sections должны вместе складываться в short.

Тон: как живой эксперт, не диктор. Без формальных фраз "уважаемое жюри",
"итак", "перейдём к". Прямо и с фактами.

Ответь строго в JSON:
{
  "criteria": [{
    "id": "...",
    "score": 1-10,
    "rationale": "...",
    "evidence_ids": ["E1", ...],
    "why_not_higher_band": "конкретно, чего не хватает для следующей полосы",
    "fatal_flaws": ["флоу 1", "флоу 2"]
  }],
  ${isSocial ? '"social_outcomes_score": 1-10, "social_outcomes_rationale": "...",' : ""}
  "evidence_grade": {"no_baseline": bool, "no_causality": bool, "no_attribution": bool, "rationale": "..."},
  "one_paragraph_verdict": "...",
  "case_fatal_flaw": "одно предложение — главный дефект кейса",
  "why_not_higher_band_overall": "почему этот кейс не заслуживает следующей медали",
  "avatar_script": {
    "short": "...60–90 секунд...",
    "long": "...3 минуты...",
    "sections": {
      "hook": "...",
      "verdict": "...",
      "steelman": "...",
      "fatal_flaw": "...",
      "close": "..."
    }
  }
}`;

  const prompt_hash = sha256_16(sys);
  const client = new OpenAI({ apiKey });

  let parsed: L2Response | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    const reminder = attempt === 0
      ? ""
      : "\n\nПРЕДЫДУЩИЙ ОТВЕТ НЕ ПРОШЁЛ ВАЛИДАЦИЮ. Верни строго JSON по схеме выше — все поля обязательны, score в [1..10].";
    const raw = await callWith429Retry(async () =>
      client.chat.completions.create({
        model: modelId,
        messages: [
          { role: "system", content: sys + reminder },
          { role: "user", content: `Кейс:\n\n${caseText.slice(0, 12000)}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      })
    );
    const content = raw?.choices?.[0]?.message?.content;
    if (!content) continue;
    try {
      const json = JSON.parse(content);
      parsed = L2ResponseSchema.parse(json);
    } catch (err) {
      console.warn(`L2 JSON validation failed (attempt ${attempt + 1}):`, (err as Error).message);
    }
  }

  if (!parsed) return runL2Fallback(bundle, block, nomination, modelId, prompt_hash);

  // Map criteria from model output → CriterionScore, dropping unknown ids.
  const validIds = new Set(block.criteria.map((c) => c.id));
  const seen = new Set<string>();
  const criteria_scores: CriterionScore[] = [];
  for (const item of parsed.criteria) {
    if (!validIds.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    const score = Math.max(1, Math.min(10, Math.round(item.score * 10) / 10));
    criteria_scores.push({
      criterion: item.id,
      score,
      rationale: item.rationale,
      evidence_ids: resolveCiteKeys(item.evidence_ids ?? [], bundle),
      why_not_higher_band: item.why_not_higher_band,
      fatal_flaws: item.fatal_flaws,
    });
  }
  // Pad missing criteria with a conservative penalty.
  for (const c of block.criteria) {
    if ((wByCriterion.get(c.id) ?? 0) === 0) continue;
    if (criteria_scores.some((s) => s.criterion === c.id)) continue;
    criteria_scores.push({
      criterion: c.id,
      score: 2,
      rationale: "Штраф: критерий отсутствовал в ответе модели.",
      evidence_ids: [],
      why_not_higher_band: "Модель не дала ответ — нет оснований для более высокого балла.",
      fatal_flaws: ["Отсутствие оценки по критерию в ответе модели."],
    });
  }

  // Anti-sycophancy: only the strict bunching guard (≥80% identical AND no
  // evidence anywhere). The earlier flat-distribution penalty was firing on
  // legitimately-weak cases where flat low scores are correct, contributing
  // to the "everything collapses to one band" failure mode seen in the
  // 2026-04-28 backtest. Removed.
  if (criteria_scores.length >= 3) {
    const scores = criteria_scores.map((s) => s.score);
    const scoreCounts = new Map<number, number>();
    for (const s of scores) scoreCounts.set(s, (scoreCounts.get(s) ?? 0) + 1);
    const maxBunch = Math.max(...scoreCounts.values());
    const bunchRatio = maxBunch / scores.length;
    const allEvidenceMissing = criteria_scores.every((s) => (s.evidence_ids ?? []).length === 0);
    if (bunchRatio >= 0.8 && allEvidenceMissing) {
      for (const s of criteria_scores) {
        s.score = Math.max(1, s.score - 2);
        s.rationale = `[anti-bunching:-2] ${s.rationale}`;
      }
    }
  }
  criteria_scores.sort(
    (a, b) =>
      block.criteria.findIndex((x) => x.id === a.criterion) -
      block.criteria.findIndex((x) => x.id === b.criterion)
  );

  // Apply evidence-grade caps before computing block score.
  const evidence_grade = parsed.evidence_grade;
  const { scores: gradeCappedScores, caps: gradeCaps } = applyEvidenceGradeCaps(criteria_scores, evidence_grade);

  // Numeric-evidence floor: if project_results has too few quantitative
  // tokens, results-type criteria can't exceed 3 regardless of model output.
  // This is the structural counterpart to the band-trigger SCALE_BANDS prompt
  // — without it, well-written empty cases drift into bronze/silver.
  const { scores: cappedScores, caps: floorCaps } = applyNumericEvidenceFloor(gradeCappedScores, bundle);
  const caps_applied: CapApplied[] = [...gradeCaps, ...floorCaps];

  let block_score = computeBlockScore(block, nomination, cappedScores);

  // Block-level evidence cap: if the model flagged 2+ evidence-grade defects,
  // the case can't credibly cross into gold territory. Loosened from the
  // initial values (4.9/3.5) after a 15-case backtest revealed all bands
  // collapsed to shortlist; these levels still keep weak-evidence cases out
  // of gold while letting genuinely strong silver cases through if the per-
  // criterion caps already cut the results-side scores.
  if (evidence_grade) {
    const flagsSet = [evidence_grade.no_baseline, evidence_grade.no_causality, evidence_grade.no_attribution].filter(Boolean).length;
    // 2 flags → top-of-bronze ceiling (5.5). 3 flags → mid-shortlist (4.5).
    // Per-criterion caps already constrain results-type criteria; the
    // block-level cap is a backstop, not the primary mechanism.
    if (flagsSet >= 2 && block_score > 5.5) {
      caps_applied.push({
        criterion: "(block_score)",
        original_score: block_score,
        capped_score: 5.5,
        reason: `evidence_grade_${flagsSet}_flags`,
      });
      block_score = 5.5;
    }
    if (flagsSet === 3 && block_score > 4.5) {
      caps_applied.push({
        criterion: "(block_score)",
        original_score: block_score,
        capped_score: 4.5,
        reason: "evidence_grade_all_flags",
      });
      block_score = 4.5;
    }
  }

  let total_score = block_score;
  let social_outcomes_score: number | undefined;
  if (isSocial) {
    const s =
      typeof parsed.social_outcomes_score === "number"
        ? Math.max(1, Math.min(10, Math.round(parsed.social_outcomes_score * 10) / 10))
        : 3;
    social_outcomes_score = s;
    total_score = applySocialFormula(block_score, s);
  }
  const award_level = scoreToAwardLevel(total_score);

  return {
    criteria_scores: cappedScores,
    block_score,
    social_outcomes_score,
    total_score,
    award_level,
    one_paragraph_verdict: parsed.one_paragraph_verdict,
    avatar_script: parsed.avatar_script.short,
    avatar_script_structured: parsed.avatar_script,
    evidence_grade,
    caps_applied,
    case_fatal_flaw: parsed.case_fatal_flaw,
    why_not_higher_band_overall: parsed.why_not_higher_band_overall,
    prompt_hash,
    model_id: modelId,
  };
}

function runL2Fallback(
  bundle: CaseBundle,
  block: MethodologyBlock,
  nomination: NominationDef,
  modelId: string,
  prompt_hash: string = "sha256-fallback"
): L2Result {
  const weights = resolveCriterionWeights(block, nomination);
  const validWeightIds = new Set(weights.map((w) => w.id));
  const criteria_scores: CriterionScore[] = block.criteria
    .filter((c) => validWeightIds.has(c.id))
    .map((c) => ({
      criterion: c.id,
      score: 3,
      rationale: `Заглушка (L2 без API ключа или невалидный JSON). Консервативная оценка. Критерий: ${c.name_ru}.`,
      evidence_ids: [],
      why_not_higher_band: "Нет данных модели для обоснования более высокого балла.",
      fatal_flaws: ["Заглушка: оценка не выполнена реальной моделью."],
    }));
  const block_score = computeBlockScore(block, nomination, criteria_scores);
  let total_score = block_score;
  let social_outcomes_score: number | undefined;
  if (nomination.is_social) {
    social_outcomes_score = 3;
    total_score = applySocialFormula(block_score, social_outcomes_score);
  }
  const award_level = scoreToAwardLevel(total_score);
  const projectName = bundle.metadata.project_name ?? bundle.metadata.case_id;
  return {
    criteria_scores,
    block_score,
    social_outcomes_score,
    total_score,
    award_level,
    one_paragraph_verdict: `Синтетическая оценка (заглушка). Кейс «${projectName}»: итоговая награда по весам блока ${block.code}, номинация ${nomination.code}: ${award_level}.`,
    avatar_script: `Кейс «${projectName}». Итоговая оценка: ${award_level}. Это заглушка; для полного скрипта нужен API ключ.`,
    avatar_script_structured: undefined,
    evidence_grade: undefined,
    caps_applied: [],
    case_fatal_flaw: "Заглушка: настоящая оценка не выполнялась.",
    why_not_higher_band_overall: "Заглушка: модель не оценивала кейс.",
    prompt_hash,
    model_id: modelId,
  };
}

```

## `backend/src/judgeAnchorsLoader.ts`

*Retrieves real-judge comments per nomination at runtime.*

```typescript
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Runtime loader + retrieval over the empirical anchor pool.
 *
 * The pool is built by scripts/phase2_extract.mjs from SM_2025.json: every
 * L2 evaluation written by a high-correlation human juror (corr ≥ 0.80
 * between their score and the project's eventual award) becomes one anchor.
 *
 * At scoring time we want a small set of band-spanning anchors from the
 * SAME nomination (or, failing that, same block) so the model has concrete
 * "this is what 9 looks like in this nomination, this is what 3 looks like"
 * reference points instead of generic prose.
 */

export interface JudgeAnchor {
  judge_id: string;
  project_id: string;
  project_name: string;
  nomination_code: string;
  block_id: string;
  total: number;
  diplom: string;
  comment: string;
  per_criterion: Array<{ name: string; score: number }>;
  is_top5: boolean;
}

interface AnchorsFile {
  meta: {
    generated_at: string;
    source: string;
    retrieval_pool_judges: string[];
    top5_judges: string[];
    total_anchors: number;
  };
  anchors: JudgeAnchor[];
  by_nomination: Record<string, JudgeAnchor[]>;
  by_block: Record<string, JudgeAnchor[]>;
}

let cached: AnchorsFile | null = null;

function loadAnchors(): AnchorsFile {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "data/judgeAnchors.json"),
    join(here, "../data/judgeAnchors.json"),
    join(here, "../../src/data/judgeAnchors.json"),
  ];
  let path = "";
  for (const c of candidates) {
    if (existsSync(c)) {
      path = c;
      break;
    }
  }
  if (!path) {
    // Empty fallback — anchor retrieval becomes a no-op so L2 still runs.
    cached = {
      meta: { generated_at: "", source: "", retrieval_pool_judges: [], top5_judges: [], total_anchors: 0 },
      anchors: [],
      by_nomination: {},
      by_block: {},
    };
    return cached;
  }
  cached = JSON.parse(readFileSync(path, "utf8")) as AnchorsFile;
  return cached;
}

function bandOf(score: number): "GOLD" | "SILVER" | "BRONZE" | "SHORTLIST" | "LONGLIST" {
  if (score >= 9) return "GOLD";
  if (score >= 7) return "SILVER";
  if (score >= 5) return "BRONZE";
  if (score >= 3) return "SHORTLIST";
  return "LONGLIST";
}

/**
 * Pick a band-spanning set of anchors for the given nomination.
 *
 * Strategy:
 *  1. Try exact nomination match first — if we have ≥3 anchors covering ≥3
 *     bands, use those.
 *  2. Otherwise expand to same block_id and pick band-spanning examples.
 *  3. Otherwise (rare blocks) fall back to globally band-spanning examples.
 *
 * Within each band we prefer top-5 judges (higher fidelity voice) when
 * available, otherwise any pool judge.
 */
export function retrieveAnchors(
  nominationCode: string,
  blockId: string,
  perBand: number = 1
): JudgeAnchor[] {
  const file = loadAnchors();
  if (!file.anchors.length) return [];

  const wantBands: Array<ReturnType<typeof bandOf>> = ["GOLD", "SILVER", "BRONZE", "SHORTLIST", "LONGLIST"];

  function pickFromList(pool: JudgeAnchor[]): JudgeAnchor[] {
    const out: JudgeAnchor[] = [];
    for (const band of wantBands) {
      const inBand = pool.filter((a) => bandOf(a.total) === band);
      if (!inBand.length) continue;
      // Prefer top-5 voices, then closest-to-band-center
      const sorted = [...inBand].sort((a, b) => {
        if (a.is_top5 !== b.is_top5) return a.is_top5 ? -1 : 1;
        // Within priority, prefer comments around top-5 median (270 chars).
        const aLen = a.comment.length;
        const bLen = b.comment.length;
        const aDist = Math.abs(aLen - 270);
        const bDist = Math.abs(bLen - 270);
        return aDist - bDist;
      });
      out.push(...sorted.slice(0, perBand));
    }
    return out;
  }

  // Step 1 — exact nomination
  const sameNom = file.by_nomination[nominationCode] || [];
  const fromNom = pickFromList(sameNom);
  const distinctBands = new Set(fromNom.map((a) => bandOf(a.total)));
  if (distinctBands.size >= 3) return fromNom.slice(0, 5);

  // Step 2 — same block, supplementing what we got from same-nomination
  const sameBlock = file.by_block[blockId] || [];
  const fromBlock = pickFromList(sameBlock);
  const merged = new Map<string, JudgeAnchor>();
  for (const a of [...fromNom, ...fromBlock]) {
    const key = `${a.judge_id}|${a.project_id}`;
    if (!merged.has(key)) merged.set(key, a);
  }
  const mergedList = [...merged.values()].sort((a, b) => b.total - a.total);
  // Keep up to one per band
  const seenBands = new Set<string>();
  const dedup: JudgeAnchor[] = [];
  for (const a of mergedList) {
    const b = bandOf(a.total);
    if (seenBands.has(b)) continue;
    seenBands.add(b);
    dedup.push(a);
  }
  if (dedup.length >= 3) return dedup.slice(0, 5);

  // Step 3 — global fallback
  const fromGlobal = pickFromList(file.anchors);
  return fromGlobal.slice(0, 5);
}

/** Render anchors as a prompt section. */
export function renderAnchorBlock(anchors: JudgeAnchor[]): string {
  if (!anchors.length) return "";
  const blocks = anchors.map((a) => {
    return `Балл ${a.total} (${a.diplom}) — реальный кейс «${a.project_name.slice(0, 60)}» в номинации ${a.nomination_code}:
  «${a.comment.slice(0, 600)}»`;
  });
  return `Реальные обоснования топ-калиброванных членов жюри XXVI на похожих кейсах
(используй их СТРОГО как ориентир по тону, длине и структуре аргументации —
не цитируй, а пиши в той же манере):

${blocks.join("\n\n")}`;
}

```

## `backend/src/critic.ts`

*Asymmetric downgrade-only critic pass (env-gated).*

```typescript
import OpenAI from "openai";
import { z } from "zod";
import { createHash } from "crypto";
import type { CaseBundle } from "./types/case.js";
import type { CriterionScore } from "./types/evaluation.js";
import type { L2Result } from "./l2.js";

/**
 * Critic pass — Phase 4 anti-sycophancy mechanism.
 *
 * Asymmetric: critic can ONLY lower scores, never raise. Idea: L2's
 * positive bias is corrected, but the critic's possible negative bias is
 * neutralised by clamping to the L2 floor.
 *
 * Process:
 *   1. Run L2 to produce initial verdict.
 *   2. Feed L2 verdict + case text to critic with downgrade-only mandate.
 *   3. For each criterion, take min(l2_score, critic_suggested_score).
 *   4. Recompute block_score / total_score / award_level downstream.
 *   5. Log critic deltas in CriticReport for audit.
 */

export interface CriticDelta {
  criterion: string;
  l2_score: number;
  critic_score: number;
  applied_score: number;
  reason: string;
}

export interface CriticReport {
  applied: boolean;
  deltas: CriticDelta[];
  extra_fatal_findings: string[];
  overall_reason?: string;
  prompt_hash: string;
}

const CriticResponseSchema = z.object({
  per_criterion: z
    .array(
      z.object({
        id: z.string().min(1),
        suggested_score: z.number().min(1).max(10),
        reason: z.string().min(5),
      })
    )
    .default([]),
  overall_recommendation: z.enum(["downgrade", "keep", "no_critique"]),
  overall_reason: z.string().min(5),
  extra_fatal_findings: z.array(z.string().min(5)).default([]),
});

const CRITIC_PERSONA = `
Ты — главный критик жюри Silver Mercury, проверяющий чужую оценку. Ты НЕ
переоцениваешь кейс с нуля. Ты получаешь:
  - Текст кейса.
  - Готовую оценку первого жюриста (по критериям, с обоснованиями).
И отвечаешь на ОДИН вопрос: первый жюрист был НЕОПРАВДАННО МЯГОК?

Твоя задача — НЕ накручивать понижения, а ловить ТОЛЬКО реальные пропуски.
Ты МОЖЕШЬ только понижать баллы. Ты НЕ МОЖЕШЬ их повышать. Но если первый
жюрист уже был жёстким и адекватным — твой ответ должен быть "keep".

Когда понижать (только в этих случаях):
- Первый жюрист поставил 7+ за критерий, но в его обосновании НЕТ ни одной
  конкретной цифры или факта — понижай на 1–2.
- Первый жюрист поставил 5+ за "результаты" / "impact" / "effectiveness", но
  в обосновании только общие слова ("охват", "вовлечённость", "успех") без
  числовых значений — понижай до 4.
- В кейсе явно есть фатальный недостаток, который первый жюрист вообще не
  упомянул в case_fatal_flaw — это повод для понижения 1–2 затронутых
  критериев.

Когда НЕ понижать (важно):
- Если все критерии уже в диапазоне 2–4 и обоснования адекватные — это уже
  жёсткая и оправданная оценка. Возвращай overall_recommendation="keep".
- Если первый жюрист уже выставил низкие баллы из-за отсутствия данных и
  evidence_grade — не накладывай ещё одно понижение за то же самое.
- Не понижай "из принципа", не понижай за стиль обоснования. Понижай только
  при наличии КОНКРЕТНОГО упущения.

Если возражений нет — overall_recommendation="keep" и пустой per_criterion.
Это нормальный, ожидаемый исход для большинства уже-жёстких оценок.
`.trim();

export async function runCritic(
  bundle: CaseBundle,
  l2: L2Result,
  apiKey: string | undefined
): Promise<CriticReport> {
  const modelId = process.env.OPENAI_CRITIC_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const sys = `${CRITIC_PERSONA}

Ответь строго в JSON:
{
  "per_criterion": [{
    "id": "идентификатор критерия из исходной оценки",
    "suggested_score": 1-10,
    "reason": "конкретно, что упустил первый жюрист"
  }],
  "overall_recommendation": "downgrade" | "keep" | "no_critique",
  "overall_reason": "краткое суммарное мнение",
  "extra_fatal_findings": ["доп. фатальный недостаток 1", ...]
}

Если возражений нет — верни overall_recommendation = "keep" и пустой per_criterion.
Не придумывай критерии, которых нет в исходной оценке.`;

  const promptHash = "sha256-" + createHash("sha256").update(sys).digest("hex").slice(0, 16);

  if (!apiKey) {
    return { applied: false, deltas: [], extra_fatal_findings: [], prompt_hash: promptHash };
  }

  const caseSummary = buildCaseSummary(bundle);
  const l2Summary = buildL2Summary(l2);

  const client = new OpenAI({ apiKey });
  let parsed: z.infer<typeof CriticResponseSchema> | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
    try {
      const res = await callWith429Retry(() =>
        client.chat.completions.create({
          model: modelId,
          messages: [
            { role: "system", content: sys },
            {
              role: "user",
              content: `Кейс (сжато):\n${caseSummary}\n\nИсходная оценка первого жюриста:\n${l2Summary}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        })
      );
      const raw = res?.choices?.[0]?.message?.content;
      if (!raw) continue;
      const json = JSON.parse(raw);
      parsed = CriticResponseSchema.parse(json);
    } catch (err) {
      console.warn(`[critic] attempt ${attempt + 1} failed:`, (err as Error).message);
    }
  }

  if (!parsed || parsed.overall_recommendation === "no_critique") {
    return {
      applied: false,
      deltas: [],
      extra_fatal_findings: parsed?.extra_fatal_findings ?? [],
      overall_reason: parsed?.overall_reason,
      prompt_hash: promptHash,
    };
  }

  const validIds = new Set(l2.criteria_scores.map((c) => c.criterion));
  const byId = new Map(l2.criteria_scores.map((c) => [c.criterion, c]));
  const deltas: CriticDelta[] = [];
  for (const item of parsed.per_criterion) {
    if (!validIds.has(item.id)) continue;
    const original = byId.get(item.id);
    if (!original) continue;
    // Asymmetric: take min — critic can only lower.
    const applied = Math.min(original.score, Math.round(item.suggested_score * 10) / 10);
    if (applied < original.score) {
      deltas.push({
        criterion: item.id,
        l2_score: original.score,
        critic_score: Math.round(item.suggested_score * 10) / 10,
        applied_score: applied,
        reason: item.reason,
      });
    }
  }

  return {
    applied: deltas.length > 0,
    deltas,
    extra_fatal_findings: parsed.extra_fatal_findings,
    overall_reason: parsed.overall_reason,
    prompt_hash: promptHash,
  };
}

/** Mutate the criteria_scores in place applying critic deltas. Returns the
 *  list of criteria that were actually changed. */
export function applyCriticDeltas(
  scores: CriterionScore[],
  deltas: CriticDelta[]
): CriterionScore[] {
  const byId = new Map(deltas.map((d) => [d.criterion, d]));
  return scores.map((s) => {
    const d = byId.get(s.criterion);
    if (!d || d.applied_score >= s.score) return s;
    return {
      ...s,
      score: d.applied_score,
      rationale: `[critic:-${(s.score - d.applied_score).toFixed(1)}] ${d.reason} || ${s.rationale}`,
    };
  });
}

function buildCaseSummary(bundle: CaseBundle): string {
  const parts: string[] = [];
  const tf = bundle.text_fields;
  if (tf.project_info) parts.push(`Описание: ${tf.project_info.slice(0, 1500)}`);
  if (tf.project_results) parts.push(`Результаты: ${tf.project_results.slice(0, 1500)}`);
  if (tf.project_strategy) parts.push(`Стратегия: ${tf.project_strategy.slice(0, 1000)}`);
  return parts.join("\n\n").slice(0, 6000) || "(нет текста)";
}

function buildL2Summary(l2: L2Result): string {
  const lines: string[] = [];
  for (const c of l2.criteria_scores) {
    lines.push(`- ${c.criterion}: ${c.score} — ${c.rationale.slice(0, 250)}`);
  }
  if (l2.evidence_grade) {
    const flags = Object.entries(l2.evidence_grade)
      .filter(([k, v]) => v === true && k !== "rationale")
      .map(([k]) => k)
      .join(", ");
    if (flags) lines.push(`evidence_grade: ${flags}`);
  }
  if (l2.case_fatal_flaw) lines.push(`fatal: ${l2.case_fatal_flaw}`);
  lines.push(`block_score=${l2.block_score} total=${l2.total_score} award=${l2.award_level}`);
  return lines.join("\n");
}

/** Same backoff helper as l2.ts (kept local to avoid circular import). */
async function callWith429Retry<T>(fn: () => Promise<T>): Promise<T> {
  const maxRetries = 4;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      const is429 = e?.status === 429 || /\b429\b|rate limit/i.test(e?.message ?? "");
      if (!is429 || attempt === maxRetries) throw err;
      const m = e?.message?.match(/try again in (\d+(?:\.\d+)?)s/i);
      const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 250 : 1500 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("callWith429Retry: exhausted");
}

```

## `backend/src/runAnalysis.ts`

*Orchestrator: ingestion → L2 → critic → caps → scoring.*

```typescript
import type { CaseBundle } from "./types/case.js";
import type { CoreOutput } from "./types/evaluation.js";
import {
  findNomination,
  getBlockById,
  getMethodologyHash,
  resolveCriterionWeights,
  scoreToAwardLevel,
} from "./methodologyLoader.js";
import { getAnchorsHash } from "./anchorsLoader.js";
import { runL2 } from "./l2.js";
import { runCritic, applyCriticDeltas } from "./critic.js";

/**
 * Phase 3 pipeline: ingestion → resolve nomination → L2 (with evidence-grade caps,
 * cite_key resolution, prompt_hash + model_id stamping).
 *
 * Resolution rules:
 *   - If bundle.metadata.nomination_id is a known XXVII nomination code (e.g. "B16"),
 *     look up its block + per-nomination weights directly.
 *   - Otherwise, fall back to bundle.metadata.block_id and synthesise a non-social
 *     placeholder nomination with the block's first nomination's weights (so fixed-weight
 *     blocks score normally and per-nomination blocks at least don't crash).
 */
export async function runAnalysis(bundle: CaseBundle): Promise<CoreOutput> {
  const apiKey = process.env.OPENAI_API_KEY;

  const resolved = resolveBlockAndNomination(bundle);
  if (!resolved) {
    throw new Error(
      `Cannot resolve block/nomination for case ${bundle.metadata.case_id} (nomination_id=${bundle.metadata.nomination_id}, block_id=${bundle.metadata.block_id})`
    );
  }
  const { block, nomination } = resolved;

  const l2Result = await runL2(bundle, block, nomination, apiKey);

  // Phase 4: critic pass — downgrade-only sanity check.
  const criticEnabled = process.env.CRITIC_PASS !== "off";
  const critic = criticEnabled
    ? await runCritic(bundle, l2Result, apiKey)
    : { applied: false, deltas: [], extra_fatal_findings: [] as string[], prompt_hash: "sha256-disabled" };

  if (critic.applied && critic.deltas.length > 0) {
    const newScores = applyCriticDeltas(l2Result.criteria_scores, critic.deltas);
    l2Result.criteria_scores = newScores;
    // Recompute block_score from the downgraded criteria.
    const weights = resolveCriterionWeights(block, nomination);
    const byId = new Map(newScores.map((c) => [c.criterion, c.score]));
    let total = 0;
    let totalWeight = 0;
    for (const { id, weight } of weights) {
      const s = byId.get(id);
      if (typeof s === "number") {
        total += s * weight;
        totalWeight += weight;
      }
    }
    l2Result.block_score = totalWeight > 0 ? Math.round((total / totalWeight) * 10) / 10 : 0;
    if (typeof l2Result.social_outcomes_score === "number") {
      l2Result.total_score = Math.round(((l2Result.block_score + l2Result.social_outcomes_score) / 2) * 10) / 10;
    } else {
      l2Result.total_score = l2Result.block_score;
    }
    l2Result.award_level = scoreToAwardLevel(l2Result.total_score);
  }

  const consistency_check_passed = checkConsistency(l2Result);

  // missing_evidence: criteria where the model couldn't cite any evidence.
  const missing_evidence = l2Result.criteria_scores
    .filter((c) => !c.evidence_ids || c.evidence_ids.length === 0)
    .map((c) => c.criterion);

  const output: CoreOutput = {
    case_id: bundle.metadata.case_id,
    methodology_hash: getMethodologyHash(),
    anchors_hash: getAnchorsHash(),
    prompt_hash: l2Result.prompt_hash,
    model_id: l2Result.model_id,
    input_hash:
      "case-" +
      fnv1a(
        stableStringify({
          metadata: bundle.metadata,
          text_fields: bundle.text_fields,
          extracted_text: bundle.extracted_text,
        })
      ),
    block_code: block.code,
    nomination_code: nomination.code,
    l2: {
      criteria_scores: l2Result.criteria_scores,
      block_score: l2Result.block_score,
      social_outcomes_score: l2Result.social_outcomes_score,
      total_score: l2Result.total_score,
      award_level: l2Result.award_level,
      one_paragraph_verdict: l2Result.one_paragraph_verdict,
      evidence_grade: l2Result.evidence_grade,
      caps_applied: l2Result.caps_applied,
      case_fatal_flaw: l2Result.case_fatal_flaw,
      why_not_higher_band_overall: l2Result.why_not_higher_band_overall,
      critic: {
        applied: critic.applied,
        deltas: critic.deltas,
        extra_fatal_findings: critic.extra_fatal_findings,
        overall_reason: critic.overall_reason,
        prompt_hash: critic.prompt_hash,
      },
    },
    evidence: [],
    missing_evidence,
    key_quotes: [],
    avatar_script: l2Result.avatar_script,
    avatar_script_structured: l2Result.avatar_script_structured,
    consistency_check_passed,
  };

  return output;
}

function resolveBlockAndNomination(bundle: CaseBundle): { block: import("./types/methodology.js").MethodologyBlock; nomination: import("./types/methodology.js").NominationDef } | null {
  const nomCode = (bundle.metadata.nomination_id || "").trim().toUpperCase();
  if (nomCode) {
    const found = findNomination(nomCode);
    if (found) return found;
  }
  // Fallback: use block_id, pick first nomination
  const block = getBlockById(bundle.metadata.block_id) ?? getBlockById("50");
  if (!block) return null;
  const nomination = block.nominations[0];
  if (!nomination) return null;
  return { block, nomination };
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function checkConsistency(l2: { total_score: number; award_level: string }): boolean {
  const score = l2.total_score;
  if (score < 0 || score > 10) return false;
  return true;
}

```

## `backend/src/types/l2Schema.ts`

*Strict zod schema for model JSON output. Strict-validation failures fall through to a stub-fallback.*

```typescript
import { z } from "zod";

/**
 * Strict JSON schema for L2 model output.
 *
 * Phase 3: every field the model is allowed to return is validated with zod.
 * On parse failure runL2 retries once with a stricter system reminder, then
 * falls back to runL2Fallback. This catches: missing fields, wrong types,
 * out-of-range scores, and free-text where structured data is expected.
 */

export const CriterionScoreInputSchema = z.object({
  id: z.string().min(1),
  score: z.number().min(1).max(10),
  rationale: z.string().min(1),
  evidence_ids: z.array(z.string()).default([]),
  /** Mandatory anti-sycophancy field: at least one concrete reason this is not a band higher.
   *  Length reduced (10 → 5) to match real top-jury terseness ("Нет KPI", "Слабо"). */
  why_not_higher_band: z.string().min(5),
  /** Mandatory: ≥1 fatal flaw or significant weakness specific to this criterion. */
  fatal_flaws: z.array(z.string().min(1)).min(1),
});

export const EvidenceGradeSchema = z
  .object({
    no_baseline: z.boolean().default(false),
    no_causality: z.boolean().default(false),
    no_attribution: z.boolean().default(false),
    rationale: z.string().optional(),
  })
  .default({ no_baseline: false, no_causality: false, no_attribution: false });

/** Phase 5: structured avatar script. Enforces a 60–90s short version with
 *  explicit sections (hook → verdict → steelman → fatal flaw → close) plus a
 *  3-minute long version for full presentations. */
export const AvatarScriptSchema = z.object({
  short: z.string().min(80), // target 60–90s, tolerate compressed Russian down to ~25s
  long: z.string().min(250), // target 3 min, tolerate down to ~60s of dense speech
  sections: z.object({
    hook: z.string().min(5),
    verdict: z.string().min(5),
    steelman: z.string().min(5),
    fatal_flaw: z.string().min(5),
    close: z.string().min(5),
  }),
});

export const L2ResponseSchema = z.object({
  criteria: z.array(CriterionScoreInputSchema).min(1),
  social_outcomes_score: z.number().min(1).max(10).optional(),
  social_outcomes_rationale: z.string().optional(),
  evidence_grade: EvidenceGradeSchema.optional(),
  one_paragraph_verdict: z.string().min(1),
  /** Required: top fatal flaw across the whole case (single sentence). */
  case_fatal_flaw: z.string().min(5),
  /** Required: explicit reason this case does not deserve a band higher overall. */
  why_not_higher_band_overall: z.string().min(5),
  avatar_script: AvatarScriptSchema,
});

export type L2Response = z.infer<typeof L2ResponseSchema>;
export type EvidenceGrade = z.infer<typeof EvidenceGradeSchema>;
export type CriterionScoreInput = z.infer<typeof CriterionScoreInputSchema>;

```

## `backend/src/types/case.ts`

*Case bundle structure (input).*

```typescript
/**
 * Internal case bundle schema — after ingestion and before L1/L2.
 * Maps from SM form fields + extracted text + video transcript.
 */

export interface CaseMetadata {
  case_id: string;
  year: string;
  nomination_id: string;
  block_id: string;
  project_id?: string;
  project_name?: string;
  project_date_from?: string;
  project_date_to?: string;
  project_size_id?: string;
}

/** Text fields from the submission form (SM-style). */
export interface CaseTextFields {
  project_info?: string;
  project_product?: string;
  project_auditory?: string;
  project_insight?: string;
  project_targets?: string;
  project_task?: string;
  project_strategy?: string;
  project_channels?: string;
  project_realisation?: string;
  project_results?: string;
  project_start_info?: string;
  project_additional_factors?: string;
}

/** Extracted content from a document with provenance. */
export interface ExtractedSegment {
  text: string;
  source: string;
  page_or_slide?: number;
  timestamp?: string;
  /** DB id (public.evidence) once persisted — short id for citation in prompts. */
  evidence_id?: string;
  /** Short alias used in prompts (e.g. "E1", "E2") that maps to evidence_id. */
  cite_key?: string;
  /** Storage path if this segment came from an uploaded file. */
  storage_path?: string;
  /** Evidence kind for the DB row. */
  kind?: "pdf_page" | "video_frame" | "video_clip" | "audio_quote" | "text_field" | "extracted_text";
}

/** Video transcript segment. */
export interface TranscriptSegment {
  text: string;
  start_sec?: number;
  end_sec?: number;
  confidence?: number;
}

/** Case bundle — input to Evidence Index and L1/L2. */
export interface CaseBundle {
  metadata: CaseMetadata;
  text_fields: CaseTextFields;
  extracted_text: ExtractedSegment[];
  transcript?: TranscriptSegment[];
  video_url?: string;
  redacted?: boolean;
  config_hash?: string;
}

```

## `backend/src/types/evaluation.ts`

*CoreOutput structure (output).*

```typescript
/**
 * Strict JSON output schema for Core — consumed by UI and avatar.
 * LLM produces only JSON matching this shape.
 *
 * Phase 1: methodology v2 — block-standard score + Social outcomes score
 * persisted separately from total_score so we can audit the social-formula combine.
 *
 * Phase 3: every CriterionScore can carry evidence_ids citing public.evidence rows;
 * EvidenceGrade flags drive hard score caps; verdicts are stamped with prompt_hash
 * and model_id for full reproducibility.
 */

export interface CriterionScore {
  criterion: string;
  score: number;
  rationale: string;
  /** Evidence row ids cited as support for this score (public.evidence.id). */
  evidence_ids?: string[];
  /** Anti-sycophancy: explicit reason this score isn't a band higher. */
  why_not_higher_band?: string;
  /** Anti-sycophancy: ≥1 fatal flaw or significant weakness for this criterion. */
  fatal_flaws?: string[];
}

export interface EvidenceGrade {
  no_baseline: boolean;
  no_causality: boolean;
  no_attribution: boolean;
  rationale?: string;
}

export interface EvidenceItem {
  claim_or_snippet: string;
  source: string;
  page_or_slide?: number;
  timestamp?: string;
}

export type AwardLevel = "gold" | "silver" | "bronze" | "shortlist" | "longlist";

export interface CoreOutput {
  case_id: string;
  /** Stable hash of the methodology config used to score this case. */
  methodology_hash: string;
  /** Stable hash of the anchored rubric used to score this case. */
  anchors_hash: string;
  /** Stable hash of the L2 system prompt used to score this case. */
  prompt_hash: string;
  /** Hash of normalised case input — for reproducibility / replay. */
  input_hash: string;
  /** OpenAI model id used (e.g. "gpt-4o-mini"). */
  model_id: string;
  /** Block code (A–L) and nomination code (e.g. "B16") used for scoring. */
  block_code: string;
  nomination_code: string;
  l2: {
    criteria_scores: CriterionScore[];
    /** Block-standard weighted score (1–10), before any social-formula combine. */
    block_score: number;
    /** Social outcomes score (1–10), only present for socially-oriented nominations. */
    social_outcomes_score?: number;
    /** Final score after social-formula combine + evidence-grade caps. */
    total_score: number;
    award_level: AwardLevel;
    one_paragraph_verdict: string;
    /** Evidence-grade flags from the model — used to apply hard score caps. */
    evidence_grade?: EvidenceGrade;
    /** Audit log of caps applied (criterion id → reason). */
    caps_applied?: Array<{ criterion: string; original_score: number; capped_score: number; reason: string }>;
    /** Anti-sycophancy: top fatal flaw across the case. */
    case_fatal_flaw?: string;
    /** Anti-sycophancy: explicit reason this case doesn't deserve a band higher overall. */
    why_not_higher_band_overall?: string;
    /** Phase 4: critic pass log — downgrades only, audit trail. */
    critic?: {
      applied: boolean;
      deltas: Array<{ criterion: string; l2_score: number; critic_score: number; applied_score: number; reason: string }>;
      extra_fatal_findings: string[];
      overall_reason?: string;
      prompt_hash: string;
    };
  };
  evidence: EvidenceItem[];
  missing_evidence: string[];
  key_quotes: string[];
  /** Backwards-compatible: rendered short version of the avatar monologue. */
  avatar_script: string;
  /** Phase 5: structured monologue with short/long variants and section
   *  breakdown (hook/verdict/steelman/fatal_flaw/close). */
  avatar_script_structured?: {
    short: string;
    long: string;
    sections: { hook: string; verdict: string; steelman: string; fatal_flaw: string; close: string };
  };
  consistency_check_passed: boolean;
}

```

## `backend/src/methodologyLoader.ts`

*Loads regulation thresholds and per-criterion weights.*

```typescript
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  MethodologyConfig,
  MethodologyBlock,
  NominationDef,
} from "./types/methodology.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LoadedMethodology {
  config: MethodologyConfig;
  /** Stable hash of the on-disk file contents — stamped onto every verdict for reproducibility. */
  methodology_hash: string;
}

let cached: LoadedMethodology | null = null;

/** Load + validate the methodology config. Caches in-process. */
export function loadMethodology(): LoadedMethodology {
  if (cached) return cached;
  const path = join(__dirname, "config", "methodology.json");
  const raw = readFileSync(path, "utf-8");
  const config = JSON.parse(raw) as MethodologyConfig;
  validate(config);
  const methodology_hash = "sha256-" + createHash("sha256").update(raw).digest("hex").slice(0, 16);
  cached = { config, methodology_hash };
  return cached;
}

export function getMethodology(): MethodologyConfig {
  return loadMethodology().config;
}

export function getMethodologyHash(): string {
  return loadMethodology().methodology_hash;
}

/** Lookup a block by its numeric id (e.g. "50" for A, "51" for B, ...). */
export function getBlockById(blockId: string): MethodologyBlock | null {
  const cfg = getMethodology();
  return cfg.blocks.find((b) => b.id === blockId) ?? null;
}

/** Lookup a block by its letter code (A–L). */
export function getBlockByCode(code: string): MethodologyBlock | null {
  const cfg = getMethodology();
  return cfg.blocks.find((b) => b.code === code.toUpperCase()) ?? null;
}

/** Find a nomination by its code (e.g. "B16"). Also returns the parent block. */
export function findNomination(
  nominationCode: string
): { block: MethodologyBlock; nomination: NominationDef } | null {
  const cfg = getMethodology();
  for (const b of cfg.blocks) {
    const n = b.nominations.find((x) => x.code === nominationCode);
    if (n) return { block: b, nomination: n };
  }
  return null;
}

/**
 * Resolve effective criterion weights for a (block, nomination):
 *   - fixed blocks: use criterion.default_weight
 *   - per_nomination blocks: use nomination.weights[criterion.id]
 * Returns ordered { id, weight } pairs in block.criteria order.
 */
export function resolveCriterionWeights(
  block: MethodologyBlock,
  nomination: NominationDef
): { id: string; weight: number }[] {
  if (block.weight_mode === "fixed") {
    return block.criteria.map((c) => {
      if (typeof c.default_weight !== "number") {
        throw new Error(`Block ${block.code} criterion ${c.id} missing default_weight (weight_mode=fixed)`);
      }
      return { id: c.id, weight: c.default_weight };
    });
  }
  // per_nomination
  const w = nomination.weights;
  if (!w) {
    throw new Error(`Nomination ${nomination.code} missing weights (block ${block.code} weight_mode=per_nomination)`);
  }
  return block.criteria.map((c) => {
    const v = w[c.id];
    if (typeof v !== "number") {
      throw new Error(`Nomination ${nomination.code} missing weight for criterion ${c.id}`);
    }
    return { id: c.id, weight: v };
  });
}

function validate(cfg: MethodologyConfig): void {
  if (!cfg.blocks || cfg.blocks.length !== 12) {
    throw new Error(`Methodology must have 12 blocks, got ${cfg.blocks?.length}`);
  }
  const codes = new Set(cfg.blocks.map((b) => b.code));
  if (codes.size !== 12) throw new Error("Duplicate block codes in methodology");

  for (const b of cfg.blocks) {
    if (!b.criteria.length) throw new Error(`Block ${b.code} has no criteria`);
    if (!b.nominations.length) throw new Error(`Block ${b.code} has no nominations`);

    if (b.weight_mode === "fixed") {
      const sum = b.criteria.reduce((acc, c) => acc + (c.default_weight ?? 0), 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        throw new Error(`Block ${b.code} fixed weights sum to ${sum}, expected 1.0`);
      }
    } else {
      for (const n of b.nominations) {
        if (!n.weights) throw new Error(`Nomination ${n.code} missing weights (block ${b.code})`);
        const sum = Object.values(n.weights).reduce((a, w) => a + w, 0);
        if (Math.abs(sum - 1.0) > 0.001) {
          throw new Error(`Nomination ${n.code} weights sum to ${sum}, expected 1.0`);
        }
        for (const c of b.criteria) {
          if (typeof n.weights[c.id] !== "number") {
            throw new Error(`Nomination ${n.code} missing weight for criterion ${c.id}`);
          }
        }
      }
    }
  }

  // Award thresholds sanity
  const t = cfg.award_thresholds;
  if (!(t.longlist.max < t.shortlist.min &&
        t.shortlist.max < t.bronze.min &&
        t.bronze.max < t.silver.min &&
        t.silver.max < t.gold.min)) {
    throw new Error("award_thresholds bands overlap or are out of order");
  }
}

/** Map a numeric score to its award level using the festival-wide thresholds. */
export function scoreToAwardLevel(
  score: number
): "longlist" | "shortlist" | "bronze" | "silver" | "gold" {
  const t = getMethodology().award_thresholds;
  if (score >= t.gold.min) return "gold";
  if (score >= t.silver.min) return "silver";
  if (score >= t.bronze.min) return "bronze";
  if (score >= t.shortlist.min) return "shortlist";
  return "longlist";
}

```

## `backend/scripts/phase1_analyze.mjs`

*Empirical-analysis script that built phase1_report.md.*

```javascript
/**
 * Phase 1 — Empirical analysis of SM_2025 human-judge L2 scoring.
 *
 * No LLM calls. Pure analytics.
 *
 * Outputs:
 *   1. Per-criterion score distributions (overall + by final award)
 *   2. Score distribution shape (does the full 1–10 range get used?)
 *   3. Per-judge "calibration accuracy" — does the judge's median score
 *      predict the actual award? (A simple correlation.)
 *   4. Sample comments per (criterion × score-band) — the canonical
 *      language real judges use.
 *   5. Histogram of human total_score by final award (the core signal —
 *      what total_score did each band actually earn from real judges?).
 *
 * Writes a single markdown report to phase1_report.md so we can read the
 * data before designing the persona.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM_PATH = join(__dirname, "../../SM_2025.json");
const OUT_PATH = join(__dirname, "../../phase1_report.md");

const data = JSON.parse(readFileSync(SM_PATH, "utf8"));

/* ------------------------------------------------------------------ */
/* 1. Walk every project and pull L2 evaluations into a flat tuple list */
/* ------------------------------------------------------------------ */

/** @typedef {{
 *   project_id: string,
 *   judge_id: string,
 *   block_id: string,
 *   nomination_code: string,
 *   nomination_name: string,
 *   total: number,
 *   comment: string,
 *   diplom: string,
 *   per_criterion: Array<{cid: string, name: string, score: number}>
 * }} Eval */

/** @type {Eval[]} */
const evals = [];

for (const block of data) {
  for (const nom of block) {
    if (!nom || !Array.isArray(nom.projects)) continue;
    for (const p of nom.projects) {
      const dipl = (p.diplom_text || "NONE").toUpperCase();
      const l2 = p?.level2?.marks_and_comments;
      if (!l2) continue;
      for (const [jid, e] of Object.entries(l2)) {
        const total = parseFloat(e?.total);
        if (Number.isNaN(total)) continue;
        if (typeof e.total === "string" && e.total.trim().toLowerCase() === "is_my") continue;
        const bc = e?.by_criteries || {};
        const per = [];
        for (const [cid, cd] of Object.entries(bc)) {
          const s = parseFloat(cd?.result);
          if (Number.isNaN(s)) continue;
          per.push({ cid, name: cd?.name || cid, score: s });
        }
        evals.push({
          project_id: p.project_id,
          judge_id: jid,
          block_id: nom.block_id,
          nomination_code: nom.code,
          nomination_name: nom.name,
          total,
          comment: (e.comment || "").trim(),
          diplom: dipl,
          per_criterion: per,
        });
      }
    }
  }
}

console.log(`extracted ${evals.length} L2 evaluations across ${new Set(evals.map(e=>e.project_id)).size} projects, ${new Set(evals.map(e=>e.judge_id)).size} judges`);

/* ------------------------------------------------------------------ */
/* 2. Score distribution of TOTAL scores by final award                */
/* ------------------------------------------------------------------ */

const AWARD_ORDER = ["GOLD", "SILVER", "BRONZE", "SHORTLIST", "LONGLIST", "NONE"];

function bucketBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function statsOfNums(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a,b)=>a-b);
  const mean = s.reduce((a,b)=>a+b,0) / s.length;
  const median = s[Math.floor(s.length/2)];
  return {
    n: s.length,
    min: s[0],
    max: s[s.length-1],
    mean: +mean.toFixed(2),
    median: +median.toFixed(2),
    p10: +s[Math.floor(s.length*0.1)].toFixed(1),
    p90: +s[Math.floor(s.length*0.9)].toFixed(1),
  };
}

function histogram(nums, binWidth = 1, min = 1, max = 10) {
  const bins = [];
  for (let b = min; b <= max; b += binWidth) bins.push({ lo: b, hi: b + binWidth, count: 0 });
  for (const n of nums) {
    if (n < min || n > max) continue;
    const idx = Math.min(bins.length - 1, Math.floor((n - min) / binWidth));
    bins[idx].count += 1;
  }
  return bins;
}

const totalsByAward = new Map();
for (const a of AWARD_ORDER) totalsByAward.set(a, []);
for (const e of evals) {
  if (totalsByAward.has(e.diplom)) totalsByAward.get(e.diplom).push(e.total);
}

/* ------------------------------------------------------------------ */
/* 3. Per-criterion distribution                                       */
/* ------------------------------------------------------------------ */

// Map crit name → flat list of all scores (across ALL evaluators, ALL projects)
const perCritScores = new Map();
const perCritByAward = new Map(); // crit -> award -> [scores]

for (const e of evals) {
  for (const c of e.per_criterion) {
    if (!perCritScores.has(c.name)) perCritScores.set(c.name, []);
    perCritScores.get(c.name).push(c.score);
    if (!perCritByAward.has(c.name)) perCritByAward.set(c.name, new Map());
    const m = perCritByAward.get(c.name);
    if (!m.has(e.diplom)) m.set(e.diplom, []);
    m.get(e.diplom).push(c.score);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Per-judge calibration accuracy                                   */
/*    For each judge: given their evaluations, how well does score     */
/*    correlate with the final award? Use rank correlation as proxy.   */
/* ------------------------------------------------------------------ */

const AWARD_TO_RANK = { GOLD: 5, SILVER: 4, BRONZE: 3, SHORTLIST: 2, LONGLIST: 1, NONE: 0 };

function spearmanLite(pairs) {
  // Simple Pearson on ranks: just use Pearson on raw values for speed —
  // we have integer awards and continuous scores, that's fine.
  if (pairs.length < 5) return null;
  const xs = pairs.map(p=>p[0]);
  const ys = pairs.map(p=>p[1]);
  const mx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const my = ys.reduce((a,b)=>a+b,0)/ys.length;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i=0; i<xs.length; i++) {
    const dx = xs[i]-mx, dy = ys[i]-my;
    num += dx*dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

const judgeBuckets = bucketBy(evals, e => e.judge_id);
const judgeCalibration = [];
for (const [jid, list] of judgeBuckets) {
  if (list.length < 10) continue;
  const pairs = list.map(e => [AWARD_TO_RANK[e.diplom] ?? 0, e.total]);
  const corr = spearmanLite(pairs);
  if (corr === null) continue;
  judgeCalibration.push({
    judge_id: jid,
    n: list.length,
    correlation: +corr.toFixed(3),
    score_range: [Math.min(...list.map(e=>e.total)), Math.max(...list.map(e=>e.total))],
    score_std: +Math.sqrt(
      list.reduce((s,e)=>{const d=e.total-list.reduce((a,b)=>a+b.total,0)/list.length; return s+d*d;},0)/list.length
    ).toFixed(2),
  });
}
judgeCalibration.sort((a,b)=>b.correlation-a.correlation);
const topJudges = judgeCalibration.slice(0, 25);
const topJudgeIds = new Set(topJudges.map(j=>j.judge_id));

/* ------------------------------------------------------------------ */
/* 5. Sample comments per (criterion × score band) FROM TOP JUDGES     */
/* ------------------------------------------------------------------ */

function bandOf(score) {
  if (score >= 9) return "9–10 GOLD";
  if (score >= 7) return "7–8 SILVER";
  if (score >= 5) return "5–6 BRONZE";
  if (score >= 3) return "3–4 SHORTLIST";
  return "1–2 LONGLIST";
}

// We use the OVERALL evaluation comment as the "scoring rationale" since
// per-criterion comments aren't separately stored — but we tag it with the
// total score band as the reference.
const commentsByBand = new Map();
for (const e of evals) {
  if (!topJudgeIds.has(e.judge_id)) continue;
  if (!e.comment || e.comment.length < 60) continue;
  const band = bandOf(e.total);
  if (!commentsByBand.has(band)) commentsByBand.set(band, []);
  commentsByBand.get(band).push({
    judge: e.judge_id,
    project_id: e.project_id,
    nomination: e.nomination_code,
    diplom: e.diplom,
    total: e.total,
    comment: e.comment.slice(0, 600),
  });
}
for (const [b, arr] of commentsByBand) {
  arr.sort((a,b)=>a.comment.length-b.comment.length);
}

/* ------------------------------------------------------------------ */
/* 6. Aggregate per-project total — using MEDIAN across judges, then   */
/*    see how the project median predicts the final award.             */
/* ------------------------------------------------------------------ */

const projectsBucket = bucketBy(evals, e => e.project_id);
const projectMedians = [];
for (const [pid, list] of projectsBucket) {
  const sorted = [...list].sort((a,b)=>a.total-b.total);
  const med = sorted[Math.floor(sorted.length/2)].total;
  const proj = list[0];
  projectMedians.push({
    project_id: pid,
    n_judges: list.length,
    median_total: +med.toFixed(2),
    diplom: proj.diplom,
    nomination: proj.nomination_code,
  });
}
const medianByAward = new Map();
for (const a of AWARD_ORDER) medianByAward.set(a, []);
for (const p of projectMedians) {
  if (medianByAward.has(p.diplom)) medianByAward.get(p.diplom).push(p.median_total);
}

/* ------------------------------------------------------------------ */
/* 7. Build the report                                                 */
/* ------------------------------------------------------------------ */

const lines = [];
lines.push("# Phase 1 — Empirical analysis of SM_2025 human L2 scoring");
lines.push("");
lines.push(`Source: SM_2025.json — ${evals.length} L2 evaluations across ${new Set(evals.map(e=>e.project_id)).size} projects from ${new Set(evals.map(e=>e.judge_id)).size} judges.`);
lines.push("");
lines.push("**Purpose:** before redesigning the AI persona, look at what real human judges actually did. Three things matter: do humans use the full 1–10 scale (yes/no), how does score-by-criterion vary by final award, and what do top-calibrated judges actually write at each score band.");
lines.push("");

// Section A — Distribution of total scores
lines.push("## A. Distribution of human total_score by final award");
lines.push("");
lines.push("How wide is the human range per award class? If real judges stick to 4–6 across all awards, the AI clustering is matching reality. If real judges spread their scores, the clustering is an LLM-only artifact.");
lines.push("");
lines.push("| award | n | mean | median | p10 | p90 | min | max |");
lines.push("|-------|---|------|--------|-----|-----|-----|-----|");
for (const a of AWARD_ORDER) {
  const s = statsOfNums(totalsByAward.get(a) || []);
  if (!s) continue;
  lines.push(`| ${a} | ${s.n} | ${s.mean} | ${s.median} | ${s.p10} | ${s.p90} | ${s.min} | ${s.max} |`);
}
lines.push("");

// Histogram
lines.push("### Total-score histogram (all evaluations, all awards)");
lines.push("");
const allTotals = evals.map(e=>e.total);
const hist = histogram(allTotals, 1, 1, 10);
const maxBin = Math.max(...hist.map(h=>h.count));
for (const h of hist) {
  const bar = "█".repeat(Math.round(40*h.count/maxBin));
  lines.push(`\`${h.lo.toFixed(0)}–${h.hi.toFixed(0)}\` ${String(h.count).padStart(5)} ${bar}`);
}
lines.push("");

// Section B — Per-criterion stats
lines.push("## B. Per-criterion score distributions");
lines.push("");
lines.push("Same view, but per criterion. Tells us if any criterion is intrinsically narrower than others (e.g. 'Strategy' might cluster while 'Idea' uses the full range).");
lines.push("");
lines.push("| criterion | n | mean | median | p10 | p90 | min | max |");
lines.push("|-----------|---|------|--------|-----|-----|-----|-----|");
const sortedCrits = [...perCritScores.entries()].sort((a,b)=>b[1].length-a[1].length);
for (const [cname, scores] of sortedCrits) {
  const s = statsOfNums(scores);
  if (!s) continue;
  lines.push(`| ${cname} | ${s.n} | ${s.mean} | ${s.median} | ${s.p10} | ${s.p90} | ${s.min} | ${s.max} |`);
}
lines.push("");

// Per-criterion × award means
lines.push("### Per-criterion mean score by final award");
lines.push("");
const allCrits = [...perCritByAward.keys()];
const headerCrits = allCrits.slice(0, 8);
lines.push("| award | " + headerCrits.join(" | ") + " |");
lines.push("|-------|" + headerCrits.map(()=>"---").join("|") + "|");
for (const a of AWARD_ORDER) {
  const row = [a];
  for (const cn of headerCrits) {
    const arr = (perCritByAward.get(cn) || new Map()).get(a) || [];
    const s = statsOfNums(arr);
    row.push(s ? s.mean.toFixed(2) : "—");
  }
  lines.push("| " + row.join(" | ") + " |");
}
lines.push("");

// Section C — Top judges
lines.push("## C. Top calibrated judges (correlation of their L2 score → final award)");
lines.push("");
lines.push("This is empirical — judges whose individual scores best predict the eventual award are the closest thing we have to a 'good juror' to imitate.");
lines.push("");
lines.push("| judge_id | n_evals | corr(score, award) | score_std | score_range |");
lines.push("|----------|---------|--------------------|-----------|-------------|");
for (const j of topJudges) {
  lines.push(`| ${j.judge_id} | ${j.n} | ${j.correlation} | ${j.score_std} | ${j.score_range[0]}–${j.score_range[1]} |`);
}
lines.push("");

// Section D — Sample comments per band
lines.push("## D. Sample comments from top-25 judges, by score band");
lines.push("");
lines.push("These are the canonical human voices at each score band. The AI persona should sound like THIS, not like generic LLM rationale.");
lines.push("");
const bandOrder = ["9–10 GOLD","7–8 SILVER","5–6 BRONZE","3–4 SHORTLIST","1–2 LONGLIST"];
for (const band of bandOrder) {
  const arr = commentsByBand.get(band) || [];
  if (!arr.length) continue;
  // Pick 3 around the median length
  arr.sort((a,b)=>a.comment.length-b.comment.length);
  const mid = Math.floor(arr.length/2);
  const samples = arr.slice(Math.max(0, mid-1), mid+2);
  lines.push(`### ${band}  (n=${arr.length})`);
  lines.push("");
  for (const s of samples) {
    lines.push(`- **judge ${s.judge}, ${s.nomination}, total=${s.total}, award=${s.diplom}:**`);
    lines.push(`  > ${s.comment.replace(/\n/g," ").slice(0,500)}`);
  }
  lines.push("");
}

// Section E — Project medians vs award (the regulation's actual mechanism)
lines.push("## E. Project median across judges — vs final award");
lines.push("");
lines.push("This is what the regulation actually computes (median across ≥7 judges per project). Tells us what the **emergent jury verdict** distribution looks like for each award class.");
lines.push("");
lines.push("| award | n | mean of medians | median of medians | p10 | p90 |");
lines.push("|-------|---|-----------------|-------------------|-----|-----|");
for (const a of AWARD_ORDER) {
  const s = statsOfNums(medianByAward.get(a) || []);
  if (!s) continue;
  lines.push(`| ${a} | ${s.n} | ${s.mean} | ${s.median} | ${s.p10} | ${s.p90} |`);
}
lines.push("");

// Section F — Key takeaways
lines.push("## F. Key takeaways for persona design");
lines.push("");
lines.push("(Auto-derived; verify against the tables above.)");
lines.push("");
const goldStats = statsOfNums(medianByAward.get("GOLD") || []);
const noneStats = statsOfNums(medianByAward.get("NONE") || []);
const noneTotalStats = statsOfNums(totalsByAward.get("NONE") || []);
const goldTotalStats = statsOfNums(totalsByAward.get("GOLD") || []);
if (goldStats && noneStats) {
  lines.push(`- Real-jury **median total_score**: gold = ${goldStats.median}, none = ${noneStats.median}. Spread is ${(goldStats.median - noneStats.median).toFixed(2)} points across the worst→best classes (project-level medians).`);
}
if (goldTotalStats && noneTotalStats) {
  lines.push(`- Individual **judge** scores: gold-projects mean ${goldTotalStats.mean} (range ${goldTotalStats.min}–${goldTotalStats.max}), none-projects mean ${noneTotalStats.mean} (range ${noneTotalStats.min}–${noneTotalStats.max}). Compare this to the AI's collapsed 4.7–6.4 range — humans use a much wider scale.`);
}
const top = topJudges[0];
if (top) lines.push(`- Best-calibrated judge: ${top.judge_id} (corr=${top.correlation} across ${top.n} evals). Use this judge as the anchor voice for the persona.`);
const overallSpread = statsOfNums(allTotals);
if (overallSpread) lines.push(`- Overall human total score range: ${overallSpread.min}–${overallSpread.max}, p10–p90 = ${overallSpread.p10}–${overallSpread.p90}. This is the empirical distribution the AI should match.`);
lines.push("");
lines.push("**Implication for v6 persona design:**");
lines.push("- Do not invent rules. Encode the empirical per-band trigger language from Section D verbatim.");
lines.push("- Match the empirical distribution shape from Section A, not a uniform expectation.");
lines.push("- Use the top-judge IDs as the persona's voice anchors (their comments become the few-shot retrieval pool).");
lines.push("");

writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`wrote report → ${OUT_PATH}`);

```

## `backend/scripts/phase2_extract.mjs`

*Built judgeAnchors.json from SM_2025.json.*

```javascript
/**
 * Phase 2 — Build the anchor pool + voice analysis.
 *
 * Outputs:
 *   1. backend/src/data/judgeAnchors.json — runtime retrieval pool of all
 *      top-25-judge evaluations, indexed by nomination_code and block_id.
 *      Each entry: {judge_id, project_id, project_name, nomination_code,
 *      block_id, total, comment, diplom, per_criterion}.
 *   2. phase2_voice_analysis.md — close study of top-5 judges' writing
 *      style: opening phrases, sentence structure, weakness/strength
 *      signals, length stats. The persona description in the system prompt
 *      will be grounded in these patterns.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM_PATH = join(__dirname, "../../SM_2025.json");
const ANCHORS_OUT = join(__dirname, "../src/data/judgeAnchors.json");
const VOICE_OUT = join(__dirname, "../../phase2_voice_analysis.md");

if (!existsSync(dirname(ANCHORS_OUT))) mkdirSync(dirname(ANCHORS_OUT), { recursive: true });

/* ------------------------------------------------------------------ */
/* 1. Find top-25 judges by score↔award correlation (replicates Phase1) */
/* ------------------------------------------------------------------ */

const data = JSON.parse(readFileSync(SM_PATH, "utf8"));

const evals = [];
for (const block of data) {
  for (const nom of block) {
    if (!nom || !Array.isArray(nom.projects)) continue;
    for (const p of nom.projects) {
      const dipl = (p.diplom_text || "NONE").toUpperCase();
      const l2 = p?.level2?.marks_and_comments;
      if (!l2) continue;
      for (const [jid, e] of Object.entries(l2)) {
        const total = parseFloat(e?.total);
        if (Number.isNaN(total)) continue;
        const bc = e?.by_criteries || {};
        const per = [];
        for (const [cid, cd] of Object.entries(bc)) {
          const s = parseFloat(cd?.result);
          if (Number.isNaN(s)) continue;
          per.push({ name: cd?.name || cid, score: s });
        }
        evals.push({
          project_id: p.project_id,
          project_name: (p.project_name || "").trim(),
          judge_id: jid,
          block_id: nom.block_id,
          nomination_code: nom.code,
          nomination_name: nom.name,
          total,
          comment: (e.comment || "").trim(),
          diplom: dipl,
          per_criterion: per,
        });
      }
    }
  }
}

const AWARD_RANK = { GOLD: 5, SILVER: 4, BRONZE: 3, SHORTLIST: 2, LONGLIST: 1, NONE: 0 };

function pearson(pairs) {
  if (pairs.length < 5) return null;
  const xs = pairs.map(p=>p[0]);
  const ys = pairs.map(p=>p[1]);
  const mx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const my = ys.reduce((a,b)=>a+b,0)/ys.length;
  let n=0, dx=0, dy=0;
  for (let i=0; i<xs.length; i++) {
    const a = xs[i]-mx, b = ys[i]-my;
    n += a*b; dx += a*a; dy += b*b;
  }
  if (dx === 0 || dy === 0) return null;
  return n / Math.sqrt(dx*dy);
}

const byJudge = new Map();
for (const e of evals) {
  if (!byJudge.has(e.judge_id)) byJudge.set(e.judge_id, []);
  byJudge.get(e.judge_id).push(e);
}

const judgeQuality = [];
for (const [jid, list] of byJudge) {
  if (list.length < 10) continue;
  const corr = pearson(list.map(e => [AWARD_RANK[e.diplom] ?? 0, e.total]));
  if (corr === null) continue;
  judgeQuality.push({ judge_id: jid, n: list.length, correlation: +corr.toFixed(4) });
}
judgeQuality.sort((a,b)=>b.correlation-a.correlation);

// Voice template: top 5. Retrieval pool: everyone with corr ≥ 0.80
// (broader pool gives coverage across all 12 blocks).
const TOP5 = judgeQuality.slice(0, 5).map(j => j.judge_id);
const RETRIEVAL_POOL = judgeQuality.filter(j => j.correlation >= 0.80).map(j => j.judge_id);
const poolSet = new Set(RETRIEVAL_POOL);

console.log(`retrieval pool: ${RETRIEVAL_POOL.length} judges (correlation ≥ 0.80)`);
console.log(`top 5 voice judges:`, TOP5.join(", "));

/* ------------------------------------------------------------------ */
/* 2. Build anchor pool — all top-25 evaluations indexed for retrieval  */
/* ------------------------------------------------------------------ */

const anchorPool = [];
for (const e of evals) {
  if (!poolSet.has(e.judge_id)) continue;
  if (!e.comment || e.comment.length < 60) continue; // skip stub comments
  anchorPool.push({
    judge_id: e.judge_id,
    project_id: e.project_id,
    project_name: e.project_name,
    nomination_code: e.nomination_code,
    block_id: e.block_id,
    total: +e.total.toFixed(2),
    diplom: e.diplom,
    comment: e.comment.replace(/\s+/g, " ").slice(0, 700),
    per_criterion: e.per_criterion.map(c => ({ name: c.name, score: c.score })),
    is_top5: TOP5.includes(e.judge_id),
  });
}

// Index by nomination and by block for fast retrieval
const byNomination = {};
const byBlock = {};
for (const a of anchorPool) {
  if (!byNomination[a.nomination_code]) byNomination[a.nomination_code] = [];
  byNomination[a.nomination_code].push(a);
  if (!byBlock[a.block_id]) byBlock[a.block_id] = [];
  byBlock[a.block_id].push(a);
}

const anchorsFile = {
  meta: {
    generated_at: new Date().toISOString(),
    source: "SM_2025.json",
    retrieval_pool_judges: RETRIEVAL_POOL,
    top5_judges: TOP5,
    total_anchors: anchorPool.length,
  },
  anchors: anchorPool,
  by_nomination: byNomination,
  by_block: byBlock,
};

writeFileSync(ANCHORS_OUT, JSON.stringify(anchorsFile, null, 2));
console.log(`wrote ${anchorPool.length} anchors → ${ANCHORS_OUT}`);

/* ------------------------------------------------------------------ */
/* 3. Voice analysis on top-5 judges                                    */
/* ------------------------------------------------------------------ */

const top5Comments = anchorPool.filter(a => a.is_top5);

function bandOf(score) {
  if (score >= 9) return "9–10 GOLD";
  if (score >= 7) return "7–8 SILVER";
  if (score >= 5) return "5–6 BRONZE";
  if (score >= 3) return "3–4 SHORTLIST";
  return "1–2 LONGLIST";
}

const lines = [];
lines.push("# Phase 2 — Voice analysis: top 5 calibrated jurors");
lines.push("");
lines.push(`Top 5 by score↔award correlation: ${TOP5.join(", ")}.  These are the voices the AI persona should imitate.`);
lines.push("");

// Per-judge stats
lines.push("## Per-judge statistics");
lines.push("");
lines.push("| judge | n_evals | corr | range | mean_total | mean_comment_len |");
lines.push("|-------|---------|------|-------|------------|------------------|");
for (const jid of TOP5) {
  const list = anchorPool.filter(a => a.judge_id === jid);
  const totals = list.map(a => a.total);
  const lens = list.map(a => a.comment.length);
  const corr = judgeQuality.find(j => j.judge_id === jid).correlation;
  lines.push(`| ${jid} | ${list.length} | ${corr} | ${Math.min(...totals)}–${Math.max(...totals)} | ${(totals.reduce((a,b)=>a+b,0)/totals.length).toFixed(2)} | ${Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)} chars |`);
}
lines.push("");

// All comments by band, judge 8837 first
lines.push("## All comments from top 5, organised by score band");
lines.push("");
lines.push("Use these as the literal style template for the persona. Note the patterns: short opening verdict, named KPI weaknesses, no hedge filler, often ends with what's missing for the next band up.");
lines.push("");

for (const band of ["9–10 GOLD","7–8 SILVER","5–6 BRONZE","3–4 SHORTLIST","1–2 LONGLIST"]) {
  const inBand = top5Comments.filter(a => bandOf(a.total) === band);
  if (!inBand.length) continue;
  lines.push(`### ${band}  (n=${inBand.length})`);
  lines.push("");
  for (const a of inBand.slice(0, 10)) {
    lines.push(`- **judge ${a.judge_id} | ${a.nomination_code} | total=${a.total} | award=${a.diplom}** — *${a.project_name.slice(0, 50)}*`);
    lines.push(`  > ${a.comment}`);
  }
  lines.push("");
}

// Style pattern extraction
lines.push("## Style pattern extraction");
lines.push("");

// Common opening words
const openings = top5Comments.map(a => a.comment.split(/[.,;]/)[0].slice(0, 60).trim());
const freqMap = new Map();
for (const o of openings) {
  const word = o.split(" ").slice(0, 2).join(" ").toLowerCase();
  freqMap.set(word, (freqMap.get(word) || 0) + 1);
}
const topOpenings = [...freqMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
lines.push("**Most common opening 2-word phrases:**");
lines.push("");
for (const [w, c] of topOpenings) lines.push(`- "${w}" (${c}×)`);
lines.push("");

// Length distribution
const lens = top5Comments.map(a => a.comment.length);
lens.sort((a,b)=>a-b);
lines.push(`**Comment length:** min ${lens[0]}, p10 ${lens[Math.floor(lens.length*0.1)]}, median ${lens[Math.floor(lens.length/2)]}, p90 ${lens[Math.floor(lens.length*0.9)]}, max ${lens[lens.length-1]} characters.`);
lines.push("");

// Markers of weakness
const weaknessMarkers = ["не хватило", "не дотягивает", "слабая", "слабый", "не хватает", "размыто", "не убедил", "не отвечает", "сомнения", "вопросы к", "минус"];
const strengthMarkers = ["шикарный", "отличный", "крепкий", "сильная", "интересный", "удачный", "качественн", "достоин", "понравил"];
lines.push("**Weakness signal phrases observed (×N occurrences):**");
lines.push("");
for (const m of weaknessMarkers) {
  const c = top5Comments.filter(a => a.comment.toLowerCase().includes(m)).length;
  if (c > 0) lines.push(`- "${m}" — ${c}×`);
}
lines.push("");
lines.push("**Strength signal phrases observed:**");
lines.push("");
for (const m of strengthMarkers) {
  const c = top5Comments.filter(a => a.comment.toLowerCase().includes(m)).length;
  if (c > 0) lines.push(`- "${m}" — ${c}×`);
}
lines.push("");

writeFileSync(VOICE_OUT, lines.join("\n"));
console.log(`wrote voice analysis → ${VOICE_OUT}`);

/* Summary stats */
console.log("\n=== summary ===");
console.log(`anchor pool size: ${anchorPool.length}`);
console.log(`nominations covered: ${Object.keys(byNomination).length} / ${(() => {
  const all = new Set();
  for (const e of evals) all.add(e.nomination_code);
  return all.size;
})()}`);
console.log(`blocks covered: ${Object.keys(byBlock).length} / 12`);

const bandCount = { "9–10 GOLD":0, "7–8 SILVER":0, "5–6 BRONZE":0, "3–4 SHORTLIST":0, "1–2 LONGLIST":0 };
for (const a of anchorPool) bandCount[bandOf(a.total)]++;
console.log(`bands:`, bandCount);

```

# 13. Empirical analysis outputs

## `phase1_report.md`

*Empirical analysis of human-juror behavior on SM_2025.*

# Phase 1 — Empirical analysis of SM_2025 human L2 scoring

Source: SM_2025.json — 8777 L2 evaluations across 781 projects from 937 judges.

**Purpose:** before redesigning the AI persona, look at what real human judges actually did. Three things matter: do humans use the full 1–10 scale (yes/no), how does score-by-criterion vary by final award, and what do top-calibrated judges actually write at each score band.

## A. Distribution of human total_score by final award

How wide is the human range per award class? If real judges stick to 4–6 across all awards, the AI clustering is matching reality. If real judges spread their scores, the clustering is an LLM-only artifact.

| award | n | mean | median | p10 | p90 | min | max |
|-------|---|------|--------|-----|-----|-----|-----|
| GOLD | 558 | 8.8 | 9.1 | 7 | 10 | 2 | 10 |
| SILVER | 1693 | 7.36 | 7.7 | 4.8 | 9.4 | 1 | 10 |
| BRONZE | 2378 | 5.69 | 5.7 | 3.3 | 8 | 1 | 10 |
| SHORTLIST | 2840 | 4.08 | 4 | 2 | 6.5 | 1 | 10 |
| LONGLIST | 1308 | 2.59 | 2 | 1 | 4.6 | 1 | 9.8 |

### Total-score histogram (all evaluations, all awards)

`1–2`   646 ████████████████████
`2–3`  1268 ████████████████████████████████████████
`3–4`  1065 █████████████████████████████████
`4–5`  1279 ████████████████████████████████████████
`5–6`  1015 ████████████████████████████████
`6–7`   983 ███████████████████████████████
`7–8`   922 █████████████████████████████
`8–9`   800 █████████████████████████
`9–10`   613 ███████████████████
`10–11`   186 ██████

## B. Per-criterion score distributions

Same view, but per criterion. Tells us if any criterion is intrinsically narrower than others (e.g. 'Strategy' might cluster while 'Idea' uses the full range).

| criterion | n | mean | median | p10 | p90 | min | max |
|-----------|---|------|--------|-----|-----|-----|-----|
| Strategy | 7039 | 5.19 | 5 | 2 | 9 | 1 | 10 |
| Results | 5627 | 4.97 | 5 | 2 | 9 | 1 | 10 |
| Execution & Craft | 3738 | 5.4 | 5 | 2 | 9 | 1 | 10 |
| Execution | 3626 | 5.66 | 6 | 2 | 9 | 1 | 10 |
| Idea | 3083 | 5.16 | 5 | 2 | 9 | 1 | 10 |
| Effectiveness & Results | 3000 | 5.21 | 5 | 2 | 9 | 1 | 10 |
| Creativity | 2537 | 5.35 | 5 | 2 | 9 | 1 | 10 |
| Innovation & Creativity | 1863 | 5.18 | 5 | 2 | 9 | 1 | 10 |
| Challenge | 1383 | 5.4 | 5 | 2 | 9 | 1 | 10 |
| Idea freshness | 1119 | 4.53 | 4 | 1 | 9 | 1 | 10 |
| Social outcomes | 818 | 5.61 | 5 | 2 | 10 | 1 | 10 |
| Solution | 294 | 5.29 | 5 | 2 | 9 | 1 | 10 |
| Big Idea | 175 | 5.35 | 6 | 1 | 9 | 1 | 10 |
| Campaign | 175 | 5.17 | 6 | 1 | 9 | 1 | 10 |
| Social Outcomes | 108 | 5.33 | 5 | 2 | 9 | 1 | 10 |

### Per-criterion mean score by final award

| award | Challenge | Idea | Execution | Results | Strategy | Social Outcomes | Creativity | Social outcomes |
|-------|---|---|---|---|---|---|---|---|
| GOLD | 8.47 | 8.74 | 8.96 | 8.38 | 8.71 | — | 8.60 | 9.36 |
| SILVER | 6.90 | 7.05 | 7.60 | 7.11 | 7.22 | 7.32 | 7.37 | 7.58 |
| BRONZE | 5.67 | 5.50 | 5.90 | 5.44 | 5.52 | 6.00 | 5.51 | 5.88 |
| SHORTLIST | 4.23 | 4.14 | 4.34 | 3.94 | 4.03 | 3.91 | 4.06 | 4.14 |
| LONGLIST | 3.06 | 2.67 | 2.87 | 2.61 | 2.56 | 2.60 | 2.62 | 2.60 |
| NONE | — | — | — | — | — | — | — | — |

## C. Top calibrated judges (correlation of their L2 score → final award)

This is empirical — judges whose individual scores best predict the eventual award are the closest thing we have to a 'good juror' to imitate.

| judge_id | n_evals | corr(score, award) | score_std | score_range |
|----------|---------|--------------------|-----------|-------------|
| 8837 | 12 | 0.987 | 3.14 | 1.15–10 |
| 9774 | 11 | 0.977 | 2.53 | 1–8.8 |
| 8918 | 15 | 0.977 | 2.41 | 1.4–9.9 |
| 9600 | 10 | 0.976 | 2.45 | 2–9.1 |
| 10369 | 15 | 0.976 | 2.29 | 2.1–10 |
| 10367 | 12 | 0.972 | 2.2 | 2.3–9.1 |
| 10368 | 12 | 0.971 | 2.24 | 2.4–9.1 |
| 9731 | 10 | 0.968 | 2.64 | 2–10 |
| 9874 | 10 | 0.967 | 1.82 | 2.3–7 |
| 9009 | 13 | 0.964 | 3.38 | 1–10 |
| 9450 | 11 | 0.964 | 2.36 | 3–10 |
| 8923 | 12 | 0.96 | 1.68 | 3.6–9.15 |
| 9900 | 11 | 0.96 | 2.48 | 1–9.7 |
| 9691 | 12 | 0.958 | 2.17 | 2.2–9.6 |
| 9110 | 12 | 0.956 | 2.6 | 1.9–9.5 |
| 9861 | 13 | 0.955 | 2.88 | 1–10 |
| 9173 | 13 | 0.951 | 2.61 | 1.3–9 |
| 8904 | 12 | 0.95 | 2.57 | 1.1–9 |
| 9679 | 13 | 0.949 | 2.8 | 1.6–9 |
| 9892 | 13 | 0.948 | 2.26 | 1–9.18 |
| 9811 | 13 | 0.948 | 2.39 | 1–8.3 |
| 8947 | 10 | 0.948 | 2.6 | 1.15–10 |
| 9092 | 11 | 0.947 | 2.07 | 2.5–10 |
| 9595 | 13 | 0.946 | 2.43 | 2–9.3 |
| 9406 | 10 | 0.945 | 1.33 | 5–9 |

## D. Sample comments from top-25 judges, by score band

These are the canonical human voices at each score band. The AI persona should sound like THIS, not like generic LLM rationale.

### 9–10 GOLD  (n=24)

- **judge 9900, F05, total=9.7, award=GOLD:**
  > Высокий уровень. Интересный креатив, кейс, ориентированный на свою аудиторию, учтены все каналы и метрики по ним. Привязка к бизнес-показателям. Более того, на высоком уровне составлена заявка! Молодцы!
- **judge 9679, K05, total=9, award=GOLD:**
  > Много онлайн-части проекта, если смотреть проект как комплекс мероприятий - соответствует номинации. Хороший дизайн проекта, эстетика соответствует ЦА. В этом мероприятии больше всего ивента, чем в остальных проектах.
- **judge 8837, A24, total=10, award=GOLD:**
  > Шикарный кейс по работе с big  data, гипотезами, сегментацией, поиску инсайтов, болей потребителя и поиску решений преломления барьеров. Результаты отцифрованы, Рост конверсий и рост продаж соответствуют бизнес задачам компании.

### 7–8 SILVER  (n=43)

- **judge 9774, E01, total=8.8, award=SILVER:**
  > Крепкий хороший проект с использованием в целом стандартного уже инструментария с инфлюенсерами для продвижения премиального сервиса. Из вау можно отметить креативную идея в неделей моды в Париже. Крепкое серебро. Не хватило нестандартного инструментария для золота.
- **judge 9600, A23, total=7, award=BRONZE:**
  > Хороший кейс, классно вывернутый хук, что если не победа в шоу, то победа по жизни тебя как современной девушки.  Многие косметические бренды интегрируются в ТВ шоу, но не многие выходят за рамки интеграции с коммуникацией в ОЛВ, которая служит продолжением общей кампании.
- **judge 9092, C15, total=7.2, award=SILVER:**
  > Отличный кейс. Инсайт удивляет, идея отвечает на сайт. Идея новая, крафт на высшем уровне. Очень деликатный язык, осторожный. При этом проблематика доносится четко и бьет в сердечко. Есть вопросы к результатам, однако я считаю, что многое зависит от времени и места Спасибо за проект

### 5–6 BRONZE  (n=39)

- **judge 8947, C14, total=5.5, award=BRONZE:**
  > Кажется, что первостепенная задача была - это продвижение платформы. Проект сам по себе классный - выверенная подача темы, большой список используемых инструментов. Но если смотреть именно на креатив, то сложно сказать, что эта идея свежая и новая.
- **judge 9774, E03, total=5.8, award=BRONZE:**
  > Проект интересен своей стратегической историей по объединению аукционных домов и продвижению русского искусства. Качественно проработанный проект с хорошими результатами в СМИ, но без креативных идей. Вопрос, считаем ли PR абонент как малобюджетный проект
- **judge 9892, A26, total=6.15, award=BRONZE:**
  > Понравился омниканальный подход, все реализовано как по учебнику. 172 000 попали в красную зону, но непонятно сколько из них не знали о своих проблемах сердца. Бизнес результат не отслеживается, но в кейсе упоминаются цели. Мне понравилась сама идея и реализация ее, но непонятны результаты

### 3–4 SHORTLIST  (n=60)

- **judge 9874, F03, total=3.5, award=SHORTLIST:**
  > Кейс крепкий, но нет в нем уникальности, т.е. не отвечает уровню фестиваля, в т.ч. по тому, как проект подан (в рамках обсуждений пришлось домысливать какие-то моменты). Видно, что была проведена качественная аналитика, и результаты для категории не плохи, но проект не является бенчмарком.
- **judge 9900, F05, total=3.1, award=SHORTLIST:**
  > Хороший кейс, понравилось, что детально оцифровали, но не хватило убедительности в цифрах при сравнении с предыдущими периодами и аналитики. Идея и механики акции не новы и подведены к стандартному розыгрышу призов. Понравилась сплоченная защита, которая очень отличалась от выступлений других номинантов.
- **judge 9861, F13, total=4, award=SHORTLIST:**
  > &gt; &quot;Кубокроссы МТС и Street Beat: синергия технологии и моды! Креативный дизайн Canyaon привлёк продвинутую молодёжь, повысив узнаваемость &quot;Кубиков&quot; МТС и укрепив имидж Street Beat как законодателя трендов.  Но работа не является фестивальной низкие показатели и плохо прописаны результаты.

### 1–2 LONGLIST  (n=55)

- **judge 8904, K01, total=2, award=SHORTLIST:**
  > Интересное решение. Реализация сложная с точки зрения формата - в полете, согласования. При этом само мероприятие реализовано в лучших традициях базовых решений в данной категории.  Интересная идея. хорошие результаты.
- **judge 9092, C14, total=2.5, award=LONGLIST:**
  > Слабая идея. Не очевидная связь динозаврика с заболеванием.  Аудитория родители и врачи, но форма коммуникации выбрана как на детей. Место для инсталляции выбрано не ради эффективности. Обоснование при защите подтверждает это
- **judge 9874, F04, total=2.5, award=SHORTLIST:**
  > Результативность проекта вызывает сомнения, особенно на фоне большого бюджета. Кажется, что при довольно четкой и не очень широкой ЦА, выбор каналов не релевантен. Креатив не цепляющий. Уникальности и ценности проекта не видно.

## E. Project median across judges — vs final award

This is what the regulation actually computes (median across ≥7 judges per project). Tells us what the **emergent jury verdict** distribution looks like for each award class.

| award | n | mean of medians | median of medians | p10 | p90 |
|-------|---|-----------------|-------------------|-----|-----|
| GOLD | 54 | 9.27 | 9.2 | 8.8 | 9.9 |
| SILVER | 163 | 7.78 | 7.75 | 7 | 8.5 |
| BRONZE | 210 | 5.82 | 5.9 | 5 | 6.7 |
| SHORTLIST | 243 | 3.93 | 4 | 3.1 | 4.8 |
| LONGLIST | 111 | 2.19 | 2.1 | 1.6 | 2.8 |

## F. Key takeaways for persona design

(Auto-derived; verify against the tables above.)

- Best-calibrated judge: 8837 (corr=0.987 across 12 evals). Use this judge as the anchor voice for the persona.
- Overall human total score range: 1–10, p10–p90 = 2–8.8. This is the empirical distribution the AI should match.

**Implication for v6 persona design:**
- Do not invent rules. Encode the empirical per-band trigger language from Section D verbatim.
- Match the empirical distribution shape from Section A, not a uniform expectation.
- Use the top-judge IDs as the persona's voice anchors (their comments become the few-shot retrieval pool).


---

## `phase2_voice_analysis.md`

*Voice patterns of top-5 calibrated jurors.*

# Phase 2 — Voice analysis: top 5 calibrated jurors

Top 5 by score↔award correlation: 8837, 8918, 9774, 10369, 9600.  These are the voices the AI persona should imitate.

## Per-judge statistics

| judge | n_evals | corr | range | mean_total | mean_comment_len |
|-------|---------|------|-------|------------|------------------|
| 8837 | 12 | 0.9868 | 1.15–10 | 6.63 | 320 chars |
| 8918 | 0 | 0.9775 | Infinity–-Infinity | NaN | NaN chars |
| 9774 | 11 | 0.9767 | 1–8.8 | 4.76 | 245 chars |
| 10369 | 0 | 0.9759 | Infinity–-Infinity | NaN | NaN chars |
| 9600 | 10 | 0.9757 | 2–9.1 | 5.42 | 256 chars |

## All comments from top 5, organised by score band

Use these as the literal style template for the persona. Note the patterns: short opening verdict, named KPI weaknesses, no hedge filler, often ends with what's missing for the next band up.

### 9–10 GOLD  (n=6)

- **judge 8837 | A01 | total=10 | award=GOLD** — *Пятёрочка & Atomic Heart*
  > Отличный пример промышленного бенчмарка, когда сеть уходит от стандартного привлечения и использования лидеров мнений, а выбирает персонаж, понятный во всех смыслах для той аудитории, которую сеть хочет привлечь в свои оффлайн каналы. При агрессивной конкуренции со стороны агрегаторов доставки, фастфуда и кафе, за счет данной кампании у сети получилось выполнить все основные бизнес задачи.
- **judge 8837 | A03 | total=10 | award=GOLD** — *Естественно вкусно! Вкус & Польза от «Пятёрочки»*
  > Проект можно назвать и национально значимым. Цель и результаты проекта соответствуют бизнес амбициям компании. Чувствуется глубина проработки проекта: тренды рынка, потребности потребителей, конкурентное кружение, ценовое позиционирование. Проект содержит детальную информацию по отцифрованным результатам.
- **judge 8837 | A05 | total=10 | award=GOLD** — *Dandy Art Edition*
  > Этетический, культурный, исторический проект продвижения продукта, story telling вокруг товара, на который наложены ограничения по продвижению. Виртуозное воплощение в жизнь. Грамотно подобранная ЦА и работа с ней. Отличный пример индустриальногто бенчмарка.
- **judge 9600 | A23 | total=9 | award=SILVER** — *Караоке-такси "Танцы-Шманцы"*
  > Хороший классный кейс. Хочется выбелить это в индустриальный бенчмарк, как имелаьный микс инфлюенсеров и перфоманс маркетинга. В рамках обозначенного бюджета ребята выжали максимум.
- **judge 8837 | A24 | total=10 | award=GOLD** — *Реклама на ТВ – Пицца на столе: досматриваемость и*
  > Шикарный кейс по работе с big data, гипотезами, сегментацией, поиску инсайтов, болей потребителя и поиску решений преломления барьеров. Результаты отцифрованы, Рост конверсий и рост продаж соответствуют бизнес задачам компании.
- **judge 9600 | A25 | total=9.1 | award=SILVER** — *Сериал “Комбинация”*
  > Один из лучших кейсов в своей номинации. Точно достойно металла за консистентную проработку проекта. Стратегические решения и тактику.

### 7–8 SILVER  (n=6)

- **judge 8837 | A01 | total=7 | award=SILVER** — *Сказки от Юбилейного*
  > Креативная идея реализации, нативно вписана в бренд заказчика. Хорошо заполненная заявка: описана ситуация на рынке, тренды, вызовы,. Прописаны задачи по данному промо и показаны результаты. Найденное стратегическое решение попадает в инсайт. Русское в моде. Сказки в моде. Нестандартная реализация идеи, которая гармонично ложиться на бренд заказчика.
- **judge 8837 | A01 | total=8 | award=SILVER** — *Альтернативная HoReCa для альтернативного молока*
  > Хороший кейс индустриального бенчамарка. Агентство нашло уникальное на сегодняшний день решение по реализации бизнес-задач клиента, нащупав новую поднишу и создав новый продукт. Агентство отлично внедрило pull стратегию продаж за счет начала формирования лояльности у конечных клиентов, повышая узнаваемость, уходя от зож и вовлекая аудиторию в пробовании нового продукта. В рамках небольших бюджетов успешно прошла тест.
- **judge 8837 | A03 | total=8 | award=SILVER** — *Собственная торговая марка сети магазинов техники *
  > Проведен анализ рынка и найдена своевременное стратегическое решение по выводу СТМ в премиальном сегменте, одноименном с основным ритейлом. Проработанная коммуникационная стратегия по выводу новинки на рынок. Есть отцифровка результатов кампании. По результатам проделанной работы получился отличный продукт, полностью соответствующий потребностям целевой аудитории и выведепн в правильное время (когда европейские бренды решили уйти с рынка).
- **judge 9600 | A23 | total=7 | award=BRONZE** — *Моя помада – мои правила*
  > Хороший кейс, классно вывернутый хук, что если не победа в шоу, то победа по жизни тебя как современной девушки. Многие косметические бренды интегрируются в ТВ шоу, но не многие выходят за рамки интеграции с коммуникацией в ОЛВ, которая служит продолжением общей кампании.
- **judge 9774 | E01 | total=8.8 | award=SILVER** — *Ultima Яндекс Маркет. Нестандартные активации для *
  > Крепкий хороший проект с использованием в целом стандартного уже инструментария с инфлюенсерами для продвижения премиального сервиса. Из вау можно отметить креативную идея в неделей моды в Париже. Крепкое серебро. Не хватило нестандартного инструментария для золота.
- **judge 9774 | E01 | total=8.6 | award=SILVER** — *Запуск сервиса Т-Возврат: утром в газете, вечером *
  > Классный B2C кампания с широким набором инструментария и качественными и значимыми результатами по очень важной теме для общества. Интересный ход с партизанским пиаром.

### 5–6 BRONZE  (n=8)

- **judge 8837 | A05 | total=6 | award=BRONZE** — *Лови закаты с El Capulco 0.0*
  > Интересный, эмоциональный кейс с небольшим бюджетом на продвижении и значимым результатом выполнения бизнес целей: рост продаж на 34%. Считаю, что кейс можно считать хорошим примером индустриального бенчмарка. Хорошо отработан 4P: продукт, цена и продвижение. Отличный пример рекламной коммуникации по категории, которая не является рекламной.
- **judge 9600 | A25 | total=6.4 | award=BRONZE** — *Прием в честь 183-летия Сбера – Мандрагора*
  > С одной стороны задаюсь вопросом, в чем этот кейс является индустриальным бенчмарком? Как-будто в кейсе минимум маркетинга - это просто классное дорогое мероприятие для вип персон. С другой стороны есть классная сильная идея и это будет классным кейсом при масштабировании на широкую публику для выстраивания имиджа и построения знания о технологиях Сбера.
- **judge 9600 | A25 | total=6 | award=SHORTLIST** — *Как мы открыли Школу русской сказки, которую уже п*
  > Хороший пиар кейс, но опять нет понимания в чем бенчмарк. Пиар поработал правда отлично и видимо блогеры хорошо разогнали инфоповод, но считала ли аудитория меседж, не понятно? Какие исследования были на этот счет? Хочется чуть больше фактуры с точки зрения результативности коммуникационных сообщений. И в чем все же ее уникальность перед другими выставками, если опустить эффект от пиар продвижения?
- **judge 9600 | A25 | total=5.15 | award=SHORTLIST** — *Васнецов. Ожившее искусство.*
  > Какие KPI в итоге стояли в рамках кампании? 20к заявок на карту это мало или много? Это только из оффлайн коммуникации? Также не ясно, а почему именно эта выставка? Или это пакетное размещение на несколько выставок в рамках сотрудничества? Вопросов больше чем отвтетов, но пока бенчмарком назвать это не могу.
- **judge 9774 | E01 | total=5 | award=BRONZE** — *Фанаты путешествий*
  > Хорошая крепкая защита проекта, милая креативная идея за счет использования образа собаки и реализация. Но если рассматривать проект в целом и как часть активации спонсорского пакета глобального ПАО &quot;МТС&quot;, нельзя сказать, что это лучший B2C PR проект. За идею и реализацию - бронза.
- **judge 9774 | E03 | total=5.8 | award=BRONZE** — *Как с помощью PR за год продать искусство на 1 мил*
  > Проект интересен своей стратегической историей по объединению аукционных домов и продвижению русского искусства. Качественно проработанный проект с хорошими результатами в СМИ, но без креативных идей. Вопрос, считаем ли PR абонент как малобюджетный проект
- **judge 9774 | E03 | total=6 | award=BRONZE** — *Анонс «Пивнов Градца» — первого пивного курорта в *
  > Интересная виральная история в условиях законодательных ограничений пивного рынка и с хорошим результатом. Крепкая защита, которая убедила в том, что проект достоен железа
- **judge 9774 | E03 | total=6 | award=BRONZE** — *#ДоброМемы — День добрых мемов*
  > Сильная сторона проекта - креатив. Интересная подача для благотворительной тематики. В целом инструменты использованы классические, но с хорошим результатом и охватом. В целом цели проекта достигнуты. Плюс, что агентство делало его про боно

### 3–4 SHORTLIST  (n=6)

- **judge 8837 | A01 | total=3.4 | award=SHORTLIST** — *“Кибертрак или 15 000 000 ₽” от TORNADO ENERGY*
  > Комплексный, продуманный проект. Правильная сегментация целевой аудитории и дальнейшая фокусировка на нее. Продуманная коммуникационная стратегия. Но не раскрыта бизнес задача по продажам и не продемонстрированы результаты продаж после завершения кейса. Хорошее, продуманное промо.
- **judge 8837 | A03 | total=4 | award=SHORTLIST** — *Premiere of Taste. Качество без границ. A03. PRIVA*
  > Проработанный, красиво упакованный кейс. Продуманное позиционирование и проработка данных по клиентам сети. Красивая рекламная кампания. Стильная упаковка. Отличная презентация со стороны представителя ритейла. Но проект нельзя назвать прорывным промышленным бенчмарком.
- **judge 9600 | A23 | total=4.55 | award=SHORTLIST** — *Стокманн – 35 лет в моде*
  > Хорошая маркетинговая годовая стратегия, с хорошими показателями, но в чем бенчмарк рыночный? Много активити в течение года и неплохой бюджет, но консистентного подхода я не считала. Моя рекомендация в будущем выделить наиболее яркую активацию, реализованную в рамках маркетинговой стратегии, и раскрыть ее в кейсе, если она будет являться бенчмарком.
- **judge 9600 | A25 | total=3 | award=LONGLIST** — *«С любовью, ВТБ»: как банк приглашал мир к культур*
  > Хороший хук с рукописными открытками, НО есть большое НО, как подтверждается результативность выстраивания диалога с иностранными музеями? 20 публикаций в СНГ кажется не тот результат за вложенные деньги. И для чего такая амбиция? Что это приносит ВТБ, как бизнесу?
- **judge 9774 | E01 | total=3 | award=SHORTLIST** — *PR-кампания сериала «Комбинация»*
  > Результаты представлены достаточно четко - по количеству и охвату хороший результат. Но номинация - лучшая B2C PR кампания. В заявке же представлен весь маркетинговый инструментарий поддержки фильма, среди которого в том числе есть пиар. Заявка не совсем релевантна номинации
- **judge 9774 | E03 | total=4.6 | award=SHORTLIST** — *Ведро-манифест*
  > Ребята креативно развернули проект, под номинацию не очень подходят. Предлагаем спец.номинацию

### 1–2 LONGLIST  (n=7)

- **judge 8837 | A05 | total=2 | award=SHORTLIST** — *Бочкарев - как сделать х2 за год?*
  > Не очевидно, как данный кейс можно использовать в качестве индустриального бенчмарка. Больше про смену упаковки и продуктового позиционирование. Также есть эстетическая составляющая. По статистике Минздрава привыкание к пиву и алкогольная зависимость выше, чем у других алкогольных напитков. + рост женского алкоголизма. А здесь позиционирование строиться на ежедневном потреблении пива и номинант ставит задачу &quot;стать главным напитком на столе&quot;.
- **judge 8837 | A11 | total=1.15 | award=LONGLIST** — *Авито Услуги. Антистресс для ваших дел*
  > Креативная идея. Бюджет кампании - зашкаливающий. Результат для бизнеса не отцифрован.
- **judge 9600 | A23 | total=2 | award=LONGLIST** — *Искусство красоты в любой момент*
  > Очень непонятный кейс, результаты которые демонстрируются это результаты чего? Точно не металл.
- **judge 9600 | A25 | total=2 | award=LONGLIST** — *Искусство красоты в любой момент*
  > Кажется это все же не та номинация. Искусство здесь скорее как инструмент, нежели основа коммуникации. + в результатах не указан PR охват, а в БХТ мешанина по категории, которую продвигает кампания.
- **judge 9774 | E01 | total=1.6 | award=LONGLIST** — *«Люди-будильники» отправились на самые «сонные» ли*
  > очень сырой кейс и слабая защита. Цели и результат расходятся. Одной из главных целей указано - привлечение новой аудитории в дзен, особенно в каналы по теме здоровья. Приэтом как раз данный результат и никак не оцифрован, даны только публикации в сми и соц сетях. Сама креативная идея будить людей тоже не очень понятна как она с темой здоровья коррелируется
- **judge 9774 | E01 | total=1 | award=LONGLIST** — *Лови закаты с El Capulco 0.0*
  > SUP не является уникальной историей. Уже достаточно много брендов поддерживали разные SUP фестивали. Также абсолютная путаница на защите в результатах. В заявке указано 45 бесплатных публикаций с охватом в 75 млн, по факту выясняется, что публикаций всего 22, а еще были платные посевы. Т.е. несоответствие заявленного и факта. Также в целом низкий охват аудитории. Продажи компании явно притянуты к результатам этого мероприятия.
- **judge 9774 | E03 | total=2 | award=LONGLIST** — *Российская электроника прошла испытание Арктикой*
  > Абсолютно не фестивальный проект. Стандартная проделанная работа. В заявке указаны аудитории, которые при этом совершенно не охвачены по факту

## Style pattern extraction

**Most common opening 2-word phrases:**

- "креативная идея" (2×)
- "хороший кейс" (2×)
- "комплексный" (1×)
- "отличный пример" (1×)
- "проведен анализ" (1×)
- "проработанный" (1×)
- "проект можно" (1×)
- "интересный" (1×)
- "этетический" (1×)
- "не очевидно" (1×)
- "хороший классный" (1×)
- "хорошая маркетинговая" (1×)
- "очень непонятный" (1×)
- "шикарный кейс" (1×)
- "с одной" (1×)

**Comment length:** min 86, p10 134, median 272, p90 421, max 456 characters.

**Weakness signal phrases observed (×N occurrences):**

- "не хватило" — 1×
- "слабая" — 1×

**Strength signal phrases observed:**

- "шикарный" — 1×
- "отличный" — 4×
- "крепкий" — 1×
- "сильная" — 2×
- "интересный" — 2×
- "качественн" — 2×


---

# 14. Configuration / data samples

## `backend/src/data/judgeAnchors.json` (sample — full file is 8.1MB, 2104 anchors)

```json
{
  "meta": {
    "generated_at": "2026-04-28T12:03:58.224Z",
    "source": "SM_2025.json",
    "retrieval_pool_judges": [
      "8837",
      "8918",
      "9774",
      "10369",
      "9600",
      "10367",
      "10368",
      "9731",
      "9874",
      "9450",
      "9009",
      "8923",
      "9900",
      "9691",
      "9110",
      "9861",
      "9173",
      "8904",
      "9679",
      "8947",
      "9892",
      "9811",
      "9092",
      "9595",
      "9387",
      "9406",
      "9808",
      "9831",
      "9303",
      "8888",
      "9486",
      "9318",
      "8868",
      "2191",
      "8963",
      "9227",
      "9623",
      "9463",
      "9004",
      "9614",
      "9266",
      "10091",
      "9673",
      "9703",
      "8893",
      "9319",
      "9239",
      "9830",
      "9392",
      "9194",
      "9025",
      "9240",
      "8981",
      "9751",
      "9432",
      "3180",
      "9291",
      "9138",
      "9020",
      "8905",
      "9325",
      "9798",
      "8990",
      "8951",
      "9901",
      "9031",
      "9555",
      "9888",
      "9815",
      "8982",
      "9282",
      "9169",
      "8903",
      "9617",
      "9168",
      "9484",
      "9475",
      "9848",
      "8810",
      "8826",
      "9263",
      "9389",
      "9077",
      "9728",
      "9517",
      "9852",
      "9191",
      "9427",
      "8943",
      "9063",
      "8995",
      "9373",
      "9867",
      "9630",
      "8874",
      "9690",
      "9511",
      "9701",
      "9529",
      "8801",
      "9725",
      "9376",
      "9613",
      "9886",
      "9594",
      "9141",
      "9509",
      "9668",
      "9692",
      "9060",
      "9377",
      "9437",
      "8975",
      "9127",
      "9801",
      "9032",
      "9566",
      "9333",
      "9670",
      "8797",
      "9109",
      "8836",
      "8974",
      "9098",
      "9209",
      "9541",
      "9438",
      "9858",
      "9186",
      "9722",
      "8845",
      "9875",
      "9182",
      "9641",
      "8986",
      "9305",
      "9008",
      "9304",
      "9758",
      "9669",
      "9785",
      "8938",
      "9500",
      "9556",
      "9532",
      "9601",
      "8886",
      "9334",
      "8818",
      "9904",
      "9611",
      "9473",
      "9268",
      "9533",
      "9535",
      "9696",
      "9474",
      "9174",
      "9586",
      "8933",
      "9370",
      "9894",
      "9236",
      "9524",
      "9890",
      "8936",
      "9205",
      "9599",
      "9221",
      "9162",
      "9681",
      "9027",
      "9111",
      "9420",
      "9769",
      "8833",
      "9153",
      "9226",
      "9313",
      "9393",
      "9351",
      "9267",
      "9051",
      "9362"
    ],
    "top5_judges": [
      "8837",
      "8918",
      "9774",
      "10369",
      "9600"
    ],
    "total_anchors": 2104
  },
  "anchors_sample": [
    {
      "judge_id": "8837",
      "project_id": "5822",
      "project_name": "“Кибертрак или 15 000 000 ₽” от TORNADO ENERGY",
      "nomination_code": "A01",
      "block_id": "50",
      "total": 3.4,
      "diplom": "SHORTLIST",
      "comment": "Комплексный, продуманный проект. Правильная сегментация целевой аудитории и дальнейшая фокусировка на нее. Продуманная коммуникационная стратегия. Но не раскрыта бизнес задача по продажам и не продемонстрированы результаты продаж после завершения кейса. Хорошее, продуманное промо.",
      "per_criterion": [
        {
          "name": "Challenge",
          "score": 4
        },
        {
          "name": "Idea",
          "score": 4
        },
        {
          "name": "Execution",
          "score": 4
        },
        {
          "name": "Results",
          "score": 2
        },
        {
          "name": "Strategy",
          "score": 4
        }
      ],
      "is_top5": true
    },
    {
      "judge_id": "8845",
      "project_id": "5822",
      "project_name": "“Кибертрак или 15 000 000 ₽” от TORNADO ENERGY",
      "nomination_code": "A01",
      "block_id": "50",
      "total": 6.15,
      "diplom": "SHORTLIST",
      "comment": "Красивый проект с ярким креативным призом. В заявке не хватило аргументов в пользу признания проекта ориентиром для категории, не предоставлены данные о влиянии на бизнес результаты",
      "per_criterion": [
        {
          "name": "Challenge",
          "score": 6
        },
        {
          "name": "Idea",
          "score": 7
        },
        {
          "name": "Execution",
          "score": 6
        },
        {
          "name": "Results",
          "score": 6
        },
        {
          "name": "Strategy",
          "score": 6
        }
      ],
      "is_top5": false
    },
    {
      "judge_id": "8974",
      "project_id": "5822",
      "project_name": "“Кибертрак или 15 000 000 ₽” от TORNADO ENERGY",
      "nomination_code": "A01",
      "block_id": "50",
      "total": 4.45,
      "diplom": "SHORTLIST",
      "comment": "Это хороший пример промо с использованием геймификации, но не что-то новое на рынке. 1. Не совсем понятно как отразилось промо на бизнесовых результатах 2. Не до конца раскрыт инсайт 3. Детали геймификации: популярность ПАБГ мобайл падает год от году, сама тема с Кибертраком и оформлением в стилистике киберпанка явление не новое. Лет 5 назад на момент выхода игры Киберпанк все бренды стояли на ушах: выпускали фирменные бинковские карты в этой тематике (это только один из примеров, который можно вспомнить) Этот гейс пример качественного промо. Но качество - это гигиена на рынке. Здесь мы смотрим на что-то новое для рынка.",
      "per_criterion": [
        {
          "name": "Challenge",
          "score": 4
        },
        {
          "name": "Idea",
          "score": 4
        },
        {
          "name": "Execution",
          "score": 5
        },
        {
          "name": "Results",
          "score": 4
        },
        {
          "name": "Strategy",
          "score": 5
        }
      ],
      "is_top5": false
    }
  ],
  "by_nomination_keys_first10": [
    "A01",
    "A03",
    "A05",
    "A06",
    "A07",
    "A09",
    "A10",
    "A11",
    "A12",
    "A13"
  ],
  "by_block_summary": {
    "50": 411,
    "51": 33,
    "52": 184,
    "53": 255,
    "54": 274,
    "55": 459,
    "58": 66,
    "59": 60,
    "60": 346,
    "61": 16
  }
}
```

## `backend/src/config/methodology.json` (structure)

```json
{
  "award_thresholds": {
    "longlist": {
      "min": 0.0,
      "max": 2.99
    },
    "shortlist": {
      "min": 3.0,
      "max": 4.99
    },
    "bronze": {
      "min": 5.0,
      "max": 6.99
    },
    "silver": {
      "min": 7.0,
      "max": 8.99
    },
    "gold": {
      "min": 9.0,
      "max": 10.0
    }
  },
  "social_formula": {
    "description": "Для социально-ориентированных номинаций итог = среднее арифметическое (a) стандартного балла блока и (b) Social outcomes с весом 100%.",
    "social_criterion": {
      "id": "social_outcomes",
      "name_en": "Social outcomes",
      "name_ru": "Социальный результат",
      "description_ru": "Изменения состояния, поведения, статуса благополучателей, произошедшие вследствие проекта. В отличие от охватов и маркетинговых метрик, это реальные последствия для целевой группы."
    },
    "social_criterion_weight": 1.0,
    "combine": "arithmetic_mean"
  },
  "blocks": [
    {
      "id": "50",
      "code": "A",
      "name_ru": "Индустриальный бенчмарк"
    },
    {
      "id": "51",
      "code": "B",
      "name_ru": "Брендинг"
    },
    {
      "id": "52",
      "code": "C",
      "name_ru": "Креатив"
    },
    {
      "id": "53",
      "code": "D",
      "name_ru": "Диджитал"
    },
    {
      "id": "54",
      "code": "E",
      "name_ru": "PR"
    },
    {
      "id": "55",
      "code": "F",
      "name_ru": "Маркетинг"
    },
    {
      "id": "56",
      "code": "G",
      "name_ru": "Медиапродакшн"
    },
    {
      "id": "57",
      "code": "H",
      "name_ru": "Стратегический прорыв"
    },
    {
      "id": "58",
      "code": "I",
      "name_ru": "Бренд-продукты"
    },
    {
      "id": "59",
      "code": "J",
      "name_ru": "Комплексно реализованные кампании"
    },
    {
      "id": "60",
      "code": "K",
      "name_ru": "Событие"
    },
    {
      "id": "61",
      "code": "L",
      "name_ru": "Бренд работодателя и внутренние коммуникации"
    }
  ]
}
```

---

# 15. THE PROMPT TO USE

Paste the entire document above into a fresh ChatGPT/Gemini/Cursor chat, then send this:

---

You're a senior ML/LLM engineer doing an external review. Read the document above carefully and the inlined source code in section 12.

Don't summarize what you read — that's not useful. Instead:

1. Pick the SINGLE biggest reason this system is at 24% exact-match and not 60%+. Be specific. Tell me which file and which lines, and what the fundamental issue is. Disagree with the analysis above if you think it's wrong.

2. Propose ONE concrete change you would make first. Not "consider trying X". A specific code-level change with a hypothesis about why it would move the metric.

3. Tell me which of the 8 open questions in section 10 is the most important one to answer empirically, and how you'd design the simplest test to answer it (with rough cost estimate in $ and hours).

4. Tell me what you'd CUT. The system has accumulated 7 iterations of complexity. What can I delete without losing signal?

5. Tell me one thing the human user (a non-engineer) should personally verify before paying for a 200-case backtest. Something they can eyeball in 10 minutes that would catch a fundamental error.

Be direct. No filler. Push back where you disagree. If you think the entire approach is wrong, say so and propose an alternative.
