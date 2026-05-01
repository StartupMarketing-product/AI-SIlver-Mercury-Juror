/**
 * Tiny shared-password auth helper for the moderator console.
 *
 * The backend protects every mutating route with `Authorization: Bearer <pwd>`
 * (see backend/src/auth.ts). This helper:
 *   - stores the password in localStorage so the moderator types it once
 *   - exposes `apiFetch()` — drop-in replacement for window.fetch that
 *     auto-attaches the header and re-prompts on 401
 *
 * Local dev: leave the prompt empty (Esc / blank) — the backend treats the
 * absence of MODERATOR_PASSWORD env var as "no auth", so any token works.
 */

const KEY = "moderator_password_v1";

export function getPassword(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setPassword(p: string): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* private browsing — ignore */
  }
}

export function clearPassword(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

/** Prompt the user once if no password is stored. Returns the password (or "" if cancelled). */
export function ensurePassword(): string {
  let p = getPassword();
  if (!p) {
    const entered = window.prompt(
      "Введите пароль модератора\n(оставьте пустым для локальной разработки)",
      ""
    );
    if (entered === null) return "";
    p = entered;
    setPassword(p);
  }
  return p;
}

/**
 * Fetch wrapper that auto-attaches the moderator password and re-prompts on 401.
 * Use this anywhere you'd use `fetch` for a protected backend route.
 */
export async function apiFetch(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const pwd = ensurePassword();
  const headers = new Headers(init.headers ?? {});
  if (pwd) headers.set("Authorization", `Bearer ${pwd}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    // Stored password is wrong — clear it, re-prompt, retry once.
    clearPassword();
    const fresh = ensurePassword();
    if (!fresh) return res; // user cancelled — surface the 401 to caller
    const headers2 = new Headers(init.headers ?? {});
    headers2.set("Authorization", `Bearer ${fresh}`);
    return fetch(input, { ...init, headers: headers2 });
  }
  return res;
}
