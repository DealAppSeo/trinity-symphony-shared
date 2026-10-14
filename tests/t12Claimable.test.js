'use strict';

/**
 * T12 claimability + idle loudness (CC1 sprint 2026-10-14).
 *
 * Pins three things measured on prod [V sql 2026-10-14]:
 *  1. CLAIM_SQL's RETURNING is the task object every consumer reads. #27 (2026-06-19) dropped
 *     success_criteria from it, and the contract loop (mel) released every claim as
 *     success_criteria_missing from that deploy on — 251,374 HITL rows, 0 before.
 *  2. A peer_verify ballot carries its contract structurally (metadata.peer_verification_queue_id),
 *     so understandTask() must not demand prose criteria the panel dispatcher never writes.
 *  3. An idle agent says WHY it is idle, at most once per interval, and never throws doing so.
 *
 * Run: node tests/t12Claimable.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// --- Stub direct-pg before the agent module loads (same pattern as claimCallSite.test.js) ---
const PG_PATH = require.resolve('../lib/direct-pg');
const calls = [];
let respond = () => [];
const stub = {
  getPgPool: () => { throw new Error('getPgPool must not be called in this test'); },
  pgQuery: async (sql, params, opts) => {
    calls.push({ sql, params, opts });
    return respond(sql, params);
  },
  pgPing: async () => ({ ok: true, latencyMs: 1 }),
  closePgPool: async () => {},
};
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], { filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true, exports: stub });

const A = require('../lib/ConstitutionalAgentV4');
assert.equal(require('../lib/direct-pg').pgQuery, stub.pgQuery, 'direct-pg stub not installed — assertions would be vacuous');

const ORIG_ENV = { ...process.env };

function agent(over = {}) {
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-mel',
    claimHistory: new Map(),
    MAX_CLAIM_RETRIES: 3,
    ...over,
  });
}

/** The columns CLAIM_SQL hands back, parsed from the live statement. */
function returningColumns() {
  const sql = A.CLAIM_SQL;
  return sql.slice(sql.lastIndexOf('RETURNING') + 'RETURNING'.length)
    .split(',').map((c) => c.trim()).filter(Boolean);
}

/** Simulate Postgres: the claimed row, projected to exactly the RETURNING list. */
function project(row) {
  return Object.fromEntries(returningColumns().map((c) => [c, row[c] === undefined ? null : row[c]]));
}

// A real shape from prod: task 435149 (analysis, assigned to mel, success_criteria 139 chars),
// released 12x as success_criteria_missing.
const ROW_WITH_CRITERIA = {
  id: 435149, title: 'LOOP C3 MEASUREMENT', description: 'Read-only measurement of the grounding rule impact.',
  metadata: null, priority: 85, task_type: 'analysis', agent_assigned: null, status: 'doing', claim_count: 1,
  success_criteria: 'A table of before/after grounding-rule hit rates with the query that produced it.',
  requires_external_artifact: false, assigned_to: 'trinity-mel', created_at: '2026-09-17T09:10:24Z',
};
// The 2026-09-23 blind-panel ballot shape: no success_criteria at all.
const PANEL_BALLOT = {
  id: 435511, title: '[PEER_VERIFY_PANEL] Verify response from trinity-chesed', description: 'BLIND panel vote. Verify the claim independently.',
  metadata: { panel: 'blind_2of3', panel_verifier: 'trinity-mel', peer_verification_queue_id: 142077 },
  priority: 80, task_type: 'peer_verify', agent_assigned: 'trinity-mel', status: 'doing', claim_count: 1,
  success_criteria: null, requires_external_artifact: null,
};

