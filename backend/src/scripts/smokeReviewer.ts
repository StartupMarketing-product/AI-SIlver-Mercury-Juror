/**
 * Smoke test for reviewer flow:
 *   1. Boot Express in-process.
 *   2. POST /api/cases/upload → analyze → approve/reject via HTTP.
 *   3. Verify approval_state transitions and audit_log rows.
 */
import "dotenv/config";
import http from "http";
import { insertCase, getCase, insertVerdict } from "../db.js";
import { buildCaseBundle } from "../ingestion.js";
import { runAnalysis } from "../runAnalysis.js";
import { getSupabase } from "../supabase.js";

const PORT = 3411;

async function importApp() {
  // index.ts auto-listens; we just hit the listening port.
  process.env.PORT = String(PORT);
  await import("../index.js");
  // Wait briefly for express to bind.
  await new Promise((r) => setTimeout(r, 400));
}

function http_post(path: string, body: any = {}, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: buf });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function http_get(path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port: PORT, path, method: "GET" }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: buf });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  await importApp();

  // Create a case directly via DB to skip multipart upload — we're testing the reviewer surface.
  const caseId = await insertCase({
    project_name: "[smoke-rev] Reviewer flow",
    nomination_id: "B16",
    block_id: "50",
    year: "2025",
    text_fields: {
      project_info: "Кейс для проверки UI модератора.",
      project_results: "Охват 5 млн. Бейзлайн не измерялся.",
    },
    storage_paths: [],
  });
  const stored = await getCase(caseId);
  if (!stored) throw new Error("case missing");
  const bundle = await buildCaseBundle(stored);
  const output = await runAnalysis(bundle);
  const verdictId = await insertVerdict(output);
  console.log("[smoke-rev] case", caseId, "verdict", verdictId);

  // 1) GET rich verdict
  const rich = await http_get(`/api/verdicts/${verdictId}`);
  console.log("[smoke-rev] GET verdict status:", rich.status, "approval:", rich.body.approval_state, "evidence rows:", rich.body.evidence?.length);
  if (rich.status !== 200) throw new Error("GET verdict failed");
  if (rich.body.approval_state !== "pending") throw new Error("expected pending");

  // 2) POST approve
  const approved = await http_post(`/api/verdicts/${verdictId}/approve`, { note: "looks good" }, { "X-Reviewer-Role": "reviewer", "X-Reviewer-Id": "smoke-tester" });
  console.log("[smoke-rev] approve:", approved.status, approved.body);
  if (approved.body.approval_state !== "approved") throw new Error("approve did not stick");

  // 3) GET list, verify approval_state surfaces
  const list = await http_get(`/api/evaluations`);
  const found = list.body.find((x: any) => x.evaluation_id === verdictId);
  console.log("[smoke-rev] list entry:", found);
  if (found?.approval_state !== "approved") throw new Error("list approval_state mismatch");

  // 4) POST reject (transition approved → rejected, audit captures previous state)
  const rejected = await http_post(`/api/verdicts/${verdictId}/reject`, {}, { "X-Reviewer-Role": "moderator" });
  console.log("[smoke-rev] reject:", rejected.status, rejected.body);
  if (rejected.body.approval_state !== "rejected") throw new Error("reject did not stick");

  // 5) Audit log: expect two rows for this verdict_id (approve + reject).
  const sb = getSupabase();
  const { data: logs } = await sb
    .from("audit_log")
    .select("action, actor_role, details")
    .eq("entity_id", verdictId)
    .order("created_at", { ascending: true });
  console.log("[smoke-rev] audit logs for verdict:", JSON.stringify(logs));
  if (!logs || logs.length < 2) throw new Error("expected ≥2 audit rows");

  console.log("[smoke-rev] OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("[smoke-rev] FAILED:", e);
  process.exit(1);
});
