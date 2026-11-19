'use strict';
/**
 * THE HANDOFF LOOP, six cases (fixtures and stubs; no network, no database, no paid request):
 *  1. valid claim: evidence present and the deterministic check supports it -> VERIFIED
 *  2. planted wrong SHA: a green run for another revision -> REFUTED, whatever the models say
 *  3. missing artifact / unavailable evidence -> the gap is named and the claim stays NOT_CHECKED
 *  4. provider outage or free quota spent -> the next free route, or a clean stop; nothing paid
 *  5. denied or expired paid approval -> no paid dispatch; an approved one stops at its cap
 *  6. fresh recipient: the spawned review row alone is enough to proceed
 * The REAL callLLM / spawnNextStep run here; only fetch and the database client are faked.
 * Run: node tests/handoff-loop.test.js
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
const H = require('../lib/handoff-record');
const { gatewayHop } = require('../lib/llm-gateway');

const RUN = 'https://github.com/DealAppSeo/trustshell/actions/runs/44544121933';
const SHA = 'd9911681e9a201233aa85aecb24addb04c1c4969';
const record = (over = {}) => H.build({
  task: { id: 7, title: 'Document the pinned check run', description: 'One sentence for the docs about one public run.' },
  acceptance_criteria: ['The sentence names the run id and the commit it ran on, and both match the run.'],
  input_revision: `DealAppSeo/trustshell@${SHA}`,
  claims: [{ id: 'c1', text: `The check workflow succeeded on commit ${SHA.slice(0, 12)}, run 44544121933.` }],
  artifacts: [{ ref: 'db://trinity_tasks/7#result', sha256: H.sha256('draft') }],
  evidence: [{ ref: RUN, kind: 'github-actions-run', available: true }],
  producer: { role: 'trinity-orch', model: 'gpt-oss-120b' },
  created_at: '2026-11-19T00:00:00.000Z',
  ...over,
});
const det = (outcome, reason) => ({ claim: 'c1', name: 'trustshell check', kind: 'deterministic', outcome, reason });
const model = (outcome, by) => ({ claim: 'c1', name: 'evidence review', kind: 'model', outcome, by });
const card = (...statuses) => ({ record: { claims: statuses.map((status) => ({ status })) } });

function agent(providers) {
  const inserted = [];
  return Object.assign(Object.create(A.prototype), {
    name: 'trinity-orch', availableProviders: [...providers], sessionMetrics: { llmCalls: 0 }, inserted,
    supabase: { from: () => ({
      insert: (row) => { inserted.push(row); return Promise.resolve({ error: null }); },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { generation: 0 } }) }) }),
    }) },
  });
}
const ok = (content) => ({ ok: true, status: 200, text: async () => '', json: async () => ({ model: 'm', choices: [{ message: { role: 'assistant', content } }] }) });
const fail = (status, body) => ({ ok: false, status, text: async () => body, json: async () => ({}) });
const PAID_HOSTS = /api\.openai\.com|api\.x\.ai|generativelanguage|anthropic|deepseek|together/;
const CLEARED = ['LLM_GATEWAY_FIRST', 'ENGINE_LLM_PROXY', 'SEAN_PAID_LOOP', 'ALLOW_PAID', 'COST_MODE', 'PAID_APPROVAL_EXPIRES', 'PAID_MAX_CALLS', 'DATA_SHARE_PROVIDERS', 'HANDOFF_RECORD', 'FREE_ROTATE_BY_AGENT', 'CEREBRAS_MODEL', 'WORM_BRAKE'];

async function run() {
  let passed = 0, total = 0;
  const test = async (name, fn) => {
    total++;
    console.log = () => {}; console.warn = () => {}; console.error = () => {};
    process.env = { ...ORIG.env, GROQ_API_KEY: 'test-not-a-key', CEREBRAS_API_KEY: 'test-not-a-key', OPENAI_API_KEY: 'test-not-a-key' };
    for (const k of CLEARED) delete process.env[k];
    gate.resetExhaustion(); gate.resetPaidCalls();
    try { await fn(); ORIG.log(`  ok ${name}`); passed++; }
    catch (e) { ORIG.log(`  FAIL ${name}: ${e.message}`); process.exitCode = 1; }
    finally { console.log = ORIG.log; console.warn = ORIG.warn; console.error = ORIG.error; process.env = { ...ORIG.env }; global.fetch = ORIG.fetch; }
  };

  // 1
  await test('valid claim: complete record + the deterministic check supports it -> VERIFIED', async () => {
    assert.deepEqual(H.gaps(record()), []);
    assert.equal(H.inspectOutcome(card('SUPPORTED', 'SUPPORTED', 'SUPPORTED'), 0), 'SUPPORTED');
    const r = H.settle(record(), [det('SUPPORTED'), model('SUPPORTED', 'trinity-mel')]);
    assert.equal(r.verification.outcome, 'VERIFIED');
    assert.deepEqual(r.open_claims, []);
  });
  await test('models agreeing is not evidence: two SUPPORTED reviews and no deterministic check -> NOT_CHECKED', async () => {
    const r = H.settle(record(), [model('SUPPORTED', 'a'), model('SUPPORTED', 'b')]);
    assert.equal(r.verification.outcome, 'NOT_CHECKED');
    assert.match(r.open_claims[0].reason, /no deterministic check ran/);
  });
  await test('a reviewer that disputes a supported claim keeps it open; it cannot be outvoted', async () => {
    const r = H.settle(record(), [det('SUPPORTED'), model('CONTRADICTED', 'trinity-mel'), model('SUPPORTED', 'x')]);
    assert.equal(r.verification.outcome, 'NOT_CHECKED');
    assert.match(r.open_claims[0].reason, /disputed by trinity-mel/);
  });

  await test('a check the record requires that never ran, or gave no answer, keeps it NOT_CHECKED (found live: the reviewer failed)', async () => {
    const need = record({ required_checks: ['evidence review', 'trustshell check'] });
    const noReview = H.settle(need, [det('SUPPORTED')]);
    assert.equal(noReview.verification.outcome, 'NOT_CHECKED');
    assert.match(noReview.open_claims[0].reason, /required check did not run: evidence review/);
    const silent = H.settle(need, [det('SUPPORTED'), { ...model('NOT_CHECKED', 'trinity-mel'), reason: 'no reply' }]);
    assert.equal(silent.verification.outcome, 'NOT_CHECKED');
    assert.match(silent.open_claims[0].reason, /evidence review gave no answer: no reply/);
    assert.equal(H.settle(need, [det('SUPPORTED'), model('SUPPORTED', 'trinity-hdm')]).verification.outcome, 'VERIFIED');
    assert.ok(H.render(need).includes('REQUIRED CHECKS (each must run on every claim): evidence review, trustshell check'));
  });
  await test('an outcome that is not exactly SUPPORTED or CONTRADICTED counts as NOT_CHECKED', async () => {
    const r = H.settle(record(), [det('SUPPORTED'), { ...det('DID_NOT_RUN'), name: 'second check' }]);
    assert.equal(r.verification.outcome, 'NOT_CHECKED');
    assert.equal(H.settle(record(), [det('supported')]).verification.outcome, 'NOT_CHECKED');
  });
  await test('an Inspect card for some other sentence supports nothing', async () => {
    const mine = 'The check workflow succeeded on commit d9911681e9a2, run 44544121933.';
    const c = { record: { claims: [{ status: 'SUPPORTED', sentence: mine }, { status: 'SUPPORTED', sentence: mine }] } };
    assert.equal(H.inspectOutcome(c, 0, mine), 'SUPPORTED');
    assert.equal(H.inspectOutcome(c, 0, mine.replace('d9911681e9a2', 'bc549681bf05')), 'NOT_CHECKED');
  });
  await test('blank acceptance criteria or a claim with no text are gaps', async () => {
    assert.ok(H.gaps(record({ acceptance_criteria: [''] })).some((g) => /acceptance_criteria: none stated/.test(g)));
    assert.ok(H.gaps(record({ acceptance_criteria: ['x', ' '] })).some((g) => /one is blank/.test(g)));
    assert.ok(H.gaps(record({ claims: [{ id: 'c1', text: '' }] })).some((g) => /c1 has no text/.test(g)));
  });

  // 2
  await test('planted wrong SHA: a green run for another revision -> REFUTED, whatever the models say', async () => {
    assert.equal(H.inspectOutcome(card('NOT_CHECKED', 'CONTRADICTED', 'SUPPORTED'), 1), 'CONTRADICTED');
    const r = H.settle(record(), [det('CONTRADICTED'), model('SUPPORTED', 'a'), model('SUPPORTED', 'b')]);
    assert.equal(r.verification.outcome, 'REFUTED');
    assert.match(r.open_claims[0].reason, /contradicted by trustshell check/);
  });

  // 3
  await test('missing artifact: the gap is named and the claim stays NOT_CHECKED even with a supporting check', async () => {
    const r = H.settle(record({ artifacts: [] }), [det('SUPPORTED')]);
    assert.equal(r.verification.outcome, 'NOT_CHECKED');
    assert.ok(r.verification.gaps.some((g) => /artifacts/.test(g)), r.verification.gaps.join());
    assert.match(H.render(r), /GAPS \(each one keeps this NOT_CHECKED\): artifacts/);
  });
  await test('unavailable evidence: a 404 / crashed / absent check is NOT_CHECKED, never a pass', async () => {
    for (const [c, exit] of [[null, 3], [null, 0], [card(), 0], [card('SUPPORTED', 'NOT_CHECKED'), 3], [card('SUPPORTED'), 3]]) assert.equal(H.inspectOutcome(c, exit), 'NOT_CHECKED');
    const r = H.settle(record({ evidence: [{ ref: RUN, kind: 'github-actions-run', available: false }] }), [det('NOT_CHECKED', 'GitHub 404')]);
    assert.equal(r.verification.outcome, 'NOT_CHECKED');
    assert.ok(r.verification.gaps.some((g) => /is not available/.test(g)));
    assert.match(r.open_claims[0].reason, /GitHub 404/);
  });
  await test('a reviewer reply that is not JSON, or skips a claim, is NOT_CHECKED with the reason', async () => {
    assert.equal(H.parseReview('looks good to me', record(), 'x')[0].outcome, 'NOT_CHECKED');
    assert.equal(H.parseReview('{"claims":[]}', record(), 'x')[0].reason, 'the reply did not rule on this claim');
    assert.equal(H.parseReview('ok {"claims":[{"id":"c1","verdict":"contradicted","reason":"sha differs"}]}', record(), 'x')[0].outcome, 'CONTRADICTED');
  });

  // 4
  await test('free quota spent on one provider: the next FREE route answers; no paid host is called', async () => {
    const urls = [];
    global.fetch = async (u) => { urls.push(u); return u.includes('groq') ? fail(429, 'Rate limit reached: tokens per day (TPD)') : ok('answer'); };
    const r = await agent(['groq', 'cerebras', 'openai']).callLLM('q', { tools: false });
    assert.equal(r.output, 'answer');
    assert.equal(r.provider, 'cerebras');
    assert.ok(!urls.some((u) => PAID_HOSTS.test(u)), urls.join());
  });
  await test('every free route down: a clean stop with the reason, and no paid request, even with a paid key present', async () => {
    const urls = [];
    global.fetch = async (u) => { urls.push(u); return fail(429, 'insufficient_quota'); };
    const a = agent(['groq', 'cerebras', 'openai']);
    await assert.rejects(a.callLLM('q', { tools: false }), /All LLMs failed|FREE_EXHAUSTED/);
    const before = urls.length;
    assert.ok(before > 0);
    await assert.rejects(a.callLLM('q', { tools: false }), /All LLMs failed|FREE_EXHAUSTED/);
    assert.equal(urls.length, before, 'an exhausted provider is not asked again');
    assert.ok(!urls.some((u) => PAID_HOSTS.test(u)), urls.join());
  });
  await test('COST_MODE=FREE_ONLY beats a standing paid approval, and skips the gateway (billing not visible)', async () => {
    process.env.COST_MODE = 'FREE_ONLY'; process.env.SEAN_PAID_LOOP = 'loop3';
    process.env.LLM_GATEWAY_FIRST = 'true'; process.env.LITELLM_URL = 'https://gateway.invalid'; process.env.LITELLM_MASTER_KEY = 'test-not-a-key';
    assert.deepEqual(gate.paidDecision(), { allow: false, reason: 'free_only' });
    assert.equal(gatewayHop('analysis').provider, null);
    assert.match(gatewayHop('analysis').skip, /free_only/);
    const urls = [];
    global.fetch = async (u) => { urls.push(u); return fail(503, 'down'); };
    await assert.rejects(agent(['groq', 'openai']).callLLM('q', { tools: false }));
    assert.ok(urls.length > 0 && urls.every((u) => u.includes('groq')), urls.join());
    process.env.COST_MODE = 'FREE_ONLYY'; // a typo is still free-only
    assert.equal(gate.allowPaid(), false);
  });
  await test('PAID_CAPPED: the gateway hop needs the same live approval and counts against the same cap', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.SEAN_PAID_LOOP = 'loop3'; process.env.PAID_MAX_CALLS = '1';
    process.env.LLM_GATEWAY_FIRST = 'true'; process.env.LITELLM_URL = 'https://gateway.invalid'; process.env.LITELLM_MASTER_KEY = 'test-not-a-key';
    process.env.PAID_APPROVAL_EXPIRES = '2020-01-01T00:00:00Z';
    assert.match(gatewayHop('analysis').skip, /approval_expired/);
    process.env.PAID_APPROVAL_EXPIRES = '2999-01-01T00:00:00Z';
    assert.equal(gatewayHop('analysis').provider.model, 'auto');
    assert.equal(gate.paidCallsUsed(), 1);
    assert.match(gatewayHop('analysis').skip, /cap_reached/);
  });
  await test('control: with COST_MODE unset the gateway hop and the paid approval behave as before', async () => {
    process.env.SEAN_PAID_LOOP = 'loop3';
    process.env.LLM_GATEWAY_FIRST = 'true'; process.env.LITELLM_URL = 'https://gateway.invalid'; process.env.LITELLM_MASTER_KEY = 'test-not-a-key';
    assert.equal(gate.allowPaid(), true);
    assert.equal(gatewayHop('analysis').provider.model, 'auto');
  });

  // 5
  const paidOnly = () => { const urls = []; global.fetch = async (u) => { urls.push(u); return u.includes('api.openai.com') ? ok('paid answer') : fail(503, 'down'); }; return urls; };
  await test('paid fallback DENIED (no approval): the paid provider is never dispatched', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.PAID_APPROVAL_EXPIRES = '2999-01-01T00:00:00Z'; process.env.PAID_MAX_CALLS = '5';
    const urls = paidOnly();
    await assert.rejects(agent(['groq', 'openai']).callLLM('q', { tools: false }));
    assert.equal(gate.paidDecision().reason, 'no_approval');
    assert.ok(!urls.some((u) => PAID_HOSTS.test(u)), urls.join());
  });
  await test('paid fallback EXPIRED approval: no paid dispatch', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.SEAN_PAID_LOOP = 'loop3'; process.env.PAID_APPROVAL_EXPIRES = '2020-01-01T00:00:00Z'; process.env.PAID_MAX_CALLS = '5';
    const urls = paidOnly();
    await assert.rejects(agent(['groq', 'openai']).callLLM('q', { tools: false }));
    assert.equal(gate.paidDecision().reason, 'approval_expired');
    assert.ok(!urls.some((u) => PAID_HOSTS.test(u)), urls.join());
  });
  await test('PAID_CAPPED with no expiry or no cap is denied: an open-ended approval is not an approval', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.SEAN_PAID_LOOP = 'loop3';
    assert.equal(gate.paidDecision().reason, 'approval_has_no_expiry_or_cap');
    process.env.PAID_APPROVAL_EXPIRES = 'next tuesday'; process.env.PAID_MAX_CALLS = '5';
    assert.equal(gate.paidDecision().reason, 'approval_expiry_unreadable');
    process.env.PAID_APPROVAL_EXPIRES = '2999-01-01T00:00:00Z'; process.env.PAID_MAX_CALLS = 'lots';
    assert.equal(gate.paidDecision().reason, 'cap_unreadable');
  });
  await test('paid fallback APPROVED with a cap of 1: one paid request goes out, the second is refused at dispatch', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.SEAN_PAID_LOOP = 'loop3'; process.env.PAID_APPROVAL_EXPIRES = '2999-01-01T00:00:00Z'; process.env.PAID_MAX_CALLS = '1';
    const urls = paidOnly();
    const a = agent(['groq', 'openai']);
    const r = await a.callLLM('q', { tools: false });
    assert.equal(r.output, 'paid answer');
    assert.equal(gate.paidCallsUsed(), 1);
    await assert.rejects(a.callLLM('q', { tools: false }));
    assert.equal(urls.filter((u) => PAID_HOSTS.test(u)).length, 1, 'exactly one paid request in all');
    assert.equal(gate.paidDecision().reason, 'cap_reached');
  });
  await test('the cap holds inside one failover chain: cap 1, two paid providers, the first fails -> the second is not asked', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.SEAN_PAID_LOOP = 'loop3'; process.env.PAID_APPROVAL_EXPIRES = '2999-01-01T00:00:00Z'; process.env.PAID_MAX_CALLS = '1';
    process.env.DEEPSEEK_API_KEY = 'test-not-a-key';
    const urls = []; global.fetch = async (u) => { urls.push(u); return fail(503, 'down'); };
    await assert.rejects(agent(['groq', 'openai', 'deepseek']).callLLM('q', { tools: false }));
    assert.equal(urls.filter((u) => PAID_HOSTS.test(u)).length, 1, urls.join());
  });
  await test('data sharing is a separate permission: spend approval does not grant it, and it does not grant spend', async () => {
    process.env.COST_MODE = 'PAID_CAPPED'; process.env.SEAN_PAID_LOOP = 'loop3'; process.env.PAID_APPROVAL_EXPIRES = '2999-01-01T00:00:00Z'; process.env.PAID_MAX_CALLS = '5';
    process.env.DATA_SHARE_PROVIDERS = 'groq';
    let urls = paidOnly();
    await assert.rejects(agent(['groq', 'openai']).callLLM('q', { tools: false }));
    assert.ok(urls.length > 0 && !urls.some((u) => PAID_HOSTS.test(u)), 'paid approved, data not shared with openai: not dispatched');
    process.env.DATA_SHARE_PROVIDERS = 'openai'; delete process.env.SEAN_PAID_LOOP;
    urls = paidOnly();
    await assert.rejects(agent(['groq', 'openai']).callLLM('q', { tools: false }));
    assert.equal(urls.length, 0, 'data shared with openai only, spend not approved: nothing is dispatched at all');
  });

  // 6
  const task = {
    id: 7, title: 'Document the pinned check run', description: 'One sentence for the docs about one public run.', task_type: 'docs',
    success_criteria: 'The sentence names the run id and the commit it ran on, and both match the run.',
    metadata: { handoff_input: { input_revision: `DealAppSeo/trustshell@${SHA}`, claims: [{ id: 'c1', text: `The check workflow succeeded on commit ${SHA.slice(0, 12)}, run 44544121933.` }], evidence: [{ ref: RUN, kind: 'github-actions-run', available: true }] } },
  };
  await test('control: HANDOFF_RECORD unset -> the spawned review row is exactly what it was', async () => {
    const a = agent(['groq']);
    await a.spawnNextStep(task, 'draft', { score: 80 }, { model: 'gpt-oss-120b', artifactUrl: 'db://a/1' });
    assert.equal(a.inserted.length, 1);
    assert.equal(a.inserted[0].description, 'Peer review for task 7');
    assert.ok(!('handoff' in a.inserted[0].metadata));
  });
  await test('fresh recipient: the spawned review row alone carries everything needed to proceed', async () => {
    process.env.HANDOFF_RECORD = 'on';
    const a = agent(['groq']);
    await a.spawnNextStep(task, 'draft', { score: 80 }, { model: 'gpt-oss-120b', artifactUrl: 'db://trinity_artifacts/1' });
    // The recipient gets the row as the database would return it, and nothing else from the producer.
    const row = JSON.parse(JSON.stringify(a.inserted[0]));
    const got = row.metadata.handoff;
    assert.deepEqual(H.gaps(got), []);
    for (const needle of [task.title, task.success_criteria, SHA, 'db://trinity_artifacts/1', RUN, 'trinity-orch', 'gpt-oss-120b', 'run 44544121933', 'c1: no check has run'])
      assert.ok(row.description.includes(needle), `description lacks: ${needle}`);
    assert.equal(row.description, H.render(got), 'the text and the record say the same thing');
    // ...and can carry on: its own check settles the record without the producer.
    assert.equal(H.settle(got, [det('SUPPORTED')]).verification.outcome, 'VERIFIED');
  });
  await test('fresh recipient of a thin task: what the producer never stated is listed as a gap, not guessed', async () => {
    process.env.HANDOFF_RECORD = 'on';
    const a = agent(['groq']);
    await a.spawnNextStep({ id: 8, title: 'Write something', description: 'd', task_type: 'docs', metadata: {} }, 'some text', { score: 80 }, {});
    const got = a.inserted[0].metadata.handoff;
    const g = H.gaps(got).join('; ');
    assert.deepEqual(got.claims, [], 'no claim is invented from the output');
    for (const part of ['acceptance_criteria', 'input_revision', 'claims: none stated', 'artifacts', 'evidence', 'producer: model']) assert.ok(g.includes(part), `${part} missing from: ${g}`);
    assert.equal(H.settle(got, [det('SUPPORTED')]).verification.outcome, 'NOT_CHECKED');
  });

  ORIG.log(`handoff-loop.test.js: ${passed}/${total} passed`);
  if (passed !== total) process.exitCode = 1;
}
run();
