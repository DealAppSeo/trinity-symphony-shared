'use strict';

/**
 * A worker that lost its claim cannot finish the task (2026-11-07).
 *
 * The reaper releases a claim after an hour and another agent takes the task. The first one, still
 * running, then finishes. Every finish wrote `.eq('id', task.id)` and nothing else, so the stale
 * worker overwrote the live claim with its own result and collected the follow-ups and reputation.
 *
 * Run: node tests/completion-fence.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../lib/ConstitutionalAgentV4');

/** A single row, and an update chain that really applies its filters. */
function db(row) {
  const writes = [];
  return {
    writes,
    row,
    from: () => ({
      update: (patch) => {
        const filters = [];
        const chain = {
          eq: (col, val) => { filters.push([col, val]); return chain; },
          select: async () => {
            if (!filters.every(([c, v]) => row[c] === v)) return { data: [], error: null };
            Object.assign(row, patch);
            writes.push(patch);
            return { data: [{ id: row.id }], error: null };
          },
        };
        return chain;
      },
    }),
  };
}

function agent(supabase) {
  const calls = { spawn: 0, rep: 0 };
  const a = Object.assign(Object.create(A.prototype), {
    name: 'trinity-a',
    claimHistory: new Map(),
    sessionMetrics: { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0 },
    wisdom: { squad: 'ALPHA', primaryVirtue: 'truth' },
    supabase,
    claimTask: async () => true,
    log: async () => {},
    trackProviderPerformance: async () => {},
    evaluateResult: async () => ({ score: 80 }),
    validateSubstance: async () => ({ ok: true }),
    _postSubstanceGateEvent: async () => ({ recorded: false }),
    _runArtifactGuardCheck: async () => ({ skipped: true }),
    _enforceArtifact: async () => ({ artifactUrl: 'db://trinity_artifacts/1', blocked: false }),
    spawnNextStep: async () => { calls.spawn++; },
    updateReputation: async () => { calls.rep++; },
    callLLM: async () => ({ output: 'real output', provider: 'groq' }),
  });
  return { a, calls };
}

const task = { id: 7, title: 't', description: 'd', task_type: 'analysis', metadata: {} };

(async () => {
  const quiet = { warn: console.warn, error: console.error, log: console.log };
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  try {
    // The holder finishes normally: the control that proves the filter can pass.
    const owned = db({ id: 7, claimed_by: 'trinity-a', status: 'doing' });
    const held = agent(owned);
    await held.a.processTask(task);
    assert.equal(owned.row.status, 'done', 'the holder finishes');
    assert.equal(held.calls.spawn, 1);
    assert.equal(held.calls.rep, 1);

    // Reaped and re-claimed: the stale worker changes nothing and earns nothing.
    const stolen = db({ id: 7, claimed_by: 'trinity-b', status: 'doing' });
    const stale = agent(stolen);
    await stale.a.processTask(task);
    assert.equal(stolen.row.status, 'doing', 'the live claim is untouched');
    assert.equal(stolen.row.claimed_by, 'trinity-b');
    assert.equal(stolen.writes.length, 0);
    assert.equal(stale.calls.spawn, 0, 'no follow-up from a discarded result');
    assert.equal(stale.calls.rep, 0, 'no reputation for a discarded result');
    assert.equal(stale.a.currentTaskId, null);

    // Reaped and not yet re-claimed.
    const freed = db({ id: 7, claimed_by: null, status: 'pending' });
    await agent(freed).a.processTask(task);
    assert.equal(freed.row.status, 'pending');

    // A database error is not a success.
    const broken = { from: () => ({ update: () => { const c = { eq: () => c, select: async () => ({ data: null, error: { message: 'boom' } }) }; return c; } }) };
    const failed = agent(broken);
    await failed.a.processTask(task);
    assert.equal(failed.calls.rep, 0);

    // Both finish paths go through the fence.
    const src = fs.readFileSync(path.join(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
    assert.equal((src.match(/await this\._finishIfOwned\(task, \{/g) || []).length, 2, 'contract loop and legacy loop');
  } finally {
    Object.assign(console, quiet);
  }
  console.log('ok completion-fence');
})().catch((e) => { console.error(e); process.exit(1); });
