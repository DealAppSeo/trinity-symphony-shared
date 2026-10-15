'use strict';

/**
 * Per-task state is reset on EVERY claim, and an artifact counts only for the task its ROW names
 * (CC1 2026-10-15; XC1 on #84).
 *
 * processTask (the legacy loop) set currentTaskId but never reset lastArtifactId. So after task A
 * saved an artifact, task B — whose LLM saved nothing — passed the artifact guard on A's artifact,
 * and _enforceArtifact wrote A's artifact as B's artifact_url with status 'done': a false "done".
 * And withTimeout is a Promise.race: a timed-out run keeps going, and could save into, or set
 * lastArtifactId for, the task that replaced it.
 *
 * Pins:
 *  1. Legacy path: A saves an artifact; B saves none → B is NOT done on A's artifact.
 *  2. Legacy path, control: B that DOES save gets its own artifact.
 *  3. lastArtifactId pointing at ANOTHER task's row (a stale run set it) → not counted, not done.
 *  4. saveArtifact refuses a save for a task that is not current, and does not credit a task that
 *     changed while the save was in flight.
 *  5. A conversation started for task A cannot save into task B when B became current mid-run.
 *  6. getNextTask's CLAIM_SQL — the statement that actually sets claimed_by — resets per-task state.
 *  7. One place sets per-task state; every claim path calls it; every done path checks ownership.
 *
 * Run: node tests/per-task-reset.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

let claimRows = []; // what CLAIM_SQL returns in this test
const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: {
    getPgPool: () => { throw new Error('no pg in this test'); },
    pgQuery: async (_sql, _params, opts) => (opts && opts.label === 'getNextTask(atomic-claim)' ? claimRows : []),
    pgPing: async () => ({ ok: true }),
    closePgPool: async () => {},
  },
});

const A = require('../lib/ConstitutionalAgentV4');
const freeTier = require('../lib/free-tier-gate');
const ORIG_LOG = console.log;
const ORIG_WARN = console.warn;
const ORIG_ERR = console.error;
const ORIG_ENV = { ...process.env };
const ORIG_FETCH = global.fetch;

/** A DB stub: task updates recorded; trinity_artifacts rows kept WITH their task_id. */
function fakeDb() {
  const updates = [];
  const artifacts = new Map();
  let next = 196835;
  let beforeInsertResolves = null; // test hook: runs while an insert is "in flight"
  const supabase = {
    from: (table) => ({
      update: (row) => ({ eq: async (_c, id) => { updates.push({ table, id, row }); return { error: null }; } }),
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: artifacts.get(id) || null, error: null }) }) }),
      insert: (row) => ({
        select: () => ({
          single: async () => {
            if (beforeInsertResolves) await beforeInsertResolves();
            const id = next++;
            artifacts.set(id, { id, task_id: row.task_id, content: row.content });
            return { data: { id }, error: null };
          },
        }),
      }),
    }),
  };
  return { supabase, updates, artifacts, onInsert: (fn) => { beforeInsertResolves = fn; } };
}

/** A legacy-loop agent with the REAL saveArtifact; its LLM saves or not per task id (or runs `llm`). */
function agent(savesFor, llm) {
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
    evaluateResult: async () => ({ score: 80 }),
    validateSubstance: async () => ({ ok: true }),
    _postSubstanceGateEvent: async () => ({ recorded: false }),
    _runArtifactGuardCheck: async () => ({ skipped: true }),
    spawnNextStep: async () => {},
    updateReputation: async () => {},
    callLLM: llm || (async () => {
      if (savesFor.has(a.currentTaskId)) await a.saveArtifact(a.currentTaskId, 'x'.repeat(2000), 'report', 'r');
      return { output: 'ok', provider: 'groq' };
    }),
  });
  return { a, db };
}

