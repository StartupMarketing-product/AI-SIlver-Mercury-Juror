/**
 * Phase 2 — Build the anchor pool + voice analysis.
 *
 * Outputs:
 *   1. backend/src/data/judgeAnchors.json — runtime retrieval pool of all
 *      top-25-judge evaluations, indexed by nomination_code and block_id.
 *      Each entry: {judge_id, project_id, project_name, nomination_code,
 *      block_id, total, comment, diplom, per_criterion}.
 *   2. phase2_voice_analysis.md — close study of top-5 judges' writing
 *      style: opening phrases, sentence structure, weakness/strength
 *      signals, length stats. The persona description in the system prompt
 *      will be grounded in these patterns.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM_PATH = join(__dirname, "../../SM_2025.json");
const ANCHORS_OUT = join(__dirname, "../src/data/judgeAnchors.json");
const VOICE_OUT = join(__dirname, "../../phase2_voice_analysis.md");

if (!existsSync(dirname(ANCHORS_OUT))) mkdirSync(dirname(ANCHORS_OUT), { recursive: true });

/* ------------------------------------------------------------------ */
/* 1. Find top-25 judges by score↔award correlation (replicates Phase1) */
/* ------------------------------------------------------------------ */

const data = JSON.parse(readFileSync(SM_PATH, "utf8"));

const evals = [];
for (const block of data) {
  for (const nom of block) {
    if (!nom || !Array.isArray(nom.projects)) continue;
    for (const p of nom.projects) {
      const dipl = (p.diplom_text || "NONE").toUpperCase();
      const l2 = p?.level2?.marks_and_comments;
      if (!l2) continue;
      for (const [jid, e] of Object.entries(l2)) {
        const total = parseFloat(e?.total);
        if (Number.isNaN(total)) continue;
        const bc = e?.by_criteries || {};
        const per = [];
        for (const [cid, cd] of Object.entries(bc)) {
          const s = parseFloat(cd?.result);
          if (Number.isNaN(s)) continue;
          per.push({ name: cd?.name || cid, score: s });
        }
        evals.push({
          project_id: p.project_id,
          project_name: (p.project_name || "").trim(),
          judge_id: jid,
          block_id: nom.block_id,
          nomination_code: nom.code,
          nomination_name: nom.name,
          total,
          comment: (e.comment || "").trim(),
          diplom: dipl,
          per_criterion: per,
        });
      }
    }
  }
}

const AWARD_RANK = { GOLD: 5, SILVER: 4, BRONZE: 3, SHORTLIST: 2, LONGLIST: 1, NONE: 0 };

function pearson(pairs) {
  if (pairs.length < 5) return null;
  const xs = pairs.map(p=>p[0]);
  const ys = pairs.map(p=>p[1]);
  const mx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const my = ys.reduce((a,b)=>a+b,0)/ys.length;
  let n=0, dx=0, dy=0;
  for (let i=0; i<xs.length; i++) {
    const a = xs[i]-mx, b = ys[i]-my;
    n += a*b; dx += a*a; dy += b*b;
  }
  if (dx === 0 || dy === 0) return null;
  return n / Math.sqrt(dx*dy);
}

const byJudge = new Map();
for (const e of evals) {
  if (!byJudge.has(e.judge_id)) byJudge.set(e.judge_id, []);
  byJudge.get(e.judge_id).push(e);
}

const judgeQuality = [];
for (const [jid, list] of byJudge) {
  if (list.length < 10) continue;
  const corr = pearson(list.map(e => [AWARD_RANK[e.diplom] ?? 0, e.total]));
  if (corr === null) continue;
  judgeQuality.push({ judge_id: jid, n: list.length, correlation: +corr.toFixed(4) });
}
judgeQuality.sort((a,b)=>b.correlation-a.correlation);

