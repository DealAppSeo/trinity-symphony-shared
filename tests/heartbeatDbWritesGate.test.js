// HEARTBEAT_DB_WRITES gate + enriched /health payload test for ConstitutionalAgentV4.
// Run: node tests/heartbeatDbWritesGate.test.js
//
// Verifies:
//  (a) flag ON  (default)  → per-iteration presence writes happen
//      (trinity_agent_registry + agent_heartbeat + trinity_heartbeat upserts) —
//      i.e. today's behavior is preserved exactly.
//  (b) flag OFF → those 3 presence upserts are SKIPPED, but durable
//      write-on-CHANGE registry config (persistRegistryConfig) still writes
//      when a durable field changed — regardless of the flag.
//  (c) persistRegistryConfig writes ONLY on change: a second heartbeat with the
//      same durable config issues no second config write; changing a value does.
//  (d) healthPayload() shape: alive:true + agent/loopCount/lastIterationAt/
//      currentTaskId/status/uptimeSec/codeVersion present.
//
// No jest in this repo (CI runs plain `node tests/*.test.js`). This mirrors the
// plain-Node style of tests/pulseCheckExecutor.test.js. We stub ./direct-pg in
// the require cache BEFORE requiring the agent so heartbeat()'s module-level
// pgQuery is intercepted, and we build the agent via Object.create to skip the
// real constructor.

'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

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

// Build an agent instance without running the real constructor.
function makeAgent(overrides = {}) {
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
  agent.heartbeatDbWrites = true; // default ON
  return Object.assign(agent, overrides);
}

const PRESENCE_LABELS = [
  'heartbeat:trinity_agent_registry',
  'heartbeat:agent_heartbeat',
  'heartbeat:trinity_heartbeat'
];
const CONFIG_LABEL = 'heartbeat:registry_config_on_change';

function labelsFired() { return pgCalls.map(c => c.label); }

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(`      ${err.stack || err.message}`); failed++; }
}

(async () => {
  // (a) flag ON → all 3 presence upserts fire (today's behavior)
  await test('a) HEARTBEAT_DB_WRITES on → presence writes happen', async () => {
    resetPgCalls();
    const agent = makeAgent({ heartbeatDbWrites: true });
    await agent.heartbeat('Idle');
    const fired = labelsFired();
    for (const lbl of PRESENCE_LABELS) {
      assert.ok(fired.includes(lbl), `expected presence write ${lbl} to fire when flag ON`);
    }
    // No durable config set → no config write.
    assert.ok(!fired.includes(CONFIG_LABEL), 'no durable config → no config write');
  });

  // (b) flag OFF → presence upserts skipped; durable config-on-change still writes
  await test('b) HEARTBEAT_DB_WRITES off → presence skipped, durable config still writes', async () => {
    resetPgCalls();
    const agent = makeAgent({
      heartbeatDbWrites: false,
      systemPrompt: 'You are MEL. v1',
      directiveSource: 'sean',
      dbtMetadata: { model: 'mel_core' }
    });
    await agent.heartbeat('Idle');
    const fired = labelsFired();
    for (const lbl of PRESENCE_LABELS) {
      assert.ok(!fired.includes(lbl), `presence write ${lbl} must be SKIPPED when flag OFF`);
    }
    assert.ok(fired.includes(CONFIG_LABEL), 'durable config-on-change must still write when a field changed');
  });

  // (c) config write-on-CHANGE: same config twice → one write; change → new write
  await test('c) persistRegistryConfig writes only on change', async () => {
    resetPgCalls();
    const agent = makeAgent({
      heartbeatDbWrites: false,
      systemPrompt: 'prompt A',
      directiveSource: 'sean'
    });

    await agent.heartbeat('Idle');
    let configWrites = labelsFired().filter(l => l === CONFIG_LABEL).length;
    assert.equal(configWrites, 1, 'first heartbeat with durable config → exactly one config write');

    // Second heartbeat, no change → no additional config write.
    await agent.heartbeat('Idle');
    configWrites = labelsFired().filter(l => l === CONFIG_LABEL).length;
    assert.equal(configWrites, 1, 'unchanged durable config → no second config write');

    // Change a durable field → a new config write fires.
    agent.systemPrompt = 'prompt B';
    await agent.heartbeat('Idle');
    configWrites = labelsFired().filter(l => l === CONFIG_LABEL).length;
    assert.equal(configWrites, 2, 'changed durable config → a new config write');
  });

  // (c2) flag ON also persists durable config-on-change (independent of flag)
  await test('c2) durable config-on-change fires with flag ON too', async () => {
    resetPgCalls();
    const agent = makeAgent({ heartbeatDbWrites: true, repidProof: '0xproof' });
    await agent.heartbeat('Idle');
    const fired = labelsFired();
    assert.ok(fired.includes(CONFIG_LABEL), 'durable config-on-change must fire regardless of flag');
    // and presence writes still happen when flag ON
    for (const lbl of PRESENCE_LABELS) {
      assert.ok(fired.includes(lbl), `presence write ${lbl} should still fire when flag ON`);
    }
  });

  // (d) healthPayload() shape
  await test('d) healthPayload() exposes in-memory liveness shape', async () => {
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
