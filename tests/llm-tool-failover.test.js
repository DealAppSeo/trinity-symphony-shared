'use strict';

/**
 * Failover on a tool FOLLOW-UP turn carries the conversation (CC1 2026-10-15).
 *
 * Task 435158, 2026-10-14 18:19Z: groq answered turn 1 with save_artifact, the artifact was saved,
 * and groq's turn 2 failed. openrouter/nvidia/together each restarted from the bare prompt and
 * failed, and the task was recorded "All LLMs failed" — with two agents' reports already in
 * trinity_artifacts (196835 gcm, 196836 orch).
 *
 * Pins:
 *  1. Provider A returns a tool call, A fails on turn 2; provider B continues WITH A's tool call
 *     and its result, the artifact is saved once, and the task completes.
 *  2. If B calls save_artifact again it is told the artifact exists; nothing is saved twice.
 *  3. If every provider fails after the artifact was saved, callLLM completes from the artifact
 *     instead of throwing "All LLMs failed".
 *  4. A second callLLM in the same claim does not save a second artifact; a new claim may.
 *  5. The replayed assistant message carries only role/content/tool_calls (no `reasoning`).
 *
 * Run: node tests/llm-tool-failover.test.js
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

const ORIG_ENV = { ...process.env };
const ORIG_FETCH = global.fetch;
const ORIG_WARN = console.warn;
const ORIG_LOG = console.log;
const GROQ = A.PROVIDERS.groq.baseUrl;
const NVIDIA = A.PROVIDERS.nvidia.baseUrl;
const ARTIFACT = { title: 'NIM route', content: '# Artifact\nNIM is wired.', type: 'report' };

function agent() {
  const saves = [];
  const a = Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    availableProviders: ['groq', 'nvidia'],
    sessionMetrics: { llmCalls: 0 },
    currentTaskId: 435158,
  });
  a.saveArtifact = async (taskId, content, type, title) => {
    saves.push({ taskId, content, type, title });
    a.lastArtifactId = 196835 + saves.length - 1;
    return `db://trinity_artifacts/${a.lastArtifactId}`;
  };
  return { a, saves };
}

const ok = (message) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ choices: [{ message }] }) });
const fail = (status, body) => ({ ok: false, status, text: async () => body, json: async () => JSON.parse(body) });
const toolCall = (id) => ({
  role: 'assistant', content: null, reasoning: 'groq-only field',
  tool_calls: [{ id, type: 'function', function: { name: 'save_artifact', arguments: JSON.stringify(ARTIFACT) } }],
});

/** script: { [url]: [response, response, ...] } served in order; every request body is recorded. */
function mockFetch(script, calls) {
  const served = new Map();
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const n = served.get(url) || 0;
    served.set(url, n + 1);
    const r = (script[url] || [])[n];
    if (!r) throw new Error(`unscripted request #${n + 1} to ${url}`);
    return r;
  };
}

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    process.env = { ...ORIG_ENV, GROQ_API_KEY: 'gsk_testAAAAAAAAAAAA', NVIDIA_API_KEY: 'nvapi-testBBBBBBBBBB' };
    for (const k of ['LLM_GATEWAY_FIRST', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID']) delete process.env[k];
    freeTier.resetExhaustion();
    console.warn = () => {};
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

  await test('A: tool call, then fails on turn 2; B continues WITH the tool result; one artifact; completes', async () => {
    const calls = [];
    mockFetch({
      [GROQ]: [ok(toolCall('call_1')), fail(429, '{"error":{"code":"rate_limit_exceeded"}}')],
      [NVIDIA]: [ok({ role: 'assistant', content: 'Done: artifact saved.' })],
    }, calls);
    const { a, saves } = agent();
    const res = await a.callLLM('confirm NIM routing');
    assert.equal(res.output, 'Done: artifact saved.');
    assert.equal(res.provider, 'nvidia');
    assert.equal(saves.length, 1, 'saved exactly once');
    const nv = calls.find((c) => c.url === NVIDIA).body.messages;
    assert.deepEqual(nv.map((m) => m.role), ['user', 'assistant', 'tool'], 'B sees the whole conversation, not the bare prompt');
    assert.equal(nv[1].tool_calls[0].id, 'call_1');
    assert.equal(nv[2].tool_call_id, 'call_1');
    assert.equal(nv[2].content, 'Artifact saved.');
    assert.ok(!('reasoning' in nv[1]), 'a provider-specific field is not replayed to another provider');
  });

  await test('B calls save_artifact again: told it exists, nothing saved twice', async () => {
    const calls = [];
    mockFetch({
      [GROQ]: [ok(toolCall('call_1')), fail(429, '{"error":{"code":"rate_limit_exceeded"}}')],
      [NVIDIA]: [ok(toolCall('call_2')), ok({ role: 'assistant', content: 'final' })],
    }, calls);
    const { a, saves } = agent();
    const res = await a.callLLM('confirm NIM routing');
    assert.equal(res.output, 'final');
    assert.equal(saves.length, 1);
    const last = calls.filter((c) => c.url === NVIDIA).at(-1).body.messages.at(-1);
    assert.equal(last.role, 'tool');
    assert.match(last.content, /^Artifact already saved for this task \(db:\/\/trinity_artifacts\/196835\)/);
  });

  await test('every provider fails after the save: completes from the artifact, not "All LLMs failed"', async () => {
    mockFetch({
      [GROQ]: [ok(toolCall('call_1')), fail(429, '{"error":{"code":"rate_limit_exceeded"}}')],
      [NVIDIA]: [fail(401, '{"error":"unauthorized"}')],
    }, []);
    const { a, saves } = agent();
    const res = await a.callLLM('confirm NIM routing');
    assert.equal(res.completed_from_artifact, true);
    assert.equal(res.output, ARTIFACT.content);
    assert.equal(res.artifact_url, 'db://trinity_artifacts/196835');
    assert.equal(saves.length, 1);
  });

  await test('a second callLLM in the same claim does not save again; a new claim may', async () => {
    const { a, saves } = agent();
    mockFetch({ [GROQ]: [ok(toolCall('c1')), ok({ role: 'assistant', content: 'one' })] }, []);
    await a.callLLM('first');
    mockFetch({ [GROQ]: [ok(toolCall('c2')), ok({ role: 'assistant', content: 'two' })] }, []);
    await a.callLLM('second, same claim');
    assert.equal(saves.length, 1, 'same claim: one artifact');
    a._artifactSavedFor = null; // what a new claim of the task does
    mockFetch({ [GROQ]: [ok(toolCall('c3')), ok({ role: 'assistant', content: 'three' })] }, []);
    await a.callLLM('after a new claim');
    assert.equal(saves.length, 2, 'a new claim may save a better artifact');
  });

  ORIG_LOG(`llm-tool-failover.test.js: ${passed}/4 passed`);
}

run();
