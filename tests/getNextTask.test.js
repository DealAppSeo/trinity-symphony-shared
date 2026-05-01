// Soft-preference routing test for ConstitutionalAgent.getNextTask
// Run: node tests/getNextTask.test.js

'use strict';

const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

// Stub the missing local require './utils/merkle' that constitutional-agent-base.js
// imports at module top. Without this, requiring the file throws MODULE_NOT_FOUND.
const STUB_ID = '__test_stub_utils_merkle__';
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === './utils/merkle') return STUB_ID;
  return origResolve.call(this, request, parent, ...rest);
};
require.cache[STUB_ID] = {
  id: STUB_ID,
  filename: STUB_ID,
  loaded: true,
  exports: {},
  children: [],
  paths: [],
};

// Provide minimal env so createClient() in constructor doesn't crash on URL parse.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-token';

const { ConstitutionalAgent } = require('../constitutional-agent-base.js');

// Mock supabase that records the chained filters/orders and resolves .single()
// against an in-memory task array.
function makeMockSupabase(tasks) {
  return {
    from(table) {
      assert.equal(table, 'trinity_tasks');
      const filters = [];
      const orders = [];
      let limitN = Infinity;
      const builder = {
        select() { return builder; },
        eq(col, val) { filters.push(t => t[col] === val); return builder; },
        is(col, val) {
          if (val === null) filters.push(t => t[col] == null);
          else filters.push(t => t[col] === val);
          return builder;
        },
        not(col, op, val) {
          if (op === 'is' && val === null) filters.push(t => t[col] != null);
          else throw new Error(`mock .not(${col}, ${op}, ${val}) not implemented`);
          return builder;
        },
        neq(col, val) { filters.push(t => t[col] !== val); return builder; },
        in(col, vals) { filters.push(t => vals.includes(t[col])); return builder; },
        order(col, opts) {
          orders.push({ col, asc: !(opts && opts.ascending === false) });
          return builder;
        },
        limit(n) { limitN = n; return builder; },
        single() {
          let rows = tasks.filter(t => filters.every(f => f(t)));
          rows = rows.slice().sort((a, b) => {
            for (const o of orders) {
              const av = a[o.col], bv = b[o.col];
              if (av < bv) return o.asc ? -1 : 1;
              if (av > bv) return o.asc ? 1 : -1;
            }
            return 0;
          });
          rows = rows.slice(0, limitN);
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
      };
      return builder;
    },
  };
}

function makeAgent(name, tasks) {
  // Bypass the real constructor (which spins up supabase + redis clients)
  const agent = Object.create(ConstitutionalAgent.prototype);
  agent.name = name;
  agent.supabase = makeMockSupabase(tasks);
  return agent;
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
    failed++;
  }
}

(async () => {
  // (a) self-tagged task is claimed
  await test('a) self-tagged task is claimed by that agent', async () => {
    const tasks = [{ id: 1, assigned_to: 'X', status: 'pending', priority: 5, created_at: 't1' }];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 1);
  });

  // (b) unassigned task is claimed
  await test('b) unassigned (NULL) task is claimed', async () => {
    const tasks = [{ id: 2, assigned_to: null, status: 'pending', priority: 5, created_at: 't1' }];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 2);
  });

  // (c) Option B: task tagged for Y CAN now be claimed by X (poaching). Sole task in queue.
  await test('c) Option B: task tagged for Y is poached by X when no other tasks exist', async () => {
    const tasks = [{ id: 3, assigned_to: 'Y', status: 'pending', priority: 5, created_at: 't1' }];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 3, 'Option B allows any agent to claim any task');
  });

  // (d) when self-tagged AND unassigned both exist, self-tagged wins (even with lower priority)
  await test('d) self-tagged preferred over unassigned even if NULL has higher priority', async () => {
    const tasks = [
      { id: 100, assigned_to: null, status: 'pending', priority: 99, created_at: 't0' },
      { id: 200, assigned_to: 'X',  status: 'pending', priority: 1,  created_at: 't1' },
    ];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 200);
  });

  // (e) full preference cascade: self > null > others
  await test('e) preference order: self > unassigned > poach others (highest priority Y ignored)', async () => {
    const tasks = [
      { id: 10, assigned_to: 'Y',  status: 'pending', priority: 99, created_at: 't0' },
      { id: 20, assigned_to: null, status: 'pending', priority: 50, created_at: 't1' },
      { id: 30, assigned_to: 'X',  status: 'pending', priority: 1,  created_at: 't2' },
    ];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 30);
  });

  // (f) only other-agent tasks: poaching falls back to highest priority
  await test('f) poaches highest-priority other-agent task when no self/null available', async () => {
    const tasks = [
      { id: 11, assigned_to: 'Y', status: 'pending', priority: 5, created_at: 't0' },
      { id: 12, assigned_to: 'Z', status: 'pending', priority: 9, created_at: 't1' },
    ];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 12);
  });

  // (g) status filter: completed/in_progress are ignored
  await test('g) ignores completed/in_progress tasks', async () => {
    const tasks = [
      { id: 21, assigned_to: 'X',  status: 'completed',   priority: 99, created_at: 't0' },
      { id: 22, assigned_to: null, status: 'in_progress', priority: 99, created_at: 't0' },
      { id: 23, assigned_to: 'X',  status: 'pending',     priority: 1,  created_at: 't2' },
    ];
    const agent = makeAgent('X', tasks);
    const t = await agent.getNextTask();
    assert.equal(t && t.id, 23);
  });

  // (h) empty queue returns null
  await test('h) empty queue returns null', async () => {
    const agent = makeAgent('X', []);
    const t = await agent.getNextTask();
    assert.equal(t, null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
