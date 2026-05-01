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
import { generateAvatarSpeech } from "./avatarSpeech.js";

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

  // Speech + one-paragraph verdict generation. Runs AFTER all caps + critic
  // deltas have been applied. The model gets the FINAL state and writes both
  // the short verdict paragraph and the avatar speech, both opening with the
  // correct post-cap award. We then overwrite l2Result.one_paragraph_verdict
  // with the post-cap version so the displayed verdict can never contradict
  // the band badge.
  const speech = await generateAvatarSpeech(
    {
      award_level: l2Result.award_level,
      total_score: l2Result.total_score,
      block_score: l2Result.block_score,
      project_name: bundle.metadata.project_name,
      nomination_code: nomination.code,
      one_paragraph_verdict: l2Result.one_paragraph_verdict,
      case_fatal_flaw: l2Result.case_fatal_flaw,
      why_not_higher_band_overall: l2Result.why_not_higher_band_overall,
      criteria_scores: l2Result.criteria_scores,
      caps_applied: l2Result.caps_applied,
    },
    apiKey
  );
  if (speech?.one_paragraph_verdict) {
    l2Result.one_paragraph_verdict = speech.one_paragraph_verdict;
  }

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
    avatar_script: speech?.short ?? "",
    avatar_script_structured: speech ?? undefined,
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
