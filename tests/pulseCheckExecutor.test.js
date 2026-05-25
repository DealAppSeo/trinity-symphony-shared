// Deterministic infra pulse-check executor test for ConstitutionalAgentV4.
// Run: node tests/pulseCheckExecutor.test.js
//
// Verifies:
//  (a) each of the 5 named 'review' pulse-checks produces a saved artifact +
//      status='done' (against a mock supabase), and returns a truthy result.
//  (b) a normal 'review' task with a NON-pulse title returns null (executor
//      defers → existing LLM path runs unchanged).
//  (c) a pulse title with the WRONG task_type returns null (exact-match guard).
//  (d) executor errors fall through (return null), never throw.
//
// No jest in this repo (package.json has no test deps + escalation test is the
// only jest file and is not runnable here). This mirrors the plain-Node style
// of tests/getNextTask.test.js.

'use strict';

const assert = require('node:assert/strict');

// Minimal env so any incidental createClient()/Redis paths in the module don't
// crash at require time. We never call the real constructor (Object.create).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-token';

const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

// --- Chainable supabase mock --------------------------------------------------
// Records every (table, op) and resolves reads from `seed[table]`, inserts into
// trinity_artifacts return a fake id, updates are recorded for assertions.
function makeMockSupabase(seed = {}, opts = {}) {
  const calls = { updates: [], inserts: [], reads: [] };
  let artifactSeq = 1000;

  function builderFor(table) {
    const state = { table, filters: [], lastOp: null, payload: null };
    const builder = {
      // reads
      select(_cols) { state.lastOp = 'select'; return builder; },
      eq(c, v) { state.filters.push([c, v]); return builder; },
      gte() { return builder; },
      lte() { return builder; },
      like() { return builder; },
      in() { return builder; },
      is() { return builder; },
      not() { return builder; },
      order() { return builder; },
      limit() { return resolveRead(); },
      single() { return resolveSingle(); },
      maybeSingle() { return resolveSingle(); },
      // writes
      insert(payload) {
        state.lastOp = 'insert';
        state.payload = payload;
        calls.inserts.push({ table, payload });
        // insert(...).select('id').single() chain for saveArtifact
        return {
          select() {
            return {
              single() {
                if (table === 'trinity_artifacts') {
                  if (opts.failArtifactInsert) {
                    return Promise.resolve({ data: null, error: { message: 'boom', code: 'XX000' } });
                  }
                  return Promise.resolve({ data: { id: ++artifactSeq }, error: null });
                }
                return Promise.resolve({ data: { id: ++artifactSeq }, error: null });
              }
            };
          },
          // bare insert (no .select) — resolve as a thenable
          then(res) { res({ data: null, error: null }); }
        };
      },
      update(payload) {
        state.lastOp = 'update';
        state.payload = payload;
        return {
          eq(c, v) {
            calls.updates.push({ table, payload, where: [c, v] });
            return Promise.resolve({ data: null, error: null });
          }
        };
      }
    };

    function resolveRead() {
      calls.reads.push({ table, filters: state.filters.slice() });
      const tableSeed = seed[table];
      if (tableSeed && tableSeed.__error) {
        return Promise.resolve({ data: null, error: tableSeed.__error });
      }
      let rows = Array.isArray(tableSeed) ? tableSeed.slice() : [];
      // apply simple eq filters (e.g. status='pending')
      for (const [c, v] of state.filters) rows = rows.filter(r => r[c] === v);
      return Promise.resolve({ data: rows, error: null });
    }
    function resolveSingle() {
      calls.reads.push({ table, filters: state.filters.slice(), single: true });
      const tableSeed = seed[table];
      if (tableSeed && tableSeed.__error) {
        return Promise.resolve({ data: null, error: tableSeed.__error });
      }
      let rows = Array.isArray(tableSeed) ? tableSeed.slice() : [];
      for (const [c, v] of state.filters) rows = rows.filter(r => r[c] === v);
      return Promise.resolve({ data: rows[0] || null, error: null });
    }

    return builder;
  }

  return {
    __calls: calls,
    from(table) { return builderFor(table); }
  };
}

// Build an agent instance without running the real constructor.
function makeAgent(supabase) {
  const agent = Object.create(ConstitutionalAgentV4.prototype);
  agent.name = 'trinity-mel';
  agent.supabase = supabase;
  agent.phi = 1.61803398875;
  agent.reputationScore = 50;
  agent.sessionMetrics = { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0, startTime: Date.now() };
  agent.wisdom = { squad: 'BETA', tier: 'specialist', primaryVirtue: 'LOVELY' };
  agent.version = 'test';
  // Sentinel: if the LLM path is ever entered for a pulse task, this throws.
  agent.callLLM = async () => { throw new Error('LLM path should NOT run for a deterministic pulse-check'); };
  return agent;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(`      ${err.stack || err.message}`); failed++; }
}

