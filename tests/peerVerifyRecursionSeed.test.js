'use strict';

/**
 * CALL-SITE tests for the three ways processPeerVerifyTask could manufacture the wedge.
 *
 * WHY CALL-SITE AND NOT STRING ASSERTIONS. claimCap.test.js's sibling file already records
 * what happens when a suite proves the SQL constant carries a guard: the live code can hand-
 * build its params at the call site and cap nothing while 15/15 tests stay green. So every
 * assertion here inspects what the method actually SENT — the SQL text and binds that reached
 * the pg layer, and the payload that reached supabase — not what the source file contains.
 *
 * THE THREE DEFECTS, all measured against production on 2026-09-22:
 *
 *  1. `result` was `Peer verification completed with verdict: X. Response ID: ...`, and the
 *     bridge enqueues a completed task's `result` as a claim. 36,193 rows of
 *     peer_verification_queue ARE that sentence — the queue verifying its own output. Those
 *     rows are now closed `stale`/recursive_meta_verification. The fence that caught them,
 *     `RE_RECURSIVE = /peer verification completed/i` in repid-engine's peer-verify-prefilter,
 *     is keyed to prose this file emits: one reword and it stops matching, silently.
 *
 *  2. The claim predicate was `verification_status IN ('pending','in_review')` — not exclusive.
 *     With the verdict POSTed in a separate step after an LLM call, a worker dying in between
 *     stranded the row, and with no timestamp nothing could tell a stale claim from a live one.
 *     62,841 rows wedged that way, frozen since 2026-07-21.
 *
 *  3. `REPID_API_KEY || 'test-key-123'` meant a service missing the variable POSTed every
 *     verdict with an invalid credential. The engine rejects it, the row stays `in_review`,
 *     and the result is indistinguishable from a dead verifier — the same wedge, arrived at
 *     silently from a config mistake.
 *
 * Run: node tests/peerVerifyRecursionSeed.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// --- Stub the pg layer BEFORE ConstitutionalAgentV4 loads (it destructures at module scope) ---
const PG_PATH = require.resolve('../lib/direct-pg');
delete require.cache[PG_PATH];
const pgCalls = [];
let pgResult = [];
const stub = {
  getPgPool: () => { throw new Error('getPgPool must not be called in this test'); },
  pgQuery: async (sql, params, opts) => { pgCalls.push({ sql, params, opts }); return pgResult; },
  pgPing: async () => true,
  closePgPool: async () => {},
};
require.cache[PG_PATH] = new Module(PG_PATH, null);
require.cache[PG_PATH].filename = PG_PATH;
require.cache[PG_PATH].path = path.dirname(PG_PATH);
require.cache[PG_PATH].loaded = true;
require.cache[PG_PATH].exports = stub;

const A = require('../lib/ConstitutionalAgentV4');

// If the swap failed we would be querying no database and every assertion would be vacuous.
assert.equal(require('../lib/direct-pg').pgQuery, stub.pgQuery,
  'the direct-pg stub is not installed — every assertion in this file would be vacuous');

const ORIG_ENV = { ...process.env };
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };
const ta = async (name, fn) => { await fn(); pass++; console.log(`  ok  ${name}`); };

/** The EXACT regex repid-engine's prefilter uses (src/services/peer-verify-prefilter.ts). */
const RE_RECURSIVE = /peer verification completed/i;

