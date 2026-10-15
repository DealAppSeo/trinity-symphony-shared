'use strict';

/**
 * Per-task state is reset on EVERY claim, in EVERY claim path (CC1 2026-10-15).
 *
 * processTask (the legacy loop) set currentTaskId but never reset lastArtifactId. So after task A
 * saved an artifact, task B — whose LLM saved nothing — passed the artifact guard on A's artifact,
 * and _enforceArtifact wrote A's artifact as B's artifact_url with status 'done': a false "done".
 *
 * Pins:
 *  1. Legacy path: A saves an artifact; B saves none → B is NOT done on A's artifact.
 *  2. Legacy path, control: B that DOES save gets its own artifact.
 *  3. Exactly one place assigns `currentTaskId = task.id` (the shared _beginTask), and every
 *     claim path calls it — so the two paths cannot drift apart again.
 *
 * Run: node tests/per-task-reset.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg in this test'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const A = require('../lib/ConstitutionalAgentV4');
const ORIG_LOG = console.log;
const ORIG_WARN = console.warn;
const ORIG_ERR = console.error;

/** A legacy-loop agent whose LLM, for each task id, either saves an artifact or does not. */
function agent(savesFor) {
  const updates = [];
  let nextArtifact = 196835;
  const a = Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    claimHistory: new Map(),
    sessionMetrics: { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0 },
    wisdom: { squad: 'ALPHA', primaryVirtue: 'truth' },
    supabase: { from: () => ({ update: (row) => ({ eq: async (_c, id) => { updates.push({ id, row }); return { error: null }; } }) }) },
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
    saveArtifact: async () => { a.lastArtifactId = nextArtifact++; return `db://trinity_artifacts/${a.lastArtifactId}`; },
    callLLM: async () => {
      if (savesFor.has(a.currentTaskId)) await a.saveArtifact(a.currentTaskId, 'x'.repeat(2000), 'report', 'r');
      return { output: 'ok', provider: 'groq' };
    },
  });
  return { a, updates };
}

const task = (id) => ({ id, title: `task ${id}`, description: 'd', task_type: 'analysis', metadata: {} });
const finalWrite = (updates, id) => updates.filter((u) => u.id === id && 'artifact_url' in u.row).at(-1).row;

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    try {
      await fn();
      ORIG_LOG(`  ok ${name}`);
      passed++;
    } catch (e) {
      ORIG_LOG(`  FAIL ${name}: ${e.message}`);
      process.exitCode = 1;
    } finally {
      console.log = ORIG_LOG; console.warn = ORIG_WARN; console.error = ORIG_ERR;
    }
  };

  await test("legacy path: B saves no artifact → B is NOT done on A's artifact", async () => {
    const { a, updates } = agent(new Set([1001]));
    await a.processTask(task(1001));
    assert.equal(finalWrite(updates, 1001).artifact_url, 'db://trinity_artifacts/196835', 'A has its own artifact');
    await a.processTask(task(1002));
    const b = finalWrite(updates, 1002);
    assert.notEqual(b.artifact_url, 'db://trinity_artifacts/196835', "B must not carry A's artifact");
    assert.equal(b.status, 'needs_artifact', 'a deliverable with no artifact is not done');
  });

  await test('legacy path, control: B that saves gets its OWN artifact', async () => {
    const { a, updates } = agent(new Set([1001, 1002]));
    await a.processTask(task(1001));
    await a.processTask(task(1002));
    assert.equal(finalWrite(updates, 1002).artifact_url, 'db://trinity_artifacts/196836');
    assert.equal(finalWrite(updates, 1002).status, 'done');
  });

  await test('one place sets per-task state, and every claim path calls it', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
    assert.equal((src.match(/this\.currentTaskId\s*=\s*task\.id/g) || []).length, 1, 'only _beginTask assigns currentTaskId = task.id');
    assert.match(src, /_beginTask\(task\)\s*\{[\s\S]{0,400}this\.lastArtifactId = null;[\s\S]{0,200}this\._artifactSavedFor = null;/);
    const claimSites = (src.match(/await (?:withTimeout\()?this\.claimTask\(task\.id\)/g) || []).length;
    const beginSites = (src.match(/this\._beginTask\(task\);/g) || []).length;
    assert.equal(beginSites, claimSites, `${claimSites} claim paths, ${beginSites} _beginTask calls`);
  });

  ORIG_LOG(`per-task-reset.test.js: ${passed}/3 passed`);
}

run();
