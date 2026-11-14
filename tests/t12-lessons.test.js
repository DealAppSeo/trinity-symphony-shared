'use strict';
/**
 * T12 LESSONS A/B (T12_LESSONS_MODE = off | ab | all).
 *
 * Two known-answer rehearsals, 2026-11-14: T12 got all 20 definite items right and 1 of 4 whose
 * answer was ABSTAIN ("skipped" or "unverified" evidence answered veto). lessons/t12-lessons.md is a
 * system message some agents get and others do not, so the daily ruler can measure whether it helps.
 *
 * Through the REAL builders (processTask, processTaskContract, callLLM, callProvider) against a fake
 * DB and a fake fetch. Only the HTTP responses, the claim and side effects are stubbed.
 *  1. off: every request body is BYTE-identical to tests/fixtures/t12-lessons-off.json, recorded
 *     from main before this change (legacy + contract, known-answer + ordinary; groq, gemini,
 *     anthropic, the litellm gateway, the engine proxy), and the result metadata gains no key.
 *  2. ab + listed agent: a system message with the abstain rule comes first, the user message is
 *     unchanged, and the result records lessons_arm 'with' + the file's sha256 prefix.
 *  3. ab + unlisted agent: bytes as off, and the result records lessons_arm 'without'.
 *  4. all: every T12 agent gets it.
 *  5. an unknown mode is off, and says so once.
 *  6. the file is short and carries the abstain rule.
 *
 * Run: node tests/t12-lessons.test.js
 * RECORD=1 rewrites the fixture. Only do that from a tree whose builder you mean to pin.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const A = require('../lib/ConstitutionalAgentV4');
const freeTier = require('../lib/free-tier-gate');

const ORIG = { log: console.log, warn: console.warn, error: console.error, env: { ...process.env }, fetch: global.fetch };
const RECORD = process.env.RECORD === '1';
const FIXTURE = path.join(__dirname, 'fixtures', 't12-lessons-off.json');
const LESSONS_FILE = path.join(__dirname, '..', 'lessons', 't12-lessons.md');
const ABSTAIN_RULE = 'Skipped, missing or unverified evidence settles nothing: if the evidence does not show the claim is true or false, answer abstain. A confident wrong answer costs more than an honest abstain.';
const ROSTER = ['trinity-orch', 'trinity-w3c', 'trinity-shofet', 'trinity-torch', 'trinity-veritas', 'trinity-gcm',
  'trinity-chesed', 'trinity-mel', 'trinity-apm', 'trinity-sophia', 'trinity-nexus', 'trinity-hdm'];

function fakeDb() {
  const updates = [];
  const artifacts = new Map();
  let next = 900;
  const supabase = {
    from: (table) => ({
      update: (row) => { let id; const chain = { eq: (c, v) => { if (c === 'id') { id = v; updates.push({ table, id, row }); } return chain; }, select: async () => ({ data: [{ id }], error: null }), then: (ok) => ok({ error: null }) }; return chain; },
      select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: artifacts.get(id) || null, error: null }) }) }),
      insert: (row) => ({
        select: () => ({
          single: async () => {
            const id = next++;
            if (table === 'trinity_artifacts') artifacts.set(id, { id, task_id: row.task_id, content: row.content });
            return { data: { id }, error: null };
          },
        }),
      }),
    }),
  };
  return { supabase, updates };
}

/** A real agent (prototype methods) with a fake DB; the claim and side effects are stubbed. */
function agent(name, providers) {
  const db = fakeDb();
  const a = Object.assign(Object.create(A.prototype), {
    name,
    availableProviders: [...providers],
    claimHistory: new Map(),
    sessionMetrics: { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0 },
    wisdom: { squad: 'GAMMA', primaryVirtue: 'EXCELLENT' },
    supabase: db.supabase,
  });
  Object.assign(a, {
    claimTask: async () => true,
    log: async () => {},
    trackProviderPerformance: async () => {},
    spawnNextStep: async () => {},
    updateReputation: async () => {},
    insertHitlRequest: async () => {},
    insertEscalationLog: async () => {},
    _postSubstanceGateEvent: async () => ({ recorded: true, gateEventId: 'gate-1', fastResult: null }),
  });
  return { a, db };
}

