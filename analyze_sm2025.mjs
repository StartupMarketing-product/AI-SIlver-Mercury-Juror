import { readFileSync } from 'fs';

const data = readFileSync('SM_2025.json', 'utf8');
const raw = JSON.parse(data);
// Structure: [ section1, section2, ... ] where each section is [block, block, ...], each block has .projects
function* allProjects(data) {
  const sections = Array.isArray(data) ? data : [data];
  for (const section of sections) {
    if (!Array.isArray(section)) continue;
    for (const block of section) {
      if (typeof block !== 'object') continue;
      const projects = block.projects;
      if (Array.isArray(projects)) for (const p of projects) yield p;
      else if (block.project_id) yield block;
    }
  }
}

let totalCases = 0;
const scoreCounts = {};
let shortlistedCount = 0;
const shortlistByType = {};

for (const p of allProjects(raw)) {
  if (typeof p !== 'object') continue;
  totalCases++;

  const dt = p.diplom_text;
  if (dt) {
    shortlistedCount++;
    shortlistByType[dt] = (shortlistByType[dt] || 0) + 1;
  }

  const level2 = p.level2 || {};
  const marks = level2.marks_and_comments || level2.marks_comments || level2.marks_scores || {};
  const scores = [];
  for (const judgeId of Object.keys(marks)) {
    const j = marks[judgeId];
    if (typeof j !== 'object') continue;
    let t = j.total;
    if (t == null) continue;
    if (typeof t === 'string' && t.trim().toLowerCase() === 'is_my') continue;
    const v = parseFloat(t);
    if (!Number.isNaN(v)) scores.push(v);
  }
  if (scores.length > 0) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const rounded = Math.round(avg * 10) / 10;
    scoreCounts[rounded] = (scoreCounts[rounded] || 0) + 1;
  }
}

const totalWithScore = Object.values(scoreCounts).reduce((a, b) => a + b, 0);
console.log('='.repeat(60));
console.log('SILVER MERCURY 2025 — Competition results summary');
console.log('='.repeat(60));
console.log('');
console.log('Total cases considered:     ', totalCases);
console.log('Cases with score (level 2):', totalWithScore);
console.log('Shortlisted (any diploma): ', shortlistedCount);
console.log('');
console.log('Shortlist by diploma type:');
for (const k of ['SHORTLIST', 'SILVER', 'GOLD']) {
  if (shortlistByType[k]) console.log('  ', k + ':', shortlistByType[k]);
}
console.log('');
console.log('Score distribution (average score per case, 1 decimal):');
console.log('-'.repeat(40));
for (const score of Object.keys(scoreCounts).sort((a, b) => parseFloat(a) - parseFloat(b))) {
  console.log('  Score', String(parseFloat(score)).padStart(4) + ':', String(scoreCounts[score]).padStart(4), 'cases');
}
console.log('-'.repeat(40));
console.log('  Total with score:', totalWithScore);
