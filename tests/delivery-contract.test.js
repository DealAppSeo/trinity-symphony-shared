'use strict';

/**
 * A reply that does not contain its deliverable is not stored as done (2026-11-24).
 *
 * Tasks 439397 and 439431 (trinity-torch, 2026-11-23/24): the task asked for lines of work, the model replied
 * "saved as a document artifact" with none of the lines in the reply, and the row was stored with status done.
 * A task can now carry metadata.delivery_contract = { pattern, min_lines }: at least min_lines lines of the
 * reply must match pattern. With DELIVERY_CONTRACT_GATE=on a reply that does not meet it finishes as
 * needs_artifact with the reason in metadata.delivery. Flag unset, or no contract: unchanged.
 *
 * The REAL processTask and processTaskContract run here; the model and the database are stand-ins.
 * Run: node tests/delivery-contract.test.js
 */

const assert = require('node:assert/strict');
const A = require('../lib/ConstitutionalAgentV4');
const dc = require('../lib/delivery-contract');

const SUMMARY = 'Done. The results have been saved as a report.';
const NINE_LINES = Array.from({ length: 9 }, (_, i) => `P${(i % 3) + 1} Q${Math.floor(i / 3) + 1}: (a) because it fits`).join('\n');
const CONTRACT = { pattern: '^P[123]\\b', min_lines: 9 };

/** One row, and an update chain that applies its filters (as tests/completion-fence.test.js). */
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

function agent(supabase, output) {
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
    _ownedArtifactUrl: async () => 'db://trinity_artifacts/1',
    spawnNextStep: async () => { calls.spawn++; },
    updateReputation: async () => { calls.rep++; },
    // The model "saved an artifact" (as torch said it did), so the contract path reaches its done write.
    callLLM: async () => { a.lastArtifactId = 1; return { output, provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' }; },
  });
  return { a, calls };
}

const task = (metadata) => ({ id: 7, title: 't', description: 'd', success_criteria: 'c', task_type: 'analysis', metadata });
const PATHS = [
  ['legacy', (a, t) => a.processTask(t)],
  ['contract', async (a, t) => { a._beginTask(t); await a.processTaskContract(t); }],
];
const run = async (runPath, output, metadata, claimedBy = 'trinity-a') => {
  const store = db({ id: 7, claimed_by: claimedBy, status: 'doing' });
  const { a, calls } = agent(store, output);
  await runPath(a, task(metadata));
  return { store, calls };
};