const CONSUMERS = [
  'understandTask', 'checkCapability', 'processTaskContract', 'processTask', 'processPeerVerifyTask',
  'tryDeterministicPulseCheck', 'validateSubstance', '_enforceArtifact', 'evaluateResult', 'spawnNextStep',
  '_postSubstanceGateEvent', '_runArtifactGuardCheck', 'handleArtifactRejection', 'recordConfused',
];

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    calls.length = 0;
    respond = () => [];
    process.env = { ...ORIG_ENV };
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

  // ---------- 1. RETURNING carries what the consumers read ----------

  await test('every task.<field> a claim consumer reads is in CLAIM_SQL RETURNING', async () => {
    const cols = new Set(returningColumns());
    const sources = CONSUMERS.map((m) => {
      assert.equal(typeof A.prototype[m], 'function', `consumer ${m} no longer exists — update CONSUMERS`);
      return A.prototype[m].toString();
    }).concat(A.isDeliverableTask.toString());
    const read = new Set();
    for (const src of sources) {
      for (const m of src.matchAll(/\b(?:task|originalTask)\??\.([a-z_]+)/g)) read.add(m[1]);
    }
    assert.ok(read.has('success_criteria'), 'sanity: the consumers do read success_criteria');
    const missing = [...read].filter((f) => !cols.has(f));
    assert.deepEqual(missing, [], `claimed task is missing ${missing.join(', ')} — consumers would read undefined`);
  });

  await test('a claimed task that HAS criteria passes understandTask (the 2026-06-19 regression)', async () => {
    respond = () => [project(ROW_WITH_CRITERIA)];
    const a = agent();
    const task = await a.getNextTask();
    assert.equal(task.id, 435149);
    assert.deepEqual(await a.understandTask(task), { ok: true },
      'understandTask rejected a task whose DB row has success_criteria — RETURNING dropped the column');
  });

  await test('CLAIM_SQL keeps returning the original columns (no egress regression back to SELECT *)', async () => {
    const cols = returningColumns();
    for (const c of ['id', 'title', 'description', 'metadata', 'priority', 'task_type', 'agent_assigned', 'status', 'claim_count']) {
      assert.ok(cols.includes(c), `lost RETURNING column ${c}`);
    }
    assert.ok(!cols.includes('*'), 'RETURNING * would reintroduce the 2026-06-19 egress bug');
  });

  // ---------- 2. peer_verify ballots are understood structurally ----------

  await test('a panel ballot with a queue id and no criteria is understood (mel can vote)', async () => {
    respond = () => [project(PANEL_BALLOT)];
    const a = agent();
    const task = await a.getNextTask();
    assert.deepEqual(await a.understandTask(task), { ok: true });
    assert.deepEqual(await a.checkCapability(task), { ok: true }, 'peer_verify must stay a known type');
  });

  await test('the structural pass is narrow: peer_verify WITHOUT a queue id still needs criteria', async () => {
    const r = await agent().understandTask({ ...PANEL_BALLOT, metadata: { panel: 'blind_2of3' } });
    assert.deepEqual(r, { ok: false, reason: 'success_criteria_missing' });
  });

  await test('non-peer_verify tasks with no criteria are still rejected', async () => {
    const r = await agent().understandTask({ ...ROW_WITH_CRITERIA, success_criteria: '   ' });
    assert.deepEqual(r, { ok: false, reason: 'success_criteria_missing' });
  });

  // ---------- 3. fail loud when idle ----------

  // The live breakdown for trinity-mel at 2026-10-14 ~17:20Z (IDLE_REASONS_SQL run read-only on prod).
  const MEL_ROWS = [
    { reason: 'claim_cap', n: 24 }, { reason: 'claimed_by_set', n: 8 }, { reason: 'assigned_elsewhere', n: 5 },
  ];

  await test('idle line names the agent, the claimable count, the total and the top reasons', async () => {
    respond = () => MEL_ROWS;
    const logged = [];
    const orig = console.warn;
    console.warn = (l) => logged.push(l);
    try {
      const line = await agent().reportIdleIfDue();
      assert.equal(line, '[idle] trinity-mel: 0 claimable of 37 pending — top reasons: claim_cap=24, claimed_by_set=8, assigned_elsewhere=5');
      assert.deepEqual(logged, [line], 'the line must actually be logged, once');
    } finally { console.warn = orig; }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sql, A.IDLE_REASONS_SQL);
    assert.ok(!/SELECT \*/i.test(calls[0].sql), 'the diagnosis is a COUNT, not a row fetch');
  });

  await test('an empty queue says so instead of listing no reasons', async () => {
    assert.equal(A.formatIdleLine('trinity-gcm', []),
      '[idle] trinity-gcm: 0 claimable of 0 pending — top reasons: none, the queue is empty');
  });

  await test('the idle report is rate-limited to once per IDLE_LOG_INTERVAL_MS', async () => {
    process.env.IDLE_LOG_INTERVAL_MS = '60000';
    respond = () => MEL_ROWS;
    let t = 1_000_000;
    const a = agent({ _now: () => t });
    const orig = console.warn;
    console.warn = () => {};
    try {
      assert.ok(await a.reportIdleIfDue(), 'first idle poll reports');
      t += 59_999;
      assert.equal(await a.reportIdleIfDue(), null, 'inside the window: silent, and no query');
      assert.equal(calls.length, 1);
      t += 1;
      assert.ok(await a.reportIdleIfDue(), 'window elapsed: reports again');
      assert.equal(calls.length, 2);
    } finally { console.warn = orig; }
  });

  await test('a failed diagnosis is logged loudly and never throws into the loop', async () => {
    respond = () => { throw new Error('pooler down'); };
    const errs = [];
    const orig = console.error;
    console.error = (l) => errs.push(String(l));
    try {
      assert.equal(await agent().reportIdleIfDue(), null);
    } finally { console.error = orig; }
    assert.equal(errs.length, 1);
    assert.match(errs[0], /\[idle\] trinity-mel: idle diagnosis query FAILED \(pooler down\)/);
  });

  await test('the idle query binds the SAME filters the claim does (blacklist, type filter, cap, statuses)', async () => {
    process.env.CAPABILITY_FILTER = 'true';
    process.env.AGENT_TASK_TYPES = 'peer_verify,analysis';
    process.env.MAX_TASK_CLAIMS = '9';
    const a = agent({ claimHistory: new Map([[435511, 3], [435514, 2]]) });
    const orig = console.warn;
    console.warn = () => {};
    try {
      await a.getNextTask();      // empty → null
      await a.reportIdleIfDue();
    } finally { console.warn = orig; }
    const [claim, idle] = calls;
    assert.equal(idle.sql, A.IDLE_REASONS_SQL);
    // CLAIM_SQL: [$1 name, $2 now, $3 statuses, $4 blacklist, $5 types, $6 cap]
    // IDLE_SQL:  [$1 name,         $2 statuses, $3 blacklist, $4 types, $5 cap]
    assert.deepEqual(idle.params, [claim.params[0], claim.params[2], claim.params[3], claim.params[4], claim.params[5]]);
    assert.deepEqual(idle.params[2], [435511], 'blacklist = only ids at MAX_CLAIM_RETRIES');
    assert.deepEqual(idle.params[3], ['peer_verify', 'analysis']);
    assert.equal(idle.params[4], 9);
    const highest = Math.max(...[...A.IDLE_REASONS_SQL.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    assert.equal(highest, idle.params.length, 'every $N must be bound — an unbound $N is a query error every poll');
  });

  await test('IDLE_REASONS_SQL classifies with every guard CLAIM_SQL serves on', async () => {
    const claim = A.CLAIM_SQL.replace(/\s+/g, ' ');
    const idle = A.IDLE_REASONS_SQL.replace(/\s+/g, ' ');
    // [guard in CLAIM_SQL, same guard renumbered in IDLE_REASONS_SQL]
    const pairs = [
      ['assigned_to = $1 OR (assigned_to IS NULL AND (agent_assigned = $1 OR agent_assigned IS NULL))',
        'assigned_to = $1 OR (assigned_to IS NULL AND (agent_assigned = $1 OR agent_assigned IS NULL))'],
      ['status = ANY($3)', 'status = ANY($2)'],
      ['claimed_by IS NULL', 'claimed_by IS NOT NULL'],
      ['$5::text[] IS NULL OR task_type IS NULL OR task_type = ANY($5)', '$4::text[] IS NULL OR task_type IS NULL OR task_type = ANY($4)'],
      ['id = ANY($4::bigint[])', 'id = ANY($3::bigint[])'],
      ['COALESCE(claim_count, 0) < $6', 'COALESCE(claim_count, 0) >= $5'],
    ];
    for (const [c, i] of pairs) {
      assert.ok(claim.includes(c), `CLAIM_SQL no longer has "${c}" — update IDLE_REASONS_SQL to match`);
      assert.ok(idle.includes(i), `IDLE_REASONS_SQL lost "${i}"`);
    }
  });

  await test('both loops report idle on the no-task branch (call sites pinned)', async () => {
    for (const loop of ['runLoop', 'runLoopLegacy']) {
      const src = A.prototype[loop].toString();
      const n = (src.match(/this\.reportIdleIfDue\(\)/g) || []).length;
      assert.equal(n, 1, `${loop} must call reportIdleIfDue() exactly once, found ${n}`);
    }
    const legacy = A.prototype.runLoopLegacy.toString();
    assert.match(legacy, /\}\s*else\s*\{\s*await this\.reportIdleIfDue\(\)/, 'legacy loop: idle report belongs on the no-task branch');
    const contract = A.prototype.runLoop.toString();
    assert.ok(contract.indexOf('reportIdleIfDue') > contract.indexOf('if (!task)')
      && contract.indexOf('reportIdleIfDue') < contract.indexOf('Processing (Contract)'),
      'contract loop: idle report belongs inside if (!task)');
  });

  // ---------- 4. heartbeat mode is no longer silent ----------

  await test('mode=off is announced at boot, naming the tables it stops writing', async () => {
    const off = A.formatHeartbeatModeLine('trinity-mel', 'off', 120000);
    assert.match(off, /mode=off/);
    assert.match(off, /agent_heartbeat/);
    assert.match(off, /NOT written/);
    assert.match(A.formatHeartbeatModeLine('trinity-mel', 'throttled', 120000), /every 120000ms/);
    assert.match(A.prototype.start.toString(), /formatHeartbeatModeLine\(this\.name, this\.heartbeatMode/,
      'start() must log the resolved mode');
  });

  console.log(`\n${passed} passed`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
