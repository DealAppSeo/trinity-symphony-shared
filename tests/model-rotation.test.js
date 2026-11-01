'use strict';
/**
 * MODEL DIVERSITY (2026-11-01: 9 of 10 T12 tasks ran on groq's openai/gpt-oss-20b, because every
 * agent asked groq first. Per-agent comparisons and peer checks were one model checking itself).
 *  - FREE_ROTATE_BY_AGENT=on: each agent starts its free providers at its roster index, so the 12
 *    agents spread evenly (4/4/4 over three providers). Off by default: nothing changes until set.
 *  - Gateway answers record the provider LiteLLM routed to (x-litellm-model-api-base), not just 'auto'.
 * The REAL gate, callLLM and callProvider run here; only fetch is faked.
 * Run: node tests/model-rotation.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const ORIG = { log: console.log, warn: console.warn, error: console.error, env: { ...process.env }, fetch: global.fetch };
const A = require('../lib/ConstitutionalAgentV4');
const gate = require('../lib/free-tier-gate');

const ROSTER = ['trinity-orch', 'trinity-w3c', 'trinity-shofet', 'trinity-torch', 'trinity-veritas', 'trinity-gcm',
  'trinity-chesed', 'trinity-mel', 'trinity-apm', 'trinity-sophia', 'trinity-nexus', 'trinity-hdm'];
const SLOTS = [{ provider: 'nvidia', model: 'm' }, { provider: 'groq', model: 'm' }, { provider: 'openrouter', model: 'x/y:free' }];
const ON = { FREE_ROTATE_BY_AGENT: 'on' };
const names = (list) => list.map((p) => p.provider);

function agent(name, providers) {
  return Object.assign(Object.create(A.prototype), {
    name, availableProviders: [...providers], sessionMetrics: { llmCalls: 0 },
    supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) }) }) },
  });
}
const ok = (model, headers = {}) => ({
  ok: true, status: 200, text: async () => '',
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => ({ model, choices: [{ message: { role: 'assistant', content: 'done' } }] }),
});

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env, GROQ_API_KEY: 'test-not-a-key', NVIDIA_API_KEY: 'test-not-a-key', OPENROUTER_API_KEY: 'test-not-a-key', OPENROUTER_MODEL: 'x/y:free' };
    for (const k of ['LLM_GATEWAY_FIRST', 'LITELLM_URL', 'LITELLM_MASTER_KEY', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID', 'FREE_ROTATE_BY_AGENT']) delete process.env[k];
    gate.resetExhaustion();
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; global.fetch = ORIG.fetch; }
  };

  // ── the gate ──
  await test('off (the default): every agent keeps the fixed order, groq first', async () => {
    for (let i = 0; i < 12; i++) assert.deepEqual(names(gate.orderProviders([...SLOTS], { rotateBy: i, env: {} })), ['groq', 'openrouter', 'nvidia']);
  });

  await test('on: the 12 roster positions spread first choices 4/4/4, and failover keeps the cycle', async () => {
    const first = {};
    for (let i = 0; i < 12; i++) {
      const order = names(gate.orderProviders([...SLOTS], { rotateBy: i, env: ON }));
      first[order[0]] = (first[order[0]] || 0) + 1;
      assert.equal(new Set(order).size, 3, 'every provider is still in the failover list');
    }
    assert.deepEqual(first, { groq: 4, openrouter: 4, nvidia: 4 });
    assert.deepEqual(names(gate.orderProviders([...SLOTS], { rotateBy: 1, env: ON })), ['openrouter', 'nvidia', 'groq']);
  });

  await test('on: paid slots (only when allowed) stay last; a non-free openrouter is not rotated in', async () => {
    const withPaid = [...SLOTS, { provider: 'openai', model: 'gpt' }];
    assert.deepEqual(names(gate.orderProviders(withPaid, { rotateBy: 2, env: ON, allowPaid: true })), ['nvidia', 'groq', 'openrouter', 'openai']);
    const paidOR = [{ provider: 'groq' }, { provider: 'openrouter', model: 'deepseek/deepseek-chat' }, { provider: 'nvidia' }];
    assert.deepEqual(names(gate.orderProviders(paidOR, { rotateBy: 1, env: ON })), ['nvidia', 'groq'], 'not free: still excluded');
    assert.deepEqual(names(gate.orderProviders(paidOR, { rotateBy: 1, env: ON, allowPaid: true })), ['nvidia', 'groq', 'openrouter'], 'paid: after the free ones');
  });

  await test('on, but no usable offset or fewer than two free providers: unchanged', async () => {
    for (const by of [undefined, -1, 1.5, '1']) assert.deepEqual(names(gate.orderProviders([...SLOTS], { rotateBy: by, env: ON })), ['groq', 'openrouter', 'nvidia']);
    assert.deepEqual(names(gate.orderProviders([{ provider: 'groq' }], { rotateBy: 5, env: ON })), ['groq']);
    gate.markExhausted('groq');
    assert.deepEqual(names(gate.orderProviders([...SLOTS], { rotateBy: 1, env: ON })), ['nvidia', 'openrouter'], 'an exhausted provider is still skipped');
  });

  // ── the agent ──
  await test('roster index: the 12 agents are 0..11 in AGENT_WISDOM order; an unknown name gets a stable number', async () => {
    assert.deepEqual(ROSTER.map((n) => agent(n, []).__proto__._rotationIndex.call(agent(n, []))), [...Array(12).keys()]);
    const x = agent('trinity-new', [])._rotationIndex();
    assert.ok(Number.isInteger(x) && x >= 0);
    assert.equal(agent('trinity-new', [])._rotationIndex(), x);
  });

  await test('real callLLM: with rotation on, orch asks groq, w3c openrouter, shofet nvidia first; off, all ask groq', async () => {
    const firstHost = async (name) => {
      const hosts = [];
      global.fetch = async (u) => { hosts.push(new URL(u).host); return ok('m'); };
      await agent(name, ['groq', 'openrouter', 'nvidia']).callLLM('q');
      return hosts[0];
    };
    assert.deepEqual(await Promise.all(['trinity-orch', 'trinity-w3c', 'trinity-shofet'].map(firstHost)), ['api.groq.com', 'api.groq.com', 'api.groq.com']);
    process.env.FREE_ROTATE_BY_AGENT = 'on';
    const on = [];
    for (const n of ['trinity-orch', 'trinity-w3c', 'trinity-shofet']) on.push(await firstHost(n));
    assert.deepEqual(on, ['api.groq.com', 'openrouter.ai', 'integrate.api.nvidia.com']);
  });

  await test("gateway: the model records the provider LiteLLM routed to (auto@host); no header keeps 'auto'", async () => {
    Object.assign(process.env, { LLM_GATEWAY_FIRST: 'true', LITELLM_URL: 'http://gw.test', LITELLM_MASTER_KEY: 'test-not-a-key' });
    global.fetch = async () => ok('auto', { 'x-litellm-model-api-base': 'https://integrate.api.nvidia.com/v1' });
    assert.equal((await agent('trinity-orch', ['groq']).callLLM('q')).model, 'auto@integrate.api.nvidia.com');
    global.fetch = async () => ok('auto');
    assert.equal((await agent('trinity-orch', ['groq']).callLLM('q')).model, 'auto');
    global.fetch = async () => ok('auto', { 'x-litellm-model-api-base': 'not a url' });
    assert.equal((await agent('trinity-orch', ['groq']).callLLM('q')).model, 'auto', 'a malformed header keeps the alias');
  });

  await test('control: a direct provider ignores the gateway header', async () => {
    global.fetch = async () => ok('openai/gpt-oss-20b', { 'x-litellm-model-api-base': 'https://elsewhere.test/v1' });
    assert.equal((await agent('trinity-orch', ['groq']).callLLM('q')).model, 'openai/gpt-oss-20b');
  });

  ORIG.log(`model-rotation.test.js: ${passed}/8 passed`);
}

run().catch((e) => { console.log = ORIG.log; ORIG.log(e); process.exit(1); });
