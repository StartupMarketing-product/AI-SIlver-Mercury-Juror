/**
 * Run runAnalysis on ONE case and dump the full L2 result so we can see why
 * caps_applied is 0 even when evidence_grade flags are set. Usage:
 *   npx tsx src/scripts/diagnoseL2.ts <case_id>
 */
import "dotenv/config";
import { getCase } from "../db.js";
import { buildCaseBundle } from "../ingestion.js";
import { runAnalysis } from "../runAnalysis.js";

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("usage: npx tsx src/scripts/diagnoseL2.ts <case_id>");
    process.exit(2);
  }
  const stored = await getCase(id);
  if (!stored) throw new Error(`case ${id} not found`);
  const bundle = await buildCaseBundle(stored);
  const out = await runAnalysis(bundle);
  console.log("BLOCK:", out.block_code, "NOMINATION:", out.nomination_code);
  console.log("EVIDENCE_GRADE:", JSON.stringify(out.l2.evidence_grade, null, 2));
  console.log("CAPS_APPLIED:", JSON.stringify(out.l2.caps_applied, null, 2));
  console.log("SCORES:");
  for (const c of out.l2.criteria_scores) {
    const evid = c.evidence_ids?.length ?? 0;
    console.log(`  ${c.criterion.padEnd(28)} score=${c.score}  evid=${evid}  whb="${(c.why_not_higher_band ?? "").slice(0, 60)}"`);
  }
  console.log("BLOCK_SCORE:", out.l2.block_score, "TOTAL_SCORE:", out.l2.total_score, "AWARD:", out.l2.award_level);
  console.log("CASE_FATAL_FLAW:", out.l2.case_fatal_flaw);
  console.log("WHY_NOT_HIGHER_OVERALL:", out.l2.why_not_higher_band_overall);
  if (out.avatar_script_structured) {
    console.log("AVATAR.short (chars):", out.avatar_script_structured.short.length);
    console.log("AVATAR.long  (chars):", out.avatar_script_structured.long.length);
    console.log("AVATAR.sections:");
    for (const [k, v] of Object.entries(out.avatar_script_structured.sections)) {
      console.log(`  [${k}] ${(v as string).slice(0, 120)}`);
    }
  }
  if (out.l2.critic) {
    console.log("CRITIC.applied:", out.l2.critic.applied);
    console.log("CRITIC.deltas:", JSON.stringify(out.l2.critic.deltas, null, 2));
    console.log("CRITIC.extra_fatal_findings:", out.l2.critic.extra_fatal_findings);
    console.log("CRITIC.overall_reason:", out.l2.critic.overall_reason);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
