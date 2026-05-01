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
