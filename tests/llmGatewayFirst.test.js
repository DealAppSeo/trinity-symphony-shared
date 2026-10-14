'use strict';

/**
 * LLM_GATEWAY_FIRST + mel's 'analysis' capability (CC1 2026-10-14).
 *
 * Pins:
 *  1. Flag unset => callLLM's first request is exactly what it was before (no gateway call).
 *  2. Flag set   => the first request goes to $LITELLM_URL/v1/chat/completions with a POOL
 *     name ('auto', or 'auto-coder' for code tasks) and the real master key; on any gateway
 *     failure the direct chain runs unchanged.
 *  3. A missing master key SKIPS the hop loudly. No placeholder key is ever sent.
 *  4. checkCapability accepts 'analysis' (mel escalated every analysis task without it).
 *
 * Run: node tests/llmGatewayFirst.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

// Stub direct-pg before the agent module loads (same pattern as t12Claimable.test.js).
const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg in this test'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const A = require('../lib/ConstitutionalAgentV4');
const { gatewayHop } = require('../lib/llm-gateway');

const ORIG_ENV = { ...process.env };
const ORIG_FETCH = global.fetch;
const ORIG_WARN = console.warn;
const ORIG_LOG = console.log;
const GW = 'https://gw.example';
const GROQ_URL = A.PROVIDERS.groq.baseUrl;

/** gatewayHop reads process.env; run it against exactly `env`. */
function withEnv(env, hint) {
  const saved = process.env;
  process.env = { ...env };
  try { return gatewayHop(hint); } finally { process.env = saved; }
}

function agent(hint) {
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    availableProviders: ['groq'],
    sessionMetrics: { llmCalls: 0 },
    _activeTaskHint: hint,
  });
}

/** Mock fetch: records every request; `gatewayStatus` controls the gateway's answer. */
function mockFetch(calls, gatewayStatus = 200) {
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const isGateway = new URL(url).origin === GW;
    const status = isGateway ? gatewayStatus : 200;
    return {
      ok: status === 200,
      status,
      text: async () => `status ${status}`,
      json: async () => ({ choices: [{ message: { content: isGateway ? 'from gateway' : 'from groq' } }] }),
    };
  };
}

