'use strict';
/**
 * KNOWN-ANSWER REPLIES THROUGH THE REAL TASK PATHS (behaviour, not source pins).
 *
 * Live, 2026-11-01: after #98 a valid one-line JSON reply passed the substance gate and then hit
 * evaluateResult (length/'#'/'Virtue' heuristic, scores it 30 < 40). The legacy path escalated
 * every reply (claim released, pending_clarification, "Question for Architect"), so the next agent
 * answered again: task 435592 got six answers. The contract path would mark it low_confidence_score.
 * mel's model also put its JSON in save_artifact and returned an empty message.
 *
 * Here the REAL evaluateResult, validateSubstance, artifact guard (hardened), _enforceArtifact and
 * saveArtifact run against a fake DB; only the LLM, the gate's HTTP post and side effects are stubbed.
 * Run: node tests/known-answer-paths.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const A = require('../lib/ConstitutionalAgentV4');
const ORIG = { log: console.log, warn: console.warn, error: console.error, env: { ...process.env } };

function fakeDb() {
  const updates = [];
  const artifacts = new Map();
  const inserts = [];
  let next = 900;
  const supabase = {
    from: (table) => ({
      update: (row) => { let id; const chain = { eq: (c, v) => { if (c === 'id') { id = v; updates.push({ table, id, row }); } return chain; }, select: async () => ({ data: [{ id }], error: null }), then: (ok) => ok({ error: null }) }; return chain; },
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: artifacts.get(id) || null, error: null }) }) }),
      insert: (row) => {
        inserts.push({ table, row });
        return {
          select: () => ({
            single: async () => {
              const id = next++;
              if (table === 'trinity_artifacts') artifacts.set(id, { id, task_id: row.task_id, content: row.content });
              return { data: { id }, error: null };
            },
          }),
        };
      },
    }),
  };
  return { supabase, updates, artifacts, inserts };
}

/** An agent whose LLM returns `output` and, when `saves` is set, first calls save_artifact with it. */
function agent({ output, saves }) {
  const db = fakeDb();
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
    // recorded like prod, so a failing gate ends as shadow_reject (the gate runs in shadow mode)
    _postSubstanceGateEvent: async () => ({ recorded: true, gateEventId: 'gate-1', fastResult: null }),
    callLLM: async (prompt, opts) => {
      llmCalls.push({ prompt, opts });
      if (saves) await a.saveArtifact(a.currentTaskId, saves, 'document', 'answer');
      return { output, provider: 'groq', model: 'openai/gpt-oss-20b' };
    },
  });
  const llmCalls = [];
  return { a, db, llmCalls };
}

const KA_META = { case_pool: 'hal_open_v1', case_id: '0005a4f5-0b25-4d30-8eca-2ef60cf88015', ab_arm: 'B' };
const kaTask = (id) => ({ id, title: 'T12 KNOWN ANSWER: is this statement accurate?', description: 'Decide ... Statement: ...', success_criteria: 'One line of JSON with decision pass, veto or abstain, a confidence from 0 to 1, and a one-sentence reason.', task_type: 'analysis', metadata: { ...KA_META } });
const plainTask = (id) => ({ id, title: 'Analyse X', description: 'Write an analysis of X', success_criteria: '', task_type: 'analysis', metadata: {} });
const REPLY = '{"decision":"pass","confidence":0.99,"reason":"The statement is an opinion and does not contain a factual error."}';

const statusWrites = (db, id) => db.updates.filter((u) => u.table === 'trinity_tasks' && u.id === id && u.row.status).map((u) => u.row);
const last = (db, id) => statusWrites(db, id).at(-1);
const questionArtifacts = (db) => [...db.artifacts.values()].filter((r) => String(r.content).startsWith('# Question for Architect'));

