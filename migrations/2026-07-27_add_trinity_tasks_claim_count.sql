-- Durable re-claim counter for trinity_tasks.
--
-- APPLIED TO PRODUCTION 2026-07-27 (Supabase qnnpjhlxljtqyigedwkb) by CC, autonomous loop
-- Beat 42, BEFORE the code in this PR ships. That ordering is deliberate and load-bearing:
-- lib/ConstitutionalAgentV4.js now references claim_count in the claim statement, and if the
-- code reached production first the query would fail with 42703, getNextTask() would catch it
-- and return null, and EVERY agent would go quietly idle — an outage indistinguishable from an
-- empty queue. Column first, code second.
--
-- WHY: task 435029 was claimed 365 times and produced 239 artifacts from 11 agents in ~1h40m
-- (~1 LLM call per 25s) [V sql:2026-07-27]. The claim itself is race-safe and was not at fault.
-- Several paths legitimately release a task back to a claimable status with claimed_by=NULL
-- (releaseTask -> 'pending', the exception path -> 'pending', escalation ->
-- 'pending_clarification', which is itself claimable), and the only brake was an in-memory,
-- per-process, per-agent Map — invisible across agents and lost on restart.
--
-- ADD COLUMN with a constant DEFAULT is metadata-only on PG11+, so this does not rewrite the
-- table. trinity_tasks is a 26-FK hub; adding a column touches none of those constraints.

ALTER TABLE public.trinity_tasks
    ADD COLUMN IF NOT EXISTS claim_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.trinity_tasks.claim_count IS
    'Durable global re-claim counter, incremented inside the atomic claim UPDATE in '
    'ConstitutionalAgentV4.getNextTask. Caps unbounded re-claim cycles that in-memory '
    'per-agent claimHistory cannot see. Added 2026-07-27 (autonomous loop Beat 42) after '
    'task 435029 was re-claimed 365 times / 239 artifacts by 11 agents.';
