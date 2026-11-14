'use strict';
/**
 * DECLARED NOT_CHECKED — an answer that says it could not check, with a reason and no number, is not a
 * substance failure. Task 438321 (2026-11-14) answered exactly that and was labelled shadow_reject
 * ("success_criteria_unmet: 22%"). SUBSTANCE_GATE_NOT_CHECKED: off = old behaviour, shadow = old status plus a
 * metadata tag, on = status not_checked, no gate event (nothing to slash), no HITL request.
 * Run: node tests/declared-not-checked.test.js
 */
const assert = require('node:assert/strict');
const { declaredNotChecked, notCheckedMode } = require('../lib/declared-not-checked');
const A = require('../lib/ConstitutionalAgentV4');
const ORIG = { log: console.log, warn: console.warn, error: console.error, env: { ...process.env } };

// Task 438321's answer, verbatim from trinity_tasks.result (trinity-hdm, groq openai/gpt-oss-20b).
const REFUSAL_438321 = '{"can_query": false, "delivery_check_rows": null, "newest_delivery_check_at": null, "service_fulfilled_total": null, "sql": null, "queried_at": "2026-11-14T12:00:00Z", "reason": "No database access available in this environment."}';
const CRITERIA_438321 = 'The numbers match an independent re-run of the same SELECT at the reported queried_at, and sql is a SELECT that produces them; or can_query=false with a reason. Graded deterministically by Claude; the known answer is withheld.';

// The same stand-in database as tests/known-answer-paths.test.js, so the contract path can save its artifact.
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

// The contract path requires a saved artifact before the substance gate runs (otherwise it is
// "[CONFUSED] artifact_missing", a different path), so the answer is saved first, as a real agent would.
function agent(output, { saves = false } = {}) {
  const db = fakeDb();
  const gateEvents = [];
  const hitl = [];
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
    insertHitlRequest: async (...args) => { hitl.push(args); },
    _postSubstanceGateEvent: async (task, out, gate) => { gateEvents.push(gate); return { recorded: true, gateEventId: 'gate-1', fastResult: null }; },
    callLLM: async () => {
      if (saves) await a.saveArtifact(a.currentTaskId, output, 'document', 'answer');
      return { output, provider: 'groq', model: 'openai/gpt-oss-20b' };
    },
  });
  return { a, db, gateEvents, hitl };
}

