/**
 * Methodology config types — Silver Mercury XXVII (regulation 2025–2026).
 *
 * Schema v2:
 *   - Medal thresholds are festival-wide (longlist 0–2.99, shortlist 3–4.99,
 *     bronze 5–6.99, silver 7–8.99, gold 9–10), not per-block.
 *   - Blocks A, C, H, I, J, K use fixed criterion weights.
 *   - Blocks B, D, E, F, G, L use per-nomination weights (each nomination
 *     overrides the criterion weights).
 *   - Each nomination carries `is_social`. For social nominations, the final
 *     score is the arithmetic mean of (a) the standard block score and
 *     (b) Social outcomes scored at 100% weight.
 *   - Anchored rubric (anchors at 2/5/8 per criterion) lives in a separate
 *     anchors.json — methodology only describes structure and weights.
 */

export type WeightMode = "fixed" | "per_nomination";

export interface CriterionDef {
  id: string;
  name_en: string;
  name_ru: string;
  description_ru: string;
  /** Set only when block.weight_mode === "fixed". */
  default_weight?: number;
}

export interface NominationDef {
  /** e.g. "A01", "B16". */
  code: string;
  name_en: string;
  name_ru: string;
  /** Triggers the social-formula combine in scoring. */
  is_social: boolean;
  /** Set only when block.weight_mode === "per_nomination". Maps criterion.id → weight. */
  weights?: Record<string, number>;
}

export interface MethodologyBlock {
  id: string;
  code: string;
  name_en: string;
  name_ru: string;
  weight_mode: WeightMode;
  criteria: CriterionDef[];
  nominations: NominationDef[];
}

export interface AwardBand {
  min: number;
  max: number;
}

export interface AwardThresholds {
  longlist: AwardBand;
  shortlist: AwardBand;
  bronze: AwardBand;
  silver: AwardBand;
  gold: AwardBand;
}

export interface SocialFormula {
  description: string;
  social_criterion: {
    id: string;
    name_en: string;
    name_ru: string;
    description_ru: string;
  };
  social_criterion_weight: number;
  combine: "arithmetic_mean";
}

export interface ScoringScale {
  min: number;
  max: number;
  increment: number;
}

export interface MethodologyConfig {
  version: string;
  festival: string;
  festival_edition: string;
  festival_year: number;
  regulation_ref: string;
  description: string;
  scoring_scale: ScoringScale;
  award_thresholds: AwardThresholds;
  social_formula: SocialFormula;
  blocks: MethodologyBlock[];
}
