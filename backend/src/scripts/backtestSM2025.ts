/**
 * Backtest harness — runs runAnalysis() over imported XXVI Silver Mercury cases
 * and compares predicted award_level against the recorded historical_award.
 *
 * Output:
 *   1. Stratified-sample summary (counts per class)
 *   2. Confusion matrix (rows = actual, cols = predicted)
 *   3. Per-block exact-match + ±1-band agreement
 *   4. Top mismatches written as JSONL for follow-up anchor tightening
 *
 * Default sample size is small (per-class cap) so a first pass is cheap. Pass
 * --full to backtest the entire pool, or --per N to override the per-class cap.
 *
 * Usage:
 *   npx tsx src/scripts/backtestSM2025.ts                  # default 15/class = ~90 cases
 *   npx tsx src/scripts/backtestSM2025.ts --per 30
 *   npx tsx src/scripts/backtestSM2025.ts --full
 *   npx tsx src/scripts/backtestSM2025.ts --block 50       # one block only
 */
import "dotenv/config";
import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getSupabase } from "../supabase.js";
import { getCase } from "../db.js";
import { buildCaseBundle } from "../ingestion.js";
import { runAnalysis } from "../runAnalysis.js";

type Award = "gold" | "silver" | "bronze" | "shortlist" | "longlist" | "none";
const AWARD_ORDER: Award[] = ["none", "longlist", "shortlist", "bronze", "silver", "gold"];

interface Flags {
  full?: boolean;
  per?: number;
  block?: string;
  /** Comma-separated list of nomination codes to filter on, e.g. "D01,D10,D13,D15". */
  nominations?: string[];
  concurrency: number;
  outDir: string;
  resume?: string;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { concurrency: 2, outDir: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--full") f.full = true;
    else if (a === "--per") f.per = parseInt(argv[++i], 10);
    else if (a === "--block") f.block = argv[++i];
    else if (a === "--nominations") f.nominations = argv[++i].split(",").map((s) => s.trim().toUpperCase());
    else if (a === "--concurrency") f.concurrency = parseInt(argv[++i], 10);
    else if (a === "--out") f.outDir = argv[++i];
    else if (a === "--resume") f.resume = argv[++i];
  }
  if (!f.outDir) {
    const here = dirname(fileURLToPath(import.meta.url));
    f.outDir = join(here, "../../backtest_runs");
  }
  return f;
}

interface PoolRow {
  case_id: string;
  block_id: string;
  nomination_id: string;
  project_name: string | null;
  historical_award: Award;
}