const task = (id) => ({ id, title: 'T12 SHADOW COUNT (read-only)', description: 'Count the rows ... Answer as JSON only.', success_criteria: CRITERIA_438321, task_type: 'audit', metadata: {} });
const lastStatus = (db, id) => db.updates.filter((u) => u.table === 'trinity_tasks' && u.id === id && u.row.status).map((u) => u.row).at(-1);

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env };
    delete process.env.HAL_SUBSTANCE_GATE_ENABLED; // shadow gate, as in prod
    delete process.env.SUBSTANCE_GATE_NOT_CHECKED;
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; }
  };

  // ── the rule, read from structure only ──
  await test('438321\'s answer is a declared NOT_CHECKED, with its reason', async () => {
    assert.deepEqual(declaredNotChecked(REFUSAL_438321), { reason: 'No database access available in this environment.' });
  });
  await test('other declarations count: not_checked true, verdict/status/decision NOT_CHECKED, a ```json fence', async () => {
    assert.ok(declaredNotChecked('{"not_checked": true, "reason": "the API needs a key I do not have"}'));
    assert.ok(declaredNotChecked('{"verdict": "not checked", "reason": "no network access here"}'));
    assert.ok(declaredNotChecked('{"status": "NOT_CHECKED", "reason": "the file was not readable"}'));
    assert.ok(declaredNotChecked('{"decision": "Not_Checked", "reason": "outside my tools entirely"}'));
    assert.ok(declaredNotChecked('```json\n{"can_read": false, "reason": "no file system access"}\n```'));
  });
  await test('controls: a count beside the refusal, no reason, a short reason, prose, an array, can_* true, bad JSON, non-string', async () => {
    assert.equal(declaredNotChecked('{"can_query": false, "delivery_check_rows": 5, "reason": "No database access available."}'), null);
    assert.equal(declaredNotChecked('{"can_query": false, "nested": {"n": 0}, "reason": "No database access available."}'), null);
    assert.equal(declaredNotChecked('{"can_query": false, "delivery_check_rows": "5", "reason": "No database access available."}'), null);
    assert.equal(declaredNotChecked('{"can_query": false, "service_fulfilled_total": "1,487", "reason": "No database access available."}'), null);
    // ...while an ISO time, which is text, does not count as a number (438321's own queried_at).
    assert.ok(declaredNotChecked('{"can_query": false, "queried_at": "2026-11-14T02:29:00Z", "reason": "No database access available."}'));
    assert.equal(declaredNotChecked('{"can_query": false}'), null);
    assert.equal(declaredNotChecked('{"can_query": false, "reason": "no db"}'), null);
    assert.equal(declaredNotChecked('I could not check this because I have no database access.'), null);
    assert.equal(declaredNotChecked('[{"can_query": false, "reason": "No database access available."}]'), null);
    assert.equal(declaredNotChecked('{"can_query": true, "reason": "I queried it and here is the answer"}'), null);
    assert.equal(declaredNotChecked('{"can_query": false, "reason": "No database access'), null);
    assert.equal(declaredNotChecked(undefined), null);
  });
  await test('the mode: unset, true and junk are off; shadow and on (any case) are themselves', async () => {
    assert.equal(notCheckedMode({}), 'off');
    assert.equal(notCheckedMode({ SUBSTANCE_GATE_NOT_CHECKED: 'true' }), 'off');
    assert.equal(notCheckedMode({ SUBSTANCE_GATE_NOT_CHECKED: 'enforce' }), 'off');
    assert.equal(notCheckedMode({ SUBSTANCE_GATE_NOT_CHECKED: ' Shadow ' }), 'shadow');
    assert.equal(notCheckedMode({ SUBSTANCE_GATE_NOT_CHECKED: 'ON' }), 'on');
  });

  // ── both real paths, each mode ──
  for (const [path, go, saves] of [
    ['legacy', async (a, t) => a.processTask(t), false],
    ['contract', async (a, t) => { a._beginTask(t); await a.processTaskContract(t); }, true],
  ]) {
    await test(`${path}, off: the old behaviour exactly (shadow_reject, no tag, the gate judged it)`, async () => {
      const { a, db, gateEvents } = agent(REFUSAL_438321, { saves });
      await go(a, task(1));
      const w = lastStatus(db, 1);
      assert.equal(w.status, 'shadow_reject');
      assert.equal(w.metadata.declared_not_checked, undefined);
      assert.equal(gateEvents.length, 1);
      assert.equal(gateEvents[0].ok, false);
    });
    await test(`${path}, shadow: still shadow_reject, tagged declared_not_checked with the reason`, async () => {
      process.env.SUBSTANCE_GATE_NOT_CHECKED = 'shadow';
      const { a, db } = agent(REFUSAL_438321, { saves });
      await go(a, task(2));
      const w = lastStatus(db, 2);
      assert.equal(w.status, 'shadow_reject');
      assert.equal(w.metadata.declared_not_checked, 'No database access available in this environment.');
    });
    await test(`${path}, on: not_checked, no gate event (nothing to slash), no HITL request`, async () => {
      process.env.SUBSTANCE_GATE_NOT_CHECKED = 'on';
      const { a, db, gateEvents, hitl } = agent(REFUSAL_438321, { saves });
      await go(a, task(3));
      const w = lastStatus(db, 3);
      assert.equal(w.status, 'not_checked');
      assert.equal(w.metadata.substance_gate_outcome, 'declared_not_checked');
      assert.match(w.metadata.substance_gate_reasoning, /^declared_not_checked: No database access/);
      assert.equal(w.result, REFUSAL_438321);
      assert.equal(gateEvents.length, 0);
      assert.equal(hitl.length, 0);
    });
    await test(`${path}, on with the gate ENFORCED: still not_checked, not pending_clarification`, async () => {
      process.env.SUBSTANCE_GATE_NOT_CHECKED = 'on';
      process.env.HAL_SUBSTANCE_GATE_ENABLED = 'true';
      const { a, db, hitl } = agent(REFUSAL_438321, { saves });
      await go(a, task(4));
      assert.equal(lastStatus(db, 4).status, 'not_checked');
      assert.equal(hitl.length, 0);
    });
    await test(`${path}, on: a refusal that still reports a count is judged as before (shadow_reject)`, async () => {
      process.env.SUBSTANCE_GATE_NOT_CHECKED = 'on';
      const { a, db } = agent('{"can_query": false, "delivery_check_rows": 7, "service_fulfilled_total": 1500, "queried_at": "2026-11-14T02:29:00Z", "reason": "No database access available in this environment."}', { saves });
      await go(a, task(5));
      assert.equal(lastStatus(db, 5).status, 'shadow_reject');
    });
  }

  ORIG.log(`\ndeclared-not-checked: ${passed} passed${process.exitCode ? ', SOME FAILED' : ''}`);
}

run();
