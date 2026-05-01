import { readFileSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  MethodologyConfig,
  MethodologyBlock,
  NominationDef,
} from "./types/methodology.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LoadedMethodology {
  config: MethodologyConfig;
  /** Stable hash of the on-disk file contents — stamped onto every verdict for reproducibility. */
  methodology_hash: string;
}

let cached: LoadedMethodology | null = null;

/** Load + validate the methodology config. Caches in-process. */
export function loadMethodology(): LoadedMethodology {
  if (cached) return cached;
  const path = join(__dirname, "config", "methodology.json");
  const raw = readFileSync(path, "utf-8");
  const config = JSON.parse(raw) as MethodologyConfig;
  validate(config);
  const methodology_hash = "sha256-" + createHash("sha256").update(raw).digest("hex").slice(0, 16);
  cached = { config, methodology_hash };
  return cached;
}

export function getMethodology(): MethodologyConfig {
  return loadMethodology().config;
}

export function getMethodologyHash(): string {
  return loadMethodology().methodology_hash;
}

/** Lookup a block by its numeric id (e.g. "50" for A, "51" for B, ...). */
export function getBlockById(blockId: string): MethodologyBlock | null {
  const cfg = getMethodology();
  return cfg.blocks.find((b) => b.id === blockId) ?? null;
}

/** Lookup a block by its letter code (A–L). */
export function getBlockByCode(code: string): MethodologyBlock | null {
  const cfg = getMethodology();
  return cfg.blocks.find((b) => b.code === code.toUpperCase()) ?? null;
}

/** Find a nomination by its code (e.g. "B16"). Also returns the parent block. */
export function findNomination(
  nominationCode: string
): { block: MethodologyBlock; nomination: NominationDef } | null {
  const cfg = getMethodology();
  for (const b of cfg.blocks) {
    const n = b.nominations.find((x) => x.code === nominationCode);
    if (n) return { block: b, nomination: n };
  }
  return null;
}

/**
 * Resolve effective criterion weights for a (block, nomination):
 *   - fixed blocks: use criterion.default_weight
 *   - per_nomination blocks: use nomination.weights[criterion.id]
 * Returns ordered { id, weight } pairs in block.criteria order.
 */
export function resolveCriterionWeights(
  block: MethodologyBlock,
  nomination: NominationDef
): { id: string; weight: number }[] {
  if (block.weight_mode === "fixed") {
    return block.criteria.map((c) => {
      if (typeof c.default_weight !== "number") {
        throw new Error(`Block ${block.code} criterion ${c.id} missing default_weight (weight_mode=fixed)`);
      }
      return { id: c.id, weight: c.default_weight };
    });
  }
  // per_nomination
  const w = nomination.weights;
  if (!w) {
    throw new Error(`Nomination ${nomination.code} missing weights (block ${block.code} weight_mode=per_nomination)`);
  }
  return block.criteria.map((c) => {
    const v = w[c.id];
    if (typeof v !== "number") {
      throw new Error(`Nomination ${nomination.code} missing weight for criterion ${c.id}`);
    }
    return { id: c.id, weight: v };
  });
}

function validate(cfg: MethodologyConfig): void {
  if (!cfg.blocks || cfg.blocks.length !== 12) {
    throw new Error(`Methodology must have 12 blocks, got ${cfg.blocks?.length}`);
  }
  const codes = new Set(cfg.blocks.map((b) => b.code));
  if (codes.size !== 12) throw new Error("Duplicate block codes in methodology");

  for (const b of cfg.blocks) {
    if (!b.criteria.length) throw new Error(`Block ${b.code} has no criteria`);
    if (!b.nominations.length) throw new Error(`Block ${b.code} has no nominations`);

    if (b.weight_mode === "fixed") {
      const sum = b.criteria.reduce((acc, c) => acc + (c.default_weight ?? 0), 0);
      if (Math.abs(sum - 1.0) > 0.001) {
        throw new Error(`Block ${b.code} fixed weights sum to ${sum}, expected 1.0`);
      }
    } else {
      for (const n of b.nominations) {
        if (!n.weights) throw new Error(`Nomination ${n.code} missing weights (block ${b.code})`);
        const sum = Object.values(n.weights).reduce((a, w) => a + w, 0);
        if (Math.abs(sum - 1.0) > 0.001) {
          throw new Error(`Nomination ${n.code} weights sum to ${sum}, expected 1.0`);
        }
        for (const c of b.criteria) {
          if (typeof n.weights[c.id] !== "number") {
            throw new Error(`Nomination ${n.code} missing weight for criterion ${c.id}`);
          }
        }
      }
    }
  }

  // Award thresholds sanity
  const t = cfg.award_thresholds;
  if (!(t.longlist.max < t.shortlist.min &&
        t.shortlist.max < t.bronze.min &&
        t.bronze.max < t.silver.min &&
        t.silver.max < t.gold.min)) {
    throw new Error("award_thresholds bands overlap or are out of order");
  }
}

/** Map a numeric score to its award level using the festival-wide thresholds. */
export function scoreToAwardLevel(
  score: number
): "longlist" | "shortlist" | "bronze" | "silver" | "gold" {
  const t = getMethodology().award_thresholds;
  if (score >= t.gold.min) return "gold";
  if (score >= t.silver.min) return "silver";
  if (score >= t.bronze.min) return "bronze";
  if (score >= t.shortlist.min) return "shortlist";
  return "longlist";
}