(async () => {
  const quiet = { warn: console.warn, error: console.error, log: console.log };
  const flagBefore = process.env.DELIVERY_CONTRACT_GATE;
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  try {
    // The check itself.
    assert.equal(dc.check(NINE_LINES, CONTRACT).delivered, true);
    assert.deepEqual(dc.check(SUMMARY, CONTRACT), { delivered: false, matched: 0, min_lines: 9, reason: 'matched 0 of 9 required lines' });
    assert.equal(dc.check(NINE_LINES.split('\n').slice(0, 8).join('\n'), CONTRACT).matched, 8, 'one line short is not delivered');
    assert.equal(dc.check(NINE_LINES.replace(/\n/g, '  \r\n'), CONTRACT).delivered, true, 'CRLF and trailing spaces');
    assert.equal(dc.check('Is it?\nWhy?  ', { pattern: '\\?$', min_lines: 2 }).delivered, true);
    assert.equal(dc.check('x', { pattern: 'x' }).delivered, true, 'min_lines defaults to 1');
    assert.equal(dc.check('', CONTRACT).delivered, false);
    assert.equal(dc.check(null, CONTRACT).delivered, false);
    // A contract that cannot be read is not met: nothing can be shown delivered against it.
    assert.match(dc.check(NINE_LINES, { pattern: '(', min_lines: 1 }).reason, /^contract_invalid/);
    assert.match(dc.check(NINE_LINES, { min_lines: 1 }).reason, /^contract_invalid/);
    assert.match(dc.check(NINE_LINES, { pattern: 'P', min_lines: 0 }).reason, /^contract_invalid/);
    assert.match(dc.check(NINE_LINES, { pattern: 'a'.repeat(201), min_lines: 1 }).reason, /^contract_invalid/);
    // The pattern comes from a task row, so a pattern that never finishes must not hold the agent loop.
    const t0 = Date.now();
    assert.equal(dc.check(`${'a'.repeat(40)}!`, { pattern: '(a+)+$', min_lines: 1 }).reason, 'contract_timeout');
    assert.ok(Date.now() - t0 < 2000, 'a runaway pattern is cut off');
    // contractOf: object or JSON-string metadata; anything else is no contract.
    assert.deepEqual(dc.contractOf({ metadata: JSON.stringify({ delivery_contract: CONTRACT }) }), CONTRACT);
    assert.equal(dc.contractOf({ metadata: '{not json' }), null);
    assert.equal(dc.contractOf({ metadata: { delivery_contract: 'nine lines' } }), null);
    assert.equal(dc.contractOf({}), null);

    for (const [name, runPath] of PATHS) {
      // ON: the summary is not stored as done; the reply is kept and the reason is recorded.
      process.env.DELIVERY_CONTRACT_GATE = 'on';
      const bad = await run(runPath, SUMMARY, { delivery_contract: CONTRACT, case_id: 'x' });
      assert.notEqual(bad.store.row.status, 'done', `${name}: a summary is not done`);
      assert.equal(bad.store.row.status, 'needs_artifact', name);
      assert.equal(bad.store.row.result, SUMMARY, `${name}: the reply is kept as evidence`);
      assert.deepEqual(bad.store.row.metadata.delivery, { delivered: false, matched: 0, min_lines: 9, reason: 'matched 0 of 9 required lines' }, name);
      assert.equal(bad.store.row.metadata.case_id, 'x', `${name}: existing metadata is kept`);
      assert.equal(bad.store.row.metadata.model_used, 'nvidia/nemotron-3-ultra-550b-a55b', name);
      assert.equal(bad.store.writes.length, 1, `${name}: one write`);
      assert.equal(bad.calls.spawn, 0, `${name}: no follow-up from a non-delivery`);
      assert.equal(bad.calls.rep, 0, `${name}: no reputation for a non-delivery`);

      // ON: a reply that meets the contract finishes exactly as before.
      const good = await run(runPath, NINE_LINES, { delivery_contract: CONTRACT });
      assert.equal(good.store.row.status, 'done', `${name}: a delivered reply is done`);
      assert.equal('delivery' in good.store.row.metadata, false, name);
      assert.equal(good.calls.spawn, 1, name);

      // ON, no contract: unchanged.
      const none = await run(runPath, SUMMARY, {});
      assert.equal(none.store.row.status, 'done', `${name}: no contract, no gate`);

      // ON, claim lost: the non-delivery is not written over the live claim.
      const stale = await run(runPath, SUMMARY, { delivery_contract: CONTRACT }, 'trinity-b');
      assert.equal(stale.store.writes.length, 0, `${name}: goes through the ownership fence`);
      assert.equal(stale.store.row.status, 'doing', name);

      // OFF (unset, or anything but "on"): unchanged, contract or not.
      for (const v of [undefined, 'true', 'off']) {
        if (v === undefined) delete process.env.DELIVERY_CONTRACT_GATE; else process.env.DELIVERY_CONTRACT_GATE = v;
        const off = await run(runPath, SUMMARY, { delivery_contract: CONTRACT });
        assert.equal(off.store.row.status, 'done', `${name}: flag ${v} changes nothing`);
        assert.equal('delivery' in off.store.row.metadata, false, name);
        assert.equal(off.calls.spawn, 1, name);
      }
    }
  } finally {
    Object.assign(console, quiet);
    if (flagBefore === undefined) delete process.env.DELIVERY_CONTRACT_GATE; else process.env.DELIVERY_CONTRACT_GATE = flagBefore;
  }
  console.log('ok delivery-contract');
})().catch((e) => { console.error(e); process.exit(1); });
