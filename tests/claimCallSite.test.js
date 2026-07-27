'use strict';

/**
 * CALL-SITE tests for the durable re-claim cap and its refund.
 *
 * WHY A SEPARATE FILE. claimCap.test.js proves the PROPERTY (a task that always releases stops
 * being served) and the STRING (CLAIM_SQL carries the guards). An independent verification
 * (Beat 43, finding F5) showed both can hold while the live code caps nothing: it hand-built a
 * 5-bind array at the getNextTask() call site instead of calling buildClaimParams, and 15/15
 * tests still passed. Two more variants did the same — sending a de-capped copy of CLAIM_SQL,
 * and Object.assign-ing the cap bind to 2147483647. `ConstitutionalAgentV4.getNextTask` had
 * ZERO coverage; tests/getNextTask.test.js exercises a different class entirely
 * (constitutional-agent-base.js's ConstitutionalAgent).
 *
 * The only thing that can see those mutations is asserting on what the method actually SENT.
 * So this file stubs the pg layer, invokes the real methods, and inspects the wire.
 *
 * That failure mode is not academic: a de-capped claim restores the 365-claim runaway, and a
 * missing bind is worse than a degraded cap — Postgres rejects the statement, getNextTask()
 * catches and returns null, and all 11 agents go quietly idle looking exactly like an empty queue.
 *
 * Run: node tests/claimCallSite.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// --- Stub the pg layer BEFORE ConstitutionalAgentV4 is loaded ------------------------------
// It destructures `const { pgQuery } = require('./direct-pg')` at module scope, so the swap has
// to happen first. Pre-seeding require.cache is the plain-node equivalent of jest.mock (this repo
// has no jest: tests are bare `node tests/*.test.js` scripts).
const PG_PATH = require.resolve('../lib/direct-pg');
const calls = [];
let nextResult = [];
let nextThrow = null;
// Per-call result override, for the tests that need the Nth query to answer differently from the
// first (a reap batch where one row loses the race and the next does not).
let resultFor = null;
const stub = {
  getPgPool: () => { throw new Error('getPgPool must not be called in this test'); },
  pgQuery: async (sql, params, opts) => {
    calls.push({ sql, params, opts });
    if (nextThrow) { const e = nextThrow; nextThrow = null; throw e; }
    return resultFor ? resultFor() : nextResult;
  },
  pgPing: async () => true,
  closePgPool: async () => {},
};
require.cache[PG_PATH] = new Module(PG_PATH, null);
require.cache[PG_PATH].filename = PG_PATH;
require.cache[PG_PATH].path = path.dirname(PG_PATH);
require.cache[PG_PATH].loaded = true;
require.cache[PG_PATH].exports = stub;

const A = require('../lib/ConstitutionalAgentV4');

// Guard: if the swap silently failed we would be exercising the real pool against no database and
// every assertion below would be meaningless. Prove the stub is the one in force.
assert.equal(require('../lib/direct-pg').pgQuery, stub.pgQuery,
  'the direct-pg stub is not installed — every assertion in this file would be vacuous');

const ORIG_ENV = { ...process.env };

/**
 * A minimal agent. Built with Object.create so the real constructor (Supabase client, websocket,
 * express server) never runs: the methods under test read only these fields.
 */
function agent(over = {}) {
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-test',
    claimHistory: new Map(),
    MAX_CLAIM_RETRIES: 3,
    isSurvivor: true,
    log: async () => {},
    ...over,
  });
}

