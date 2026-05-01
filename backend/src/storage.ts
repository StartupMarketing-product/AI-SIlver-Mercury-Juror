import { getSupabase } from "./supabase.js";

/**
 * Supabase Storage layer for the `cases` bucket.
 *
 * Path scheme:  {case_id}/{epoch_ms}-{safe_filename}
 *   - flat per-case folders so we can list / purge by case_id
 *   - epoch prefix prevents collisions when the same filename is re-uploaded
 *
 * Buckets are private. Reads go through signed URLs (default TTL 10 min).
 * The DB row stores the full storage path; this module is the only one that
 * speaks to Supabase Storage directly.
 */

export const CASES_BUCKET = "cases";
export const RENDERS_BUCKET = "renders";

const SIGNED_URL_TTL_SECONDS = 600;

export interface StoredFileRef {
  bucket: string;
  path: string;
  kind: string;
  original_name: string;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
}

/** Upload a single file buffer to the `cases` bucket. Returns the storage path + ref. */
export async function uploadCaseFile(
  caseId: string,
  buffer: Buffer | Uint8Array,
  originalName: string,
  contentType?: string
): Promise<StoredFileRef> {
  const sb = getSupabase();
  const filename = `${Date.now()}-${safeFilename(originalName)}`;
  const path = `${caseId}/${filename}`;
  const { error } = await sb.storage.from(CASES_BUCKET).upload(path, buffer, {
    contentType: contentType ?? "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`storage upload failed (${path}): ${error.message}`);
  return {
    bucket: CASES_BUCKET,
    path,
    kind: contentType ?? "application/octet-stream",
    original_name: originalName,
  };
}

/** Download a stored case file as a Buffer (for pdf-parse / OCR ingestion). */
export async function downloadCaseFile(path: string): Promise<Buffer> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(CASES_BUCKET).download(path);
  if (error || !data) throw new Error(`storage download failed (${path}): ${error?.message ?? "no data"}`);
  const arr = await data.arrayBuffer();
  return Buffer.from(arr);
}

/** Generate a short-lived signed URL for a stored case file (UI preview / download). */
export async function getCaseFileSignedUrl(path: string, ttlSeconds: number = SIGNED_URL_TTL_SECONDS): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(CASES_BUCKET).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`signed url failed (${path}): ${error?.message ?? "no url"}`);
  }
  return data.signedUrl;
}

/** Best-effort delete of all files for a case (used on retention cleanup). */
export async function deleteCaseFiles(caseId: string): Promise<void> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(CASES_BUCKET).list(caseId);
  if (error) throw new Error(`storage list failed (${caseId}): ${error.message}`);
  const paths = (data ?? []).map((f) => `${caseId}/${f.name}`);
  if (paths.length === 0) return;
  const { error: rmErr } = await sb.storage.from(CASES_BUCKET).remove(paths);
  if (rmErr) throw new Error(`storage delete failed (${caseId}): ${rmErr.message}`);
}