const REPLY = '{"decision":"abstain","confidence":0.6,"reason":"The evidence was skipped, so it does not show the claim is true or false."}';
const REPORT = `# Artifact\n\n## Finding\n${'The routing was checked against the task text and nothing beyond it is claimed. '.repeat(8)}\n\nVirtue: TRUE`;
const kaTask = (id) => ({ id, title: 'T12 KNOWN ANSWER: is this statement accurate?', description: 'Decide pass, veto or abstain. Statement: the audit passed. Evidence: skipped.', success_criteria: 'One line of JSON with decision pass, veto or abstain, a confidence from 0 to 1, and a one-sentence reason.', task_type: 'analysis', metadata: { case_pool: 'hal_open_v1', case_id: '0005a4f5-0b25-4d30-8eca-2ef60cf88015' } });
const plainTask = (id) => ({ id, title: 'Analyse the routing', description: 'Write an analysis of the routing', success_criteria: '', task_type: 'analysis', metadata: {} });

const ENV = {
  groq: { GROQ_API_KEY: 'test-groq' },
  gemini: { GEMINI_API_KEY: 'test-gemini', SEAN_PAID_LOOP: 'test' },
  anthropic: { ANTHROPIC_API_KEY: 'test-anthropic', SEAN_PAID_LOOP: 'test' },
  gateway: { LLM_GATEWAY_FIRST: 'true', LITELLM_URL: 'https://litellm.test', LITELLM_MASTER_KEY: 'test-litellm' },
  engine: { ENGINE_LLM_PROXY: 'true', REPID_API_URL: 'https://engine.test', REPID_API_KEY: 'test-engine', SEAN_PAID_LOOP: 'test' },
};
const PROVIDERS = { groq: ['groq'], gemini: ['gemini'], anthropic: ['anthropic'], gateway: [], engine: [] };

// Every combination a T12 task can take to a model. The fixture holds what main sent for each.
const SCENARIOS = [
  ['legacy', 'ka', 'groq'], ['legacy', 'plain', 'groq'], ['contract', 'ka', 'groq'], ['contract', 'plain', 'groq'],
  ['legacy', 'ka', 'gemini'], ['legacy', 'ka', 'anthropic'], ['legacy', 'ka', 'gateway'], ['legacy', 'ka', 'engine'],
].map(([p, t, v]) => ({ key: `${p}/${t}/${v}`, path: p, kind: t, via: v }));

function respond(url, out) {
  if (url.includes('/api/v1/llm/complete')) return { ok: true, status: 200, text: async () => JSON.stringify({ answer: out, provider: 'groq' }) };
  if (url.includes('generativelanguage')) return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: out }] } }] }) };
  if (url.includes('anthropic')) return { ok: true, status: 200, json: async () => ({ content: [{ text: out }] }) };
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: out } }], model: 'fake-model' }) };
}

