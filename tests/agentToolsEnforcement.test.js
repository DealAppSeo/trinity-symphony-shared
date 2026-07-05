// Agent tools + enforcement tests for ConstitutionalAgentV4.
// Run: node tests/agentToolsEnforcement.test.js
//
// Covers the three CHANGE areas from feat/cc-2026-07-04-agent-tools-enforcement:
//   1) WebResearchTool.searchWeb degrades LOUDLY (no fabricated result) with no key.
//   2) Artifact enforcement: _enforceArtifact + isDeliverableTask predicate — a
//      deliverable task may not reach 'done' without an artifact; substantive text
//      is auto-saved; empty text blocks.
//   3) Peer-verify: _postPeerVerdict computes the HMAC signature deterministically
//      and reports already-processed; processPeerVerifyTask's LLM-timeout path POSTs
//      verdict='timeout' so the panel always gets a vote.
//
// No jest in this repo (CI runs plain `node tests/*.test.js`). Mirrors the
// plain-Node style of tests/heartbeatDbWritesGate.test.js: stub network/DB seams,
// build the agent via Object.create to skip the real constructor.

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Minimal env so incidental createClient()/Redis paths don't crash at require time.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-token';
// Deterministic HMAC secret for the peer-verdict signature assertion.
process.env.PEER_VERIFY_HMAC_SECRET = 'unit-test-secret';
// Ensure the web search tool sees NO key so we test the loud-degrade branch.
delete process.env.TAVILY_API_KEY;

const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

// Build an agent instance without running the real constructor.
function makeAgent(overrides = {}) {
  const agent = Object.create(ConstitutionalAgentV4.prototype);
  agent.name = 'trinity-mel';
  agent.version = '8.1.3-test';
  agent.lastArtifactId = null;
  agent.researchTool = new ConstitutionalAgentV4.WebResearchTool();
  // Minimal supabase stub: records update() payloads.
  agent._updates = [];
  agent.supabase = {
    from() {
      return {
        update(payload) { agent._updates.push(payload); return this; },
        eq() { return Promise.resolve({ data: null, error: null }); }
      };
    }
  };
  return Object.assign(agent, overrides);
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(`      ${err.stack || err.message}`); failed++; }
}

