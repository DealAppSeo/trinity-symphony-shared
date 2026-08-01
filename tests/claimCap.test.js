'use strict';

/**
 * Durable re-claim cap — regression tests for the runaway measured on task 435029
 * (365 claims / 239 artifacts / 11 agents / ~1h40m, ~1 LLM call per 25s).
 *
 * The runaway was NOT a claim race: the claim has been a single-row atomic
 * `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED)` since the 2026-06-19
 * egress fix. It was UNBOUNDED RE-CLAIM — several paths legitimately release a task
 * back to a claimable status with claimed_by=NULL, and the only brake was an
 * in-memory, per-process, per-agent Map.
 *
 * Two things have to be true for the fix to hold, and they are tested separately
 * on purpose:
 *   1. PROPERTY — a task that always releases eventually stops being served.
 *      Exercised against the pure mirror `selectClaimableTask`.
 *   2. WIRING — the SQL the live agent actually sends carries the same guards.
 *      Without this, the mirror could satisfy (1) while the real query capped
 *      nothing: a mirror that moves with the implementation proves nothing.
 *
 * Run: node tests/claimCap.test.js
 */

const assert = require('node:assert/strict');
const A = require('../lib/ConstitutionalAgentV4');

const ORIG_ENV = { ...process.env };

/** A task in the shape the selector predicate cares about. */
function task(id, over = {}) {
  return {
    id,
    status: 'pending',
    claimed_by: null,
    assigned_to: null,
    agent_assigned: null,
    task_type: 'research',
    priority: 1,
    created_at: `2026-07-27T00:00:${String(id % 60).padStart(2, '0')}Z`,
    claim_count: 0,
    ...over,
  };
}

/** Release a task the way the escalation path does: back to the pool, unclaimed. */
function releaseToPool(t, status = 'pending_clarification') {
  t.status = status;
  t.claimed_by = null;
  return t;
}

