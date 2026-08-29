---

## HyperDAG Protocol Rules (Sean-authored)

- CLAUDE-RULE-1: Verify before building. Query existing state before creating new state.
- CLAUDE-RULE-2: Describe vs execute. Never auto-execute infrastructure changes without "GO".
- CLAUDE-RULE-3: Code discipline. Fix only what's named. No scope creep.
- CLAUDE-RULE-4: Truth principles. Honest > flattering. "I don't know" > fabrication.
- CLAUDE-RULE-5: Schema first. Query information_schema before SQL. trinity_tasks.id is BIGINT, not UUID.
- CLAUDE-RULE-6: Efficiency. Shortest path to done. No busywork.

## Architectural Principles (first-class)

1. Persistent stateful channels beat repeated stateless calls when state is heavy and turns are short.
2. Latency is opportunity. The gap between signal and response is where alignment work happens.
3. ANFIS/LASSO at every decision point. Pattern learning and anticipatory metrics measuring prediction quality.
4. Reward functions grounded in declared purpose alignment, not engagement maximization.
5. Multi-source signals with explicit attestation chains. Where did this come from? Why is it trusted?

## Hard Stops (Marco/Vitto/Leonard contributor protections)

Files in packages/contracts/ are protected. Do not modify:
- packages/contracts/ERC8004SPEC.md
- packages/contracts/contracts/*
- packages/contracts/test/*
- packages/contracts/abis/*

## Two agents share this database and these repos — claim before you touch

**CC** runs in a remote cloud container. **GA** runs on Sean's laptop. Both have
GitHub and Supabase access, and `ListAgents` returns nothing across that
boundary, so **the two cannot message each other.** Supabase is the only
substrate both reach, which is why coordination lives there.

### 1. Never share a branch name

The cheapest half of this needs no machinery. Namespace your branches by who you
are, and the largest collision class disappears:

| agent | branch prefix |
|---|---|
| CC (remote) | `claude/…` |
| GA (local)  | `ga/…` |
| XC          | `xc/…` |

Two agents force-pushing one branch name is not a conflict you resolve — it is
work that silently disappears.

### 2. Claim a shared mutable resource before changing it

```sql
-- Before you start:
select * from v_active_claims;

select claim_resource(
  'supabase_table',            -- git_branch | supabase_table | supabase_migration
                               -- railway_service | env_var | other
  'repid_agents',              -- 'owner/repo#branch' for a branch
  'GA',                        -- who you are
  'adding a column for X',     -- why, one line
  60                           -- TTL minutes; it EXPIRES, always
);

-- When done:
select release_resource('supabase_table','repid_agents','GA');
```

`claim_resource` **raises** rather than returning null when someone else holds
it — a caller that ignored a null return would have proceeded without the lock,
which is the exact failure this exists to prevent. The message names the holder
and the expiry.

**The exclusion is the unique index `uniq_active_claim`, not the function.** A
second live claim on one resource is impossible at the storage layer, so
skipping the helper still cannot double-claim. Same reasoning as
`social_content_queue_verified_before_publish`: app code is where a gate gets
forgotten.

**Every claim expires.** A lock with no TTL becomes a permanent outage the first
time a session dies holding it, and these sessions are ephemeral. An expired
claim is cleared automatically by the next `claim_resource` call — you do not
need to reap it.

### 3. What actually collides

Measured on 2026-08-29, three times in one session, all the same shape: **work
landed on `main` while a PR against it was open, and the branch then conflicted
with the squash of its own commit.** After any merge, reset your branch onto the
new `main` rather than stacking on it:

```bash
git fetch origin main && git checkout -B <your-branch> origin/main
```

A squash-merged commit is in `main` by content but is **not an ancestor**, so
`git merge-base --is-ancestor` says "not merged" about work that shipped. Check
`git diff HEAD origin/main` — empty means your work is in, whatever the ancestry
says.

### 4. Migrations are the sharp edge

Both agents can call `apply_migration` against the one production project
(`qnnpjhlxljtqyigedwkb`). There is no staging copy. Claim
`supabase_migration` + the table name before DDL, and say in `purpose` what you
are changing — a concurrent `ALTER` on the same table is not recoverable by
re-running.

## Tooling Notes

- GitNexus auto-generation skipped due to broken tree-sitter-dart SSH dependency in the project. Manual rules block in use until GitNexus dependency is fixed upstream or Codebase-Memory alternative is evaluated.

---
