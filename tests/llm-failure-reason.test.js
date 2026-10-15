'use strict';

/**
 * The direct LLM chain must say WHY a provider failed (CC1 2026-10-15).
 *
 * Railway, 24h to 2026-10-15: every T12 failure logged only "groq failed", "openrouter failed",
 * "nvidia failed", "together failed", then "All LLMs failed". A 401, a 404 and a 429 looked the
 * same. And callProvider used `providerKey` without declaring it, so the 401/404 demotion, an
 * `error` body and an empty `choices` all threw "providerKey is not defined" instead.
 *
 * Pins:
 *  1. A failure logs "<provider> failed: HTTP <status> (turn N): <body>", with the key redacted.
 *  2. A 401/404 demotes the provider for the session (it never could).
 *  3. A 429 whose body never says "429" or "rate limit" is still recognised as quota exhaustion.
 *  4. An `error` body on a 200 reports the provider's error, not a ReferenceError.
 *  5. The boot line names providers (never values) and what the free-tier gate lets run.
 *
 * Run: node tests/llm-failure-reason.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg in this test'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const A = require('../lib/ConstitutionalAgentV4');
const freeTier = require('../lib/free-tier-gate');

const GROQ_KEY = 'gsk_testkeyAAAAAAAAAAAAAAAA';
const ORIG_ENV = { ...process.env };
const ORIG_FETCH = global.fetch;
const ORIG_WARN = console.warn;
const ORIG_LOG = console.log;

function agent(providers) {
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    availableProviders: providers,
    sessionMetrics: { llmCalls: 0 },
  });
}

/** groq answers with `groq`; every other provider answers 200 with content. */
function mockFetch(groq) {
  global.fetch = async (url) => {
    if (url === A.PROVIDERS.groq.baseUrl) {
      return { ok: groq.status === 200, status: groq.status, text: async () => groq.body, json: async () => JSON.parse(groq.body) };
    }
    return { ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message: { content: 'from fallback' } }] }) };
  };
}

async function run() {
  let passed = 0;
  const warnings = [];
  const test = async (name, fn) => {
    process.env = { ...ORIG_ENV, GROQ_API_KEY: GROQ_KEY, NVIDIA_API_KEY: 'nvapi-testkeyBBBBBBBBBBBB' };
    for (const k of ['LLM_GATEWAY_FIRST', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID']) delete process.env[k];
    freeTier.resetExhaustion();
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

  await test('a 401 logs status + body with the key redacted, and demotes the provider', async () => {
    mockFetch({ status: 401, body: `{"error":{"message":"Invalid API Key ${GROQ_KEY}","code":"invalid_api_key"}}` });
    const a = agent(['groq', 'nvidia']);
    const res = await a.callLLM('ping');
    assert.equal(res.provider, 'nvidia', 'the chain still falls through');
    const line = warnings.find((w) => w.startsWith('groq failed'));
    assert.ok(line, `no groq failure line in ${JSON.stringify(warnings)}`);
    assert.match(line, /^groq failed: HTTP 401 \(turn 1\): .*invalid_api_key/);
    assert.ok(!line.includes(GROQ_KEY), 'the key must never reach the log');
    assert.deepEqual(a.availableProviders, ['nvidia'], 'a 401 demotes the provider for the session');
  });

  await test('a 429 is quota exhaustion even when the body never says "429" or "rate limit"', async () => {
    mockFetch({ status: 429, body: '{"error":{"code":"too_many_requests"}}' });
    await agent(['groq', 'nvidia']).callLLM('ping');
    assert.ok(freeTier.isExhausted('groq'), 'groq must be parked until UTC midnight');
    assert.ok(warnings.some((w) => /^groq failed: HTTP 429 /.test(w)));
  });

  await test("an error body on a 200 reports the provider's error, not a ReferenceError", async () => {
    mockFetch({ status: 200, body: '{"error":{"message":"model_decommissioned"}}' });
    await agent(['groq', 'nvidia']).callLLM('ping');
    const line = warnings.find((w) => w.startsWith('groq failed'));
    assert.match(line, /groq API Error: .*model_decommissioned/);
    assert.doesNotMatch(line, /is not defined/);
  });

  await test('redactForLog: keys, key-shaped tokens, bearer headers and ?key= are redacted; length capped', async () => {
    const s = A.redactForLog('k=supersecret123 sk-abcdefghijklmnop Bearer xyz.123 https://x/y?key=AIzaSECRET&a=1 nvapi-QQQQQQQQQQQQ', ['supersecret123']);
    for (const leaked of ['supersecret123', 'sk-abcdefghijklmnop', 'xyz.123', 'AIzaSECRET', 'nvapi-QQQQQQQQQQQQ']) assert.ok(!s.includes(leaked), leaked);
    assert.equal(A.redactForLog('x'.repeat(1000)).length, 300);
  });

  await test('boot line: provider NAMES and what the gate lets run, never a value', async () => {
    assert.equal(
      A.formatProviderBootLine(['groq', 'openrouter', 'nvidia'], ['groq', 'nvidia'], false),
      '[LLM] providers key_present=groq,openrouter,nvidia eligible=groq,nvidia allow_paid=false',
    );
    assert.equal(A.formatProviderBootLine([], [], false), '[LLM] providers key_present=none eligible=none allow_paid=false');
  });

  ORIG_LOG(`llm-failure-reason.test.js: ${passed}/5 passed`);
}

run();