async function run() {
  let passed = 0;
  const test = (name, fn) => {
    try {
      fn();
      console.log(`  ok ${name}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL ${name}:`, e.message);
      process.exitCode = 1;
    } finally {
      process.env = { ...ORIG_ENV };
    }
  };

  // ---- 1. PROPERTY: the cycle terminates -------------------------------------

  test('a task that is always released stops being served after the cap', () => {
    const t = task(435029);
    const tasks = [t];
    const max = A.maxTaskClaims();
    let claims = 0;
    // Bound the loop well above the cap so a broken cap shows up as a failed
    // assertion rather than as a hanging test.
    for (let i = 0; i < max * 10; i++) {
      const got = A.selectClaimableTask(tasks, { agentName: `agent-${i % 11}`, maxClaims: max });
      if (!got) break;
      claims++;
      releaseToPool(got);
    }
    assert.equal(claims, max, `expected exactly ${max} claims before exhaustion, got ${claims}`);
    assert.equal(A.selectClaimableTask(tasks, { agentName: 'agent-fresh' }), null,
      'an exhausted task must not be served to a fresh agent either');
  });

  test('the cap is global, not per-agent — 11 agents share one budget', () => {
    // This is the specific thing the in-memory claimHistory could not do: each of
    // the 11 live agents had its own Map, so each got its own private budget.
    const t = task(1);
    const tasks = [t];
    const agents = Array.from({ length: 11 }, (_, i) => `trinity-${i}`);
    let claims = 0;
    for (let i = 0; i < 200; i++) {
      const got = A.selectClaimableTask(tasks, { agentName: agents[i % agents.length] });
      if (!got) break;
      claims++;
      releaseToPool(got);
    }
    assert.equal(claims, A.maxTaskClaims());
  });

  test('release via plain pending is capped too, not just pending_clarification', () => {
    // releaseTask() -> 'pending' and the exception path -> 'pending' are separate
    // release paths. Counting at CLAIM time is what makes the cap cover all of them.
    const t = task(2);
    const tasks = [t];
    let claims = 0;
    for (let i = 0; i < 100; i++) {
      const got = A.selectClaimableTask(tasks, { agentName: 'a' });
      if (!got) break;
      claims++;
      releaseToPool(got, 'pending');
    }
    assert.equal(claims, A.maxTaskClaims());
  });

  test('claim_count increments by exactly one per claim', () => {
    const t = task(3);
    A.selectClaimableTask([t], { agentName: 'a' });
    assert.equal(t.claim_count, 1);
    releaseToPool(t);
    A.selectClaimableTask([t], { agentName: 'b' });
    assert.equal(t.claim_count, 2);
  });

  test('a task at claim_count === max is already exhausted (boundary is exclusive)', () => {
    const max = A.maxTaskClaims();
    assert.equal(A.selectClaimableTask([task(4, { claim_count: max })], { agentName: 'a' }), null);
    assert.ok(A.selectClaimableTask([task(5, { claim_count: max - 1 })], { agentName: 'a' }),
      'one claim below the cap must still be servable');
  });

  test('a NULL claim_count (pre-migration row) is treated as 0, not as exhausted', () => {
    // Every row that existed before the column was added reads as 0 via the DEFAULT,
    // but COALESCE is what keeps an explicit NULL from silently parking a task forever.
    const t = task(6, { claim_count: null });
    const got = A.selectClaimableTask([t], { agentName: 'a' });
    assert.ok(got, 'a row with no claim_count must remain claimable');
    assert.equal(got.claim_count, 1);
  });

  test('the cap does not disturb the existing selector predicates', () => {
    const fresh = () => [
      task(10, { status: 'done' }),                        // wrong status
      task(11, { claimed_by: 'someone-else' }),            // already claimed
      task(12, { assigned_to: 'other-agent' }),            // assigned elsewhere
      task(13),                                            // <- the only claimable one
    ];
    const got = A.selectClaimableTask(fresh(), { agentName: 'me' });
    assert.ok(got);
    assert.equal(got.id, 13);
    // blacklist still excludes
    assert.equal(A.selectClaimableTask(fresh(), { agentName: 'me', blacklist: [13] }), null);
  });

  test('priority DESC, created_at ASC ordering still decides which task is served', () => {
    const tasks = [
      task(20, { priority: 1, created_at: '2026-07-27T00:00:00Z' }),
      task(21, { priority: 9, created_at: '2026-07-27T05:00:00Z' }),
      task(22, { priority: 9, created_at: '2026-07-27T01:00:00Z' }),
    ];
    assert.equal(A.selectClaimableTask(tasks, { agentName: 'me' }).id, 22);
  });

  test('MAX_TASK_CLAIMS is env-tunable without a deploy, and rejects junk', () => {
    process.env.MAX_TASK_CLAIMS = '3';
    assert.equal(A.maxTaskClaims(), 3);
    process.env.MAX_TASK_CLAIMS = 'not-a-number';
    assert.equal(A.maxTaskClaims(), A.DEFAULT_MAX_TASK_CLAIMS);
    process.env.MAX_TASK_CLAIMS = '0';
    assert.equal(A.maxTaskClaims(), A.DEFAULT_MAX_TASK_CLAIMS, '0 would park every task — must fall back');
    process.env.MAX_TASK_CLAIMS = '-5';
    assert.equal(A.maxTaskClaims(), A.DEFAULT_MAX_TASK_CLAIMS);
  });

  // ---- 2. WIRING: the live SQL carries the same guards ------------------------
  // These are what stop the mirror above from drifting into a self-satisfying oracle.

  test('CLAIM_SQL increments claim_count in the same statement that claims', () => {
    const sql = A.CLAIM_SQL.replace(/\s+/g, ' ');
    assert.match(sql, /SET .*claim_count = COALESCE\(claim_count, ?0\) \+ 1/,
      'the increment must be in the claiming UPDATE — a separate write reopens the race');
  });

  test('CLAIM_SQL refuses to select a task at or above the cap', () => {
    const sql = A.CLAIM_SQL.replace(/\s+/g, ' ');
    // ANCHORED to the end of the predicate. Round-4 verification found the unanchored form
    // (/< \$6/) is satisfied by anything appended to the right-hand side: `< $6 + 1` (cap
    // silently 13), `< $6 + 1000000` (cap silently 1,000,012 — the 365-claim runaway returns
    // with no other symptom and no failing test), and `< $6 OR TRUE` (the whole WHERE
    // short-circuits, so agents claim rows already claimed by others). All three passed the old
    // assertion, and the call-site test cannot catch them because the BIND VALUE is unchanged.
    assert.match(sql, /AND COALESCE\(claim_count, ?0\) < \$6 ORDER BY/,
      'the cap predicate is the whole fix; without it claim_count is just telemetry');
    assert.ok(!/< \$6 *(\+|OR\b|AND\b)/.test(sql),
      'nothing may be appended to the cap comparison — a widened right-hand side disarms the cap silently');
  });

  test('CLAIM_SQL still carries the race-safety guards it had before', () => {
    const sql = A.CLAIM_SQL.replace(/\s+/g, ' ');
    for (const guard of ['FOR UPDATE SKIP LOCKED', 'LIMIT 1', 'claimed_by IS NULL',
      'ORDER BY priority DESC, created_at ASC']) {
      assert.ok(sql.includes(guard), `lost pre-existing guard: ${guard}`);
    }
    assert.ok(!/SELECT \*/.test(sql), 'SELECT * would reintroduce the 2026-06-19 egress bug');
  });

  test('CLAIM_SQL returns claim_count so callers can see how contested a task is', () => {
    assert.match(A.CLAIM_SQL.replace(/\s+/g, ' '), /RETURNING [^)]*claim_count/);
  });

  test('every $N placeholder in CLAIM_SQL is actually bound by buildClaimParams', () => {
    // Regression for mutation M12, which SURVIVED the first version of this suite: the SQL
    // asserted the cap while the call site quietly stopped passing it. That is not a degraded
    // cap — Postgres rejects the statement, getNextTask() catches and returns null, and the whole
    // fleet goes idle looking exactly like an empty queue. String assertions on the SQL alone
    // cannot see it; only comparing the SQL against the real bind list can.
    const highest = Math.max(...[...A.CLAIM_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    const params = A.buildClaimParams('trinity-test', new Date().toISOString(), [], null);
    assert.equal(params.length, highest,
      `CLAIM_SQL binds up to $${highest} but buildClaimParams supplies ${params.length}`);
    assert.equal(params[highest - 1], A.maxTaskClaims(), 'the cap must be the last bind');
    assert.ok(params.every((p) => p !== undefined), 'an undefined bind is a runtime query error');
  });

  test('the mirror and the SQL agree on the claimable status set', () => {
    // pending_clarification is claimable BY DESIGN (#25). Recorded here so that if
    // someone removes it, they do it deliberately and see this test.
    assert.deepEqual(A.CLAIMABLE_STATUSES, ['pending', 'todo', 'assigned', 'pending_clarification']);
  });

  console.log(`\nclaimCap.test.js: ${passed} passed`);
  if (process.exitCode) console.error('claimCap.test.js: FAILURES ABOVE');
}

run();
