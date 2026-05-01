import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Runtime loader + retrieval over the empirical anchor pool.
 *
 * The pool is built by scripts/phase2_extract.mjs from SM_2025.json: every
 * L2 evaluation written by a high-correlation human juror (corr ≥ 0.80
 * between their score and the project's eventual award) becomes one anchor.
 *
 * At scoring time we want a small set of band-spanning anchors from the
 * SAME nomination (or, failing that, same block) so the model has concrete
 * "this is what 9 looks like in this nomination, this is what 3 looks like"
 * reference points instead of generic prose.
 */

export interface JudgeAnchor {
  judge_id: string;
  project_id: string;
  project_name: string;
  nomination_code: string;
  block_id: string;
  total: number;
  diplom: string;
  comment: string;
  per_criterion: Array<{ name: string; score: number }>;
  is_top5: boolean;
}

interface AnchorsFile {
  meta: {
    generated_at: string;
    source: string;
    retrieval_pool_judges: string[];
    top5_judges: string[];
    total_anchors: number;
  };
  anchors: JudgeAnchor[];
  by_nomination: Record<string, JudgeAnchor[]>;
  by_block: Record<string, JudgeAnchor[]>;
}

let cached: AnchorsFile | null = null;

function loadAnchors(): AnchorsFile {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "data/judgeAnchors.json"),
    join(here, "../data/judgeAnchors.json"),
    join(here, "../../src/data/judgeAnchors.json"),
  ];
  let path = "";
  for (const c of candidates) {
    if (existsSync(c)) {
      path = c;
      break;
    }
  }
  if (!path) {
    // Empty fallback — anchor retrieval becomes a no-op so L2 still runs.
    cached = {
      meta: { generated_at: "", source: "", retrieval_pool_judges: [], top5_judges: [], total_anchors: 0 },
      anchors: [],
      by_nomination: {},
      by_block: {},
    };
    return cached;
  }
  cached = JSON.parse(readFileSync(path, "utf8")) as AnchorsFile;
  return cached;
}

function bandOf(score: number): "GOLD" | "SILVER" | "BRONZE" | "SHORTLIST" | "LONGLIST" {
  if (score >= 9) return "GOLD";
  if (score >= 7) return "SILVER";
  if (score >= 5) return "BRONZE";
  if (score >= 3) return "SHORTLIST";
  return "LONGLIST";
}

/**
 * Pick a band-spanning set of anchors for the given nomination.
 *
 * Strategy:
 *  1. Try exact nomination match first — if we have ≥3 anchors covering ≥3
 *     bands, use those.
 *  2. Otherwise expand to same block_id and pick band-spanning examples.
 *  3. Otherwise (rare blocks) try sibling nominations sharing a code prefix
 *     (e.g. D01 → other "D*" nominations in the digital block).
 *  4. Otherwise (very rare) fall back to globally band-spanning examples.
 *
 * Within each band we prefer top-5 judges (higher fidelity voice) when
 * available, otherwise any pool judge.
 */
export function retrieveAnchors(
  nominationCode: string,
  blockId: string,
  perBand: number = 1
): JudgeAnchor[] {
  const file = loadAnchors();
  if (!file.anchors.length) return [];

  const wantBands: Array<ReturnType<typeof bandOf>> = ["GOLD", "SILVER", "BRONZE", "SHORTLIST", "LONGLIST"];

  function pickFromList(pool: JudgeAnchor[]): JudgeAnchor[] {
    const out: JudgeAnchor[] = [];
    for (const band of wantBands) {
      const inBand = pool.filter((a) => bandOf(a.total) === band);
      if (!inBand.length) continue;
      // Prefer top-5 voices, then closest-to-band-center
      const sorted = [...inBand].sort((a, b) => {
        if (a.is_top5 !== b.is_top5) return a.is_top5 ? -1 : 1;
        // Within priority, prefer comments around top-5 median (270 chars).
        const aLen = a.comment.length;
        const bLen = b.comment.length;
        const aDist = Math.abs(aLen - 270);
        const bDist = Math.abs(bLen - 270);
        return aDist - bDist;
      });
      out.push(...sorted.slice(0, perBand));
    }
    return out;
  }

  // Step 1 — exact nomination
  const sameNom = file.by_nomination[nominationCode] || [];
  const fromNom = pickFromList(sameNom);
  const distinctBands = new Set(fromNom.map((a) => bandOf(a.total)));
  if (distinctBands.size >= 3) return fromNom.slice(0, 5);

  // Step 2 — same block, supplementing what we got from same-nomination
  const sameBlock = file.by_block[blockId] || [];
  const fromBlock = pickFromList(sameBlock);
  const merged = new Map<string, JudgeAnchor>();
  for (const a of [...fromNom, ...fromBlock]) {
    const key = `${a.judge_id}|${a.project_id}`;
    if (!merged.has(key)) merged.set(key, a);
  }
  const mergedList = [...merged.values()].sort((a, b) => b.total - a.total);
  // Keep up to one per band
  const seenBands = new Set<string>();
  const dedup: JudgeAnchor[] = [];
  for (const a of mergedList) {
    const b = bandOf(a.total);
    if (seenBands.has(b)) continue;
    seenBands.add(b);
    dedup.push(a);
  }
  if (dedup.length >= 3) return dedup.slice(0, 5);

  // Step 3 — sibling-nomination fallback. Pull from any nomination whose
  // code shares the same letter prefix (e.g. "D01" → all D-nominations).
  // Useful for rarely-judged nominations like D01 (0 direct anchors) and
  // D15 (5 anchors) where same-block alone might still be thin.
  const prefix = nominationCode.replace(/\d+$/, "");
  const sibling: JudgeAnchor[] = [];
  for (const [code, list] of Object.entries(file.by_nomination)) {
    if (code.startsWith(prefix) && code !== nominationCode) sibling.push(...list);
  }
  if (sibling.length) {
    const fromSibling = pickFromList(sibling);
    for (const a of [...dedup, ...fromSibling]) {
      const k = `${a.judge_id}|${a.project_id}`;
      if (!merged.has(k)) merged.set(k, a);
    }
    const merged2 = [...merged.values()].sort((a, b) => b.total - a.total);
    const seen2 = new Set<string>();
    const dedup2: JudgeAnchor[] = [];
    for (const a of merged2) {
      const b = bandOf(a.total);
      if (seen2.has(b)) continue;
      seen2.add(b);
      dedup2.push(a);
    }
    if (dedup2.length >= 3) return dedup2.slice(0, 5);
  }

  // Step 4 — global fallback
  const fromGlobal = pickFromList(file.anchors);
  return fromGlobal.slice(0, 5);
}

/** Render anchors as a prompt section. */
export function renderAnchorBlock(anchors: JudgeAnchor[]): string {
  if (!anchors.length) return "";
  const blocks = anchors.map((a) => {
    return `Балл ${a.total} (${a.diplom}) — реальный кейс «${a.project_name.slice(0, 60)}» в номинации ${a.nomination_code}:
  «${a.comment.slice(0, 600)}»`;
  });
  return `Реальные обоснования топ-калиброванных членов жюри XXVI на похожих кейсах
(используй их СТРОГО как ориентир по тону, длине и структуре аргументации —
не цитируй, а пиши в той же манере):

${blocks.join("\n\n")}`;
}
