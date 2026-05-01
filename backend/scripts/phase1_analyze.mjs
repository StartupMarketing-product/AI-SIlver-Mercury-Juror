/**
 * Phase 1 — Empirical analysis of SM_2025 human-judge L2 scoring.
 *
 * No LLM calls. Pure analytics.
 *
 * Outputs:
 *   1. Per-criterion score distributions (overall + by final award)
 *   2. Score distribution shape (does the full 1–10 range get used?)
 *   3. Per-judge "calibration accuracy" — does the judge's median score
 *      predict the actual award? (A simple correlation.)
 *   4. Sample comments per (criterion × score-band) — the canonical
 *      language real judges use.
 *   5. Histogram of human total_score by final award (the core signal —
 *      what total_score did each band actually earn from real judges?).
 *
 * Writes a single markdown report to phase1_report.md so we can read the
 * data before designing the persona.
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SM_PATH = join(__dirname, "../../SM_2025.json");
const OUT_PATH = join(__dirname, "../../phase1_report.md");

const data = JSON.parse(readFileSync(SM_PATH, "utf8"));

/* ------------------------------------------------------------------ */
/* 1. Walk every project and pull L2 evaluations into a flat tuple list */
/* ------------------------------------------------------------------ */

/** @typedef {{
 *   project_id: string,
 *   judge_id: string,
 *   block_id: string,
 *   nomination_code: string,
 *   nomination_name: string,
 *   total: number,
 *   comment: string,
 *   diplom: string,
 *   per_criterion: Array<{cid: string, name: string, score: number}>
 * }} Eval */

/** @type {Eval[]} */
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
        if (typeof e.total === "string" && e.total.trim().toLowerCase() === "is_my") continue;
        const bc = e?.by_criteries || {};
        const per = [];
        for (const [cid, cd] of Object.entries(bc)) {
          const s = parseFloat(cd?.result);
          if (Number.isNaN(s)) continue;
          per.push({ cid, name: cd?.name || cid, score: s });
        }
        evals.push({
          project_id: p.project_id,
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

console.log(`extracted ${evals.length} L2 evaluations across ${new Set(evals.map(e=>e.project_id)).size} projects, ${new Set(evals.map(e=>e.judge_id)).size} judges`);

/* ------------------------------------------------------------------ */
/* 2. Score distribution of TOTAL scores by final award                */
/* ------------------------------------------------------------------ */

const AWARD_ORDER = ["GOLD", "SILVER", "BRONZE", "SHORTLIST", "LONGLIST", "NONE"];

function bucketBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function statsOfNums(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a,b)=>a-b);
  const mean = s.reduce((a,b)=>a+b,0) / s.length;
  const median = s[Math.floor(s.length/2)];
  return {
    n: s.length,
    min: s[0],
    max: s[s.length-1],
    mean: +mean.toFixed(2),
    median: +median.toFixed(2),
    p10: +s[Math.floor(s.length*0.1)].toFixed(1),
    p90: +s[Math.floor(s.length*0.9)].toFixed(1),
  };
}

function histogram(nums, binWidth = 1, min = 1, max = 10) {
  const bins = [];
  for (let b = min; b <= max; b += binWidth) bins.push({ lo: b, hi: b + binWidth, count: 0 });
  for (const n of nums) {
    if (n < min || n > max) continue;
    const idx = Math.min(bins.length - 1, Math.floor((n - min) / binWidth));
    bins[idx].count += 1;
  }
  return bins;
}

const totalsByAward = new Map();
for (const a of AWARD_ORDER) totalsByAward.set(a, []);
for (const e of evals) {
  if (totalsByAward.has(e.diplom)) totalsByAward.get(e.diplom).push(e.total);
}

/* ------------------------------------------------------------------ */
/* 3. Per-criterion distribution                                       */
/* ------------------------------------------------------------------ */

// Map crit name → flat list of all scores (across ALL evaluators, ALL projects)
const perCritScores = new Map();
const perCritByAward = new Map(); // crit -> award -> [scores]

for (const e of evals) {
  for (const c of e.per_criterion) {
    if (!perCritScores.has(c.name)) perCritScores.set(c.name, []);
    perCritScores.get(c.name).push(c.score);
    if (!perCritByAward.has(c.name)) perCritByAward.set(c.name, new Map());
    const m = perCritByAward.get(c.name);
    if (!m.has(e.diplom)) m.set(e.diplom, []);
    m.get(e.diplom).push(c.score);
  }
}

