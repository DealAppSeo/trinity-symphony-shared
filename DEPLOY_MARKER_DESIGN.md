# S-DEPLOY-MARKER — honest deploy-SHA stamp (DESIGN; code edit BLOCKED on overlap)

**Status:** ⛔ The code edit is **STOPPED per the sprint's deconfliction guard** — the heartbeat
`code_version` writer (`lib/ConstitutionalAgentV4.js`) is being rewritten **right now** on GA's
in-flight `feat/ga-2026-05-30-t12-concurrency` + `feat/ga-observability-2026-05-29` (41 changed
lines each in the heartbeat region, incl. the `agent_heartbeat` upsert + `code_version`). Editing it
here would guarantee a conflict. This file is the **ready-to-apply design** — fold it into GA's T12,
or apply after T12 merges. Nothing in `lib/ConstitutionalAgentV4.js` was touched on this branch.

## The one-line change (DEFAULT non-breaking route)
Stamp the SHA onto `this.version` at construction — a **single point** that feeds **every** heartbeat
write path (both the `supabase.from('agent_heartbeat').upsert({ code_version: this.version })` and the
direct-pg `INSERT … code_version … this.version` fallback). It does NOT touch the heartbeat SQL, and
it preserves the SPRINT-14 NULL marker (an agent on OLD code still writes NULL/old label; only agents
running THIS code write the stamped label).

In `lib/ConstitutionalAgentV4.js`, where `this.version = CONSTITUTION.VERSION;` (~line 134):
```js
// S-DEPLOY-MARKER 2026-06-01 — append the real running commit SHA so the DB shows what's deployed.
const sha = (process.env.RAILWAY_GIT_COMMIT_SHA || '').trim().slice(0, 7);
const onRailway = !!process.env.RAILWAY_SERVICE_ID;            // present in prod, absent locally
const marker = sha
  ? '@' + sha                                                  // deployed, SHA known → "8.2.0-reflect-wired@a1b2c3d"
  : onRailway
    ? '@deployed-nosha'                                        // prod but Railway didn't inject the git SHA → escalate to build-baked SHA
    : '@local-' + new Date().toISOString().replace(/[:.]/g, '-'); // local run → NEVER a SHA
this.version = CONSTITUTION.VERSION + marker;
```
Result in `agent_heartbeat.code_version`:
- deployed → `8.2.0-reflect-wired@<sha7>` (diff `<sha7>` vs `origin/main`)
- prod w/o injected SHA → `8.2.0-reflect-wired@deployed-nosha` (honest: deployed but SHA missing)
- local → `8.2.0-reflect-wired@local-2026-06-01T...` (can NEVER pass as a SHA)
- old code (unchanged) → `8.2.0-reflect-wired` or `NULL` (SPRINT-14 marker intact)

## SHA source — verified state
- Expected env var: **`RAILWAY_GIT_COMMIT_SHA`** (Railway's standard for GitHub-connected deploys).
- ⚠️ It is **NOT in the agent service's variable list** `[sql/railway:2026-06-01]` — only
  `RAILWAY_SERVICE_ID` / `RAILWAY_SERVICE_NAME` / `RAILWAY_SERVICE_*_URL` are listed. Railway injects
  git vars at **runtime** for GitHub-source services, so it may still be defined in-container — but if
  these agents deploy via `railway up`/CLI/Docker (not GitHub), it will be **undefined**, and prod
  would show `@deployed-nosha`. **Verification = the stamp itself:** after redeploy, if prod shows a
  SHA → injection works; if it shows `@deployed-nosha` → add a **build-baked SHA** (write
  `git rev-parse HEAD` into a `COMMIT_SHA` file at build via nixpacks/Dockerfile and read it first).
- Robust source order to use: `RAILWAY_GIT_COMMIT_SHA` → (build-baked file, follow-up) → `local-<ts>`.

## Optional cleaner route (flagged, unapplied)
`migrations/2026-06-01_add_deployed_commit_sha.sql` — a dedicated `deployed_commit_sha text` column so
the SHA is its own field and `code_version` is left entirely alone. Sean applies; then the writer sets
`deployed_commit_sha = sha` (NULL/`local-*` otherwise).

## Activation (Sean only)
1. Fold the one-liner into GA's T12 (or apply after it merges) — do NOT land a competing heartbeat edit.
2. **Sean redeploys** the agent services (Railway = Sean-only).
3. Verify: `SELECT DISTINCT code_version FROM agent_heartbeat;` → a `@<sha7>` you can diff vs `origin/main`.
