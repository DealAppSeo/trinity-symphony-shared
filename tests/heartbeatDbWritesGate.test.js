// HEARTBEAT_MODE tri-state gate + enriched /health payload test for ConstitutionalAgentV4.
// Run: node tests/heartbeatDbWritesGate.test.js
//
// Verifies the presence-write control (trinity_agent_registry presence +
// agent_heartbeat + trinity_heartbeat upserts) across all three modes, plus the
// durable write-on-CHANGE path and /health shape:
//
//  (a) mode 'full' (default)  → all 3 presence upserts fire on EVERY heartbeat()
//      call — today's behavior, preserved exactly.
//  (b) mode 'throttled'       → presence upserts fire AT MOST ONCE per
//      heartbeatLivenessIntervalMs per agent: first call writes, calls inside the
//      window skip, the call after the window writes again.
//  (c) mode 'off'             → presence upserts NEVER fire.
//  (d) durable config-on-change (persistRegistryConfig) ALWAYS writes when a
//      durable field changed, in EVERY mode (never gated), and only on change.
//  (e) resolveHeartbeatMode legacy mapping: HEARTBEAT_DB_WRITES=off → 'off',
//      unset/on → 'full'; explicit HEARTBEAT_MODE wins.
//  (f) healthPayload() shape: alive:true + agent/loopCount/lastIterationAt/
//      currentTaskId/status/uptimeSec/codeVersion present, no DB access.
//
// No jest in this repo (CI runs plain `node tests/*.test.js`). This mirrors the
// plain-Node style of tests/pulseCheckExecutor.test.js. We stub ./direct-pg in
// the require cache BEFORE requiring the agent so heartbeat()'s module-level
// pgQuery is intercepted, and we build the agent via Object.create to skip the
// real constructor. The 'throttled' window is driven deterministically by
// overriding the agent's _now() seam (no real timers).

'use strict';

const assert = require('node:assert/strict');

// Minimal env so incidental createClient()/Redis paths don't crash at require time.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-token';

// --- Stub ./direct-pg in the require cache before the agent module loads. ----
// heartbeat() / persistRegistryConfig() call the module-scoped pgQuery. We
// record every call's label so we can assert which writes fired.
const pgCalls = [];
function resetPgCalls() { pgCalls.length = 0; }
const directPgPath = require.resolve('../lib/direct-pg');
require.cache[directPgPath] = {
  id: directPgPath,
  filename: directPgPath,
  loaded: true,
  exports: {
    pgQuery: async (sql, params, opts) => {
      pgCalls.push({ label: (opts && opts.label) || null, sql, params });
      return { rows: [], rowCount: 0 };
    },
    pgPing: async () => ({ ok: true, latencyMs: 1 })
  },
  children: [],
  paths: []
};

const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

const LIVENESS_MS = 120000; // default 2min throttle window used in these tests

// Build an agent instance without running the real constructor.
// `clock` is a mutable { t } box so the test drives _now() deterministically.
function makeAgent(overrides = {}, clock = { t: 1_000_000 }) {
  const agent = Object.create(ConstitutionalAgentV4.prototype);
  agent.name = 'trinity-mel';
  agent.version = '8.1.3-test';
  agent.phi = 1.61803398875;
  agent.loopCount = 3;
  agent.currentTaskId = null;
  agent.lastIterationAt = new Date().toISOString();
  agent.codeVersion = 'deadbeef';
  agent.sessionMetrics = { tasksCompleted: 2, tasksFailed: 1, llmCalls: 0, startTime: Date.now() - 5000 };
  agent.wisdom = { squad: 'BETA', tier: 'specialist', primaryVirtue: 'LOVELY' };
  agent.consecutiveHeartbeatFailures = 0;
  agent.heartbeatCircuitOpenUntil = 0;
  agent.heartbeatCircuitOpenLogged = false;
  agent._lastRegistryConfig = null;
  // Tri-state presence-write config.
  agent.heartbeatMode = 'full';                 // default
  agent.heartbeatDbWrites = true;               // back-compat mirror (full|throttled → true)
  agent.heartbeatLivenessIntervalMs = LIVENESS_MS;
  agent._lastPresenceWriteAt = 0;
  // Deterministic clock seam.
  agent._now = () => clock.t;
  return Object.assign(agent, overrides);
}