const task = (id) => ({ id, title: `task ${id}`, description: 'd', task_type: 'analysis', metadata: {} });
const finalWrite = (updates, id) => updates.filter((u) => u.table === 'trinity_tasks' && u.id === id && 'artifact_url' in u.row).at(-1).row;

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    claimRows = [];
    try {
      await fn();
      ORIG_LOG(`  ok ${name}`);
      passed++;
    } catch (e) {
      ORIG_LOG(`  FAIL ${name}: ${e.message}`);
      process.exitCode = 1;
    } finally {
      console.log = ORIG_LOG; console.warn = ORIG_WARN; console.error = ORIG_ERR;
      process.env = { ...ORIG_ENV };
      global.fetch = ORIG_FETCH;
    }
  };

  await test("legacy path: B saves no artifact → B is NOT done on A's artifact", async () => {
    const { a, db } = agent(new Set([1001]));
    await a.processTask(task(1001));
    assert.equal(finalWrite(db.updates, 1001).artifact_url, 'db://trinity_artifacts/196835', 'A has its own artifact');
    await a.processTask(task(1002));
    const b = finalWrite(db.updates, 1002);
    assert.notEqual(b.artifact_url, 'db://trinity_artifacts/196835', "B must not carry A's artifact");
    assert.equal(b.status, 'needs_artifact', 'a deliverable with no artifact is not done');
  });

  await test('legacy path, control: B that saves gets its OWN artifact', async () => {
    const { a, db } = agent(new Set([1001, 1002]));
    await a.processTask(task(1001));
    await a.processTask(task(1002));
    assert.equal(finalWrite(db.updates, 1002).artifact_url, 'db://trinity_artifacts/196836');
    assert.equal(finalWrite(db.updates, 1002).status, 'done');
  });

  await test("lastArtifactId naming ANOTHER task's row (a stale run set it) is not counted: not done", async () => {
    const { a, db } = agent(new Set(), async () => {
      // A run for task 1001 that outlived it writes its id into the field after 1002's reset.
      db.artifacts.set(500, { id: 500, task_id: 1001, content: 'x'.repeat(2000) });
      a.lastArtifactId = 500;
      return { output: 'ok', provider: 'groq' };
    });
    await a.processTask(task(1002));
    const b = finalWrite(db.updates, 1002);
    assert.notEqual(b.artifact_url, 'db://trinity_artifacts/500');
    assert.equal(b.status, 'needs_artifact');
  });

  await test('saveArtifact refuses a save for a task that is not current, and credits no task that changed mid-save', async () => {
    const { a, db } = agent(new Set());
    a.currentTaskId = 1002;
    assert.equal(await a.saveArtifact(1001, 'stale', 'report', 't'), null, 'a save for a task that is not current');
    assert.equal(db.artifacts.size, 0, 'nothing written');
    db.onInsert(async () => { a._beginTask(task(1003)); }); // the next task begins while this save is in flight
    assert.equal(await a.saveArtifact(1002, 'late', 'report', 't'), null);
    assert.equal(a.lastArtifactId, null, 'the task that is current now is not credited');
  });

  await test('a conversation started for task A cannot save into task B when B became current mid-run', async () => {
    process.env = { ...ORIG_ENV, GROQ_API_KEY: 'gsk_testAAAAAAAAAAAA' };
    for (const k of ['LLM_GATEWAY_FIRST', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID']) delete process.env[k];
    freeTier.resetExhaustion();
    const db = fakeDb();
    const a = Object.assign(Object.create(A.prototype), {
      name: 'trinity-canary', availableProviders: ['groq'], sessionMetrics: { llmCalls: 0 }, supabase: db.supabase,
    });
    a._beginTask(task(1001));
    let turn = 0;
    global.fetch = async () => {
      turn++;
      if (turn === 1) {
        a._beginTask(task(1002)); // 1001's run timed out; 1002 is claimed while the LLM call was in flight
        const call = { id: 'c1', type: 'function', function: { name: 'save_artifact', arguments: JSON.stringify({ title: 't', content: 'from 1001', type: 'report' }) } };
        return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [call] } }] }) };
      }
      return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { role: 'assistant', content: 'done' } }] }) };
    };
    await a.callLLM('task 1001 prompt');
    assert.equal(db.artifacts.size, 0, "1001's output must not land as an artifact while 1002 is current");
    assert.equal(a.lastArtifactId, null);
  });

  await test("getNextTask's CLAIM_SQL (what sets claimed_by) resets per-task state", async () => {
    const { a } = agent(new Set());
    a.currentTaskId = 1001;
    a.lastArtifactId = 196835;
    a._artifactSavedFor = { taskId: 1001, url: 'db://trinity_artifacts/196835' };
    claimRows = [task(1002)];
    const claimed = await a.getNextTask();
    assert.equal(claimed.id, 1002);
    assert.equal(a.currentTaskId, 1002);
    assert.equal(a.lastArtifactId, null);
    assert.equal(a._artifactSavedFor, null);
  });

  await test('one place sets per-task state; every claim path calls it; every done path checks ownership', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
    assert.equal((src.match(/this\.currentTaskId\s*=\s*task\.id/g) || []).length, 1, 'only _beginTask assigns currentTaskId = task.id');
    assert.match(src, /_beginTask\(task\)\s*\{[\s\S]{0,400}this\.lastArtifactId = null;[\s\S]{0,200}this\._artifactSavedFor = null;/);
    const claimConfirms = (src.match(/await (?:withTimeout\()?this\.claimTask\(task\.id\)/g) || []).length;
    const begins = (src.match(/this\._beginTask\((?:task|rows\[0\])\);/g) || []).length;
    assert.equal(begins, claimConfirms + 1, `${claimConfirms} claim confirms + the CLAIM_SQL claim, ${begins} _beginTask calls`);
    const getNext = src.slice(src.indexOf('async getNextTask()'), src.indexOf('async getNextTask()') + 6000);
    assert.match(getNext, /ConstitutionalAgentV4\.CLAIM_SQL[\s\S]*this\._beginTask\(rows\[0\]\)/, 'the CLAIM_SQL claim resets state');
    assert.doesNotMatch(src, /artifact_url: `db:\/\/trinity_artifacts\/\$\{this\.lastArtifactId\}`/, 'no done path writes lastArtifactId unchecked');
  });

  ORIG_LOG(`per-task-reset.test.js: ${passed}/7 passed`);
}

run();
