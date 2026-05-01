// Smoke test: load methodology + anchors, resolve a known nomination, run L2 fallback,
// confirm hashes + social formula combine work.
import { loadMethodology, findNomination, scoreToAwardLevel, resolveCriterionWeights, getMethodologyHash } from "./dist/methodologyLoader.js";
import { loadAnchors, getAnchorSet, getAnchorsHash } from "./dist/anchorsLoader.js";
import { runL2 } from "./dist/l2.js";

console.log("=== methodology ===");
const m = loadMethodology();
console.log("  blocks:", m.config.blocks.length);
console.log("  total nominations:", m.config.blocks.reduce((a,b)=>a+b.nominations.length,0));
console.log("  methodology_hash:", getMethodologyHash());

console.log("\n=== anchors ===");
const a = loadAnchors();
console.log("  blocks covered:", Object.keys(a.config.anchors_by_block).length);
console.log("  anchors_hash:", getAnchorsHash());

console.log("\n=== nomination lookup ===");
const f = findNomination("B16");
console.log("  B16 found:", !!f, f?.nomination?.name_en, "is_social:", f?.nomination?.is_social);
const w = resolveCriterionWeights(f.block, f.nomination);
console.log("  resolved weights:", w);

const aset = getAnchorSet("B", "creativity");
console.log("  anchor B/creativity at 5:", aset["5"].slice(0, 60), "...");

console.log("\n=== L2 fallback ===");
const bundle = {
  metadata: { case_id: "test-1", year: "2025", nomination_id: "B16", block_id: "51", project_name: "Demo Brand" },
  text_fields: { project_info: "Demo info", project_results: "Demo results" },
  extracted_text: [],
};
const out = await runL2(bundle, f.block, f.nomination, undefined);
console.log("  block_score:", out.block_score);
console.log("  social_outcomes_score:", out.social_outcomes_score);
console.log("  total_score:", out.total_score, "(expected mean of block & social = 3)");
console.log("  award_level:", out.award_level);

console.log("\n=== threshold check ===");
[0, 2.5, 3, 5, 7, 8.99, 9, 10].forEach(s => console.log(`  ${s} -> ${scoreToAwardLevel(s)}`));
