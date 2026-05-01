import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import type { CaseBundle } from "../src/types/case.js";
import { runAnalysis } from "../src/runAnalysis.js";

async function main() {
  const raw = JSON.parse(readFileSync("/sessions/modest-lucid-sagan/mnt/ИИ жюри/SM_2026 test.json", "utf-8"));
  const noms: any[] = Object.values(raw[0]);
  const nom = noms.find((n) => n?.code === "D13");
  const p = nom.projects.find((x: any) => x.project_id === "7997");
  const t = (s: any) => (typeof s === "string" && s.trim()) ? s.trim() : undefined;
  const text_fields = {
    project_info: t(p.project_info) ?? t(p.project_start_info),
    project_product: t(p.project_product),
    project_auditory: t(p.project_auditory),
    project_insight: t(p.project_insight),
    project_targets: t(p.project_targets),
    project_task: t(p.project_task),
    project_strategy: t(p.project_strategy),
    project_channels: t(p.project_channels),
    project_realisation: t(p.project_realisation),
    project_results: t(p.project_results) ?? t(p.project_business_results),
    project_start_info: t(p.project_start_info),
  };
  const bundle: CaseBundle = {
    metadata: {
      case_id: `smoke-${p.project_id}`,
      year: "2026", nomination_id: "D13", block_id: "53",
      project_id: p.project_id, project_name: p.project_name,
    },
    text_fields,
    extracted_text: [
      ...(text_fields.project_results ? [{ text: text_fields.project_results, source: "project_results", cite_key: "E1", kind: "text_field" as const }] : []),
      ...(text_fields.project_strategy ? [{ text: text_fields.project_strategy, source: "project_strategy", cite_key: "E2", kind: "text_field" as const }] : []),
      ...(text_fields.project_realisation ? [{ text: text_fields.project_realisation, source: "project_realisation", cite_key: "E3", kind: "text_field" as const }] : []),
    ],
  };
  console.log(`scoring D13 / 7997 — ${p.project_name}`);
  const t0 = Date.now();
  const out = await runAnalysis(bundle);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const dir = "/sessions/modest-lucid-sagan/mnt/ИИ жюри/backend/smoke_test_results/2026-04-29T09-58-44-207Z";
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "D13_7997.json"), JSON.stringify(out, null, 2));
  console.log(`done in ${dt}s — block_score=${out.l2.block_score} total=${out.l2.total_score} award=${out.l2.award_level} caps=${out.l2.caps_applied?.length ?? 0}`);
  console.log(`\nVERDICT: ${out.l2.one_paragraph_verdict?.slice(0, 350)}`);
  console.log(`FATAL FLAW: ${out.l2.case_fatal_flaw}`);
  console.log(`WHY NOT HIGHER: ${out.l2.why_not_higher_band_overall}`);
  console.log(`CRITERIA:`);
  for (const cs of out.l2.criteria_scores ?? []) {
    console.log(`  ${cs.criterion.padEnd(20)} score=${cs.score}  rationale: ${cs.rationale.slice(0, 180)}`);
  }
  if (out.l2.caps_applied?.length) {
    console.log(`CAPS:`);
    for (const cap of out.l2.caps_applied) console.log(`  ${cap.criterion}: ${cap.original_score} → ${cap.capped_score}  (${cap.reason})`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