function agent(over = {}) {
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-test',
    log: async () => {},
    ...over,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('1. the claim predicate');

(async () => {
  await ta('claims pending, and in_review ONLY past the lease TTL', async () => {
    pgCalls.length = 0;
    pgResult = [];
    const a = agent();
    // Drive only the claim leg; an empty RETURNING makes the method soft-skip after it.
    a.supabase = { from: () => ({ update: () => ({ eq: async () => ({}) }) }) };
    await a.processPeerVerifyTask({ id: 1, metadata: { peer_verification_queue_id: 77 } })
      .catch(() => {});

    assert.ok(pgCalls.length >= 1, 'no pg query was issued at all');
    const sql = pgCalls[0].sql.replace(/\s+/g, ' ');

    // The defect: a bare IN (...) list that re-accepts a live claim.
    assert.ok(!/verification_status IN \('pending', ?'in_review'\)/i.test(sql),
      'claim still re-accepts in_review unconditionally — a live claim is stealable');

    // The fix: a fresh in_review row is only takeable once its lease has expired.
    assert.ok(/claimed_at\s+IS NOT NULL/i.test(sql),
      'claim does not require claimed_at — it cannot tell a stale claim from a live one');
    assert.ok(/claimed_at\s*<\s*now\(\)\s*-\s*make_interval/i.test(sql),
      'claim has no TTL comparison — an expired lease is never reclaimable');
    assert.ok(/SET[\s\S]*claimed_at\s*=\s*now\(\)/i.test(sql),
      'claim does not stamp claimed_at — the next reclaim could not date this one');

    // The TTL must be a BIND, not interpolated text.
    assert.equal(pgCalls[0].params[0], 77, 'queue id is not the first bind');
    assert.equal(typeof pgCalls[0].params[1], 'number', 'lease TTL is not passed as a numeric bind');
  });

  // ───────────────────────────────────────────────────────────────────────────
  console.log('2. the result field the bridge enqueues as a claim');

  await ta('EVERY result this path writes evades the recursion regex — both write sites', async () => {
    pgCalls.length = 0;
    pgResult = [{ id: 77, claim_text: 'x', certainty_at_claim: 0.5,
                  source_agent_id: 'src', verification_status: 'in_review' }];

    const writes = [];
    const a = agent({
      supabase: { from: (tbl) => ({ update: (payload) => ({ eq: async (_c, id) => { writes.push({ tbl, payload, id }); return {}; } }) }) },
      _postPeerVerdict: async () => ({ ok: true, status: 200, errTxt: null,
                                       alreadyProcessed: false, verifierResponseId: 'resp-1' }),
    });

    // No LLM is stubbed, so this drives the TIMEOUT leg — which is the leg that mattered:
    // its old string was `Peer verification submitted verdict: ...`, and "submitted" is not
    // "completed", so RE_RECURSIVE never matched it. 2 rows in production carry that text
    // [MEASURED 2026-09-22]. The regex had already been evaded by a sibling line in the same
    // method as the string it was written for.
    await a.processPeerVerifyTask({ id: 1, metadata: { peer_verification_queue_id: 77 } })
      .catch(() => {});

    const done = writes.filter((w) => w.tbl === 'trinity_tasks' && w.payload.status === 'done');
    assert.ok(done.length > 0, 'no trinity_tasks completion was written — the test drove nothing');

    for (const w of done) {
      // THE LOAD-BEARING ASSERTION.
      assert.ok(!RE_RECURSIVE.test(w.payload.result),
        `result re-seeds the recursion: ${JSON.stringify(w.payload.result)}`);
      // And the broader shape the regex was reaching for, so the NEXT reword is caught here
      // rather than in the queue six weeks later.
      assert.ok(!/^\s*peer verification\b/i.test(w.payload.result),
        `result still opens as a peer-verification claim: ${JSON.stringify(w.payload.result)}`);
      // The STRUCTURAL guard isPeerVerificationTask() keys on this. Explicit, not incidental —
      // it is what holds when the content fence does not.
      assert.equal(w.payload.metadata.peer_verification_queue_id, 77,
        'peer_verification_queue_id missing — the structural recursion guard would not fire');
      // The verdict must survive, structurally.
      assert.ok(w.payload.metadata.peer_verify && w.payload.metadata.peer_verify.verdict,
        'the verdict was dropped rather than moved into metadata.peer_verify');
    }
  });

  // ───────────────────────────────────────────────────────────────────────────
  console.log('3. the credential fallback');

  await ta('refuses to POST a verdict with no REPID_API_KEY, instead of using a literal', async () => {
    // The HMAC secret is checked FIRST and also throws, so it has to be present or this
    // test proves nothing about the credential path — it would just be re-asserting the
    // HMAC guard under a misleading name.
    process.env.PEER_VERIFY_HMAC_SECRET = 'test-hmac-secret-not-a-real-key';
    delete process.env.REPID_API_KEY;

    const a = agent();
    let threw = null;
    await a._postPeerVerdict(77, 'verified').catch((e) => { threw = e; });

    assert.ok(threw, 'no REPID_API_KEY and it still tried to POST — the old test-key-123 path');
    assert.match(threw.message, /REPID_API_KEY/,
      'the refusal does not name the missing variable, so the operator cannot act on it');
    // Prove it is THIS guard firing and not the HMAC one standing in for it.
    assert.doesNotMatch(threw.message, /HMAC/i,
      'the HMAC guard threw first — this assertion was not exercising the credential path');

    process.env = { ...ORIG_ENV };
  });

  console.log(`\n${pass} assertions passed`);
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
