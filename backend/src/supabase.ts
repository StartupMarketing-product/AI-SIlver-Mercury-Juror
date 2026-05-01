import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client. Uses the service-role key — NEVER ship this client
 * to the browser. RLS is bypassed under service-role; the API layer is responsible
 * for enforcing access control on the way in.
 *
 * Phase 2: this is the only place we instantiate the client. db.ts and storage.ts
 * import getSupabase() and never touch credentials directly.
 */

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL not set in environment");
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set in environment");
  cached = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "synthetic-jury-api/0.1" } },
  });
  return cached;
}

/** Reset the cached client — useful for tests that swap env vars between cases. */
export function resetSupabase(): void {
  cached = null;
}