async function fetchPool(block?: string, nominations?: string[]): Promise<PoolRow[]> {
  const sb = getSupabase();
  const out: PoolRow[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = sb
      .from("cases")
      .select("id, block_id, nomination_id, project_name, historical_award")
      .eq("source", "sm2025_import")
      .range(from, from + pageSize - 1);
    if (block) q = q.eq("block_id", block);
    if (nominations && nominations.length) q = q.in("nomination_id", nominations);
    const { data, error } = await q;
    if (error) throw new Error(`fetchPool: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as any[]) {
      out.push({
        case_id: r.id,
        block_id: r.block_id,
        nomination_id: r.nomination_id,
        project_name: r.project_name ?? null,
        historical_award: (r.historical_award ?? "none") as Award,
      });
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/** Stratify by historical_award, take up to `perClass` from each. */
function stratify(pool: PoolRow[], perClass: number): PoolRow[] {
  const buckets = new Map<Award, PoolRow[]>();
  for (const r of pool) {
    const arr = buckets.get(r.historical_award) ?? [];
    arr.push(r);
    buckets.set(r.historical_award, arr);
  }
  const picked: PoolRow[] = [];
  for (const [award, rows] of buckets.entries()) {
    // Shuffle deterministically so re-runs hit the same set.
    rows.sort((a, b) => a.case_id.localeCompare(b.case_id));
    picked.push(...rows.slice(0, perClass));
    void award;
  }
  return picked;
}

function awardIndex(a: Award): number {
  return AWARD_ORDER.indexOf(a);
}

interface RunRecord {
  case_id: string;
  block_id: string;
  nomination_id: string;
  project_name: string | null;
  actual: Award;
  /** Best award this project earned in ANY nomination it entered (corrected
   *  ground truth — same campaign can win silver in one nomination and lose
   *  outright in another, so a per-submission "actual" can mislabel quality). */
  best_project_award: Award;
  predicted: Award;
  total_score: number | null;
  block_score: number | null;
  exact: boolean;
  within1: boolean;
  /** True if predicted matches the project's best-of-any-nomination award. */
  exact_vs_best: boolean;
  within1_vs_best: boolean;
  caps_applied: number;
  evidence_grade: string | null;
  error?: string;
}

async function runOne(row: PoolRow, bestProjectAward: Award): Promise<RunRecord> {
  const base: RunRecord = {
    case_id: row.case_id,
    block_id: row.block_id,
    nomination_id: row.nomination_id,
    project_name: row.project_name,
    actual: row.historical_award,
    best_project_award: bestProjectAward,
    predicted: "none",
    total_score: null,
    block_score: null,
    exact: false,
    within1: false,
    exact_vs_best: false,
    within1_vs_best: false,
    caps_applied: 0,
    evidence_grade: null,
  };
  try {
    const stored = await getCase(row.case_id);
    if (!stored) return { ...base, error: "case missing" };
    const bundle = await buildCaseBundle(stored);
    const out = await runAnalysis(bundle);
    const predicted = (out.l2.award_level as Award) ?? "none";
    const distance = Math.abs(awardIndex(row.historical_award) - awardIndex(predicted));
    const distBest = Math.abs(awardIndex(bestProjectAward) - awardIndex(predicted));
    const grade = out.l2.evidence_grade
      ? Object.entries(out.l2.evidence_grade)
          .filter(([k, v]) => v === true && k !== "rationale")
          .map(([k]) => k)
          .join(",")
      : null;
    return {
      ...base,
      predicted,
      total_score: out.l2.total_score,
      block_score: out.l2.block_score,
      exact: predicted === row.historical_award,
      within1: distance <= 1,
      exact_vs_best: predicted === bestProjectAward,
      within1_vs_best: distBest <= 1,
      caps_applied: out.l2.caps_applied?.length ?? 0,
      evidence_grade: grade,
    };
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }
}

/** Run with bounded concurrency. */
async function pmap<T, U>(items: T[], n: number, fn: (x: T, i: number) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(n, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

function buildConfusion(records: RunRecord[]): Record<Award, Record<Award, number>> {
  const matrix = {} as Record<Award, Record<Award, number>>;
  for (const a of AWARD_ORDER) {
    matrix[a] = {} as Record<Award, number>;
    for (const b of AWARD_ORDER) matrix[a][b] = 0;
  }
  for (const r of records) {
    if (r.error) continue;
    matrix[r.actual][r.predicted] += 1;
  }
  return matrix;
}

function formatConfusion(matrix: Record<Award, Record<Award, number>>): string {
  const header = ["actual\\pred", ...AWARD_ORDER].map((s) => s.padStart(10)).join("");
  const rows = AWARD_ORDER.map((a) => {
    const cells = AWARD_ORDER.map((b) => String(matrix[a][b]).padStart(10)).join("");
    return a.padStart(10) + cells;
  });
  return [header, ...rows].join("\n");
}

function perBlockStats(records: RunRecord[]): Record<string, { n: number; exact: number; within1: number }> {
  const out: Record<string, { n: number; exact: number; within1: number }> = {};
  for (const r of records) {
    if (r.error) continue;
    if (!out[r.block_id]) out[r.block_id] = { n: 0, exact: 0, within1: 0 };
    out[r.block_id].n += 1;
    if (r.exact) out[r.block_id].exact += 1;
    if (r.within1) out[r.block_id].within1 += 1;
  }
  return out;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const perClass = flags.full ? Number.POSITIVE_INFINITY : flags.per ?? 15;
  console.log("[backtest] flags:", { ...flags, perClass });

  if (!existsSync(flags.outDir)) mkdirSync(flags.outDir, { recursive: true });
  let runDir: string;
  let alreadyDone = new Set<string>();
  if (flags.resume) {
    runDir = flags.resume.startsWith("/") ? flags.resume : join(flags.outDir, flags.resume);
    if (!existsSync(runDir)) throw new Error(`--resume dir does not exist: ${runDir}`);
    const recordsPath = join(runDir, "records.jsonl");
    if (existsSync(recordsPath)) {
      for (const line of readFileSync(recordsPath, "utf-8").split("\n")) {
        if (!line.trim()) continue;
        try { alreadyDone.add(JSON.parse(line).case_id); } catch { /* ignore */ }
      }
    }
    console.log(`[backtest] resuming ${runDir}; ${alreadyDone.size} cases already done`);
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    runDir = join(flags.outDir, stamp);
    mkdirSync(runDir, { recursive: true });
  }

  const pool = await fetchPool(flags.block, flags.nominations);
  console.log(`[backtest] pool size: ${pool.length}`);

  // Build a project_name → best-award map across the FULL pool (across nominations).
  // For per-project ground truth — same campaign in multiple nominations may
  // legitimately win silver in one and none in another; the AI's quality judgment
  // should be checked against the project's actual best result, not against an
  // arbitrary submission slot.
  // NOTE: we look across ALL imported cases (not just the filtered pool) so
  // best-of-project includes other nominations the project entered.
  const fullCorpus = await fetchPool();
  const bestByProject = new Map<string, Award>();
  for (const r of fullCorpus) {
    const key = (r.project_name || "").trim();
    if (!key) continue;
    const cur = bestByProject.get(key) ?? "none";
    if (awardIndex(r.historical_award) > awardIndex(cur)) bestByProject.set(key, r.historical_award);
  }
  console.log(`[backtest] indexed best-of-project award for ${bestByProject.size} unique project_names`);

  const fullSample = flags.full ? pool : stratify(pool, perClass);
  const sample = fullSample.filter((r) => !alreadyDone.has(r.case_id));
  if (alreadyDone.size > 0) console.log(`[backtest] skipping ${alreadyDone.size} already-done; ${sample.length} remaining`);
  // Class breakdown (per-submission and per-project-best)
  const classCounts: Record<string, number> = {};
  const classCountsBest: Record<string, number> = {};
  for (const r of sample) {
    classCounts[r.historical_award] = (classCounts[r.historical_award] ?? 0) + 1;
    const best = bestByProject.get((r.project_name || "").trim()) ?? r.historical_award;
    classCountsBest[best] = (classCountsBest[best] ?? 0) + 1;
  }
  console.log("[backtest] sample (per-submission):", sample.length, classCounts);
  console.log("[backtest] sample (per-project-best):", sample.length, classCountsBest);

  const t0 = Date.now();
  let done = 0;
  // Stream records.jsonl as cases finish so a sandbox-killed run keeps partial data.
  const recordsPath = join(runDir, "records.jsonl");
  if (!flags.resume) writeFileSync(recordsPath, "");
  const records = await pmap(sample, flags.concurrency, async (row) => {
    const best = bestByProject.get((row.project_name || "").trim()) ?? row.historical_award;
    const rec = await runOne(row, best);
    appendFileSync(recordsPath, JSON.stringify(rec) + "\n");
    done++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[backtest] ${done}/${sample.length}  (${elapsed}s)  ${rec.actual}|${rec.best_project_award} → ${rec.predicted}  score=${rec.total_score ?? "?"}  caps=${rec.caps_applied}${rec.error ? "  ERR " + rec.error : ""}`);
    return rec;
  });

  // For summary, include any pre-existing records too (resume case).
  const allRecords: RunRecord[] = [...records];
  if (flags.resume && existsSync(recordsPath)) {
    const lines = readFileSync(recordsPath, "utf-8").split("\n").filter(Boolean);
    const seen = new Set(records.map((r) => r.case_id));
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as RunRecord;
        if (!seen.has(r.case_id)) allRecords.push(r);
      } catch { /* ignore */ }
    }
  }
  const errors = allRecords.filter((r) => r.error);
  const ok = allRecords.filter((r) => !r.error);
  const exact = ok.filter((r) => r.exact).length;
  const within1 = ok.filter((r) => r.within1).length;
  // Per-project-best metrics: backfill best_project_award for legacy records that lack it.
  for (const r of ok) {
    if (!r.best_project_award) {
      const best = bestByProject.get((r.project_name || "").trim()) ?? r.actual;
      (r as RunRecord).best_project_award = best;
      (r as RunRecord).exact_vs_best = r.predicted === best;
      (r as RunRecord).within1_vs_best = Math.abs(awardIndex(best) - awardIndex(r.predicted)) <= 1;
    }
  }
  const exactBest = ok.filter((r) => r.exact_vs_best).length;
  const within1Best = ok.filter((r) => r.within1_vs_best).length;
  const matrix = buildConfusion(allRecords);
  const blockStats = perBlockStats(allRecords);

  const summary = {
    sampled: sample.length,
    completed: ok.length,
    errors: errors.length,
    per_submission: {
      exact_match: exact,
      exact_match_pct: ok.length ? Math.round((exact / ok.length) * 1000) / 10 : 0,
      within1_band: within1,
      within1_band_pct: ok.length ? Math.round((within1 / ok.length) * 1000) / 10 : 0,
    },
    per_project_best: {
      exact_match: exactBest,
      exact_match_pct: ok.length ? Math.round((exactBest / ok.length) * 1000) / 10 : 0,
      within1_band: within1Best,
      within1_band_pct: ok.length ? Math.round((within1Best / ok.length) * 1000) / 10 : 0,
    },
    by_class_per_submission: classCounts,
    by_class_per_project_best: classCountsBest,
    per_block: blockStats,
  };

  console.log("\n[backtest] SUMMARY");
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nConfusion matrix (rows = actual, cols = predicted):");
  console.log(formatConfusion(matrix));

  // Persist artefacts (records.jsonl already streamed above).
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(runDir, "confusion.txt"), formatConfusion(matrix));
  // Mismatches sorted by distance for follow-up.
  const mismatches = ok
    .filter((r) => !r.exact)
    .map((r) => ({ ...r, distance: Math.abs(awardIndex(r.actual) - awardIndex(r.predicted)) }))
    .sort((a, b) => b.distance - a.distance);
  writeFileSync(
    join(runDir, "mismatches.jsonl"),
    mismatches.map((r) => JSON.stringify(r)).join("\n")
  );

  console.log(`\n[backtest] artefacts written to ${runDir}`);
}

main().catch((e) => {
  console.error("[backtest] FAILED:", e);
  process.exit(1);
});
