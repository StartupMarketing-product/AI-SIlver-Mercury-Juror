import { readFileSync } from "fs";
import { createHash } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A single (criterion, block) anchor set. Keys "2" / "5" / "8" hold short prose anchors. */
export type AnchorSet = { "2": string; "5": string; "8": string };

export interface AnchorsConfig {
  version: string;
  description: string;
  scale_intervals: Record<string, string>;
  /** anchors_by_block[blockCode][criterionId] = AnchorSet */
  anchors_by_block: Record<string, Record<string, AnchorSet>>;
  /** AnchorSet for the special "social_outcomes" criterion (used only on social nominations). */
  social_outcomes: AnchorSet;
}

interface LoadedAnchors {
  config: AnchorsConfig;
  /** Stable hash of the on-disk file contents — stamped onto every verdict alongside methodology_hash. */
  anchors_hash: string;
}

let cached: LoadedAnchors | null = null;

export function loadAnchors(): LoadedAnchors {
  if (cached) return cached;
  const path = join(__dirname, "config", "anchors.json");
  const raw = readFileSync(path, "utf-8");
  const config = JSON.parse(raw) as AnchorsConfig;
  validate(config);
  const anchors_hash = "sha256-" + createHash("sha256").update(raw).digest("hex").slice(0, 16);
  cached = { config, anchors_hash };
  return cached;
}

export function getAnchors(): AnchorsConfig {
  return loadAnchors().config;
}

export function getAnchorsHash(): string {
  return loadAnchors().anchors_hash;
}

/** Look up the (2/5/8) anchor set for a (block, criterion). Returns null if absent. */
export function getAnchorSet(blockCode: string, criterionId: string): AnchorSet | null {
  const cfg = getAnchors();
  const block = cfg.anchors_by_block[blockCode.toUpperCase()];
  if (!block) return null;
  return block[criterionId] ?? null;
}

export function getSocialOutcomesAnchors(): AnchorSet {
  return getAnchors().social_outcomes;
}

function validate(cfg: AnchorsConfig): void {
  const REQUIRED_LEVELS: Array<keyof AnchorSet> = ["2", "5", "8"];
  if (!cfg.anchors_by_block || typeof cfg.anchors_by_block !== "object") {
    throw new Error("anchors.json: missing anchors_by_block");
  }
  for (const [block, crits] of Object.entries(cfg.anchors_by_block)) {
    for (const [crit, set] of Object.entries(crits)) {
      for (const lvl of REQUIRED_LEVELS) {
        if (typeof set[lvl] !== "string" || !set[lvl].trim()) {
          throw new Error(`anchors.json: block ${block} criterion ${crit} missing anchor "${lvl}"`);
        }
      }
    }
  }
  for (const lvl of REQUIRED_LEVELS) {
    if (typeof cfg.social_outcomes?.[lvl] !== "string" || !cfg.social_outcomes[lvl].trim()) {
      throw new Error(`anchors.json: social_outcomes missing anchor "${lvl}"`);
    }
  }
}
