'use strict';
/**
 * PROVIDER FALLBACKS (live 2026-11-01, mel task 435608 "[CONFUSED] All LLMs failed"):
 *  - groq 400 tool_use_failed: gpt-oss-20b sent its JSON as a call to a tool named "json" because
 *    save_artifact was offered. A caller can now ask for NO tools (known-answer replies).
 *  - nvidia 410 Gone: meta/llama-3.1-8b-instruct reached end of life 2026-08-26 and was still called
 *    on every failover. 410 (and 402 credit exhausted: together) now demote the provider like 401/404.
 *  - the nvidia default model is a live one; NVIDIA_MODEL overrides it.
 * The REAL callLLM/callProvider run here; only fetch is faked.
 * Run: node tests/provider-fallbacks.test.js
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
delete process.env.NVIDIA_MODEL; // the default is what this file checks
const A = require('../lib/ConstitutionalAgentV4');
const freeTier = require('../lib/free-tier-gate');

function agent(providers) {
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary', availableProviders: [...providers], sessionMetrics: { llmCalls: 0 },
    supabase: { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: { id: 1 }, error: null }) }) }) }) },
  });
}
const ok = (content, model) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ model, choices: [{ message: { role: 'assistant', content } }] }) });
const fail = (status, body) => ({ ok: false, status, text: async () => body, json: async () => ({}) });

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env, GROQ_API_KEY: 'test-not-a-key', NVIDIA_API_KEY: 'test-not-a-key', TOGETHER_API_KEY: 'test-not-a-key' };
    for (const k of ['LLM_GATEWAY_FIRST', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID', 'NVIDIA_MODEL']) delete process.env[k];
    freeTier.resetExhaustion();
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; global.fetch = ORIG.fetch; }
  };

  await test('tools: false → the request carries no tools and no tool_choice', async () => {
    const bodies = [];
    global.fetch = async (_u, init) => { bodies.push(JSON.parse(init.body)); return ok('{"decision":"pass","confidence":0.9,"reason":"x"}', 'openai/gpt-oss-20b'); };
    const r = await agent(['groq']).callLLM('q', { tools: false });
    assert.equal(r.output, '{"decision":"pass","confidence":0.9,"reason":"x"}');
    assert.ok(!('tools' in bodies[0]) && !('tool_choice' in bodies[0]), JSON.stringify(Object.keys(bodies[0])));
  });

  await test('control: by default the request still offers save_artifact with tool_choice auto', async () => {
    const bodies = [];
    global.fetch = async (_u, init) => { bodies.push(JSON.parse(init.body)); return ok('done', 'm'); };
    await agent(['groq']).callLLM('q');
    assert.equal(bodies[0].tool_choice, 'auto');
    assert.ok(bodies[0].tools.some((t) => t.function.name === 'save_artifact'));
  });

  await test('410 Gone and 402 credit exhausted demote the provider; the next call does not try it', async () => {
    // Together is only reachable when paid use is explicitly allowed.
    process.env.SEAN_PAID_LOOP = 'test-loop';
    const a = agent(['groq', 'nvidia', 'together']);
    const urls = [];
    global.fetch = async (u) => {
      urls.push(u);
      if (u.includes('groq')) return fail(400, '{"error":{"code":"tool_use_failed"}}');      // transient: kept
      if (u.includes('nvidia')) return fail(410, '{"detail":"model reached its end of life"}'); // dead: demoted
      return fail(402, '{"error":{"type":"credit_limit"}}');                                     // together: demoted
    };
    await assert.rejects(a.callLLM('q'), /All LLMs failed|FREE_EXHAUSTED/);
    assert.deepEqual(a.availableProviders, ['groq'], '410 and 402 demoted, a 400 is not');
    urls.length = 0;
    await assert.rejects(a.callLLM('q'));
    assert.ok(urls.every((u) => u.includes('groq')), 'the dead providers are not called again');
  });

  await test('the last provider demoted says so loudly (Grok on #100)', async () => {
    const a = agent(['nvidia']);
    const errors = [];
    global.fetch = async () => fail(410, 'gone');
    console.error = (m) => errors.push(String(m));
    await assert.rejects(a.callLLM('q'));
    assert.deepEqual(a.availableProviders, []);
    assert.ok(errors.some((m) => m.includes('NO providers left')), errors.join(' | '));
  });

  await test('control: a 429 (quota) is not demoted for the session; the free-tier gate handles it', async () => {
    const a = agent(['groq', 'nvidia']);
    global.fetch = async (u) => (u.includes('nvidia') ? fail(429, 'rate limit') : fail(400, 'bad'));
    await assert.rejects(a.callLLM('q'));
    assert.ok(a.availableProviders.includes('nvidia'));
  });

  await test('nvidia asks a live model by default (not the retired llama-3.1-8b)', async () => {
    const bodies = [];
    global.fetch = async (_u, init) => { bodies.push(JSON.parse(init.body)); return ok('done', 'nvidia/nemotron-3-super-120b-a12b'); };
    const r = await agent(['nvidia']).callLLM('q');
    assert.equal(bodies[0].model, 'nvidia/nemotron-3-super-120b-a12b');
    assert.equal(r.model, 'nvidia/nemotron-3-super-120b-a12b');
  });

  await test('NVIDIA_MODEL overrides the default (read when the module loads)', async () => {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
    assert.match(src, /model: process\.env\.NVIDIA_MODEL \|\| 'nvidia\/nemotron-3-super-120b-a12b'/);
    assert.ok(!src.includes("'meta/llama-3.1-8b-instruct'"), 'the retired model is gone from the code');
  });

  ORIG.log(`provider-fallbacks.test.js: ${passed}/7 passed`);
}

run().catch((e) => { console.log = ORIG.log; ORIG.log(e); process.exit(1); });
