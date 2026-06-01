-- ============================================================================
-- S-DEPLOY-MARKER (optional, cleaner route) — dedicated deployed-commit column
-- Author: CC · 2026-06-01 · branch feat/cc-2026-06-01-deploy-marker
-- DESIGN ONLY — Sean applies in Supabase. NOT applied. Idempotent.
--
-- The DEFAULT route (per sprint) is the NON-BREAKING quick stamp that appends the
-- SHA to the existing code_version label (no schema change) — see DEPLOY_MARKER_DESIGN.md.
-- This file is the FLAGGED follow-up: a dedicated column so the SHA is its own field
-- (cleaner to diff/query), leaving code_version + its SPRINT-14 NULL-marker semantics
-- completely untouched.
-- ============================================================================

ALTER TABLE public.agent_heartbeat
  ADD COLUMN IF NOT EXISTS deployed_commit_sha text;

COMMENT ON COLUMN public.agent_heartbeat.deployed_commit_sha IS
  'Real running git commit SHA, sourced from RAILWAY_GIT_COMMIT_SHA at boot. '
  'NULL or a local-* value means it is NOT a deployed SHA (local run / SHA unavailable). '
  'Added by S-DEPLOY-MARKER 2026-06-01. Does NOT alter code_version / SPRINT-14 NULL marker.';

-- rollback: ALTER TABLE public.agent_heartbeat DROP COLUMN IF EXISTS deployed_commit_sha;

-- Verify after the writer is updated + Sean redeploys:
--   SELECT DISTINCT deployed_commit_sha FROM agent_heartbeat;   -- expect a 7-40 char SHA you can diff vs origin/main
--   (local runs show 'local-<ts>' or NULL — never a SHA)