// Voice template: top 5. Retrieval pool: everyone with corr ≥ 0.80
// (broader pool gives coverage across all 12 blocks).
const TOP5 = judgeQuality.slice(0, 5).map(j => j.judge_id);
const RETRIEVAL_POOL = judgeQuality.filter(j => j.correlation >= 0.80).map(j => j.judge_id);
const poolSet = new Set(RETRIEVAL_POOL);

console.log(`retrieval pool: ${RETRIEVAL_POOL.length} judges (correlation ≥ 0.80)`);
console.log(`top 5 voice judges:`, TOP5.join(", "));

/* ------------------------------------------------------------------ */
/* 2. Build anchor pool — all top-25 evaluations indexed for retrieval  */
/* ------------------------------------------------------------------ */

const anchorPool = [];
for (const e of evals) {
  if (!poolSet.has(e.judge_id)) continue;
  if (!e.comment || e.comment.length < 60) continue; // skip stub comments
  anchorPool.push({
    judge_id: e.judge_id,
    project_id: e.project_id,
    project_name: e.project_name,
    nomination_code: e.nomination_code,
    block_id: e.block_id,
    total: +e.total.toFixed(2),
    diplom: e.diplom,
    comment: e.comment.replace(/\s+/g, " ").slice(0, 700),
    per_criterion: e.per_criterion.map(c => ({ name: c.name, score: c.score })),
    is_top5: TOP5.includes(e.judge_id),
  });
}

// Index by nomination and by block for fast retrieval
const byNomination = {};
const byBlock = {};
for (const a of anchorPool) {
  if (!byNomination[a.nomination_code]) byNomination[a.nomination_code] = [];
  byNomination[a.nomination_code].push(a);
  if (!byBlock[a.block_id]) byBlock[a.block_id] = [];
  byBlock[a.block_id].push(a);
}

const anchorsFile = {
  meta: {
    generated_at: new Date().toISOString(),
    source: "SM_2025.json",
    retrieval_pool_judges: RETRIEVAL_POOL,
    top5_judges: TOP5,
    total_anchors: anchorPool.length,
  },
  anchors: anchorPool,
  by_nomination: byNomination,
  by_block: byBlock,
};

writeFileSync(ANCHORS_OUT, JSON.stringify(anchorsFile, null, 2));
console.log(`wrote ${anchorPool.length} anchors → ${ANCHORS_OUT}`);

/* ------------------------------------------------------------------ */
/* 3. Voice analysis on top-5 judges                                    */
/* ------------------------------------------------------------------ */

const top5Comments = anchorPool.filter(a => a.is_top5);

function bandOf(score) {
  if (score >= 9) return "9–10 GOLD";
  if (score >= 7) return "7–8 SILVER";
  if (score >= 5) return "5–6 BRONZE";
  if (score >= 3) return "3–4 SHORTLIST";
  return "1–2 LONGLIST";
}

const lines = [];
lines.push("# Phase 2 — Voice analysis: top 5 calibrated jurors");
lines.push("");
lines.push(`Top 5 by score↔award correlation: ${TOP5.join(", ")}.  These are the voices the AI persona should imitate.`);
lines.push("");

// Per-judge stats
lines.push("## Per-judge statistics");
lines.push("");
lines.push("| judge | n_evals | corr | range | mean_total | mean_comment_len |");
lines.push("|-------|---------|------|-------|------------|------------------|");
for (const jid of TOP5) {
  const list = anchorPool.filter(a => a.judge_id === jid);
  const totals = list.map(a => a.total);
  const lens = list.map(a => a.comment.length);
  const corr = judgeQuality.find(j => j.judge_id === jid).correlation;
  lines.push(`| ${jid} | ${list.length} | ${corr} | ${Math.min(...totals)}–${Math.max(...totals)} | ${(totals.reduce((a,b)=>a+b,0)/totals.length).toFixed(2)} | ${Math.round(lens.reduce((a,b)=>a+b,0)/lens.length)} chars |`);
}
lines.push("");

