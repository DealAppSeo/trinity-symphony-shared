/**
 * GLOBAL EMERGENCY HALT — the agent-side half of SPRINT_BACKLOG L0 gate 0.4.
 *
 * WHY THIS EXISTS SEPARATELY FROM `agent-controls.js` (checked first — they are
 * NOT the same lever, and this does not replace it):
 *   `agent-controls.js` reads `agent_controls.enabled` PER AGENT. It is the
 *   right tool for "idle mel while I look at something". It is the wrong tool
 *   for an emergency, for two measured reasons:
 *     1. `agent_controls` currently holds THREE rows — mel, sophia, veritas
 *        [sql:2026-07-27] — and `readEnabledFromDb` returns TRUE when no row
 *        exists. Nine of the twelve production agents therefore cannot be
 *        stopped by that lever at all until someone INSERTs a row first, which
 *        is not something an operator discovers mid-incident.
 *     2. Even fully populated it is twelve flips, not one, and it says nothing
 *        about the non-agent producers in this repo (the seeding loop).
 *   This module is the orthogonal axis: ONE boolean, EVERY acting loop. The two
 *   compose — either can park an agent — and neither reads the other's storage.
 *
 * WHAT: `trinity_system_config.emergency_halt` (singleton row id=1) — the SAME
 * column the repid-engine kill switch reads, so one flip stops the engine's
 * workers, the engine's mutating HTTP surface, AND the twelve Railway agents.
 * The column already exists in production [sql:2026-07-27]; this ships NO DDL.
 *
 * ── WHICH LOOPS ARE COVERED — ENUMERATED, NOT IMPLIED ────────────────────────
 * The engine's first version of this switch claimed "worker tick loops park"
 * and reached 3 of 14. The scope below was produced by grepping every
 * `while (true)` and `setInterval(` in this repo (excluding node_modules and
 * tests) and classifying each one, and `tests/emergency-halt-coverage.test.js`
 * pins it against the filesystem so a NEW loop added later fails CI until it is
 * covered or explicitly exempted here.
 *
 * COVERED (call `shouldParkForHalt()` before doing any work):
 *   - lib/ConstitutionalAgentV4.js  `runLoop()`        — the 12 Railway agents
 *   - lib/ConstitutionalAgentV4.js  `runLoopLegacy()`  — ditto (11 of 12 run this)
 *   - constitutional-agent-base.js  main `while (true)` claim loop
 *   - constitutional-agent-base.js  `runSelfDiagnostic()`  (it can trigger a
 *     HEALING CASCADE and writes a genome report — that is the machine acting)
 *   - constitutional-agent-base.js  `askEternalQuestions()`
 *   - trinity-worker.js             `startSeedingLoop()` — a PRODUCER: it shells
 *     out to seed evergreen tasks when agents look idle. A kill switch that does
 *     not stop the thing that CREATES work is not a kill switch.
 *
 * DELIBERATELY EXEMPT, each for a stated reason (NOT an oversight):
 *   - the `heartbeat()` setIntervals (ConstitutionalAgentV4, base, ConstitutionalAgent.ts)
 *     — observability. A halt must stop the machine ACTING, not stop it
 *     REPORTING; the operator needs /health and last_ping to watch the fleet
 *     come to rest. Same call the engine made for `providers/health.ts`.
 *   - mutual-wake.js — `fetch(agent.url + '/health')` only; enumerated for
 *     writes and there are none. Read-only liveness pings.
 *
 * NOT WIRED BECAUSE THEY DO NOT RUN — evidence, not assumption:
 *   - trinity.hdm.js       — calls `pollAndExecute` which is defined ZERO times
 *                            in the file (9 lines total); it would throw at boot.
 *   - trinity-{apm,orch,sophia,hdm,...}.js — one-line shims that spawn
 *                            `scripts/run-agent.js`, which does not exist.
 *   - w3c.index.js         — a full standalone agent loop, referenced by no file
 *                            and no deploy config in this repo.
 *   - lib/ConstitutionalAgent.ts — no `require`/`import` of it anywhere.
 *   The live entry point is `server.js` (`npm start`) -> ConstitutionalAgentV4.
 *   If any of these is ever revived it must be gated; the coverage test will
 *   say so, because it classifies by filename and these are listed as dead.
 *
 * DEFAULT BEHAVIOUR IS UNCHANGED. The column defaults to false, so with nothing
 * flipped every caller behaves exactly as it did before.
 *
 * MODE: EMERGENCY_HALT_MODE = enforce (DEFAULT) | shadow | off
 *   enforce — flag true actually parks callers. Default ON PURPOSE: a kill
 *             switch that ALSO needs an env var set is not a kill switch, it is
 *             two levers, and the second one needs a redeploy of 12 services.
 *   shadow  — read + log what WOULD park, change nothing.
 *   off     — skip the check entirely, no DB read (escape hatch if this module
 *             itself misbehaves).
 * The parser FAILS CLOSED — the inverse of every other mode parser in the
 * ecosystem, deliberately. Only `off` and `shadow` weaken the switch
 * (case-insensitive, surrounding whitespace ignored, matching
 * `toControlName`'s trim because a Railway field with a trailing space is a typo
 * in the fingers, not the intent). `of`, `false`, `0`, `disabled`, garbage — all
 * resolve to `enforce` and warn once. Other flags guard features that do damage
 * when ON; this one guards the lever that STOPS damage. You cannot typo the kill
 * switch into being disabled.
 *
 * FAILURE SEMANTICS (the part that matters — mirrors the engine exactly so an
 * operator has ONE mental model across both repos):
 *   - A read error can never START a halt. A flaky pooler must not park the fleet.
 *   - A read error can never LIFT one. Once a successful read has seen true,
 *     later failures keep the halt ("sticky"); only a successful read of FALSE
 *     resumes. An operator who pulls the switch during an incident must not have
 *     it released BY the incident.
 *   - A MISSING COLUMN/TABLE is treated as "not halted" and warned once, so this
 *     code is safe to run before, without, or after a rollback of the DDL.
 * Note this is fail-OPEN while `agent-controls.js` is fail-CLOSED (default-off
 * when unreachable). That is not an inconsistency: agent-controls already parks
 * the agent when the store is unreachable, so nothing is lost, and making BOTH
 * fail closed would mean a flaky read could park the fleet twice over with a
 * misleading "EMERGENCY HALT" in the log.
 *
 * NO REDIS ON PURPOSE. `agent-controls.js` caches through Upstash; this does
 * not. The switch has to work when infrastructure is misbehaving, and every
 * extra hop is another place a stale `false` can survive. Cost of that choice,
 * stated: one extra bounded query per agent per cache window — with 12 agents,
 * a 30 s loop sleep and a 5 s cache that is ~0.4 reads/sec against the pooler.
 *
 * LEVERS: EMERGENCY_HALT_MODE · EMERGENCY_HALT_CACHE_MS (default 5000)
 *       · EMERGENCY_HALT_TIMEOUT_MS (default 2000 — hard ceiling on how long
 *         this check may block a tick; an overrun is treated as a failed read)
 *
 * OPERATOR RUNBOOK — one statement each way, from the Supabase SQL editor:
 *
 *   -- PULL THE SWITCH
 *   UPDATE trinity_system_config
 *      SET emergency_halt = true, emergency_halt_reason = '<why>',
 *          emergency_halt_at = now(), emergency_halt_by = '<who>'
 *    WHERE id = 1;
 *
 *   -- RESUME
 *   UPDATE trinity_system_config
 *      SET emergency_halt = false, emergency_halt_at = now(), emergency_halt_by = '<who>'
 *    WHERE id = 1;
 *
 * Takes effect within EMERGENCY_HALT_CACHE_MS plus the caller's poll interval
 * (worst case ~35 s on an idle agent, which sleeps 30 s between iterations).
 */