/* ------------------------------------------------------------------ */
/* 4. Per-judge calibration accuracy                                   */
/*    For each judge: given their evaluations, how well does score     */
/*    correlate with the final award? Use rank correlation as proxy.   */
/* ------------------------------------------------------------------ */

const AWARD_TO_RANK = { GOLD: 5, SILVER: 4, BRONZE: 3, SHORTLIST: 2, LONGLIST: 1, NONE: 0 };

function spearmanLite(pairs) {
  // Simple Pearson on ranks: just use Pearson on raw values for speed —
  // we have integer awards and continuous scores, that's fine.
  if (pairs.length < 5) return null;
  const xs = pairs.map(p=>p[0]);
  const ys = pairs.map(p=>p[1]);
  const mx = xs.reduce((a,b)=>a+b,0)/xs.length;
  const my = ys.reduce((a,b)=>a+b,0)/ys.length;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i=0; i<xs.length; i++) {
    const dx = xs[i]-mx, dy = ys[i]-my;
    num += dx*dy; dx2 += dx*dx; dy2 += dy*dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

const judgeBuckets = bucketBy(evals, e => e.judge_id);
const judgeCalibration = [];
for (const [jid, list] of judgeBuckets) {
  if (list.length < 10) continue;
  const pairs = list.map(e => [AWARD_TO_RANK[e.diplom] ?? 0, e.total]);
  const corr = spearmanLite(pairs);
  if (corr === null) continue;
  judgeCalibration.push({
    judge_id: jid,
    n: list.length,
    correlation: +corr.toFixed(3),
    score_range: [Math.min(...list.map(e=>e.total)), Math.max(...list.map(e=>e.total))],
    score_std: +Math.sqrt(
      list.reduce((s,e)=>{const d=e.total-list.reduce((a,b)=>a+b.total,0)/list.length; return s+d*d;},0)/list.length
    ).toFixed(2),
  });
}
judgeCalibration.sort((a,b)=>b.correlation-a.correlation);
const topJudges = judgeCalibration.slice(0, 25);
const topJudgeIds = new Set(topJudges.map(j=>j.judge_id));

/* ------------------------------------------------------------------ */
/* 5. Sample comments per (criterion × score band) FROM TOP JUDGES     */
/* ------------------------------------------------------------------ */

function bandOf(score) {
  if (score >= 9) return "9–10 GOLD";
  if (score >= 7) return "7–8 SILVER";
  if (score >= 5) return "5–6 BRONZE";
  if (score >= 3) return "3–4 SHORTLIST";
  return "1–2 LONGLIST";
}

// We use the OVERALL evaluation comment as the "scoring rationale" since
// per-criterion comments aren't separately stored — but we tag it with the
// total score band as the reference.
const commentsByBand = new Map();
for (const e of evals) {
  if (!topJudgeIds.has(e.judge_id)) continue;
  if (!e.comment || e.comment.length < 60) continue;
  const band = bandOf(e.total);
  if (!commentsByBand.has(band)) commentsByBand.set(band, []);
  commentsByBand.get(band).push({
    judge: e.judge_id,
    project_id: e.project_id,
    nomination: e.nomination_code,
    diplom: e.diplom,
    total: e.total,
    comment: e.comment.slice(0, 600),
  });
}
for (const [b, arr] of commentsByBand) {
  arr.sort((a,b)=>a.comment.length-b.comment.length);
}

/* ------------------------------------------------------------------ */
/* 6. Aggregate per-project total — using MEDIAN across judges, then   */
/*    see how the project median predicts the final award.             */
/* ------------------------------------------------------------------ */

const projectsBucket = bucketBy(evals, e => e.project_id);
const projectMedians = [];
for (const [pid, list] of projectsBucket) {
  const sorted = [...list].sort((a,b)=>a.total-b.total);
  const med = sorted[Math.floor(sorted.length/2)].total;
  const proj = list[0];
  projectMedians.push({
    project_id: pid,
    n_judges: list.length,
    median_total: +med.toFixed(2),
    diplom: proj.diplom,
    nomination: proj.nomination_code,
  });
}
const medianByAward = new Map();
for (const a of AWARD_ORDER) medianByAward.set(a, []);
for (const p of projectMedians) {
  if (medianByAward.has(p.diplom)) medianByAward.get(p.diplom).push(p.median_total);
}

/* ------------------------------------------------------------------ */
/* 7. Build the report                                                 */
/* ------------------------------------------------------------------ */

const lines = [];
lines.push("# Phase 1 — Empirical analysis of SM_2025 human L2 scoring");
lines.push("");
lines.push(`Source: SM_2025.json — ${evals.length} L2 evaluations across ${new Set(evals.map(e=>e.project_id)).size} projects from ${new Set(evals.map(e=>e.judge_id)).size} judges.`);
lines.push("");
lines.push("**Purpose:** before redesigning the AI persona, look at what real human judges actually did. Three things matter: do humans use the full 1–10 scale (yes/no), how does score-by-criterion vary by final award, and what do top-calibrated judges actually write at each score band.");
lines.push("");

// Section A — Distribution of total scores
lines.push("## A. Distribution of human total_score by final award");
lines.push("");
lines.push("How wide is the human range per award class? If real judges stick to 4–6 across all awards, the AI clustering is matching reality. If real judges spread their scores, the clustering is an LLM-only artifact.");
lines.push("");
lines.push("| award | n | mean | median | p10 | p90 | min | max |");
lines.push("|-------|---|------|--------|-----|-----|-----|-----|");
for (const a of AWARD_ORDER) {
  const s = statsOfNums(totalsByAward.get(a) || []);
  if (!s) continue;
  lines.push(`| ${a} | ${s.n} | ${s.mean} | ${s.median} | ${s.p10} | ${s.p90} | ${s.min} | ${s.max} |`);
}
lines.push("");

// Histogram
lines.push("### Total-score histogram (all evaluations, all awards)");
lines.push("");
const allTotals = evals.map(e=>e.total);
const hist = histogram(allTotals, 1, 1, 10);
const maxBin = Math.max(...hist.map(h=>h.count));
for (const h of hist) {
  const bar = "█".repeat(Math.round(40*h.count/maxBin));
  lines.push(`\`${h.lo.toFixed(0)}–${h.hi.toFixed(0)}\` ${String(h.count).padStart(5)} ${bar}`);
}
lines.push("");

// Section B — Per-criterion stats
lines.push("## B. Per-criterion score distributions");
lines.push("");
lines.push("Same view, but per criterion. Tells us if any criterion is intrinsically narrower than others (e.g. 'Strategy' might cluster while 'Idea' uses the full range).");
lines.push("");
lines.push("| criterion | n | mean | median | p10 | p90 | min | max |");
lines.push("|-----------|---|------|--------|-----|-----|-----|-----|");
const sortedCrits = [...perCritScores.entries()].sort((a,b)=>b[1].length-a[1].length);
for (const [cname, scores] of sortedCrits) {
  const s = statsOfNums(scores);
  if (!s) continue;
  lines.push(`| ${cname} | ${s.n} | ${s.mean} | ${s.median} | ${s.p10} | ${s.p90} | ${s.min} | ${s.max} |`);
}
lines.push("");

// Per-criterion × award means
lines.push("### Per-criterion mean score by final award");
lines.push("");
const allCrits = [...perCritByAward.keys()];
const headerCrits = allCrits.slice(0, 8);
lines.push("| award | " + headerCrits.join(" | ") + " |");
lines.push("|-------|" + headerCrits.map(()=>"---").join("|") + "|");
for (const a of AWARD_ORDER) {
  const row = [a];
  for (const cn of headerCrits) {
    const arr = (perCritByAward.get(cn) || new Map()).get(a) || [];
    const s = statsOfNums(arr);
    row.push(s ? s.mean.toFixed(2) : "—");
  }
  lines.push("| " + row.join(" | ") + " |");
}
lines.push("");

// Section C — Top judges
lines.push("## C. Top calibrated judges (correlation of their L2 score → final award)");
lines.push("");
lines.push("This is empirical — judges whose individual scores best predict the eventual award are the closest thing we have to a 'good juror' to imitate.");
lines.push("");
lines.push("| judge_id | n_evals | corr(score, award) | score_std | score_range |");
lines.push("|----------|---------|--------------------|-----------|-------------|");
for (const j of topJudges) {
  lines.push(`| ${j.judge_id} | ${j.n} | ${j.correlation} | ${j.score_std} | ${j.score_range[0]}–${j.score_range[1]} |`);
}
lines.push("");

// Section D — Sample comments per band
lines.push("## D. Sample comments from top-25 judges, by score band");
lines.push("");
lines.push("These are the canonical human voices at each score band. The AI persona should sound like THIS, not like generic LLM rationale.");
lines.push("");
const bandOrder = ["9–10 GOLD","7–8 SILVER","5–6 BRONZE","3–4 SHORTLIST","1–2 LONGLIST"];
for (const band of bandOrder) {
  const arr = commentsByBand.get(band) || [];
  if (!arr.length) continue;
  // Pick 3 around the median length
  arr.sort((a,b)=>a.comment.length-b.comment.length);
  const mid = Math.floor(arr.length/2);
  const samples = arr.slice(Math.max(0, mid-1), mid+2);
  lines.push(`### ${band}  (n=${arr.length})`);
  lines.push("");
  for (const s of samples) {
    lines.push(`- **judge ${s.judge}, ${s.nomination}, total=${s.total}, award=${s.diplom}:**`);
    lines.push(`  > ${s.comment.replace(/\n/g," ").slice(0,500)}`);
  }
  lines.push("");
}

// Section E — Project medians vs award (the regulation's actual mechanism)
lines.push("## E. Project median across judges — vs final award");
lines.push("");
lines.push("This is what the regulation actually computes (median across ≥7 judges per project). Tells us what the **emergent jury verdict** distribution looks like for each award class.");
lines.push("");
lines.push("| award | n | mean of medians | median of medians | p10 | p90 |");
lines.push("|-------|---|-----------------|-------------------|-----|-----|");
for (const a of AWARD_ORDER) {
  const s = statsOfNums(medianByAward.get(a) || []);
  if (!s) continue;
  lines.push(`| ${a} | ${s.n} | ${s.mean} | ${s.median} | ${s.p10} | ${s.p90} |`);
}
lines.push("");

// Section F — Key takeaways
lines.push("## F. Key takeaways for persona design");
lines.push("");
lines.push("(Auto-derived; verify against the tables above.)");
lines.push("");
const goldStats = statsOfNums(medianByAward.get("GOLD") || []);
const noneStats = statsOfNums(medianByAward.get("NONE") || []);
const noneTotalStats = statsOfNums(totalsByAward.get("NONE") || []);
const goldTotalStats = statsOfNums(totalsByAward.get("GOLD") || []);
if (goldStats && noneStats) {
  lines.push(`- Real-jury **median total_score**: gold = ${goldStats.median}, none = ${noneStats.median}. Spread is ${(goldStats.median - noneStats.median).toFixed(2)} points across the worst→best classes (project-level medians).`);
}
if (goldTotalStats && noneTotalStats) {
  lines.push(`- Individual **judge** scores: gold-projects mean ${goldTotalStats.mean} (range ${goldTotalStats.min}–${goldTotalStats.max}), none-projects mean ${noneTotalStats.mean} (range ${noneTotalStats.min}–${noneTotalStats.max}). Compare this to the AI's collapsed 4.7–6.4 range — humans use a much wider scale.`);
}
const top = topJudges[0];
if (top) lines.push(`- Best-calibrated judge: ${top.judge_id} (corr=${top.correlation} across ${top.n} evals). Use this judge as the anchor voice for the persona.`);
const overallSpread = statsOfNums(allTotals);
if (overallSpread) lines.push(`- Overall human total score range: ${overallSpread.min}–${overallSpread.max}, p10–p90 = ${overallSpread.p10}–${overallSpread.p90}. This is the empirical distribution the AI should match.`);
lines.push("");
lines.push("**Implication for v6 persona design:**");
lines.push("- Do not invent rules. Encode the empirical per-band trigger language from Section D verbatim.");
lines.push("- Match the empirical distribution shape from Section A, not a uniform expectation.");
lines.push("- Use the top-judge IDs as the persona's voice anchors (their comments become the few-shot retrieval pool).");
lines.push("");

writeFileSync(OUT_PATH, lines.join("\n"));
console.log(`wrote report → ${OUT_PATH}`);