(async () => {
  // Common seeds for read-backed pulse checks.
  const baseSeed = () => ({
    repid_score_events: [
      { agent_id: 'a1', delta: 5, created_at: new Date().toISOString() },
      { agent_id: 'a1', delta: 3, created_at: new Date().toISOString() },
      { agent_id: 'a2', delta: -2, created_at: new Date().toISOString() }
    ],
    trinity_kv_store: [
      { key: 'receipt_indexer_cursor:chain-84532:0xabc', value: { lastBlock: 100, lastIndexedAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
      { key: 'receipt_indexer_cursor:chain-177:0xdef', value: { lastBlock: 50, lastIndexedAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }, updated_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() }
    ],
    trinity_hitl_requests: [
      { id: 'h1', status: 'pending', requested_at: new Date().toISOString() },
      { id: 'h2', status: 'resolved', requested_at: new Date().toISOString() }
    ],
    hal_runner_results: [
      { ground_truth_is_hallucination: true, was_caught: true, hal_vetoed: true, false_positive: false, created_at: new Date().toISOString() },
      { ground_truth_is_hallucination: false, was_caught: false, hal_vetoed: false, false_positive: false, created_at: new Date().toISOString() },
      { ground_truth_is_hallucination: true, was_caught: false, hal_vetoed: false, false_positive: false, created_at: new Date().toISOString() }
    ],
    trinity_agent_registry: [{ agent_name: 'trinity-mel', reputation_score: 50, current_tier: 'specialist', tasks_completed: 0 }]
  });

  const PULSE_TITLES = [
    'REPID_SCORE_EVENTS_AUDIT',
    'RECEIPT_INDEXER_PULSE_CHECK',
    'ZKP_PROOF_SELF_TEST',
    'HAL_HITL_QUEUE_PULSE',
    'HAL_ACCURACY_SPOT_CHECK'
  ];

  // Stub global fetch for the ZKP probe so the test never hits the network.
  const realFetch = global.fetch;
  global.fetch = async () => ({ status: 200, ok: true, text: async () => '{"status":"ok"}' });

  // (a) every pulse-check title → artifact saved + status='done' + truthy result
  for (const title of PULSE_TITLES) {
    await test(`a) pulse-check ${title} → artifact + status=done`, async () => {
      const sb = makeMockSupabase(baseSeed());
      const agent = makeAgent(sb);
      const task = { id: 7, task_type: 'review', title, description: 'https://zkp-postcard-production.up.railway.app/prove/x desc', success_criteria: 'x' };

      const result = await agent.tryDeterministicPulseCheck(task);

      assert.ok(result && result.ok === true, 'expected truthy result with ok=true');
      assert.equal(result.pulse_check, title);

      // an artifact row was inserted
      const artifactInsert = sb.__calls.inserts.find(i => i.table === 'trinity_artifacts');
      assert.ok(artifactInsert, 'expected a trinity_artifacts insert');
      assert.ok(agent.lastArtifactId, 'expected this.lastArtifactId to be set');

      // the task was marked done
      const doneUpdate = sb.__calls.updates.find(u => u.table === 'trinity_tasks' && u.payload.status === 'done');
      assert.ok(doneUpdate, 'expected trinity_tasks update with status=done');
      assert.ok(doneUpdate.payload.artifact_url, 'expected artifact_url on the done update');
      assert.equal(doneUpdate.where[1], 7, 'update should target task id 7');

      assert.equal(agent.sessionMetrics.tasksCompleted, 1, 'tasksCompleted should increment');
    });
  }

  // (b) normal 'review' task with non-pulse title → returns null (LLM path runs)
  await test(`b) normal review (non-pulse title) → executor returns null`, async () => {
    const sb = makeMockSupabase(baseSeed());
    const agent = makeAgent(sb);
    const task = { id: 8, task_type: 'review', title: '[VERIFY] Some normal peer review', description: 'd', success_criteria: 'c' };
    const result = await agent.tryDeterministicPulseCheck(task);
    assert.equal(result, null, 'non-pulse review must return null');
    assert.equal(sb.__calls.inserts.length, 0, 'no artifact should be saved for a non-pulse task');
    assert.equal(sb.__calls.updates.length, 0, 'no task update should occur for a non-pulse task');
  });

  // (c) exact-match guard: pulse title but WRONG task_type → null
  await test(`c) pulse title with non-review task_type → returns null`, async () => {
    const sb = makeMockSupabase(baseSeed());
    const agent = makeAgent(sb);
    const task = { id: 9, task_type: 'code', title: 'REPID_SCORE_EVENTS_AUDIT', description: 'd', success_criteria: 'c' };
    const result = await agent.tryDeterministicPulseCheck(task);
    assert.equal(result, null, 'wrong task_type must return null even for a pulse title');
  });

  // (d) executor error → falls through (null), never throws
  await test(`d) read error → falls through to null (no throw)`, async () => {
    const seed = baseSeed();
    seed.repid_score_events = { __error: { message: 'simulated read failure', code: 'XX000' } };
    const sb = makeMockSupabase(seed);
    const agent = makeAgent(sb);
    const task = { id: 10, task_type: 'review', title: 'REPID_SCORE_EVENTS_AUDIT', description: 'd', success_criteria: 'c' };
    const result = await agent.tryDeterministicPulseCheck(task);
    assert.equal(result, null, 'executor error must return null (fall through), not throw');
  });

  // (e) missing trinity_kv_store table → still a successful pulse result (clear finding)
  await test(`e) RECEIPT_INDEXER with missing table → successful finding (not a fail)`, async () => {
    const seed = baseSeed();
    seed.trinity_kv_store = { __error: { message: 'relation "trinity_kv_store" does not exist', code: '42P01' } };
    const sb = makeMockSupabase(seed);
    const agent = makeAgent(sb);
    const task = { id: 11, task_type: 'review', title: 'RECEIPT_INDEXER_PULSE_CHECK', description: 'd', success_criteria: 'c' };
    const result = await agent.tryDeterministicPulseCheck(task);
    assert.ok(result && result.ok === true, 'missing-table case should still complete as a successful pulse');
    const doneUpdate = sb.__calls.updates.find(u => u.table === 'trinity_tasks' && u.payload.status === 'done');
    assert.ok(doneUpdate, 'expected status=done even when the table is absent');
  });

  global.fetch = realFetch;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
