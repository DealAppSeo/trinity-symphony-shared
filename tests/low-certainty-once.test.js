'use strict';
/**
 * ONE ESCALATION PER TASK. Task 438797 (2026-11-18, trinity-gcm): the agent answered, scored its own certainty
 * 31-33, escalated to 'pending_clarification' (a claimable status), claimed the same row again, and repeated
 * until the durable claim cap stopped it at 12. Twelve model calls, no finished answer.
 * Now: the first low-certainty answer escalates as before; a task already claimed once keeps its answer and
 * finishes as not_checked.
 * The REAL processTask runs here; the model, the certainty score and the database are stand-ins.
 * Run: node tests/low-certainty-once.test.js
 */
const assert = require('node:assert/strict');
const A = require('../lib/ConstitutionalAgentV4');
const ORIG = { log: console.log, warn: console.warn, error: console.error, env: { ...process.env } };

const ANSWER = 'A plain answer that is long enough to be saved as an artifact and says nothing about asking anyone for anything.';

function fakeDb() {
  const updates = [];
  let next = 900;
  const supabase = {
    from: (table) => ({
      update: (row) => { let id; const chain = { eq: (c, v) => { if (c === 'id') { id = v; updates.push({ table, id, row }); } return chain; }, select: async () => ({ data: [{ id }], error: null }), then: (r) => r({ data: null, error: null }) }; return chain; },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: next++ }, error: null }) }) }),
    }),
  };
  return { supabase, updates };
}

function agent({ score, output = ANSWER }) {
  const db = fakeDb();
  let llmCalls = 0;
  const a = Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    claimHistory: new Map(),
    sessionMetrics: { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0 },
    wisdom: { squad: 'ALPHA', primaryVirtue: 'truth' },
    supabase: db.supabase,
  });
  Object.assign(a, {
    claimTask: async () => true,
    log: async () => {},
    trackProviderPerformance: async () => {},
    spawnNextStep: async () => {},
    updateReputation: async () => {},
    insertHitlRequest: async () => {},
    evaluateResult: async () => ({ score }),
    validateSubstance: async () => ({ ok: true }),
    _postSubstanceGateEvent: async () => ({ recorded: true, gateEventId: 'gate-1', fastResult: null }),
    callLLM: async () => { llmCalls++; return { output, provider: 'cerebras', model: 'gpt-oss-120b' }; },
  });
  return { a, db, calls: () => llmCalls };
}

const task = (id, claim_count) => ({ id, title: 'roll call', description: 'Answer in one line.', task_type: 'analysis', metadata: { keep: 'me' }, claim_count });
const lastStatus = (db, id) => db.updates.filter((u) => u.table === 'trinity_tasks' && u.id === id && u.row.status).map((u) => u.row).at(-1);

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env };
    delete process.env.HAL_SUBSTANCE_GATE_ENABLED;
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; }
  };

  await test('first claim, low certainty: escalates as before (released, pending_clarification)', async () => {
    const { a, db } = agent({ score: 31 });
    await a.processTask(task(1, 1));
    const w = lastStatus(db, 1);
    assert.equal(w.status, 'pending_clarification');
    assert.equal(w.claimed_by, null);
    assert.match(w.result, /^\[ESCALATED\]/);
  });

  await test('second claim, low certainty: keeps the answer and finishes not_checked, no second escalation', async () => {
    const { a, db } = agent({ score: 31 });
    await a.processTask(task(2, 2));
    const w = lastStatus(db, 2);
    assert.equal(w.status, 'not_checked');
    assert.equal(w.result, ANSWER, 'the answer itself is kept, not an escalation notice');
    assert.ok(w.completed_at, 'it is finished, so nothing claims it again');
    assert.deepEqual(w.metadata.low_certainty, { reason: 'low_belief', score: 31, claim_count: 2 });
    assert.equal(w.metadata.keep, 'me', 'existing metadata survives');
    assert.equal(w.metadata.model_used, 'gpt-oss-120b');
    assert.ok(!db.updates.some((u) => u.id === 2 && u.row.status === 'pending_clarification'));
  });

  await test('second claim, an answer that says "escalate": also finishes not_checked', async () => {
    const { a, db } = agent({ score: 90, output: `${ANSWER} I would escalate this to a human.` });
    await a.processTask(task(3, 5));
    const w = lastStatus(db, 3);
    assert.equal(w.status, 'not_checked');
    assert.equal(w.metadata.low_certainty.reason, 'explicit');
  });

  await test('control: second claim with normal certainty is NOT marked not_checked', async () => {
    const { a, db } = agent({ score: 90 });
    await a.processTask(task(4, 2)).catch(() => {}); // later steps need more of the runtime than this stand-in has
    assert.ok(!db.updates.some((u) => u.id === 4 && (u.row.status === 'not_checked' || u.row.status === 'pending_clarification')));
  });

  await test('the 438797 loop: the same row offered again and again costs two model calls, not twelve', async () => {
    const { a, db, calls } = agent({ score: 31 });
    for (let claim = 1; claim <= 12; claim++) {
      const last = lastStatus(db, 5);
      if (last && last.completed_at) break; // a finished row is not claimable
      await a.processTask(task(5, claim));
    }
    assert.equal(calls(), 2);
    assert.equal(lastStatus(db, 5).status, 'not_checked');
  });

  ORIG.log(`low-certainty-once.test.js: ${passed}/5 passed`);
}

run().catch((e) => { console.log = ORIG.log; ORIG.log(e); process.exit(1); });
