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
// Capture the REAL breaker threshold before the stub replaces the module. The reap budget has to
// stay under this number, and the round-2 verification found the old test asserting against a
// literal 5 copied into the test file — so lowering direct-pg's threshold would have left the
// suite green while silently disarming the guard. Read from the real module, not duplicated.
// (Importing it is side-effect-free: the pool is lazy, only constants run at module scope.)
const REAL_CIRCUIT_BREAKER_THRESHOLD = require('../lib/direct-pg').CIRCUIT_BREAKER_THRESHOLD;
delete require.cache[PG_PATH];
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

  /**
   * Supabase stub returning stale rows from the reaper's select — and RECORDING what the reaper
   * actually asked for.
   *
   * The first version of this stub implemented select/in/lt/limit as argument-ignoring chainables.
   * The round-2 verification showed what that cost: mutating the staleness window from one HOUR to
   * one SECOND left all 44 tests green, and that single mutation neutralises the whole cap — a
   * 1-second window rips tasks back mid-work and refunds the claim before the counter can ever
   * accumulate, reproducing exactly the runaway this PR exists to stop. Four further
   * trigger-condition mutations (status filter, batch size, survivor gate, release status) were
   * equally invisible. A stub that discards its arguments does not test a query; it tests only
   * that some query was issued.
   */
  function staleSupabase(rows) {
    const seen = { table: null, select: null, in: [], lt: [], limit: null };
    const q = {
      select: (cols) => { seen.select = cols; return q; },
      in: (col, vals) => { seen.in.push([col, vals]); return q; },
      lt: (col, val) => { seen.lt.push([col, val]); return q; },
      limit: async (n) => { seen.limit = n; return { data: rows, error: null }; },
    };
    const client = { from: (t) => { seen.table = t; return q; } };
    client.seen = seen;
    return client;
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
    assert.match(A.REAP_SQL.replace(/\s+/g, ' '), /THEN GREATEST\(COALESCE\(claim_count, 0\) - 1, 0\)/,
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

  await test('main() routes each mode to the action with the field parsed FOR it', async () => {
    const script = require('../scripts/ops/claim-exhausted');
    // Round-2 verifier, MEDIUM: exporting parseArgs/list/reset still left the tool's only real
    // entry point untested. `return reset(args.taskId)` -> `reset(args.limit)` survived the whole
    // suite — and it does not fail loudly. It resets task #20 (the default list limit), reports
    // success, and leaves the task the operator actually meant still parked.
    const prior = process.exitCode;
    const cases = [
      { argv: ['--reset', '4242'], sql: () => A.RESET_CLAIM_COUNT_SQL, bind: 4242 },
      { argv: ['--limit', '4242'], sql: () => A.EXHAUSTED_TASKS_SQL, bind: 4242 },
    ];
    for (const c of cases) {
      calls.length = 0;
      nextResult = [{ id: 4242, claim_count: 12, status: 'pending', title: 't', updated_at: null, metadata: {} }];
      await script.main(c.argv);
      assert.equal(calls.length, 1, `${c.argv.join(' ')} sent ${calls.length} statements, expected 1`);
      assert.equal(calls[0].sql, c.sql(), `${c.argv.join(' ')} sent the wrong statement`);
      // Loose compare: parseArgs keeps the id as the raw argv string and the limit as a number.
      assert.ok(calls[0].params.map(String).includes(String(c.bind)),
        `${c.argv.join(' ')} did not carry ${c.bind} to the wire — the modes' fields are crossed`);
    }
    // 4242 is deliberately distinct from DEFAULT_LIMIT and from the cap, so a crossed field cannot
    // coincide with a plausible-looking value and pass.
    assert.notEqual(4242, script.DEFAULT_LIMIT);
    assert.notEqual(4242, A.maxTaskClaims());
    process.exitCode = prior;
  });

  await test('main() --help prints and touches no database at all', async () => {
    const script = require('../scripts/ops/claim-exhausted');
    const prior = process.exitCode;
    const log = console.log;
    console.log = () => {};
    try {
      calls.length = 0;
      await script.main(['--help']);
      assert.equal(calls.length, 0, 'help must not query');
    } finally { console.log = log; process.exitCode = prior; }
  });

  await test('a failing reap abandons the batch before it can open the shared pg breaker', async () => {
    // The reap moved to pgQuery, which sits behind direct-pg's PROCESS-WIDE circuit breaker:
    // 5 consecutive failed calls open a 5-minute cool-down that throws for every caller —
    // getNextTask, claimTask and the heartbeat included. Continuing past failures across a 50-row
    // batch would guarantee that, letting a background janitor idle the fleet's claim path.
    // (The zero-row path was pinned earlier; this is the THROW path, which was left unpinned in
    // the first version of this file even though the harness already had nextThrow.)
    // Asserted against the REAL exported threshold, not a literal copied into this file. And the
    // property is the doubled one, because the failure counter is global and the reaper's
    // abandonment does not reset it: what is actually guaranteed is that TWO full failing passes
    // stay under the threshold. The old `< 5` let 3 -> 4 pass while making that false.
    assert.ok(2 * A.REAP_FAILURE_BUDGET < REAL_CIRCUIT_BREAKER_THRESHOLD,
      `two full failing reaper passes (2 x ${A.REAP_FAILURE_BUDGET}) must stay under direct-pg's ${REAL_CIRCUIT_BREAKER_THRESHOLD}-failure breaker`);
    const rows = Array.from({ length: 20 }, (_, i) => (
      { id: 100 + i, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }));
    const a = agent({ supabase: staleSupabase(rows) });
    resultFor = () => { throw new Error('connection refused'); };
    await a.runStaleTaskReaper();
    assert.equal(calls.length, A.REAP_FAILURE_BUDGET,
      `expected the reaper to stop after ${A.REAP_FAILURE_BUDGET} consecutive failures, not to walk all 20 rows`);
  });

  // ---------- the reaper: the TRIGGER CONDITIONS (round-2 verifier, HIGH #1) ----------
  // Every assertion below was absent, and every one of these mutations survived the full 44-test
  // suite. They are grouped so it is obvious what class of defect was invisible: not the SQL the
  // reaper sends, which was well pinned, but WHEN it decides to send it.

  await test('the reaper only reaps tasks stale by a FULL HOUR, not by a moment', async () => {
    // THE ONE THAT MATTERS. `Date.now() - 60*60*1000` -> `- 1000` left 44/44 green while completely
    // neutralising the cap: a 1-second window reaps tasks mid-work and refunds the claim before the
    // counter can accumulate, which is the 365-claims-in-100-minutes runaway this PR exists to stop.
    // A tolerance rather than an equality because the reaper stamps its own `now`.
    const sb = staleSupabase([]);
    const before = Date.now();
    await agent({ supabase: sb }).runStaleTaskReaper();
    const after = Date.now();

    assert.equal(sb.seen.lt.length, 1, 'the reaper must bound staleness with exactly one lt()');
    const [col, iso] = sb.seen.lt[0];
    assert.equal(col, 'claimed_at', 'staleness is measured from when the task was CLAIMED');
    const cutoff = Date.parse(iso);
    assert.ok(Number.isFinite(cutoff), 'the cutoff must be a parseable ISO timestamp');
    // The cutoff must sit REAP_STALE_AFTER_MS in the past, within the runtime of the call itself.
    assert.ok(before - cutoff >= A.REAP_STALE_AFTER_MS - 1 && after - cutoff <= A.REAP_STALE_AFTER_MS + 5000,
      `cutoff is ${before - cutoff}ms back; expected ~${A.REAP_STALE_AFTER_MS}ms`);
    // …and the constant itself is pinned, so shrinking it fails here rather than silently.
    assert.equal(A.REAP_STALE_AFTER_MS, 60 * 60 * 1000, 'the staleness window is one hour by decision');
  });

  await test('the reaper reads the in-flight statuses, from the right table, in a bounded batch', async () => {
    // Mutations that survived: `.in('status', ['pending'])` (reaps nothing, ever — the cap then
    // never gets its refunds and real tasks park), and `.limit(50)` -> `.limit(50000)` (a batch far
    // larger than the failure budget can protect, on a path behind a process-wide breaker).
    const sb = staleSupabase([]);
    await agent({ supabase: sb }).runStaleTaskReaper();
    assert.equal(sb.seen.table, 'trinity_tasks');
    assert.deepEqual(sb.seen.in, [['status', A.REAPABLE_STATUSES]]);
    assert.equal(sb.seen.limit, A.REAP_BATCH_LIMIT);
    assert.equal(A.REAP_BATCH_LIMIT, 50);
    assert.match(String(sb.seen.select), /\bmetadata\b/,
      'the reaper rewrites metadata, so it must select it or it will clobber the existing object');
  });

  await test('a non-survivor agent issues NO reaper query at all', async () => {
    // Deleting `if (!this.isSurvivor) return;` survived because the stub agent is always a survivor.
    // Every agent reaping means N copies of a 50-row batch racing the same rows every pass.
    const sb = staleSupabase([{ id: 1, claimed_by: 'x', claimed_at: '2026-07-27T00:00:00Z', metadata: {} }]);
    await agent({ supabase: sb, isSurvivor: false }).runStaleTaskReaper();
    assert.equal(sb.seen.table, null, 'a non-survivor must not even touch the table');
    assert.equal(calls.length, 0);
  });

  await test('the release returns the task to a CLAIMABLE status and clears the claimer', async () => {
    // Two survivors, both of which strand every reaped task permanently: releasing to 'blocked'
    // (not in CLAIMABLE_STATUSES, so nothing serves it again) and dropping `claimed_by = NULL`
    // (CLAIM_SQL requires claimed_by IS NULL, so the row is un-claimable forever). Neither is
    // detectable by asserting the SQL is "the reap SQL" — the property is what that SQL RESTORES.
    const sql = A.REAP_SQL.replace(/\s+/g, ' ');
    assert.ok(A.CLAIMABLE_STATUSES.includes(A.REAP_RELEASE_STATUS),
      `a reap must release into a claimable status; ${A.REAP_RELEASE_STATUS} is a permanent strand`);
    assert.ok(sql.includes(`status = '${A.REAP_RELEASE_STATUS}'`), 'the release status left the statement');
    assert.match(sql, /claimed_by = NULL/, 'without clearing claimed_by the row can never be claimed again');
    assert.match(sql, /claimed_at = NULL/, 'a stale claimed_at would make the row instantly re-reapable');
  });

  await test('ONLY a claim that was counted is refunded — the uncapped paths cannot drain the cap', async () => {
    // Round-2 verifier HIGH #2. constitutional-agent-base.js:1441/:1491 and w3c.index.js:241 move
    // tasks to 'in_progress' WITHOUT incrementing claim_count. Refunding those was a monotone
    // downward driver — claim uncounted, reap, -1 — which walks the counter to zero and disables
    // the cap entirely. 'doing' is the only status CLAIM_SQL sets, and CLAIM_SQL is the only
    // incrementing path, so the refund is conditioned on it. Both statuses are still RELEASED;
    // the rescue is the point and is not in question.
    const sql = A.REAP_SQL.replace(/\s+/g, ' ');
    assert.equal(A.REFUNDABLE_STATUS, 'doing');
    assert.match(A.CLAIM_SQL.replace(/\s+/g, ' '), new RegExp(`SET status = '${A.REFUNDABLE_STATUS}'`),
      'the refundable status must be the one the COUNTED claim sets');
    assert.match(sql, new RegExp(`claim_count = CASE WHEN status = '${A.REFUNDABLE_STATUS}' THEN GREATEST`),
      'the refund must be conditional on the claim having been counted');
    assert.match(sql, /ELSE COALESCE\(claim_count, 0\) END/, 'an uncounted claim must leave the counter alone');
    // The reap still rescues both, or the uncapped paths would leak claimed rows forever.
    assert.ok(A.REAPABLE_STATUSES.includes('in_progress'),
      'in_progress must still be reaped — only its REFUND is withheld');
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
