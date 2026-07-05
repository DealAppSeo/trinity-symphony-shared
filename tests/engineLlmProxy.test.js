'use strict';

/**
 * ENGINE_LLM_PROXY unit tests — no live engine required (fetch mocked).
 * Run: node tests/engineLlmProxy.test.js
 */

const assert = require('node:assert/strict');

const ORIG_FETCH = global.fetch;
const ORIG_ENV = { ...process.env };

function restore() {
  global.fetch = ORIG_FETCH;
  process.env = { ...ORIG_ENV };
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    try {
      await fn();
      console.log(`  ok ${name}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL ${name}:`, e.message);
      process.exitCode = 1;
    } finally {
      restore();
    }
  };

  await test('canUseProxy false when flag unset', async () => {
    delete process.env.ENGINE_LLM_PROXY;
    delete require.cache[require.resolve('../lib/engine-llm-proxy')];
    const { canUseProxy } = require('../lib/engine-llm-proxy');
    assert.equal(canUseProxy(), false);
  });

  await test('canUseProxy true when env complete', async () => {
    process.env.ENGINE_LLM_PROXY = 'true';
    process.env.REPID_API_URL = 'https://engine.example';
    process.env.REPID_API_KEY = 'agent-key-abc';
    delete require.cache[require.resolve('../lib/engine-llm-proxy')];
    const { canUseProxy } = require('../lib/engine-llm-proxy');
    assert.equal(canUseProxy(), true);
  });

  await test('callEngineComplete maps answer to output', async () => {
    process.env.REPID_API_URL = 'https://engine.example';
    process.env.REPID_API_KEY = 'k';
    global.fetch = async (url, init) => {
      assert.match(url, /\/api\/v1\/llm\/complete$/);
      const body = JSON.parse(init.body);
      assert.equal(body.agent_id, 'trinity-test');
      assert.equal(body.tier_preference, 'auto');
      assert.ok(body.idempotency_key);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          answer: 'hello from engine',
          provider: 'groq',
          tier: 0,
          tokens_in: 10,
          tokens_out: 5,
          cost_estimate_usd: 0,
        }),
      };
    };
    delete require.cache[require.resolve('../lib/engine-llm-proxy')];
    const { callEngineComplete } = require('../lib/engine-llm-proxy');
    const res = await callEngineComplete({ agentName: 'trinity-test', prompt: 'ping' });
    assert.equal(res.output, 'hello from engine');
    assert.equal(res.provider, 'groq');
    assert.equal(res.engine_proxy, true);
  });

  await test('callEngineComplete throws on HTTP error', async () => {
    process.env.REPID_API_URL = 'https://engine.example';
    process.env.REPID_API_KEY = 'k';
    global.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => JSON.stringify({ error: 'API key agent_id mismatch' }),
    });
    delete require.cache[require.resolve('../lib/engine-llm-proxy')];
    const { callEngineComplete } = require('../lib/engine-llm-proxy');
    await assert.rejects(
      () => callEngineComplete({ agentName: 'trinity-test', prompt: 'x' }),
      /403/,
    );
  });

  console.log(`\nengineLlmProxy: ${passed} passed`);
  if (process.exitCode) process.exit(process.exitCode);
}

run();