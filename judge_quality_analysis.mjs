/**
 * Judge quality analysis for Silver Mercury 2025.
 * Criteria: (1) well-written arguments for 95%+ of evaluations, (2) argument-score connection for 90%+.
 * Scope: judges with ≥10 evaluations and at least one L1 and one L2 evaluation. Rule-based.
 */

import { readFileSync, writeFileSync } from 'fs';

const MIN_EVALUATIONS = 10;
const MIN_COMMENT_LENGTH = 50;
const C1_THRESHOLD = 0.95;  // 95% of evals must have well-written comment
const C2_THRESHOLD = 0.90;  // 90% of evals must have comment consistent with score

// Russian keywords for rule-based argument–score consistency
const NEGATIVE_KEYWORDS = [
  'слабый', 'слабая', 'слабо', 'слабые', 'не хватает', 'не хватило', 'недостаточно', 'недостаточен',
  'не для категории', 'не для этой', 'не лонг', 'нелонг', 'отсутств', 'не увидел', 'не вижу', 'не видела',
  'нет стратегии', 'не подтверждает', 'мало', 'не дотягивает', 'размыто', 'странно', 'смущают',
  'вопросы', 'проблема', 'минус', 'слабые стороны', 'не хватило', 'недостаточн', 'нет результатов',
  'нет данных', 'не выстроена', 'не расписан', 'не соответствует', 'не показан', 'не отражает',
  'бессмысленно', 'стандартн', 'обычн', 'типов', 'неинформативн', 'не убедил', 'не убедили'
];
const POSITIVE_KEYWORDS = [
  'классный', 'достоин', 'сильная', 'сильные', 'хорошо', 'отличн', 'рекомендую', 'лонг', 'long',
  'интересн', 'понравил', 'удачн', 'качественн', 'продуманн', 'сильная сторона', 'плюс',
  'соответствует', 'четк', 'проработан', 'успешн', 'достаточн', 'хорошая', 'хороший',
  'может позволить', 'достоин дальнейшего', 'рекомендую', 'продолжить', 'соответствует конкурсному'
];

function normalize(t) {
  if (t == null || typeof t !== 'string') return '';
  return t.toLowerCase().replace(/\s+/g, ' ').trim();
}

function commentIsNegative(comment) {
  const c = normalize(comment);
  if (c.length < 10) return false;
  const hasNeg = NEGATIVE_KEYWORDS.some(k => c.includes(k));
  const hasPos = POSITIVE_KEYWORDS.some(k => c.includes(k));
  if (hasNeg && !hasPos) return true;
  if (hasPos && !hasNeg) return false;
  if (hasNeg && hasPos) return c.length < 150 || hasNeg; // tie-break: prefer negative if short or has neg
  return false; // neutral
}

function commentIsPositive(comment) {
  const c = normalize(comment);
  if (c.length < 10) return false;
  const hasPos = POSITIVE_KEYWORDS.some(k => c.includes(k));
  const hasNeg = NEGATIVE_KEYWORDS.some(k => c.includes(k));
  if (hasPos && !hasNeg) return true;
  if (hasNeg && !hasPos) return false;
  if (hasPos && hasNeg) return c.length >= 150; // long mixed = treat as positive
  return false;
}

function consistentL1(mark, comment) {
  const m = (mark || '').toLowerCase();
  if (m === 'not_long' || m === 'не лонг') return commentIsNegative(comment);
  if (m === 'long') return commentIsPositive(comment);
  return false;
}

function consistentL2(totalStr, comment) {
  const t = parseFloat(totalStr);
  if (Number.isNaN(t)) return false;
  const low = t < 5;
  const high = t >= 7;
  if (low) return commentIsNegative(comment);
  if (high) return commentIsPositive(comment);
  return true; // mid band 5–7: accept any substantive comment
}

// --- Load data and build judge evals
const data = readFileSync('SM_2025.json', 'utf8');
const raw = JSON.parse(data);

function* allProjects(data) {
  const sections = Array.isArray(data) ? data : [data];
  for (const section of sections) {
    if (!Array.isArray(section)) continue;
    for (const block of section) {
      if (typeof block !== 'object') continue;
      const projects = block.projects;
      if (Array.isArray(projects)) for (const p of projects) yield p;
    }
  }
}

const judgeEvals = {}; // judgeId -> { L1: [...], L2: [...] }

