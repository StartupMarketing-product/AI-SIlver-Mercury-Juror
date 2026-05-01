/**
 * Bulk-import SM_2025.json (XXVI Silver Mercury) into public.cases for backtest.
 *
 * Source file: /Users/OlegLebedev/Documents/AI Agent Сбер/ИИ жюри/SM_2025.json
 * Structure:   list[12 blocks] -> list[nominations] -> {code, block_id, projects: [...]}
 *
 * Per project we set:
 *   source            = 'sm2025_import'
 *   historical_award  = lowercased diplom_text or 'none'
 *   historical_scores = { criteries, marks_and_comments, diplom_id, to_long } from level2/level1
 *   external_case_id  = SM-2025-<project_id> (idempotency key)
 *
 * Skips projects without enough textual content for analysis (project_info+strategy+results all empty).
 *
 * Idempotency: re-runs check public.cases by external_case_id; existing rows are skipped.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/importSM2025.ts [--limit N] [--dry] [--block 50]
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getSupabase } from "../supabase.js";

const TEXT_FIELDS = [
  "project_name",
  "project_product",
  "project_info",
  "project_unique",
  "project_info_client",
  "project_start_info",
  "project_targets",
  "project_task",
  "project_call",
  "project_auditory",
  "project_insight",
  "project_strategy_idea_or_actuality",
  "project_strategy",
  "project_creative",
  "project_big_idea",
  "project_channels",
  "project_realisation",
  "project_results",
  "project_business_results",
  "project_effectivity",
  "project_results_text",
  "project_additional_factors",
] as const;

/** Resolve SM_2025.json. Tries (in order): SM2025_PATH env var, ../../SM_2025.json
 *  relative to this script (project repo root), then macOS host path as a last resort. */
function resolveSourcePath(): string {
  const candidates: string[] = [];
  if (process.env.SM2025_PATH) candidates.push(process.env.SM2025_PATH);
  const here = dirname(fileURLToPath(import.meta.url));
  candidates.push(resolve(here, "../../../SM_2025.json")); // backend/src/scripts -> repo root
  candidates.push(resolve(here, "../../SM_2025.json"));
  candidates.push("/Users/OlegLebedev/Documents/AI Agent Сбер/ИИ жюри/SM_2025.json");
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`SM_2025.json not found. Tried:\n  ${candidates.join("\n  ")}`);
}

type RawProject = Record<string, any>;
type RawNomination = { code?: string; block_id?: string; id?: string; projects?: RawProject[]; name?: string };

function parseFlags(argv: string[]) {
  const flags: { limit?: number; dry?: boolean; block?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") flags.dry = true;
    else if (a === "--limit") flags.limit = parseInt(argv[++i], 10);
    else if (a === "--block") flags.block = argv[++i];
  }
  return flags;
}

function normalizeAward(raw: string | null | undefined): string {
  if (!raw) return "none";
  const u = raw.toUpperCase();
  if (u === "GOLD") return "gold";
  if (u === "SILVER") return "silver";
  if (u === "BRONZE") return "bronze";
  if (u === "SHORTLIST") return "shortlist";
  if (u === "LONGLIST") return "longlist";
  return "none";
}

function pickTextFields(p: RawProject): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TEXT_FIELDS) {
    const v = p[k];
    if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

function hasEnoughContent(text: Record<string, string>): boolean {
  // At minimum we want some context AND some claimed results.
  const hasContext = !!(text.project_info || text.project_unique || text.project_strategy);
  const hasResults = !!(text.project_results || text.project_business_results || text.project_effectivity || text.project_results_text);
  return hasContext && hasResults;
}

async function existingExternalIds(): Promise<Set<string>> {
  const sb = getSupabase();
  const out = new Set<string>();
  // Page through everything matching source filter.
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from("cases")
      .select("external_case_id")
      .eq("source", "sm2025_import")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`existingExternalIds failed: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ external_case_id: string | null }>) {
      if (r.external_case_id) out.add(r.external_case_id);
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log("[import] flags:", flags);

  const sourcePath = resolveSourcePath();
  console.log("[import] reading:", sourcePath);
  const raw = readFileSync(sourcePath, "utf-8");
  const data = JSON.parse(raw) as RawNomination[][];
  if (!Array.isArray(data)) throw new Error("SM_2025.json: expected top-level array");

  // Pre-existing rows so re-runs are no-ops.
  const existing = flags.dry ? new Set<string>() : await existingExternalIds();
  console.log("[import] existing sm2025_import rows:", existing.size);

  let scanned = 0;
  let skippedThin = 0;
  let skippedExisting = 0;
  let inserted = 0;
  const awardCounts: Record<string, number> = {};
  const pendingRows: Array<Record<string, unknown>> = [];

  outer: for (const block of data) {
    if (!Array.isArray(block)) continue;
    for (const nom of block) {
      if (flags.block && String(nom.block_id) !== flags.block) continue;
      const nominationCode = nom.code ?? "";
      const blockId = String(nom.block_id ?? "");
      for (const p of nom.projects ?? []) {
        scanned++;
        const projectId = p.project_id ?? p.id;
        if (!projectId) continue;
        const externalId = `SM-2025-${projectId}`;
        if (existing.has(externalId)) {
          skippedExisting++;
          continue;
        }
        const text = pickTextFields(p);
        if (!hasEnoughContent(text)) {
          skippedThin++;
          continue;
        }
        const award = normalizeAward(p.diplom_text);
        awardCounts[award] = (awardCounts[award] ?? 0) + 1;

        const historical: Record<string, unknown> = {
          diplom_id: p.diplom_id ?? null,
          diplom_text: p.diplom_text ?? null,
          to_long: p.to_long ?? null,
          level2: p.level2 ?? null,
        };

        const row = {
          external_case_id: externalId,
          project_name: typeof p.project_name === "string" ? p.project_name : null,
          nomination_id: nominationCode || "UNKNOWN",
          block_id: blockId || "00",
          year: 2025,
          text_fields: text,
          storage_paths: [],
          status: "uploaded" as const,
          source: "sm2025_import",
          historical_award: award,
          historical_scores: historical,
        };
        pendingRows.push(row);
        inserted++;
        if (flags.limit && inserted >= flags.limit) break outer;
      }
    }
  }

  if (!flags.dry && pendingRows.length > 0) {
    const sb = getSupabase();
    const CHUNK = 200;
    for (let i = 0; i < pendingRows.length; i += CHUNK) {
      const chunk = pendingRows.slice(i, i + CHUNK);
      const { error } = await sb.from("cases").insert(chunk);
      if (error) {
        console.error(`[import] chunk ${i}-${i + chunk.length} failed:`, error.message);
        // Fall back to per-row insert so a single bad row doesn't kill the rest.
        for (const r of chunk) {
          const { error: e2 } = await sb.from("cases").insert(r);
          if (e2) console.warn(`[import] row ${r.external_case_id} failed: ${e2.message}`);
        }
      } else {
        console.log(`[import] inserted chunk ${i}-${i + chunk.length}`);
      }
    }
  }

  console.log("[import] DONE");
  console.log("  scanned:", scanned);
  console.log("  skippedThin:", skippedThin);
  console.log("  skippedExisting:", skippedExisting);
  console.log("  inserted:", inserted);
  console.log("  awardCounts:", awardCounts);
}

main().catch((e) => {
  console.error("[import] FAILED:", e);
  process.exit(1);
});