'use strict';

const { pgQuery } = require('./direct-pg');

const CACHE_MS = Number(process.env.EMERGENCY_HALT_CACHE_MS || 5000);
const TIMEOUT_MS = Number(process.env.EMERGENCY_HALT_TIMEOUT_MS || 2000);

const HALT_SQL = 'SELECT emergency_halt FROM trinity_system_config WHERE id = 1';

/** Injection seam for tests — production always uses direct-pg's pgQuery. */
let queryImpl = null;

/** null = never successfully read. true/false = last SUCCESSFUL read (sticky). */
let lastKnownHalt = null;
let cacheExpiresAt = 0;
let warnedUnknownMode = false;
let warnedMissingColumn = false;

/**
 * Fail-closed mode parser. ONLY exact `off`/`shadow` (case/whitespace
 * insensitive) weaken the switch; everything else is `enforce`.
 * @param {unknown} raw
 * @returns {'off'|'shadow'|'enforce'}
 */
function parseHaltMode(raw) {
  if (typeof raw !== 'string') return 'enforce';
  const v = raw.trim().toLowerCase();
  if (v === 'off') return 'off';
  if (v === 'shadow') return 'shadow';
  if (v !== '' && v !== 'enforce' && !warnedUnknownMode) {
    warnedUnknownMode = true;
    console.warn(
      `[emergency-halt] EMERGENCY_HALT_MODE="${raw}" is not off|shadow|enforce — ` +
        'resolving to ENFORCE (this parser fails closed on purpose).'
    );
  }
  return 'enforce';
}

