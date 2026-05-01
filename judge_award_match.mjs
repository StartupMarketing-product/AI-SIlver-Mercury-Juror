import { readFileSync } from 'fs';

// Thresholds for mapping score -> award band
function bandFromScore(t) {
  const v = parseFloat(t);
  if (Number.isNaN(v)) return null;
  if (v >= 9.0) return 'GOLD';
  if (v >= 8.0) return 'SILVER';
  if (v >= 7.0) return 'BRONZE';
  if (v >= 6.0) return 'SHORTLIST';
  return 'LONG';
}

const MIN_EVALUATIONS = 10;
const MIN_COMMENT_LENGTH = 50;
const C1_THRESHOLD = 0.95;

function normalize(t) {
  if (t == null || typeof t !== 'string') return '';
  return t.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Load JSON
const data = readFileSync('SM_2025.json', 'utf8');
const raw = JSON.parse(data);

function* allProjects(data) {
  const sections = Array.isArray(data) ? data : [data];
  for (const section of sections) {
    if (!Array.isArray(section)) continue;
    for (const block of section) {
      if (typeof block !== 'object') continue;
      const projects = block.projects;
      if (Array.isArray(projects)) {
        for (const p of projects) yield p;
      }
    }
  }
}

// Build per-judge evaluations and per-project awards
const judgeEvals = {}; // judgeId -> { L1: [...], L2: [...] }
const projectAwards = {}; // project_id -> diplom_text

for (const p of allProjects(raw)) {
  if (!p || typeof p !== 'object') continue;

  if (p.diplom_text) {
    const d = String(p.diplom_text).toUpperCase();
    if (['GOLD', 'SILVER', 'BRONZE', 'SHORTLIST'].includes(d)) {
      projectAwards[p.project_id] = d;
    }
  }

  const l1 = p.level1 && p.level1.marks_comments;
  if (l1) {
    for (const [jid, o] of Object.entries(l1)) {
      if (!o || typeof o !== 'object') continue;
      if (!judgeEvals[jid]) judgeEvals[jid] = { L1: [], L2: [] };
      judgeEvals[jid].L1.push({
        project_id: p.project_id,
        mark: o.mark,
        comment: (o.comment != null ? String(o.comment) : '').trim()
      });
    }
  }

  const l2 = p.level2 && p.level2.marks_and_comments;
  if (l2) {
    for (const [jid, o] of Object.entries(l2)) {
      if (!o || typeof o !== 'object') continue;
      const total = o.total;
      if (total == null || (typeof total === 'string' && total.trim().toLowerCase() === 'is_my')) continue;
      if (!judgeEvals[jid]) judgeEvals[jid] = { L1: [], L2: [] };
      judgeEvals[jid].L2.push({
        project_id: p.project_id,
        total: total,
        comment: (o.comment != null ? String(o.comment) : '').trim()
      });
    }
  }
}

// C1 well-written (same as in judge_quality_analysis.mjs, but only length-based)
function passesC1(evals) {
  const total = evals.length;
  if (total === 0) return false;
  const ok = evals.filter(e => normalize(e.comment).length >= MIN_COMMENT_LENGTH).length;
  return ok / total >= C1_THRESHOLD;
}

// Determine which judges pass C1 with ≥10 evals and both L1 & L2
const c1Judges = new Set();
for (const [jid, ev] of Object.entries(judgeEvals)) {
  const nL1 = (ev.L1 || []).length;
  const nL2 = (ev.L2 || []).length;
  const total = nL1 + nL2;
  if (total < MIN_EVALUATIONS || nL1 < 1 || nL2 < 1) continue;
  const all = [...(ev.L1 || []), ...(ev.L2 || [])];
  if (passesC1(all)) c1Judges.add(jid);
}

// Count matches per final level for C1 judges, using only L2 scores
const levels = ['GOLD', 'SILVER', 'BRONZE', 'SHORTLIST'];
const matrix = {};
for (const L of levels) {
  matrix[L] = { GOLD: 0, SILVER: 0, BRONZE: 0, SHORTLIST: 0 };
}

for (const [jid, ev] of Object.entries(judgeEvals)) {
  if (!c1Judges.has(jid)) continue;
  for (const e of ev.L2 || []) {
    const finalLevel = projectAwards[e.project_id];
    if (!finalLevel) continue; // only awarded projects
    const band = bandFromScore(e.total);
    if (!band || band === 'LONG') continue; // ignore below-shortlist bands in the breakdown
    if (!matrix[finalLevel]) continue;
    if (matrix[finalLevel][band] === undefined) matrix[finalLevel][band] = 0;
    matrix[finalLevel][band] += 1;
  }
}

console.log('Matches per final award level (C1 judges only):');
for (const L of levels) {
  const row = matrix[L];
  console.log(
    `${L} projects: ` +
      `Gold scores = ${row.GOLD}, ` +
      `Silver = ${row.SILVER}, ` +
      `Bronze = ${row.BRONZE}, ` +
      `Shortlist = ${row.SHORTLIST}`
  );
}

