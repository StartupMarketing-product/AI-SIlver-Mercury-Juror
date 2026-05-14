import type { CriterionScore } from "./types/evaluation.js";

/**
 * Mechanical Results-criterion cap for Digital cases (Block D).
 *
 * Why this exists: the Digital evaluation framework says first-priority
 * evidence (sales, revenue, market share, ROI, ROMI, etc.) is the only
 * strong proof of business impact. Without it, Results cannot score above
 * the bronze band (5–6) regardless of how impressive media metrics look.
 *
 * The framework is in the L2 prompt and the model OFTEN follows it — but
 * compliance is variable. This module is the belt-and-braces equivalent:
 * a code-level cap that runs after L2 + critic and enforces the rule
 * mechanically.
 *
 * Rule:
 *   If the Results-criterion rationale contains:
 *     • zero numeric tokens (no digit anywhere), AND
 *     • zero business-or-marketing-metric vocabulary (sales, ROI, NPS, …),
 *   then the score is hard-capped at 4 ("longlist tier")
 *   — regardless of what the model wrote.
 *
 * This catches the failure mode where the model says "campaign achieved
 * great engagement" with no numbers and no first/second-priority metric
 * names — i.e., pure third-priority handwaving promoted to silver/gold.
 *
 * The bar is intentionally LOW: even one mention of «выручка» or «NPS»
 * by name is enough to skip the cap. The goal is to catch rationales that
 * consist entirely of generic praise like "хорошие охваты, высокая
 * вовлечённость" with no anchor to anything verifiable.
 *
 * Only applies to Block D cases. Other blocks pass through unchanged.
 */

export interface ResultsCapDelta {
  criterion: string;
  l2_score: number;
  capped_score: number;
  reason: string;
}

export interface ResultsCapReport {
  applied: boolean;
  delta?: ResultsCapDelta;
}

const RESULTS_CAP_SCORE = 4;
const RESULTS_CRITERION_ID = "results";

/**
 * Business + marketing-metric vocabulary (first + second priority from
 * the Digital framework). If ANY of these appear in the rationale, the
 * model has at least gestured at proper evidence — skip the cap.
 *
 * Each entry is a regex fragment; combined into one regex with the `i`
 * flag. Cyrillic and Latin terms are both covered.
 */
const BUSINESS_METRIC_VOCAB = [
  // First priority (business / financial)
  "sales", "выручк", "продаж",
  "incremental\\s+revenue", "доход",
  "ebitda", "margin", "маржа", "маржинальн",
  "доля\\s+рынка", "market\\s+share",
  "roi", "rooi",
  // Second priority (marketing / brand / CRM / customer)
  "romi", "roas", "дрр",
  "cac", "cpa", "cpl",
  "ltv", "arpu", "arppu", "aov",
  "конверси", "(?:^|\\s)cr(?:\\s|[,.])",
  "retention", "удержани",
  "churn", "отток",
  "(?:^|\\s)dau(?:\\s|[,.])", "(?:^|\\s)mau(?:\\s|[,.])",
  "awareness", "узнаваемост",
  "consideration", "namely\\s+consideration",
  "purchase\\s+intent", "намерение\\s+покуп",
  "ad\\s+recall", "запоминаемост",
  "(?:^|\\s)nps(?:\\s|[,.])", "csat", "(?:^|\\s)tom(?:\\s|[,.])",
  "brand\\s+associations", "ассоциаци",
];
const BUSINESS_RE = new RegExp(BUSINESS_METRIC_VOCAB.join("|"), "i");

/** Numeric tokens: any digit anywhere in the text. */
const NUMERIC_RE = /\d/;

/**
 * Apply the mechanical Results cap to a list of criterion scores.
 *
 * Returns the (possibly modified) scores and a report describing what
 * was capped. Idempotent — running this twice is a no-op.
 */
export function applyResultsEvidenceCap(
  scores: CriterionScore[],
  blockCode: string
): { scores: CriterionScore[]; report: ResultsCapReport } {
  // Only applies to Digital block.
  if (!blockCode || blockCode.trim().toUpperCase()[0] !== "D") {
    return { scores, report: { applied: false } };
  }
  let report: ResultsCapReport = { applied: false };
  const out = scores.map((s) => {
    if (s.criterion !== RESULTS_CRITERION_ID) return s;
    if (s.score <= RESULTS_CAP_SCORE) return s; // already at/below cap, nothing to do
    const rationale = s.rationale ?? "";
    const hasNumber = NUMERIC_RE.test(rationale);
    const hasBizVocab = BUSINESS_RE.test(rationale);
    if (hasNumber || hasBizVocab) return s; // model cited at least something; skip cap
    // Both missing — apply the cap.
    const reason =
      "В обосновании результатов нет конкретных цифр и не упоминаются бизнес- или маркетинг-метрики. " +
      "Кейс опирается только на медийные показатели или общие формулировки — " +
      `балл по этому критерию ограничен ${RESULTS_CAP_SCORE}.`;
    report = {
      applied: true,
      delta: {
        criterion: s.criterion,
        l2_score: s.score,
        capped_score: RESULTS_CAP_SCORE,
        reason,
      },
    };
    return {
      ...s,
      score: RESULTS_CAP_SCORE,
      rationale: `${reason} ${rationale}`.trim(),
    };
  });
  return { scores: out, report };
}