/** Run one task through the real path; returns the raw request bodies sent and the task's last status write. */
async function runTask(s, { name = 'trinity-hdm', env = {}, id = 1 } = {}) {
  process.env = { ...ENV[s.via], ...env };
  freeTier.resetExhaustion();
  const requests = [];
  const task = s.kind === 'ka' ? kaTask(id) : plainTask(id);
  const out = s.kind === 'ka' ? REPLY : REPORT;
  global.fetch = async (url, init) => {
    // the engine proxy draws a fresh idempotency key per call; it is the one byte that may differ
    requests.push({ url: String(url).split('?')[0], body: String(init.body).replace(/"idempotency_key":"[^"]*"/, '"idempotency_key":"<uuid>"') });
    return respond(String(url), out);
  };
  const { a, db } = agent(name, PROVIDERS[s.via]);
  if (s.path === 'legacy') await a.processTask(task);
  else { a._beginTask(task); await a.processTaskContract(task); }
  const writes = db.updates.filter((u) => u.table === 'trinity_tasks' && u.id === id && u.row.status).map((u) => u.row);
  const w = writes.at(-1) || {};
  return { requests, final: { status: w.status, metadata: w.metadata } };
}

const scenario = (key) => SCENARIOS.find((s) => s.key === key);
// the text as sent: a Windows checkout has CRLF, the deploy has LF; the hash names what the model saw
const lessonsText = () => fs.readFileSync(LESSONS_FILE, 'utf8').replace(/\r\n/g, '\n').trim();
const sha12 = () => crypto.createHash('sha256').update(lessonsText()).digest('hex').slice(0, 12);

async function record() {
  console.log = () => {}; console.warn = () => {}; console.error = () => {};
  const snap = {};
  try { for (const s of SCENARIOS) snap[s.key] = await runTask(s); }
  finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; global.fetch = ORIG.fetch; }
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
  fs.writeFileSync(FIXTURE, JSON.stringify(snap, null, 2) + '\n');
  ORIG.log(`recorded ${SCENARIOS.length} scenarios to ${FIXTURE}`);
}

async function run() {
  const SNAP = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  let passed = 0;
  let total = 0;
  let warns = [];
  const test = async (name, fn) => {
    total++;
    console.log = () => {}; console.error = () => {};
    warns = [];
    console.warn = (...args) => { warns.push(args.join(' ')); };
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; global.fetch = ORIG.fetch; }
  };
  const userOf = (body) => JSON.parse(body).messages.find((m) => m.role === 'user').content;

  // ── 1. off: byte-identical to main ──
  for (const s of SCENARIOS) {
    await test(`off (unset): ${s.key} sends exactly what main sent and records nothing new`, async () => {
      const got = await runTask(s);
      assert.deepEqual(got.requests, SNAP[s.key].requests);
      assert.deepEqual(got.final, SNAP[s.key].final);
    });
  }
  for (const v of ['', 'off', ' OFF ']) {
    await test(`off ("${v}"): byte-identical, no log line`, async () => {
      const got = await runTask(scenario('legacy/ka/groq'), { env: { T12_LESSONS_MODE: v, T12_LESSONS_AGENTS: 'trinity-hdm' } });
      assert.deepEqual(got, SNAP['legacy/ka/groq']);
      assert.ok(!warns.some((w) => w.includes('T12_LESSONS_MODE')), 'no warning for a known value');
    });
  }

  // ── 2. ab + listed agent ──
  const AB = { T12_LESSONS_MODE: 'ab', T12_LESSONS_AGENTS: 'trinity-hdm, trinity-mel' };
  for (const key of ['legacy/ka/groq', 'contract/ka/groq', 'legacy/plain/groq', 'contract/plain/groq', 'legacy/ka/gateway']) {
    await test(`ab, listed agent: ${key} sends the lessons as a system message before the unchanged user message`, async () => {
      const got = await runTask(scenario(key), { env: AB });
      const msgs = JSON.parse(got.requests[0].body).messages;
      assert.equal(msgs[0].role, 'system');
      assert.equal(msgs[0].content, lessonsText());
      assert.ok(msgs[0].content.includes(ABSTAIN_RULE));
      assert.equal(msgs[1].role, 'user');
      assert.equal(msgs[1].content, userOf(SNAP[key].requests[0].body), 'the user message is untouched');
      assert.equal(got.final.metadata.lessons_arm, 'with');
      assert.equal(got.final.metadata.lessons_sha256_prefix, sha12());
    });
  }
  await test('ab, listed by short or upper-case name: HDM and mel both match', async () => {
    const got = await runTask(scenario('legacy/ka/groq'), { name: 'trinity-mel', env: { T12_LESSONS_MODE: 'AB', T12_LESSONS_AGENTS: 'HDM,mel' } });
    assert.equal(JSON.parse(got.requests[0].body).messages[0].role, 'system');
    assert.equal(got.final.metadata.lessons_arm, 'with');
  });

  // ── where the system message lands for providers that do not take role "system" in messages ──
  await test('ab, listed: gemini gets the lessons folded in front of the prompt text (it has one text part)', async () => {
    const got = await runTask(scenario('legacy/ka/gemini'), { env: AB });
    const text = JSON.parse(got.requests[0].body).contents[0].parts[0].text;
    const offText = JSON.parse(SNAP['legacy/ka/gemini'].requests[0].body).contents[0].parts[0].text;
    assert.equal(text, `${lessonsText()}\n${offText}`);
  });
  await test('ab, listed: anthropic gets the lessons in the top-level system field, never as a message role', async () => {
    const got = await runTask(scenario('legacy/ka/anthropic'), { env: AB });
    const body = JSON.parse(got.requests[0].body);
    const off = JSON.parse(SNAP['legacy/ka/anthropic'].requests[0].body);
    assert.equal(body.system, lessonsText());
    assert.ok(body.messages.every((m) => m.role !== 'system'));
    assert.deepEqual(body.messages, off.messages);
    assert.equal(got.final.metadata.lessons_arm, 'with');
  });
  await test('ab, listed: the engine proxy (one prompt string) gets the lessons in front of the prompt', async () => {
    const got = await runTask(scenario('legacy/ka/engine'), { env: AB });
    const prompt = JSON.parse(got.requests[0].body).prompt;
    const offPrompt = JSON.parse(SNAP['legacy/ka/engine'].requests[0].body).prompt;
    assert.equal(prompt, `${lessonsText()}\n\n${offPrompt}`);
    assert.equal(got.final.metadata.lessons_arm, 'with');
  });

  // ── 3. ab + unlisted agent ──
  for (const key of ['legacy/ka/groq', 'contract/ka/groq']) {
    await test(`ab, unlisted agent: ${key} sends main's bytes and records lessons_arm 'without'`, async () => {
      const got = await runTask(scenario(key), { name: 'trinity-sophia', env: AB });
      assert.deepEqual(got.requests, SNAP[key].requests);
      assert.deepEqual(got.final.metadata, { ...SNAP[key].final.metadata, lessons_arm: 'without' });
    });
  }
  await test('ab with T12_LESSONS_AGENTS unset: nobody gets the lessons, every result says without', async () => {
    const got = await runTask(scenario('legacy/ka/groq'), { env: { T12_LESSONS_MODE: 'ab' } });
    assert.deepEqual(got.requests, SNAP['legacy/ka/groq'].requests);
    assert.equal(got.final.metadata.lessons_arm, 'without');
  });

  // ── 4. all ──
  await test('all: every one of the 12 T12 agents gets the lessons and records with', async () => {
    for (const [i, name] of ROSTER.entries()) {
      const got = await runTask(scenario('legacy/ka/groq'), { name, id: 100 + i, env: { T12_LESSONS_MODE: 'all' } });
      const msgs = JSON.parse(got.requests[0].body).messages;
      assert.equal(msgs[0].role, 'system', name);
      assert.ok(msgs[0].content.includes(ABSTAIN_RULE), name);
      assert.equal(got.final.metadata.lessons_arm, 'with', name);
    }
  });

  // ── 5. unknown mode ──
  await test('unknown mode: treated as off (main\'s bytes, nothing recorded) and logged exactly once', async () => {
    require('../lib/t12-lessons')._resetForTest();
    const env = { T12_LESSONS_MODE: 'yes', T12_LESSONS_AGENTS: 'trinity-hdm' };
    const one = await runTask(scenario('legacy/ka/groq'), { env, id: 1 });
    const two = await runTask(scenario('contract/ka/groq'), { env, id: 1 });
    const seen = warns.filter((w) => w.includes('T12_LESSONS_MODE')); // across both tasks
    assert.deepEqual(one, SNAP['legacy/ka/groq']);
    assert.deepEqual(two, SNAP['contract/ka/groq']);
    assert.equal(seen.length, 1, `one log line, got ${seen.length}`);
    assert.match(seen[0], /"yes"/);
  });

  // ── 6. the file ──
  await test('lessons file: at most 1200 characters and carries the abstain rule verbatim', async () => {
    const text = fs.readFileSync(LESSONS_FILE, 'utf8');
    assert.ok(text.length <= 1200, `${text.length} chars`);
    assert.ok(text.includes(ABSTAIN_RULE));
  });

  ORIG.log(`t12-lessons.test.js: ${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}

(RECORD ? record() : run()).catch((e) => { console.log = ORIG.log; ORIG.log(e); process.exit(1); });
