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

/** A legacy-loop agent: the REAL processTask, callLLM and artifact guard; DB writes recorded. */
function taskAgent() {
  const updates = [];
  const store = new Map(); // artifact id -> { id, content }
  let next = 196835;
  const a = Object.assign(Object.create(A.prototype), {
    name: 'trinity-canary',
    availableProviders: ['groq', 'nvidia'],
    sessionMetrics: { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0 },
    claimHistory: new Map(),
    wisdom: { squad: 'ALPHA', primaryVirtue: 'truth' },
    supabase: {
      from: (table) => ({
        update: (row) => ({ eq: async (_c, id) => { updates.push({ table, id, row }); return { error: null }; } }),
        select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: store.get(id) || null, error: null }) }) }),
      }),
    },
  });
  Object.assign(a, {
    claimTask: async () => true,
    log: async () => {},
    trackProviderPerformance: async () => {},
    evaluateResult: async () => ({ score: 80 }),
    validateSubstance: async () => ({ ok: true }),
    _postSubstanceGateEvent: async () => ({ recorded: false }),
    spawnNextStep: async () => {},
    updateReputation: async () => {},
    insertEscalationLog: async () => {},
    insertHitlRequest: async () => {},
    saveArtifact: async (_taskId, content) => {
      const id = next++;
      store.set(id, { id, content });
      a.lastArtifactId = id;
      return `db://trinity_artifacts/${id}`;
    },
  });
  return { a, updates, store };
}
const task = (id) => ({ id, title: `task ${id}`, description: 'confirm the routing', task_type: 'analysis', metadata: {} });
const taskWrite = (updates, id) => updates.filter((u) => u.table === 'trinity_tasks' && u.id === id).at(-1)?.row;

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
    for (const k of ['LLM_GATEWAY_FIRST', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID', 'ARTIFACT_GUARD_HARDENED']) delete process.env[k];
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

  await test('a second callLLM in the same claim does not save again; a new claim (processTask) may', async () => {
    const { a, saves } = agent();
    mockFetch({ [GROQ]: [ok(toolCall('c1')), ok({ role: 'assistant', content: 'one' })] }, []);
    await a.callLLM('first');
    mockFetch({ [GROQ]: [ok(toolCall('c2')), ok({ role: 'assistant', content: 'two' })] }, []);
    await a.callLLM('second, same claim');
    assert.equal(saves.length, 1, 'same claim: one artifact');
    // A NEW claim goes through processTask, which must reset the guard itself (XC1: nulling the field
    // here proved nothing). Two claims of the same task, each saving: both artifacts are written.
    const t = taskAgent();
    mockFetch({ [GROQ]: [ok(toolCall('p1')), ok({ role: 'assistant', content: 'one' })] }, []);
    await t.a.processTask(task(435158));
    mockFetch({ [GROQ]: [ok(toolCall('p2')), ok({ role: 'assistant', content: 'two' })] }, []);
    await t.a.processTask(task(435158));
    assert.equal(t.store.size, 2, 'each claim may save its own artifact');
  });

  await test('every provider fails after a SHORT artifact was saved: needs_artifact, never done (guard forced, flag off)', async () => {
    const t = taskAgent();
    mockFetch({
      [GROQ]: [ok(toolCall('call_1')), fail(429, '{"error":{"code":"rate_limit_exceeded"}}')],
      [NVIDIA]: [fail(401, '{"error":"unauthorized"}')],
    }, []);
    await t.a.processTask(task(435158));
    const row = taskWrite(t.updates, 435158);
    assert.equal(row.status, 'needs_artifact');
    assert.match(row.result, /^\[FAILOVER_ARTIFACT_REJECTED\] too_short/);
    assert.ok(!t.updates.some((u) => u.row.status === 'done'), 'never done');
  });

  await test('every provider fails after a SUBSTANTIVE artifact was saved: the guard passes, the task completes', async () => {
    const t = taskAgent();
    const long = { ...ARTIFACT, content: '# NIM routing\n' + 'trinity-litellm routes the nim/* pool to integrate.api.nvidia.com; verified by config read. '.repeat(3) };
    const call = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'save_artifact', arguments: JSON.stringify(long) } }] };
    mockFetch({
      [GROQ]: [ok(call), fail(429, '{"error":{"code":"rate_limit_exceeded"}}')],
      [NVIDIA]: [fail(401, '{"error":"unauthorized"}')],
    }, []);
    await t.a.processTask(task(435158));
    assert.equal(taskWrite(t.updates, 435158).status, 'done');
  });

  await test('a tool call that THROWS is still answered: the next provider never sees an unanswered tool_calls row', async () => {
    const calls = [];
    mockFetch({
      // `function` missing: reading toolCall.function.name throws inside the tool loop.
      [GROQ]: [ok({ role: 'assistant', content: null, tool_calls: [{ id: 'bad1', type: 'function' }] }), fail(500, 'upstream down')],
      [NVIDIA]: [ok({ role: 'assistant', content: 'recovered' })],
    }, calls);
    const { a } = agent();
    const res = await a.callLLM('x');
    assert.equal(res.output, 'recovered');
    const nv = calls.find((c) => c.url === NVIDIA).body.messages;
    const asked = nv.filter((m) => m.tool_calls).flatMap((m) => m.tool_calls.map((tc) => tc.id));
    const answered = new Set(nv.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
    assert.deepEqual(asked, ['bad1']);
    assert.ok(asked.every((id) => answered.has(id)), `unanswered tool_calls: ${JSON.stringify(nv)}`);
    assert.match(nv.find((m) => m.role === 'tool').content, /^FAILED: this tool call threw/);
  });

  await test('replayed tool bodies are capped, with a marker', async () => {
    const big = 'x'.repeat(20000);
    const capped = A.capReplayBody(big);
    assert.ok(capped.length < A.REPLAY_TOOL_BODY_MAX + 80);
    assert.match(capped, /…\[truncated 12000 chars of 20000\]$/);
    assert.equal(A.capReplayBody('small'), 'small');
  });

  ORIG_LOG(`llm-tool-failover.test.js: ${passed}/8 passed`);
}

run();