const PRESENCE_LABELS = [
  'heartbeat:trinity_agent_registry',
  'heartbeat:agent_heartbeat',
  'heartbeat:trinity_heartbeat'
];
const CONFIG_LABEL = 'heartbeat:registry_config_on_change';

function labelsFired() { return pgCalls.map(c => c.label); }
function presenceWriteCount() {
  // One "presence write" == the trinity_agent_registry upsert (fires once per
  // presence flush). Counting a single label avoids ×3 arithmetic.
  return labelsFired().filter(l => l === 'heartbeat:trinity_agent_registry').length;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(`      ${err.stack || err.message}`); failed++; }
}

(async () => {
  // (a) mode 'full' → all 3 presence upserts fire on EVERY call (today's behavior)
  await test("a) mode 'full' → presence writes fire on every call", async () => {
    resetPgCalls();
    const agent = makeAgent({ heartbeatMode: 'full' });
    await agent.heartbeat('Idle');
    await agent.heartbeat('Idle'); // no clock advance → 'full' still writes
    const fired = labelsFired();
    for (const lbl of PRESENCE_LABELS) {
      assert.ok(fired.includes(lbl), `expected presence write ${lbl} in 'full'`);
    }
    assert.equal(presenceWriteCount(), 2, "'full' writes presence every call (2 calls → 2 flushes)");
    assert.ok(!fired.includes(CONFIG_LABEL), 'no durable config set → no config write');
  });

  // (b) mode 'throttled' → at most once per heartbeatLivenessIntervalMs per agent
  await test("b) mode 'throttled' → presence writes at most once per interval", async () => {
    resetPgCalls();
    const clock = { t: 1_000_000 };
    const agent = makeAgent({ heartbeatMode: 'throttled' }, clock);

    // First call (cold) always writes.
    await agent.heartbeat('Idle');
    assert.equal(presenceWriteCount(), 1, 'first throttled call writes (cold start)');

    // Within the window → skipped, no matter how many calls.
    clock.t += 30_000;  await agent.heartbeat('Idle'); // +30s
    clock.t += 30_000;  await agent.heartbeat('Idle'); // +60s
    clock.t += 59_000;  await agent.heartbeat('Idle'); // +119s (still < 120s)
    assert.equal(presenceWriteCount(), 1, 'calls inside the window are throttled (no extra writes)');

    // Crossing the window → writes again exactly once.
    clock.t += 2_000;   await agent.heartbeat('Idle'); // +121s ≥ 120s window
    assert.equal(presenceWriteCount(), 2, 'first call past the window writes again');

    // Immediately after → throttled again.
    clock.t += 1_000;   await agent.heartbeat('Idle');
    assert.equal(presenceWriteCount(), 2, 'next call re-enters the throttle window');
  });

  // (b2) throttled writes ALL THREE presence tables together when it fires
  await test("b2) mode 'throttled' → a flush writes all 3 presence tables", async () => {
    resetPgCalls();
    const agent = makeAgent({ heartbeatMode: 'throttled' });
    await agent.heartbeat('Idle');
    const fired = labelsFired();
    for (const lbl of PRESENCE_LABELS) {
      assert.ok(fired.includes(lbl), `throttled flush must write ${lbl} (keeps every reader fresh)`);
    }
  });

  // (c) mode 'off' → presence upserts NEVER fire
  await test("c) mode 'off' → presence writes never fire", async () => {
    resetPgCalls();
    const clock = { t: 5_000_000 };
    const agent = makeAgent({ heartbeatMode: 'off', heartbeatDbWrites: false }, clock);
    await agent.heartbeat('Idle');
    clock.t += 10_000_000; // huge advance
    await agent.heartbeat('Idle');
    for (const lbl of PRESENCE_LABELS) {
      assert.ok(!labelsFired().includes(lbl), `presence write ${lbl} must NEVER fire in 'off'`);
    }
    assert.equal(presenceWriteCount(), 0, "'off' writes no presence at all");
  });

  // (d) durable config-on-change writes in EVERY mode, only on change
  await test('d) durable config-on-change always writes (all modes), only on change', async () => {
    for (const mode of ['full', 'throttled', 'off']) {
      resetPgCalls();
      const agent = makeAgent({
        heartbeatMode: mode,
        heartbeatDbWrites: mode !== 'off',
        systemPrompt: 'prompt A',
        directiveSource: 'sean'
      });

      await agent.heartbeat('Idle');
      let configWrites = labelsFired().filter(l => l === CONFIG_LABEL).length;
      assert.equal(configWrites, 1, `[${mode}] first heartbeat with durable config → one config write`);

      // Unchanged → no new config write (even as presence throttles/fires independently).
      await agent.heartbeat('Idle');
      configWrites = labelsFired().filter(l => l === CONFIG_LABEL).length;
      assert.equal(configWrites, 1, `[${mode}] unchanged durable config → no second config write`);

      // Change a durable field → new config write, regardless of presence mode.
      agent.systemPrompt = 'prompt B';
      await agent.heartbeat('Idle');
      configWrites = labelsFired().filter(l => l === CONFIG_LABEL).length;
      assert.equal(configWrites, 2, `[${mode}] changed durable config → a new config write`);
    }
  });

  // (e) resolveHeartbeatMode legacy mapping + precedence
  await test('e) resolveHeartbeatMode maps legacy flag and honors explicit mode', async () => {
    const resolve = ConstitutionalAgentV4.resolveHeartbeatMode;
    assert.equal(typeof resolve, 'function', 'resolveHeartbeatMode must be exported');
    // Legacy-only mapping.
    assert.equal(resolve(undefined, undefined), 'full', 'nothing set → full (today default)');
    assert.equal(resolve(undefined, 'on'), 'full', 'HEARTBEAT_DB_WRITES=on → full');
    assert.equal(resolve(undefined, 'off'), 'off', 'HEARTBEAT_DB_WRITES=off → off');
    // Explicit mode wins over legacy.
    assert.equal(resolve('throttled', 'off'), 'throttled', 'explicit HEARTBEAT_MODE wins over legacy');
    assert.equal(resolve('FULL', 'off'), 'full', 'mode is case-insensitive');
    assert.equal(resolve('off', 'on'), 'off', 'explicit off wins over legacy on');
    // Unrecognized mode falls back to legacy mapping.
    assert.equal(resolve('bogus', 'off'), 'off', 'unknown mode → legacy fallback (off)');
    assert.equal(resolve('bogus', undefined), 'full', 'unknown mode + no legacy → full');
  });

  // (f) healthPayload() shape (unchanged enrichment)
  await test('f) healthPayload() exposes in-memory liveness shape', async () => {
    const agent = makeAgent({ loopCount: 42, currentTaskId: 'task-7' });
    const p = agent.healthPayload();
    assert.equal(p.alive, true, 'alive must be true');
    assert.equal(p.status, 'healthy');
    assert.equal(p.agent, 'trinity-mel');
    assert.equal(p.loopCount, 42);
    assert.equal(p.currentTaskId, 'task-7');
    assert.equal(typeof p.lastIterationAt, 'string');
    assert.equal(typeof p.uptimeSec, 'number');
    assert.ok(p.uptimeSec >= 0, 'uptimeSec must be non-negative');
    assert.equal(p.codeVersion, 'deadbeef');
    assert.ok('version' in p && 'timestamp' in p);
    // Pure read: healthPayload must not touch the DB.
    resetPgCalls();
    agent.healthPayload();
    assert.equal(pgCalls.length, 0, 'healthPayload must perform no DB writes');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