// All comments by band, judge 8837 first
lines.push("## All comments from top 5, organised by score band");
lines.push("");
lines.push("Use these as the literal style template for the persona. Note the patterns: short opening verdict, named KPI weaknesses, no hedge filler, often ends with what's missing for the next band up.");
lines.push("");

for (const band of ["9–10 GOLD","7–8 SILVER","5–6 BRONZE","3–4 SHORTLIST","1–2 LONGLIST"]) {
  const inBand = top5Comments.filter(a => bandOf(a.total) === band);
  if (!inBand.length) continue;
  lines.push(`### ${band}  (n=${inBand.length})`);
  lines.push("");
  for (const a of inBand.slice(0, 10)) {
    lines.push(`- **judge ${a.judge_id} | ${a.nomination_code} | total=${a.total} | award=${a.diplom}** — *${a.project_name.slice(0, 50)}*`);
    lines.push(`  > ${a.comment}`);
  }
  lines.push("");
}

// Style pattern extraction
lines.push("## Style pattern extraction");
lines.push("");

// Common opening words
const openings = top5Comments.map(a => a.comment.split(/[.,;]/)[0].slice(0, 60).trim());
const freqMap = new Map();
for (const o of openings) {
  const word = o.split(" ").slice(0, 2).join(" ").toLowerCase();
  freqMap.set(word, (freqMap.get(word) || 0) + 1);
}
const topOpenings = [...freqMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 15);
lines.push("**Most common opening 2-word phrases:**");
lines.push("");
for (const [w, c] of topOpenings) lines.push(`- "${w}" (${c}×)`);
lines.push("");

// Length distribution
const lens = top5Comments.map(a => a.comment.length);
lens.sort((a,b)=>a-b);
lines.push(`**Comment length:** min ${lens[0]}, p10 ${lens[Math.floor(lens.length*0.1)]}, median ${lens[Math.floor(lens.length/2)]}, p90 ${lens[Math.floor(lens.length*0.9)]}, max ${lens[lens.length-1]} characters.`);
lines.push("");

// Markers of weakness
const weaknessMarkers = ["не хватило", "не дотягивает", "слабая", "слабый", "не хватает", "размыто", "не убедил", "не отвечает", "сомнения", "вопросы к", "минус"];
const strengthMarkers = ["шикарный", "отличный", "крепкий", "сильная", "интересный", "удачный", "качественн", "достоин", "понравил"];
lines.push("**Weakness signal phrases observed (×N occurrences):**");
lines.push("");
for (const m of weaknessMarkers) {
  const c = top5Comments.filter(a => a.comment.toLowerCase().includes(m)).length;
  if (c > 0) lines.push(`- "${m}" — ${c}×`);
}
lines.push("");
lines.push("**Strength signal phrases observed:**");
lines.push("");
for (const m of strengthMarkers) {
  const c = top5Comments.filter(a => a.comment.toLowerCase().includes(m)).length;
  if (c > 0) lines.push(`- "${m}" — ${c}×`);
}
lines.push("");

writeFileSync(VOICE_OUT, lines.join("\n"));
console.log(`wrote voice analysis → ${VOICE_OUT}`);

/* Summary stats */
console.log("\n=== summary ===");
console.log(`anchor pool size: ${anchorPool.length}`);
console.log(`nominations covered: ${Object.keys(byNomination).length} / ${(() => {
  const all = new Set();
  for (const e of evals) all.add(e.nomination_code);
  return all.size;
})()}`);
console.log(`blocks covered: ${Object.keys(byBlock).length} / 12`);

const bandCount = { "9–10 GOLD":0, "7–8 SILVER":0, "5–6 BRONZE":0, "3–4 SHORTLIST":0, "1–2 LONGLIST":0 };
for (const a of anchorPool) bandCount[bandOf(a.total)]++;
console.log(`bands:`, bandCount);
