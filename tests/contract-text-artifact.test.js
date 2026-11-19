'use strict';
/**
 * CONTRACT PATH: a substantive text reply is its own artifact.
 * Tasks 438774 and 438811 (2026-11-19, trinity-mel, the one agent on the contract path): the prompt asked for
 * "ONE JSON object and nothing else", the model replied exactly that without calling save_artifact, and the task
 * ended "[CONFUSED] artifact_missing". The other eleven agents, on the legacy path, were not failed for the
 * same reply. Now the contract path saves a substantive text reply as the artifact, as the legacy path does.
 * An empty or trivial reply still fails artifact_missing.
 * The REAL processTaskContract and saveArtifact run here; the model and the database are stand-ins.
 * Run: node tests/contract-text-artifact.test.js
 */
const assert = require('node:assert/strict');
const A = require('../lib/ConstitutionalAgentV4');
const ORIG = { log: console.log, warn: console.warn, error: console.error, env: { ...process.env } };

// The shape of the reply that failed, from the roll-call prompt.
const REPLY = '{"agent":"trinity-mel","present":true,"model":"unknown","can_post_to_github_yourself":"no","tools_you_can_call":["save_artifact"],"note":"Read-only check."}';

// The same stand-in database as tests/declared-not-checked.test.js.
function fakeDb() {
  const updates = [];
  const artifacts = new Map();
  const inserts = [];
  let next = 900;
  const supabase = {
    from: (table) => ({
      update: (row) => { let id; const chain = { eq: (c, v) => { if (c === 'id') { id = v; updates.push({ table, id, row }); } return chain; }, select: async () => ({ data: [{ id }], error: null }), then: (r) => r({ data: null, error: null }) }; return chain; },
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: artifacts.get(id) || null, error: null }) }) }),
      insert: (row) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => { const id = next++; if (table === 'trinity_artifacts') artifacts.set(id, { id, task_id: row.task_id, content: row.content }); return { data: { id }, error: null }; } }) };
      },
    }),
  };
  return { supabase, updates, inserts };
}

function agent(output, { callsTool = false } = {}) {
  const db = fakeDb();
  const confused = [];
  const a = Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    claimHistory: new Map(),
    sessionMetrics: { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0 },
    wisdom: { squad: 'ALPHA', primaryVirtue: 'truth' },
    supabase: db.supabase,
  });
  const realConfused = a.recordConfused;
  Object.assign(a, {
    claimTask: async () => true,
    log: async () => {},
    trackProviderPerformance: async () => {},
    spawnNextStep: async () => {},
    updateReputation: async () => {},
    insertHitlRequest: async () => {},
    _postSubstanceGateEvent: async () => ({ recorded: true, gateEventId: 'gate-1', fastResult: null }),
    recordConfused: async function (task, reason, ctx) { confused.push(reason); return realConfused.call(this, task, reason, ctx); },
    callLLM: async () => {
      if (callsTool) await a.saveArtifact(a.currentTaskId, output, 'document', 'answer');
      return { output, provider: 'cerebras', model: 'gpt-oss-120b' };
    },
  });
  return { a, db, confused };
}

const task = (id) => ({ id, title: '[ROLLCALL] read-only check', description: 'Reply with ONE JSON object and nothing else.', success_criteria: 'One short reply in the format the description gives.', task_type: 'analysis', metadata: {} });
const artifactsFor = (db, id) => db.inserts.filter((i) => i.table === 'trinity_artifacts' && String(i.row.task_id) === String(id));
const go = async (a, t) => { a._beginTask(t); await a.processTaskContract(t); };

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env };
    delete process.env.HAL_SUBSTANCE_GATE_ENABLED;
    delete process.env.SUBSTANCE_GATE_NOT_CHECKED;
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; }
  };

  await test('a text reply with no tool call is saved as the task\'s artifact and is not artifact_missing', async () => {
    const { a, db, confused } = agent(REPLY);
    await go(a, task(1));
    assert.ok(!confused.includes('artifact_missing'), `confused: ${confused.join(',')}`);
    const saved = artifactsFor(db, 1);
    assert.equal(saved.length, 1, 'exactly one artifact, for this task');
    assert.equal(saved[0].row.content, REPLY, 'the artifact is the reply itself');
    assert.ok(!db.updates.some((u) => u.id === 1 && /artifact_missing/.test(String(u.row.result))));
  });

  await test('only a substantive text reply is saved: the runtime minimum decides, and nothing is saved twice', async () => {
    const MIN = A.MIN_ARTIFACT_CHARS;
    // Exactly at the minimum: saved (this line fails without the change).
    const edge = agent('x'.repeat(MIN));
    await go(edge.a, task(2));
    assert.ok(!edge.confused.includes('artifact_missing'), 'a reply at the minimum length is saved');
    assert.equal(artifactsFor(edge.db, 2).length, 1);
    // One character under: still artifact_missing, nothing saved.
    const under = agent('x'.repeat(MIN - 1));
    await go(under.a, task(3));
    assert.deepEqual(under.confused, ['artifact_missing']);
    assert.equal(artifactsFor(under.db, 3).length, 0);
    // Empty: still artifact_missing.
    const empty = agent('');
    await go(empty.a, task(4));
    assert.deepEqual(empty.confused, ['artifact_missing']);
    // The model called the tool itself: one artifact, not two.
    const tool = agent(REPLY, { callsTool: true });
    await go(tool.a, task(5));
    assert.equal(artifactsFor(tool.db, 5).length, 1);
  });

  ORIG.log(`contract-text-artifact.test.js: ${passed}/2 passed`);
}

run().catch((e) => { console.log = ORIG.log; ORIG.log(e); process.exit(1); });
