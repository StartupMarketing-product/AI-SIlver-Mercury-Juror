-- Migration: add avatar pipeline columns to verdicts.
-- Apply via: supabase db push, or paste into Supabase SQL editor.
-- Idempotent — safe to re-run.

alter table public.verdicts
  add column if not exists avatar_script text,
  add column if not exists avatar_video_url text,
  add column if not exists avatar_status text,
  add column if not exists avatar_updated_at timestamptz;

-- avatar_status values match the AvatarStatus enum in src/db.ts:
--   scoring | awaiting_review | approved | rendering | ready | failed
-- Default state for a new verdict is 'awaiting_review' (set by insertVerdict).
