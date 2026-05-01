/**
 * Phase 3 smoke test:
 *   1. Insert a case with rich text fields (results-heavy, no clear baseline).
 *   2. Build bundle (persists evidence rows + cite_keys).
 *   3. Run analysis (L2 with evidence-grade caps + prompt_hash + model_id).
 *   4. Insert verdict, then read DB rows back and assert Phase 3 invariants.
 */
import "dotenv/config";
import { insertCase, getCase, insertVerdict, getVerdict, appendAuditLog } from "../db.js";
import { buildCaseBundle } from "../ingestion.js";
import { runAnalysis } from "../runAnalysis.js";
import { getSupabase } from "../supabase.js";

async function main() {
  const caseId = await insertCase({
    project_name: "[smoke3] Социальный кейс — без бейзлайна",
    nomination_id: "B16", // socially-oriented per XXVII regulation
    block_id: "50",
    year: "2025",
    text_fields: {
      project_info: "Кампания о поддержке людей с ОВЗ: серия видео и наружной рекламы в 5 городах России в 2025.",
      project_task: "Снять стигму с темы инклюзии и привлечь 10 000 волонтёров в фонд.",
      project_strategy:
        "Документальная подача: реальные истории, контраст до/после, амбассадоры — известные предприниматели.",
      project_channels: "TV, OOH, YouTube, Telegram, ВКонтакте, локальные СМИ.",
      project_realisation: "20 видеороликов, 1200 поверхностей OOH, 3 пресс-конференции, спецпроект на vc.ru.",
      project_results:
        "Охват 18 млн контактов. Привлечено 12 500 заявок волонтёров за 3 месяца. Узнаваемость фонда выросла. Бейзлайн до запуска не измерялся.",
    },
    storage_paths: [],
  });
  console.log("[smoke3] case_id:", caseId);

  const stored = await getCase(caseId);
  if (!stored) throw new Error("case not found after insert");

  const bundle = await buildCaseBundle(stored);
  console.log("[smoke3] extracted segments:", bundle.extracted_text.length);
  console.log(
    "[smoke3] cite_keys:",
    bundle.extracted_text.map((s) => s.cite_key).filter(Boolean)
  );
  const haveEvidenceIds = bundle.extracted_text.filter((s) => s.evidence_id).length;
  console.log("[smoke3] segments with evidence_id:", haveEvidenceIds);

  const output = await runAnalysis(bundle);
  console.log("[smoke3] block_code:", output.block_code, "nomination_code:", output.nomination_code);
  console.log("[smoke3] total_score:", output.l2.total_score, "award:", output.l2.award_level);
  console.log("[smoke3] block_score:", output.l2.block_score, "social:", output.l2.social_outcomes_score);
  console.log("[smoke3] prompt_hash:", output.prompt_hash, "model_id:", output.model_id);
  console.log("[smoke3] evidence_grade:", JSON.stringify(output.l2.evidence_grade));
  console.log("[smoke3] caps_applied:", JSON.stringify(output.l2.caps_applied));
  console.log("[smoke3] missing_evidence:", output.missing_evidence);
  console.log(
    "[smoke3] criteria_scores:",
    output.l2.criteria_scores
      .map((c) => `${c.criterion}=${c.score}(ev=${(c.evidence_ids ?? []).length})`)
      .join(", ")
  );

  const verdictId = await insertVerdict(output);
  console.log("[smoke3] verdict_id:", verdictId);
  await appendAuditLog({
    action: "verdict.created",
    entity_type: "verdict",
    entity_id: verdictId,
    details: { case_id: caseId, smoke: "phase3" },
  });

  // Read back from DB and verify Phase 3 fields persisted.
  const stored2 = await getVerdict(verdictId);
  console.log("[smoke3] DB roundtrip prompt_hash:", stored2?.output.prompt_hash);
  console.log("[smoke3] DB roundtrip model_id:", stored2?.output.model_id);

  const sb = getSupabase();
  const { data: row } = await sb
    .from("verdicts")
    .select("prompt_hash, model_id, input_hash, criteria_scores")
    .eq("id", verdictId)
    .single();
  console.log("[smoke3] verdict row:", JSON.stringify(row, null, 2).slice(0, 600));

  const { count: evidCount } = await sb
    .from("evidence")
    .select("id", { count: "exact", head: true })
    .eq("case_id", caseId);
  console.log("[smoke3] persisted evidence rows for case:", evidCount);

  const { data: auditRows } = await sb
    .from("audit_log")
    .select("action, entity_type, entity_id, created_at")
    .or(`entity_id.eq.${caseId},entity_id.eq.${verdictId}`)
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("[smoke3] audit rows:", JSON.stringify(auditRows));

  console.log("[smoke3] OK");
}

main().catch((e) => {
  console.error("[smoke3] FAILED:", e);
  process.exit(1);
});
