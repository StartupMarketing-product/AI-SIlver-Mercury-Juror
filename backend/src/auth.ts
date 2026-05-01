/**
 * Shared-password auth middleware for the moderator console.
 *
 * - If MODERATOR_PASSWORD env var is set: every protected request must include
 *   `Authorization: Bearer <password>` (or just the raw password).
 * - If MODERATOR_PASSWORD env var is NOT set: the middleware is a no-op.
 *   This keeps local development frictionless — you only need a password in
 *   production.
 *
 * Use it on any route that mutates data, costs money (LLM / HeyGen credits),
 * or could leak unfinished verdicts.
 */

import type { Request, Response, NextFunction } from "express";

export function moderatorAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = (process.env.MODERATOR_PASSWORD || "").trim();
  if (!expected) {
    // Local dev mode — no password configured, allow everything.
    return next();
  }
  const raw = req.header("Authorization") ?? "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
  if (token === expected) {
    return next();
  }
  res.status(401).json({
    error: "Unauthorized",
    detail: "Введите пароль модератора (Authorization: Bearer <password>).",
  });
}