for (const p of allProjects(raw)) {
  if (typeof p !== 'object') continue;

  const l1 = p.level1 && p.level1.marks_comments;
  if (l1) {
    for (const [jid, o] of Object.entries(l1)) {
      if (!o || typeof o !== 'object') continue;
      if (!judgeEvals[jid]) judgeEvals[jid] = { L1: [], L2: [] };
      judgeEvals[jid].L1.push({
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
        total: total,
        comment: (o.comment != null ? String(o.comment) : '').trim()
      });
    }
  }
}

// Filter: ≥10 total, at least one L1 and one L2
const judgeIds = Object.keys(judgeEvals).filter(jid => {
  const ev = judgeEvals[jid];
  const nL1 = (ev.L1 || []).length;
  const nL2 = (ev.L2 || []).length;
  return (nL1 + nL2) >= MIN_EVALUATIONS && nL1 >= 1 && nL2 >= 1;
});

// C1: well-written (comment present, length >= MIN_COMMENT_LENGTH)
function passesC1(evals) {
  const total = evals.length;
  if (total === 0) return false;
  const ok = evals.filter(e => {
    const c = (e.comment != null ? String(e.comment) : '').trim();
    return c.length >= MIN_COMMENT_LENGTH;
  }).length;
  return ok / total >= C1_THRESHOLD;
}

// C2: argument–score consistent
function passesC2(evals, stage) {
  const total = evals.length;
  if (total === 0) return false;
  let ok = 0;
  for (const e of evals) {
    if (stage === 'L1') ok += consistentL1(e.mark, e.comment) ? 1 : 0;
    else ok += consistentL2(e.total, e.comment) ? 1 : 0;
  }
  return ok / total >= C2_THRESHOLD;
}

const results = [];
for (const jid of judgeIds) {
  const ev = judgeEvals[jid];
  const allEvals = [...(ev.L1 || []), ...(ev.L2 || [])];
  const c1 = passesC1(allEvals);
  const c2L1 = passesC2(ev.L1 || [], 'L1');
  const c2L2 = passesC2(ev.L2 || [], 'L2');
  const c2 = c2L1 && c2L2; // both required
  const best = c1 && c2;
  results.push({
    judgeId: jid,
    nL1: (ev.L1 || []).length,
    nL2: (ev.L2 || []).length,
    total: allEvals.length,
    c1,
    c2L1,
    c2L2,
    c2,
    best
  });
}

const bestQualityJudges = results.filter(r => r.best);
const bestCount = bestQualityJudges.length;
const totalConsidered = results.length;

// Output
const lines = [
  '============================================================',
  'Judge input quality analysis (Silver Mercury 2025)',
  '============================================================',
  '',
  'Parameters:',
  `  Min evaluations per judge: ${MIN_EVALUATIONS} (and at least one L1 and one L2)`,
  `  C1 well-written: ≥${C1_THRESHOLD * 100}% of evals with comment length ≥ ${MIN_COMMENT_LENGTH} chars`,
  `  C2 argument–score: ≥${C2_THRESHOLD * 100}% consistent (rule-based); both L1 and L2 must pass`,
  '',
  'Results:',
  `  Judges considered (with ≥10 evals, both L1 and L2): ${totalConsidered}`,
  `  Judges qualifying as BEST QUALITY (pass both C1 and C2): ${bestCount}`,
  ''
];

const passC1Only = results.filter(r => r.c1 && !r.best).length;
const passC2Only = results.filter(r => r.c2 && !r.c1).length;
lines.push(`  Pass C1 only: ${results.filter(r => r.c1).length}`);
lines.push(`  Pass C2 only: ${results.filter(r => r.c2).length}`);
lines.push(`  Pass both (best quality): ${bestCount}`);
lines.push('');
lines.push('Best-quality judge IDs (first 50):');
bestQualityJudges.slice(0, 50).forEach(r => {
  lines.push(`  ${r.judgeId} (L1: ${r.nL1}, L2: ${r.nL2}, total: ${r.total})`);
});
if (bestQualityJudges.length > 50) {
  lines.push(`  ... and ${bestQualityJudges.length - 50} more`);
}

const out = lines.join('\n');
console.log(out);
writeFileSync('judge_quality_report.txt', out, 'utf8');

// Also write short summary for markdown
const summary = [
  '# Judge quality analysis — summary',
  '',
  `**Judges considered:** ${totalConsidered} (min 10 evaluations, both L1 and L2 required).`,
  '',
  `**Judges qualifying as best quality:** **${bestCount}**`,
  '',
  'Criteria: (1) well-written arguments for ≥95% of evaluations; (2) clear argument–score connection for ≥90% in both L1 and L2 (rule-based).'
].join('\n');
writeFileSync('Judge_Quality_Summary.md', summary, 'utf8');