function currentMode() {
  return parseHaltMode(process.env.EMERGENCY_HALT_MODE);
}

/**
 * A halt value must be unambiguously true. Accepts boolean true and the string
 * 'true' (pg returns a boolean, but a JSON/REST path could hand back a string)
 * and NOTHING else — so a stray value cannot park the fleet, while the one
 * direction that matters (an operator pulled the switch) cannot be missed.
 */
function isHaltTruthy(v) {
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function looksLikeMissingColumn(err) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  return (
    (err && err.code === '42703') ||
    (err && err.code === '42P01') ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes('relation') && msg.includes('does not exist'))
  );
}

/** Bound the read. `pgQuery` races its own timeout, but this check must never
 *  be able to wedge the loop it protects, so the ceiling is enforced here too.
 *  The timer is NOT unref'd: it lives <= TIMEOUT_MS, and an unref'd timer can
 *  let a short-lived process exit mid-await instead of failing open. */
function withHardTimeout(promise, ms, label) {
  let handle = null;
  const timer = new Promise((_, reject) => {
    handle = setTimeout(() => {
      const e = new Error(`Timeout after ${ms}ms: ${label}`);
      e.name = 'TimeoutError';
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timer]).finally(() => {
    if (handle) clearTimeout(handle);
  });
}

/**
 * Read the global halt flag. Cached for CACHE_MS. Never throws.
 * @returns {Promise<{halted: boolean, source: string}>}
 */
async function readHalt() {
  if (Date.now() < cacheExpiresAt && lastKnownHalt !== null) {
    return { halted: lastKnownHalt, source: 'cache' };
  }

  const q = queryImpl || pgQuery;
  try {
    const rows = await withHardTimeout(
      q(HALT_SQL, [], { retries: 1, timeoutMs: TIMEOUT_MS, label: 'emergency-halt-read' }),
      TIMEOUT_MS,
      'emergency-halt-read'
    );
    // No row at all is not a halt: the singleton is missing, not set.
    const value = Array.isArray(rows) && rows.length ? rows[0].emergency_halt : false;
    lastKnownHalt = isHaltTruthy(value);
    cacheExpiresAt = Date.now() + CACHE_MS;
    return { halted: lastKnownHalt, source: 'db' };
  } catch (err) {
    if (looksLikeMissingColumn(err)) {
      if (!warnedMissingColumn) {
        warnedMissingColumn = true;
        console.warn(
          '[emergency-halt] trinity_system_config.emergency_halt is absent — ' +
            'treating as NOT halted (safe to run before/without the DDL).'
        );
      }
      lastKnownHalt = false;
      cacheExpiresAt = Date.now() + CACHE_MS;
      return { halted: false, source: 'missing_column' };
    }
    // A failure can neither START a halt nor LIFT one.
    if (lastKnownHalt === true) {
      console.warn(
        `[emergency-halt] read failed (${(err && err.message) || err}) — HALT STAYS IN PLACE (sticky).`
      );
      return { halted: true, source: 'error_sticky' };
    }
    console.warn(
      `[emergency-halt] read failed (${(err && err.message) || err}) — failing open (not halted).`
    );
    return { halted: false, source: 'error_open' };
  }
}

/**
 * THE call site helper. `true` => the caller must park (claim nothing, spawn
 * nothing, act on nothing) and try again on its next tick.
 * @param {string} [who] label for the log line (agent name / loop name)
 * @returns {Promise<boolean>}
 */
async function shouldParkForHalt(who = 'agent') {
  const mode = currentMode();
  if (mode === 'off') return false;

  const { halted, source } = await readHalt();
  if (!halted) return false;

  if (mode === 'shadow') {
    console.warn(`[emergency-halt] SHADOW: ${who} WOULD park (source=${source}); continuing.`);
    return false;
  }
  console.warn(`[emergency-halt] 🛑 EMERGENCY HALT ACTIVE — ${who} is parking (source=${source}).`);
  return true;
}

/** Drop the cache so the next read hits the DB (used after an external flip). */
function bustHaltCache() {
  cacheExpiresAt = 0;
}

/** Test seam — never called in production paths. */
function __setQueryImplForTests(fn) {
  queryImpl = fn;
}

/** Test seam — resets every module-level bit of state. */
function __resetForTests() {
  queryImpl = null;
  lastKnownHalt = null;
  cacheExpiresAt = 0;
  warnedUnknownMode = false;
  warnedMissingColumn = false;
}

module.exports = {
  parseHaltMode,
  isHaltTruthy,
  readHalt,
  shouldParkForHalt,
  bustHaltCache,
  CACHE_MS,
  TIMEOUT_MS,
  __setQueryImplForTests,
  __resetForTests,
};