function reset() {
  calls.length = 0;
  nextResult = [];
  nextThrow = null;
  resultFor = null;
  process.env = { ...ORIG_ENV };
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    reset();
    try {
      await fn();
      console.log(`  ok ${name}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL ${name}:`, e.message);
      process.exitCode = 1;
    } finally {
      process.env = { ...ORIG_ENV };
    }
  };

  // ---------- getNextTask: the claim actually sent ----------

  await test('getNextTask sends CLAIM_SQL itself, not a copy', async () => {
    // Kills M16 (a de-capped duplicate of the SQL at the call site). Identity, not similarity:
    // a near-copy is exactly what a mutation produces.
    await agent().getNextTask();
    assert.equal(calls.length, 1, 'expected exactly one query');
    assert.equal(calls[0].sql, A.CLAIM_SQL, 'the call site did not send CLAIM_SQL');
  });

  await test('getNextTask sends the cap bind, and it equals the configured cap', async () => {
    // Kills M15 (hand-built 5-bind array) and M21 (Object.assign to a huge cap).
    process.env.MAX_TASK_CLAIMS = '7';
    await agent().getNextTask();
    const { params } = calls[0];
    assert.equal(params.length, 6, 'CLAIM_SQL binds $1..$6; a short array is a fleet-wide outage');
    assert.equal(params[5], 7, 'the cap bind must carry the configured cap, not a default or a sentinel');
  });

  await test('the bind count is pinned to a LITERAL, not derived from the SQL under test', async () => {
    // claimCap.test.js derives `highest` with Math.max(...CLAIM_SQL.matchAll(/\$(\d+)/g)), which a
    // coordinated removal of BOTH $6 and its bind satisfies. Pinning 6 as a literal here is what
    // makes that mutation visible, so the two files fail for different reasons on purpose.
    const highest = Math.max(...[...A.CLAIM_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(highest, 6, 'CLAIM_SQL must bind exactly $1..$6 — changing this is a deliberate act');
    await agent().getNextTask();
    assert.equal(calls[0].params.length, 6);
  });

  await test('every bind position carries the value the SQL expects at that position', async () => {
    // Replaces `params.every(p => p !== undefined)`, which is satisfied by any array of nulls.
    const a = agent();
    a.claimHistory.set(99, 3); // at MAX_CLAIM_RETRIES => blacklisted
    await a.getNextTask();
    const { params } = calls[0];
    assert.equal(params[0], 'trinity-test', '$1 = agent name');
    assert.match(String(params[1]), /^\d{4}-\d{2}-\d{2}T/, '$2 = ISO timestamp');
    assert.deepEqual(params[2], A.CLAIMABLE_STATUSES, '$3 = claimable status set');
    assert.deepEqual(params[3], [99], '$4 = in-memory blacklist');
    assert.equal(params[4], null, '$5 = capability filter, NULL when CAPABILITY_FILTER is off');
    assert.equal(params[5], A.maxTaskClaims(), '$6 = the cap');
  });

  await test('the env lever reaches the wire end-to-end', async () => {
    // Verifier F6: replacing maxTaskClaims() with DEFAULT_MAX_TASK_CLAIMS inside buildClaimParams
    // survived, because the suite ran with MAX_TASK_CLAIMS unset so the two were equal. Raising the
    // cap without a deploy is the operator's only mitigation for a wrongly-parked task, so it is
    // tested against a value that CANNOT coincide with the default.
    process.env.MAX_TASK_CLAIMS = '37';
    assert.notEqual(37, A.DEFAULT_MAX_TASK_CLAIMS, 'pick a probe value distinct from the default');
    await agent().getNextTask();
    assert.equal(calls[0].params[5], 37, 'MAX_TASK_CLAIMS did not reach the claim statement');
  });

  await test('the default cap is pinned to 12, not merely to "some positive number"', async () => {
    // Verifier F7: every existing assertion read maxTaskClaims() dynamically, so 12->2 and 12->50
    // both passed. 2 would park real work; 50 would have let the 365-claim runaway run four times
    // longer. The magnitude is a decision and is recorded as one.
    delete process.env.MAX_TASK_CLAIMS;
    assert.equal(A.DEFAULT_MAX_TASK_CLAIMS, 12);
    await agent().getNextTask();
    assert.equal(calls[0].params[5], 12);
  });

  await test('a query failure returns null instead of throwing into the loop', async () => {
    nextThrow = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const got = await agent().getNextTask();
    assert.equal(got, null);
  });

  await test('getNextTask returns the claimed row', async () => {
    nextResult = [{ id: 1, title: 't', status: 'doing', claim_count: 1 }];
    const got = await agent().getNextTask();
    assert.equal(got.id, 1);
    assert.equal(got.claim_count, 1);
  });

  // ---------- the reaper: the refund actually sent ----------

  /** Supabase stub returning one stale row from the reaper's select. */
  function staleSupabase(rows) {
    const q = {
      select: () => q, in: () => q, lt: () => q,
      limit: async () => ({ data: rows, error: null }),
    };
    return { from: () => q };
  }

  await test('the reaper refunds the claim it is undoing', async () => {
    // Verifier F1: a reap is blameless — the claimer died or restarted, the task did nothing wrong.
    // Without the refund each reap costs the task one claim permanently, and 2,408 real tasks have
    // already been reaped >=12 times (max 438): agent lifecycle noise alone would park them all.
    nextResult = [{ id: 42, claim_count: 4 }];
    const logged = [];
    const a = agent({
      supabase: staleSupabase([{ id: 42, claimed_by: 'trinity-dead', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }]),
      log: async (kind, msg, meta) => { logged.push({ kind, meta }); },
    });
    await a.runStaleTaskReaper();
    assert.equal(calls.length, 1, 'the reaper must release through one statement');
    assert.equal(calls[0].sql, A.REAP_SQL);
    assert.match(A.REAP_SQL.replace(/\s+/g, ' '), /claim_count = GREATEST\(COALESCE\(claim_count, 0\) - 1, 0\)/,
      'the release must refund the claim, saturating at zero');
    assert.equal(logged[0].kind, 'task_reaped');
    assert.equal(logged[0].meta.claimCountAfterRefund, 4, 'the refunded count must be recorded, not just logged to stdout');
  });

  await test('the refund saturates at zero rather than going negative', async () => {
    // A signed counter is a cap that can be farmed: provoke reaps, bank negative claims, then
    // cycle freely. GREATEST is what makes that impossible, so it is asserted as behaviour.
    const sql = A.REAP_SQL.replace(/\s+/g, ' ');
    assert.ok(sql.includes('GREATEST('), 'lost the saturating floor on the refund');
    assert.ok(!/claim_count = COALESCE\(claim_count, 0\) - 1(?!,)/.test(sql), 'unsaturated decrement');
  });

  await test('the reaper re-checks status INSIDE the statement, so two reapers cannot both refund', async () => {
    nextResult = [{ id: 42, claim_count: 0 }];
    const a = agent({
      supabase: staleSupabase([{ id: 42, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }]),
    });
    await a.runStaleTaskReaper();
    assert.match(A.REAP_SQL.replace(/\s+/g, ' '), /WHERE id = \$1 AND status = ANY\(\$3\)/,
      'the status re-check must share the statement with the update, not be a second round-trip');
    assert.deepEqual(calls[0].params[2], A.REAPABLE_STATUSES);
    assert.deepEqual(A.REAPABLE_STATUSES, ['doing', 'in_progress']);
  });

  await test('losing the reap race is skipped cleanly — the batch continues', async () => {
    // Zero rows means another reaper won, or the task left 'doing' on its own. Two things must be
    // true and BOTH are asserted: no task_reaped row is emitted for it, and the rest of the batch
    // still gets reaped.
    //
    // The second half is the whole test. A first draft asserted only the absence of the log, and
    // mutation MR5 (delete the zero-row guard) SURVIVED it: without the guard the code reads
    // reaped[0].claim_count on an empty array, throws, and the outer catch swallows it — so "no
    // log" is equally true of the fix and of the defect, while every remaining stale task is
    // silently abandoned. Absence of a signal is not evidence when the mutant produces the same
    // absence by crashing.
    const seen = [];
    let call = 0;
    const a = agent({
      supabase: staleSupabase([
        { id: 41, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }, // race lost
        { id: 42, claimed_by: 'y', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }, // must still reap
      ]),
      log: async (kind, msg, meta) => { seen.push(meta.taskId); },
    });
    resultFor = () => (++call === 1 ? [] : [{ id: 42, claim_count: 3 }]);
    await a.runStaleTaskReaper();
    assert.deepEqual(seen, [42], 'the lost race must be skipped, and the next task still reaped');
    assert.equal(calls.length, 2, 'both rows must be attempted');
  });

  await test('the reap carries forward reap_count metadata', async () => {
    nextResult = [{ id: 42, claim_count: 1 }];
    const a = agent({
      supabase: staleSupabase([{ id: 42, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: { reap_count: 6 } }]),
    });
    await a.runStaleTaskReaper();
    const meta = JSON.parse(calls[0].params[1]);
    assert.equal(meta.reap_count, 7);
    assert.ok(meta.last_reaped_at);
  });

  // ---------- the recovery surface (verifier F2) ----------

  await test('the recovery query looks for the SAME threshold the claim enforces', async () => {
    // F2: claim_count was written by the claim and read by nothing, so a parked task produced zero
    // human-visible signal. A recovery tool pinned to the wrong threshold is worse than none — it
    // reports "nothing parked" while work sits parked. Both sides are checked against one boundary.
    const list = A.EXHAUSTED_TASKS_SQL.replace(/\s+/g, ' ');
    assert.match(list, /COALESCE\(claim_count, 0\) >= \$1/,
      'the claim serves while count < cap, so recovery must list count >= cap — the same boundary');
    assert.match(A.CLAIM_SQL.replace(/\s+/g, ' '), /COALESCE\(claim_count, 0\) < \$6/);
    assert.equal(A.isClaimExhausted({ claim_count: 12 }, 12), true, 'boundary is inclusive on the recovery side');
    assert.equal(A.isClaimExhausted({ claim_count: 11 }, 12), false);
    assert.equal(A.isClaimExhausted({ claim_count: null }, 12), false, 'a pre-migration NULL is 0, not parked');
  });

  await test('the recovery tool BINDS the cap the claim enforces, including the env override', async () => {
    // Pinning the SQL string is not pinning what the tool sends. Three one-line mutations left the
    // whole suite green while making `list()` print "No parked tasks" forever: binding
    // REAPABLE_STATUSES instead of CLAIMABLE_STATUSES (parked rows are 'pending', never 'doing'),
    // binding DEFAULT_MAX_TASK_CLAIMS instead of maxTaskClaims() (the operator raises the cap and
    // the tool ignores it), and binding cap+1 (the first parked task is invisible). Each produces
    // the exact silent failure the tool's own header says is worse than having no tool.
    process.env.MAX_TASK_CLAIMS = '5';
    const script = require('../scripts/ops/claim-exhausted');
    nextResult = [{ id: 7, title: 't', task_type: 'research', status: 'pending', claim_count: 9, updated_at: null }];
    await script.list(25);
    assert.equal(calls[0].sql, A.EXHAUSTED_TASKS_SQL);
    assert.equal(calls[0].params[0], 5, 'the tool must look for the cap the CLAIM is using, not the default');
    assert.deepEqual(calls[0].params[1], A.CLAIMABLE_STATUSES,
      'parked tasks sit in a CLAIMABLE status — searching the in-flight statuses finds nothing, forever');
    assert.equal(calls[0].params[2], 25, 'the limit must reach the query');
  });

  await test('the recovery tool resets exactly the task it was asked to', async () => {
    const script = require('../scripts/ops/claim-exhausted');
    nextResult = [{ id: 435029, claim_count: 0, status: 'pending' }];
    await script.reset('435029');
    assert.equal(calls[0].sql, A.RESET_CLAIM_COUNT_SQL);
    assert.deepEqual(calls[0].params, ['435029']);
  });

  await test('the recovery tool refuses a non-numeric id without touching the database', async () => {
    // trinity_tasks.id is BIGINT (CLAUDE-RULE-5). A flag arriving where an id belongs
    // (`--reset --limit 5` parses taskId as '--limit') must not reach a query.
    const script = require('../scripts/ops/claim-exhausted');
    const prior = process.exitCode;
    await script.reset('--limit');
    assert.equal(calls.length, 0, 'a rejected id must not produce a query');
    process.exitCode = prior;
  });

  await test('no argv reaches the database with anything but a single numeric id', async () => {
    // Asserted END-TO-END rather than at the parser, because the two layers disagree and the
    // parser is the wrong place to look: `--reset all` DOES parse to {mode:'reset', taskId:'all'},
    // and a first draft of this test failed on exactly that — correctly, since it was checking the
    // parser when the guard lives in reset(). The property that actually matters is that no
    // argument list produces a query that could touch more than one row, so that is what is
    // checked, by driving each argv through to the wire.
    const script = require('../scripts/ops/claim-exhausted');
    const prior = process.exitCode;
    for (const argv of [['--reset-all'], ['--all'], ['--reset', 'all'], ['--reset', '*'],
      ['--reset', '1 OR 1=1'], ['--reset'], ['--reset', '--limit'], []]) {
      calls.length = 0;
      nextResult = [];
      const a = script.parseArgs(argv);
      if (a.mode === 'reset') await script.reset(a.taskId);
      else if (a.mode === 'list') await script.list(a.limit);
      for (const c of calls) {
        if (c.sql === A.RESET_CLAIM_COUNT_SQL) {
          assert.equal(c.params.length, 1, `${argv.join(' ')} sent a reset with more than one bind`);
          assert.match(String(c.params[0]), /^\d+$/, `${argv.join(' ')} sent a non-numeric id to a reset`);
        } else {
          assert.equal(c.sql, A.EXHAUSTED_TASKS_SQL, `${argv.join(' ')} sent an unexpected statement`);
        }
      }
    }
    process.exitCode = prior;
  });

  await test('a failing reap abandons the batch before it can open the shared pg breaker', async () => {
    // The reap moved to pgQuery, which sits behind direct-pg's PROCESS-WIDE circuit breaker:
    // 5 consecutive failed calls open a 5-minute cool-down that throws for every caller —
    // getNextTask, claimTask and the heartbeat included. Continuing past failures across a 50-row
    // batch would guarantee that, letting a background janitor idle the fleet's claim path.
    // (The zero-row path was pinned earlier; this is the THROW path, which was left unpinned in
    // the first version of this file even though the harness already had nextThrow.)
    assert.ok(A.REAP_FAILURE_BUDGET < 5, 'the budget must stay under direct-pg\'s 5-failure breaker threshold');
    const rows = Array.from({ length: 20 }, (_, i) => (
      { id: 100 + i, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }));
    const a = agent({ supabase: staleSupabase(rows) });
    resultFor = () => { throw new Error('connection refused'); };
    await a.runStaleTaskReaper();
    assert.equal(calls.length, A.REAP_FAILURE_BUDGET,
      `expected the reaper to stop after ${A.REAP_FAILURE_BUDGET} consecutive failures, not to walk all 20 rows`);
  });

  await test('an intermittent failure does NOT abandon the batch', async () => {
    // The budget counts CONSECUTIVE failures. A reaper that gave up on the first transient error
    // would leave stale tasks claimed for another hour — trading one failure mode for another.
    const rows = Array.from({ length: 6 }, (_, i) => (
      { id: 200 + i, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }));
    const a = agent({ supabase: staleSupabase(rows) });
    let n = 0;
    resultFor = () => { n++; if (n % 2 === 1) throw new Error('transient'); return [{ id: 200 + n, claim_count: 1 }]; };
    await a.runStaleTaskReaper();
    assert.equal(calls.length, 6, 'alternating failures never reach the consecutive budget');
  });

  await test('recovery resets one task at a time, and cannot un-park the whole queue', async () => {
    const sql = A.RESET_CLAIM_COUNT_SQL.replace(/\s+/g, ' ');
    assert.match(sql, /WHERE id = \$1/, 'reset must be scoped to a single id');
    assert.match(sql, /claim_count = 0/);
    // Scope the check to the WHERE clause: `claim_count` legitimately appears in RETURNING, and a
    // regex spanning to end-of-string matches that instead — which is how this assertion failed on
    // its first draft, against correct SQL.
    const where = sql.slice(sql.indexOf('WHERE'), sql.indexOf('RETURNING'));
    assert.ok(!/claim_count/.test(where), 'a predicate on claim_count would allow a mass un-park');
    const script = require('../scripts/ops/claim-exhausted');
    assert.equal(script.parseArgs(['--reset', '435029']).taskId, '435029');
    assert.equal(script.parseArgs([]).mode, 'list', 'the default must be read-only');
  });

  console.log(`\nclaimCallSite.test.js: ${passed} passed`);
  if (process.exitCode) console.error('claimCallSite.test.js: FAILURES ABOVE');
}

run();
