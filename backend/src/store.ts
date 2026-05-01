/**
 * Phase 2: persistence moved to Supabase. This file is kept only as a thin
 * re-export so older imports keep working during the transition. New code
 * should import directly from "./db.js" and "./storage.js".
 */
export type { StoredCase, StoredEvaluation, NewCaseInput, CaseStatus } from "./db.js";
export {
  insertCase,
  getCase,
  listCases,
  insertVerdict,
  getVerdict,
  listVerdicts,
  updateCaseStatus,
} from "./db.js";