(async () => {
  // ---- CHANGE 1: web search degrades loudly ------------------------------
  await test('1) searchWeb with no TAVILY_API_KEY degrades loudly (no fake result)', async () => {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    try {
      const tool = new ConstitutionalAgentV4.WebResearchTool();
      const res = await tool.searchWeb('anything');
      assert.equal(res.degraded, true, 'must report degraded');
      assert.deepEqual(res.results, [], 'must return NO fabricated results');
      assert.match(res.reason, /TAVILY_API_KEY/, 'reason names the missing key');
      assert.ok(warnings.some(w => /DEGRADED/.test(w)), 'must console.warn loudly');
    } finally { console.warn = origWarn; }
  });

  await test('1b) researchWeb produces an explicit non-fabricated Sources block when degraded', async () => {
    const agent = makeAgent();
    const r = await agent.researchWeb('quantum widgets');
    assert.equal(r.degraded, true);
    assert.deepEqual(r.results, []);
    assert.match(r.sourcesBlock, /Web search unavailable/, 'degraded sources block must say so, not invent URLs');
    assert.ok(!/http/.test(r.sourcesBlock), 'degraded block must contain no fabricated URLs');
  });

  // ---- CHANGE 2: deliverable predicate + artifact enforcement ------------
  await test('2) isDeliverableTask covers named deliverable types + requires_external_artifact', () => {
    for (const t of ['research', 'code', 'analysis', 'audit', 'content', 'design', 'data', 'documentation']) {
      assert.equal(ConstitutionalAgentV4.isDeliverableTask({ task_type: t }), true, `${t} is a deliverable`);
    }
    assert.equal(ConstitutionalAgentV4.isDeliverableTask({ task_type: 'peer_verify' }), false, 'peer_verify is NOT a deliverable');
    assert.equal(ConstitutionalAgentV4.isDeliverableTask({ task_type: 'system' }), false, 'system is NOT a deliverable');
    assert.equal(ConstitutionalAgentV4.isDeliverableTask({ task_type: 'system', requires_external_artifact: true }), true, 'requires_external_artifact forces deliverable');
    assert.equal(ConstitutionalAgentV4.isDeliverableTask(null), false, 'null is safe');
  });

  await test('2a) non-deliverable task is a no-op (never blocked)', async () => {
    const agent = makeAgent();
    const e = await agent._enforceArtifact({ id: 1, task_type: 'system' }, 'short');
    assert.deepEqual(e, { required: false, blocked: false, artifactUrl: null });
  });

  await test('2b) deliverable WITH existing artifact (lastArtifactId) → not blocked, uses db url', async () => {
    const agent = makeAgent({ lastArtifactId: 'art-123' });
    const e = await agent._enforceArtifact({ id: 2, task_type: 'research' }, 'anything');
    assert.equal(e.blocked, false);
    assert.equal(e.artifactUrl, 'db://trinity_artifacts/art-123');
  });

  await test('2c) deliverable with substantive text but NO artifact → auto-saves, not blocked', async () => {
    const agent = makeAgent();
    let savedWith = null;
    agent.saveArtifact = async (taskId, content) => { savedWith = { taskId, content }; return 'db://trinity_artifacts/auto-9'; };
    const longText = 'x'.repeat(200);
    const e = await agent._enforceArtifact({ id: 3, task_type: 'code' }, longText);
    assert.ok(savedWith, 'must call saveArtifact when substantive text has no artifact');
    assert.equal(savedWith.content, longText);
    assert.equal(e.blocked, false);
    assert.equal(e.artifactUrl, 'db://trinity_artifacts/auto-9');
  });

  await test('2d) deliverable with empty/trivial text and no artifact → BLOCKED (needs_artifact)', async () => {
    const agent = makeAgent();
    let called = false;
    agent.saveArtifact = async () => { called = true; return null; };
    const e = await agent._enforceArtifact({ id: 4, task_type: 'analysis' }, '   ');
    assert.equal(called, false, 'nothing substantive → must NOT try to save an empty artifact');
    assert.equal(e.blocked, true, 'must block completion');
    assert.equal(e.artifactUrl, null);
  });

  await test('2e) deliverable with substantive text but saveArtifact fails → BLOCKED (no silent pass)', async () => {
    const agent = makeAgent();
    agent.saveArtifact = async () => null; // DB save failed
    const e = await agent._enforceArtifact({ id: 5, task_type: 'documentation' }, 'y'.repeat(100));
    assert.equal(e.blocked, true, 'save failure on a deliverable must not silently pass');
  });

  // ---- CHANGE 3: peer-verdict signature + timeout POST -------------------
  await test('3) _postPeerVerdict computes the documented HMAC signature and reports ok', async () => {
    const agent = makeAgent();
    let sentBody = null;
    global.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ recorded: true }) }; };

    const post = await agent._postPeerVerdict(42, 'verified');
    assert.equal(post.ok, true);
    // Recompute the expected signature the same way the code does.
    const dataToSign = `42:${sentBody.verifier_response_id}:verified`;
    const expected = crypto.createHmac('sha256', 'unit-test-secret').update(dataToSign).digest('hex');
    assert.equal(sentBody.signature, expected, 'signature must match queueId:responseId:verdict HMAC');
    assert.equal(sentBody.queue_id, 42);
    assert.equal(sentBody.verifier_agent_id, 'trinity-mel');
    assert.equal(sentBody.verdict, 'verified');
  });

  await test('3b) _postPeerVerdict surfaces already-processed (400) without throwing', async () => {
    const agent = makeAgent();
    global.fetch = async () => ({ ok: false, status: 400, text: async () => 'queue already processed' });
    const post = await agent._postPeerVerdict(7, 'timeout');
    assert.equal(post.ok, false);
    assert.equal(post.alreadyProcessed, true);
  });

  await test('3c) processPeerVerifyTask LLM-timeout path POSTs verdict=timeout (panel gets a vote)', async () => {
    const agent = makeAgent();
    // Force the verifier LLM call to hang → withTimeout rejects with TimeoutError.
    agent.callLLM = () => new Promise(() => {});
    let postedVerdict = null;
    global.fetch = async (url, opts) => { postedVerdict = JSON.parse(opts.body).verdict; return { ok: true, status: 200, json: async () => ({ recorded: true }) }; };

    // Shrink the timeout for the test by monkeypatching withTimeout's budget via a
    // fast-rejecting callLLM wrapper: we instead race a short timer ourselves.
    // Simpler: temporarily override the module timeout by making callLLM reject fast.
    agent.callLLM = () => Promise.reject(Object.assign(new Error('Timeout after 30000ms: peer_verify'), { name: 'TimeoutError' }));

    const task = { id: 900, metadata: { peer_verification_queue_id: 55 } };
    // Bypass the queue-claim DB step by pre-stubbing supabase update chain to also
    // handle the claim .in()/.select(); return a queue entry so we reach the LLM call.
    agent.supabase = {
      from() {
        return {
          update() { return this; },
          eq() { return this; },
          in() { return this; },
          select: async () => ({ data: [{ id: 55, claim_text: 'x', certainty_at_claim: 0.5 }], error: null })
        };
      }
    };
    await agent.processPeerVerifyTask(task);
    assert.equal(postedVerdict, 'timeout', 'timeout path must POST a timeout verdict so the panel receives 3 votes');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
