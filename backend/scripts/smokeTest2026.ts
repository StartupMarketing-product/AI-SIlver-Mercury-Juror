/**
 * End-to-end smoke test on real SM_2026 submissions.
 *
 * Loads cases directly from SM_2026 test.json (no DB import), builds a
 * CaseBundle for each, runs the full scoring pipeline, dumps the full
 * result for human review.
 */
import "dotenv/config";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { CaseBundle } from "../src/types/case.js";
import { runAnalysis } from "../src/runAnalysis.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM26_PATH = join(__dirname, "../../SM_2026 test.json");
const OUT_DIR = join(__dirname, "../smoke_test_results");

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

interface RawProject {
  project_id: string;
  nomination_id: string;
  project_name: string | null;
  project_info?: string | null;
  project_task?: string | null;
  project_strategy?: string | null;
  project_results?: string | null;
  project_business_results?: string | null;
  project_realisation?: string | null;
  project_targets?: string | null;
  project_unique?: string | null;
  project_start_info?: string | null;
  project_insight?: string | null;
  project_channels?: string | null;
  project_auditory?: string | null;
  project_product?: string | null;
  project_additional_factors?: string | null;
  project_date_from?: string | null;
  project_date_to?: string | null;
  project_size_id?: string | null;
  project_results_file?: string | null;
}

/** Hand-picked test cases — top by content richness, one per target nomination. */
const TARGETS = [
  { code: "D01", project_id: "8461" }, // "Кулинарная премия Kenwood 2025"
  { code: "D10", project_id: "8588" }, // "Дети в фокусе: «Счастливчик Лаки» — первая AI-мультипликация"
  { code: "D13", project_id: "7997" }, // "Kotex POME Tech: data-driven"
];

function buildBundle(p: RawProject, nominationCode: string, blockId: string): CaseBundle {
  const t = (s: string | null | undefined) => (s ?? "").trim() || undefined;
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
    project_additional_factors: t(p.project_additional_factors),
  };
  // Synthesise extracted_text segments from the rich fields so the model has
  // cite_keys to reference. Each non-empty field becomes one segment.
  const sources: Array<[keyof typeof text_fields, string]> = [
    ["project_results", "project_results"],
    ["project_strategy", "project_strategy"],
    ["project_realisation", "project_realisation"],
  ];
  const extracted_text = sources
    .map(([field, src], i) => {
      const v = text_fields[field];
      if (!v) return null;
      return {
        text: v,
        source: src,
        cite_key: `E${i + 1}`,
        kind: "text_field" as const,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  return {
    metadata: {
      case_id: `smoke-${p.project_id}`,
      year: "2026",
      nomination_id: nominationCode,
      block_id: blockId,
      project_id: p.project_id,
      project_name: p.project_name ?? undefined,
      project_date_from: p.project_date_from ?? undefined,
      project_date_to: p.project_date_to ?? undefined,
      project_size_id: p.project_size_id ?? undefined,
    },
    text_fields,
    extracted_text,
  };
}

async function main() {
  const raw = JSON.parse(readFileSync(SM26_PATH, "utf-8"));
  // Top is a list of length 1; element 0 is a dict whose values are the four nominations.
  const noms: any[] = Object.values(raw[0]);
  console.log(`[smoke] found ${noms.length} nominations in SM_2026 test.json`);

  // Methodology block 53 → 2025 D-nominations; 2026 is block 74. Use the 2026
  // block id from data, but resolve criterion weights via the methodology
  // (which has the same nomination codes; runAnalysis maps via nomination code).
  const cases: { code: string; project_id: string; bundle: CaseBundle; rawName: string }[] = [];
  for (const t of TARGETS) {
    const nom = noms.find((n) => n?.code === t.code);
    if (!nom) {
      console.error(`[smoke] nomination ${t.code} not found`);
      continue;
    }
    const project = nom.projects?.find((p: RawProject) => p.project_id === t.project_id);
    if (!project) {
      console.error(`[smoke] project ${t.project_id} not found in ${t.code}`);
      continue;
    }
    // We use the methodology's block id ("53" Digital) so resolution works,
    // not the 2026 dataset's block id ("74").
    const bundle = buildBundle(project, t.code, "53");
    cases.push({
      code: t.code,
      project_id: t.project_id,
      bundle,
      rawName: project.project_name ?? "(unnamed)",
    });
  }

  console.log(`[smoke] running pipeline on ${cases.length} cases:`);
  for (const c of cases) console.log(`  - ${c.code} | ${c.project_id} | ${c.rawName.slice(0, 60)}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(OUT_DIR, stamp);
  mkdirSync(runDir, { recursive: true });

  for (const c of cases) {
    console.log(`\n[smoke] scoring ${c.code} / ${c.project_id} — ${c.rawName.slice(0, 50)}`);
    const t0 = Date.now();
    try {
      const out = await runAnalysis(c.bundle);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const filename = `${c.code}_${c.project_id}.json`;
      writeFileSync(join(runDir, filename), JSON.stringify(out, null, 2));
      console.log(
        `[smoke]   done in ${dt}s — block_score=${out.l2.block_score} total=${out.l2.total_score} award=${out.l2.award_level} caps=${out.l2.caps_applied?.length ?? 0}`
      );

      // Print a human-readable summary
      console.log(`\n  PROJECT: ${c.rawName}`);
      console.log(`  AWARD: ${out.l2.award_level} (block_score=${out.l2.block_score}, total_score=${out.l2.total_score})`);
      console.log(`  VERDICT: ${out.l2.one_paragraph_verdict?.slice(0, 300)}`);
      console.log(`  FATAL FLAW: ${out.l2.case_fatal_flaw}`);
      console.log(`  WHY NOT HIGHER: ${out.l2.why_not_higher_band_overall}`);
      console.log(`  CRITERIA:`);
      for (const cs of out.l2.criteria_scores ?? []) {
        console.log(`    ${cs.criterion.padEnd(20)} score=${cs.score}  evidence=${cs.evidence_ids?.length ?? 0}  rationale: ${cs.rationale.slice(0, 140)}`);
      }
      if (out.l2.caps_applied?.length) {
        console.log(`  CAPS APPLIED:`);
        for (const cap of out.l2.caps_applied) {
          console.log(`    ${cap.criterion}: ${cap.original_score} → ${cap.capped_score}  (${cap.reason})`);
        }
      }
    } catch (e) {
      console.error(`[smoke]   FAILED: ${(e as Error).message}`);
    }
  }
  console.log(`\n[smoke] full results written to ${runDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
