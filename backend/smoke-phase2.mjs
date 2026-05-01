// Phase 2 smoke test: insert case → upload file → read back → insert verdict → read back → list.
// Run from backend/: node smoke-phase2.mjs
import "dotenv/config";
import { insertCase, getCase, listCases, insertVerdict, getVerdict, listVerdicts } from "./dist/db.js";
import { uploadCaseFile, downloadCaseFile, getCaseFileSignedUrl } from "./dist/storage.js";

async function main() {
  console.log("=== Phase 2 smoke test ===");
  const ts = Date.now();

  const caseId = await insertCase({
    external_case_id: `smoke-${ts}`,
    project_name: `Smoke Test ${ts}`,
    nomination_id: "B16",
    block_id: "B",
    year: 2025,
    text_fields: {
      project_info: "Test project info",
      project_results: "Test results",
    },
    storage_paths: [],
  });
  console.log("Inserted case:", caseId);

  // Storage round-trip
  const buffer = Buffer.from("This is a fake PDF for smoke test\n%PDF-1.4 fake\n", "utf-8");
  const ref = await uploadCaseFile(caseId, buffer, `smoke-${ts}.pdf`, "application/pdf");
  console.log("Uploaded file:", ref);
  const dl = await downloadCaseFile(ref.path);
  console.log("Downloaded length:", dl.length, "bytes (matches:", dl.length === buffer.length, ")");
  const url = await getCaseFileSignedUrl(ref.path, 60);
  console.log("Signed URL OK:", url.startsWith("https://") ? "yes" : url);

  const got = await getCase(caseId);
  console.log("Read case:", got?.case_id, "project_name:", got?.project_name, "status:", got?.status);

  // Synthetic verdict
  const verdictId = await insertVerdict(
    {
      case_id: caseId,
      methodology_hash: "sha256-test",
      anchors_hash: "sha256-test",
      input_hash: "abcd1234",
      block_code: "B",
      nomination_code: "B16",
      l2: {
        criteria_scores: [
          { criterion: "strategy", score: 7, rationale: "ok" },
          { criterion: "creativity", score: 6, rationale: "ok" },
          { criterion: "execution", score: 7, rationale: "ok" },
          { criterion: "results", score: 5, rationale: "ok" },
        ],
        block_score: 6.3,
        social_outcomes_score: 5,
        total_score: 5.7,
        award_level: "bronze",
        one_paragraph_verdict: "Smoke verdict.",
      },
      evidence: [],
      missing_evidence: [],
      key_quotes: [],
      avatar_script: "Smoke avatar script.",
      consistency_check_passed: true,
    },
    "gpt-4o-mini"
  );
  console.log("Inserted verdict:", verdictId);

  const v = await getVerdict(verdictId);
  console.log("Read verdict:", v?.evaluation_id, "award:", v?.output.l2.award_level, "total:", v?.output.l2.total_score);

  const cl = await listCases(5);
  console.log("Recent cases:", cl.length);
  const vl = await listVerdicts(5);
  console.log("Recent verdicts:", vl.length);

  console.log("=== smoke test passed ===");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