async function legacy(opts, task) { const { a, db } = agent(opts); await a.processTask(task); return db; }
async function contract(opts, task) { const { a, db } = agent(opts); a._beginTask(task); await a.processTaskContract(task); return db; }

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env, ARTIFACT_GUARD_HARDENED: 'true' }; // the strictest guard setting
    delete process.env.HAL_SUBSTANCE_GATE_ENABLED;                   // shadow mode, as in prod
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; }
  };

  // ── legacy path (11 of 12 agents) ──
  await test('legacy: a valid reply is answered once — done, not escalated, claim not released', async () => {
    const db = await legacy({ output: REPLY }, kaTask(1));
    const w = last(db, 1);
    assert.equal(w.status, 'done');
    assert.equal(w.result, REPLY);
    assert.ok(!statusWrites(db, 1).some((r) => r.status === 'pending_clarification'), 'never released for re-answering');
    assert.equal(questionArtifacts(db).length, 0, 'no "Question for Architect"');
  });

  await test('legacy: model and provider are recorded on the answered task', async () => {
    const db = await legacy({ output: REPLY }, kaTask(2));
    assert.equal(last(db, 2).metadata.model_used, 'openai/gpt-oss-20b');
    assert.equal(last(db, 2).metadata.provider_used, 'groq');
  });

  await test('legacy: JSON only in save_artifact + empty message → the saved reply is the answer', async () => {
    const db = await legacy({ output: '', saves: REPLY }, kaTask(3));
    assert.equal(last(db, 3).status, 'done');
    assert.equal(last(db, 3).result, REPLY);
  });

  await test('legacy: a reply in the wrong shape is recorded as answer_format_invalid (shadow_reject)', async () => {
    const db = await legacy({ output: 'I think it is true.' }, kaTask(4));
    assert.equal(last(db, 4).status, 'shadow_reject');
    assert.equal(last(db, 4).metadata.substance_gate_reasoning, 'answer_format_invalid: no_json');
    assert.equal(last(db, 4).result, 'I think it is true.', 'the raw reply is kept for diagnosis');
  });

  await test('legacy, control: an ordinary task with the same short output is unchanged (gate rejects it)', async () => {
    const db = await legacy({ output: REPLY }, plainTask(5));
    assert.equal(last(db, 5).status, 'shadow_reject');
    assert.match(last(db, 5).metadata.substance_gate_reasoning, /^output_too_short/);
  });

  await test('legacy, control: an ordinary task that passes the gate but scores low still escalates', async () => {
    const long = 'A plain paragraph without headings that runs long enough to pass the length rule. '.repeat(3);
    const db = await legacy({ output: long }, plainTask(6));
    assert.ok(statusWrites(db, 6).some((r) => r.status === 'pending_clarification'), 'low belief escalation still applies to other tasks');
    assert.equal(questionArtifacts(db).length, 1);
  });

  // ── contract path (mel, ESCALATION_CONTRACT=true) ──
  await test('contract: a valid reply with no save_artifact is saved as the artifact and done', async () => {
    const db = await contract({ output: REPLY }, kaTask(11));
    const w = last(db, 11);
    assert.equal(w.status, 'done');
    assert.equal(w.result, REPLY);
    assert.match(w.artifact_url, /^db:\/\/trinity_artifacts\/\d+$/);
    assert.equal(w.metadata.model_used, 'openai/gpt-oss-20b');
  });

  await test('contract: JSON only in save_artifact + empty message (mel, 435592) → done with that reply', async () => {
    const db = await contract({ output: '', saves: REPLY }, kaTask(12));
    assert.equal(last(db, 12).status, 'done');
    assert.equal(last(db, 12).result, REPLY);
  });

  await test('contract, control: an ordinary short reply with an artifact is still confused (low score)', async () => {
    // 220 chars: passes the gate's 200 floor, scores floor(220/500*40 + 10 + 10) = 37 < 40
    const db = await contract({ output: 'x'.repeat(220), saves: 'y'.repeat(220) }, plainTask(13));
    assert.equal(last(db, 13).status, 'failed');
    assert.match(last(db, 13).result, /CONFUSED/);
  });

  // ── what each path sends to the model (window 2: groq 400 tool_use_failed, a call to a tool "json") ──
  const cp = require('../lib/case-pool');
  for (const [pathName, runPath] of [['legacy', async (a, t) => a.processTask(t)], ['contract', async (a, t) => { a._beginTask(t); await a.processTaskContract(t); }]]) {
    await test(`${pathName}: a known-answer task is sent with no tools and told its reply is saved`, async () => {
      const { a, llmCalls } = agent({ output: REPLY });
      await runPath(a, kaTask(21));
      assert.deepEqual(llmCalls[0].opts, { tools: false });
      assert.ok(llmCalls[0].prompt.includes(cp.REPLY_RULE));
      assert.ok(!llmCalls[0].prompt.includes('save_artifact'), 'no instruction to call a tool it does not have');
    });
    await test(`${pathName}, control: an ordinary task keeps its tools and its save_artifact instruction`, async () => {
      const { a, llmCalls } = agent({ output: 'x'.repeat(600) });
      await runPath(a, plainTask(22));
      assert.deepEqual(llmCalls[0].opts, {});
      assert.ok(llmCalls[0].prompt.includes("'save_artifact'"));
      assert.ok(!llmCalls[0].prompt.includes(cp.REPLY_RULE));
    });
  }

  ORIG.log(`known-answer-paths.test.js: ${passed}/13 passed`);
}

run().catch((e) => { console.log = ORIG.log; ORIG.log(e); process.exit(1); });
