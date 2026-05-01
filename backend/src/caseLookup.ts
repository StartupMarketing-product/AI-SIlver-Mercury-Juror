import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

interface CaseRef {
  project_id: string;
  project_name: string;
  nomination_id: string;
}

let cached: CaseRef[] | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function loadRefs(): CaseRef[] {
  if (cached) return cached;
  const path = join(__dirname, "..", "..", "SM_2025.json");
  if (!existsSync(path)) {
    cached = [];
    return cached;
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  const blocks = Array.isArray(raw) && Array.isArray(raw[0]) ? (raw[0] as any[]) : (raw as any[]);
  const out: CaseRef[] = [];
  for (const b of blocks ?? []) {
    for (const p of b?.projects ?? []) {
      out.push({
        project_id: String(p?.project_id ?? ""),
        project_name: String(p?.project_name ?? ""),
        nomination_id: String(p?.nomination_id ?? ""),
      });
    }
  }
  cached = out;
  return cached;
}

export function resolveNomination(projectId?: string, projectName?: string): string | null {
  const refs = loadRefs();
  const pid = (projectId ?? "").trim();
  if (pid) {
    const byId = refs.find((r) => r.project_id === pid);
    if (byId?.nomination_id) return byId.nomination_id;
  }

  const pn = normalizeName(projectName ?? "");
  if (!pn) return null;
  const byName = refs.find((r) => normalizeName(r.project_name) === pn);
  if (byName?.nomination_id) return byName.nomination_id;
  return null;
}