async function run() {
  let passed = 0;
  const warnings = [];
  const test = async (name, fn) => {
    process.env = { ...ORIG_ENV, GROQ_API_KEY: 'groq-test', LITELLM_URL: GW + '/', LITELLM_MASTER_KEY: 'master-test' };
    delete process.env.LLM_GATEWAY_FIRST;
    delete process.env.ENGINE_LLM_PROXY;
    delete process.env.SEAN_PAID_LOOP;
    delete process.env.ALLOW_PAID;
    warnings.length = 0;
    console.warn = (...a) => warnings.push(a.join(' '));
    console.log = () => {};
    try {
      await fn();
      ORIG_LOG(`  ok ${name}`);
      passed++;
    } catch (e) {
      ORIG_LOG(`  FAIL ${name}: ${e.message}`);
      process.exitCode = 1;
    } finally {
      process.env = { ...ORIG_ENV };
      global.fetch = ORIG_FETCH;
      console.warn = ORIG_WARN;
      console.log = ORIG_LOG;
    }
  };

  // ---------- gatewayHop (pure) ----------

  await test('gatewayHop: flag unset => no provider, no skip', async () => {
    assert.deepEqual(withEnv({ LITELLM_URL: GW, LITELLM_MASTER_KEY: 'k' }, 'research'), { provider: null, skip: null });
    assert.deepEqual(withEnv({ LLM_GATEWAY_FIRST: 'TRUE', LITELLM_URL: GW, LITELLM_MASTER_KEY: 'k' }, 'x').provider, null, 'only the exact string "true" enables it');
  });

  await test('gatewayHop: pool name, never a provider/model string', async () => {
    const env = { LLM_GATEWAY_FIRST: 'true', LITELLM_URL: GW + '//', LITELLM_MASTER_KEY: 'k' };
    const p = withEnv(env, 'research').provider;
    assert.equal(p.baseUrl, `${GW}/v1/chat/completions`);
    assert.equal(p.model, 'auto');
    assert.equal(p.envKey, 'LITELLM_MASTER_KEY');
    assert.equal(withEnv(env, 'code').provider.model, 'auto-coder');
    assert.equal(withEnv(env, undefined).provider.model, 'auto');
  });

  await test('gatewayHop: missing key or URL => skipped with a reason', async () => {
    assert.deepEqual(withEnv({ LLM_GATEWAY_FIRST: 'true', LITELLM_URL: GW }, 'x'), { provider: null, skip: 'LITELLM_MASTER_KEY unset' });
    assert.deepEqual(withEnv({ LLM_GATEWAY_FIRST: 'true', LITELLM_MASTER_KEY: 'k' }, 'x'), { provider: null, skip: 'LITELLM_URL unset' });
  });

  // ---------- callLLM wiring ----------

  await test('flag unset: first and only request is the direct chain (behaviour unchanged)', async () => {
    const calls = [];
    mockFetch(calls);
    const res = await agent('research').callLLM('ping');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, GROQ_URL);
    assert.equal(res.provider, 'groq');
    assert.equal(warnings.length, 0);
  });

  await test('flag set: gateway is the FIRST hop, with pool "auto" and the real master key', async () => {
    process.env.LLM_GATEWAY_FIRST = 'true';
    const calls = [];
    mockFetch(calls);
    const res = await agent('research').callLLM('ping');
    assert.equal(calls.length, 1, 'a gateway success must not also call a direct provider');
    assert.equal(calls[0].url, `${GW}/v1/chat/completions`);
    assert.equal(calls[0].body.model, 'auto');
    assert.equal(calls[0].auth, 'Bearer master-test');
    assert.equal(res.provider, 'litellm');
    assert.equal(res.output, 'from gateway');
  });

  await test('flag set: code tasks ask for "auto-coder"', async () => {
    process.env.LLM_GATEWAY_FIRST = 'true';
    const calls = [];
    mockFetch(calls);
    await agent('code').callLLM('ping');
    assert.equal(calls[0].body.model, 'auto-coder');
  });

  await test('flag set: gateway failure falls through to the direct chain', async () => {
    process.env.LLM_GATEWAY_FIRST = 'true';
    const calls = [];
    mockFetch(calls, 500);
    const res = await agent('research').callLLM('ping');
    assert.deepEqual(calls.map((c) => c.url), [`${GW}/v1/chat/completions`, GROQ_URL]);
    assert.equal(res.provider, 'groq');
    assert.ok(warnings.some((w) => /LLM_GATEWAY_FIRST: gateway auto failed, falling back/.test(w)), 'failure must be logged');
  });

  await test('flag set, no master key: hop skipped loudly, no placeholder key sent', async () => {
    process.env.LLM_GATEWAY_FIRST = 'true';
    delete process.env.LITELLM_MASTER_KEY;
    const calls = [];
    mockFetch(calls);
    const res = await agent('research').callLLM('ping');
    assert.deepEqual(calls.map((c) => c.url), [GROQ_URL]);
    assert.equal(res.provider, 'groq');
    assert.ok(warnings.some((w) => /LITELLM_MASTER_KEY unset — gateway hop SKIPPED/.test(w)));
    assert.ok(calls.every((c) => !/sk-proxy/.test(c.auth || '')));
  });

  // ---------- mel capability ----------

  await test("checkCapability accepts 'analysis'; unknown types still escalate", async () => {
    const a = agent();
    assert.deepEqual(await a.checkCapability({ task_type: 'analysis' }), { ok: true });
    assert.equal((await a.checkCapability({ task_type: 'not-a-type' })).ok, false);
    assert.ok(A.DELIVERABLE_TASK_TYPES.has('analysis'), 'analysis must stay a deliverable type (auto-saved artifact)');
  });

  ORIG_LOG(`\n${passed} passed`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
