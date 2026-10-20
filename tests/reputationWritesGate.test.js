// P0 Contain: updateReputation writes nothing unless TRINITY_REPUTATION_WRITES === 'true'.
// Run: node tests/reputationWritesGate.test.js
//
// Pins:
//  (a) flag unset / 'TRUE' / '1' / 'false': every call shape (self success, self failure,
//      peer slash with an override delta) makes ZERO Supabase calls and leaves the in-memory
//      reputationScore + wisdom.tier unchanged (the heartbeat writes wisdom.tier to current_tier).
//  (b) flag 'true': the legacy read + update still happen (opt-in path not broken).

'use strict';

const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL || 'http://localhost';
process.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'test-token';

const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

function makeSupabase() {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const b = {
        select() { calls.push(['select', table]); return b; },
        eq() { return b; },
        single: async () => ({ data: { reputation_score: 50, current_tier: 'Approve', tasks_completed: 3 }, error: null }),
        update(payload) {
          calls.push(['update', table, payload]);
          return { eq: async () => ({ error: null }) };
        },
      };
      return b;
    },
  };
}

function makeAgent(supabase) {
  const agent = Object.create(ConstitutionalAgentV4.prototype);
  agent.name = 'trinity-mel';
  agent.supabase = supabase;
  agent.phi = 1.61803398875;
  agent.reputationScore = 50;
  agent.wisdom = { squad: 'BETA', tier: 'Approve', primaryVirtue: 'LOVELY' };
  return agent;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS  ${name}`); passed++; }
  catch (err) { console.error(`FAIL  ${name}`); console.error(`      ${err.stack || err.message}`); failed++; }
}

(async () => {
  for (const value of [undefined, 'TRUE', '1', 'false', ' true']) {
    await test(`flag=${JSON.stringify(value)}: no Supabase call, in-memory reputation unchanged`, async () => {
      if (value === undefined) delete process.env.TRINITY_REPUTATION_WRITES;
      else process.env.TRINITY_REPUTATION_WRITES = value;
      const sb = makeSupabase();
      const agent = makeAgent(sb);
      await agent.updateReputation(true);
      await agent.updateReputation(false);
      await agent.updateReputation(false, 'trinity-peer', -5);
      await agent.updateReputation(true, 'trinity-peer', 2);
      assert.deepEqual(sb.calls, []);
      assert.equal(agent.reputationScore, 50);
      assert.equal(agent.wisdom.tier, 'Approve');
    });
  }

  await test("flag='true': legacy read + update still run", async () => {
    process.env.TRINITY_REPUTATION_WRITES = 'true';
    const sb = makeSupabase();
    const agent = makeAgent(sb);
    await agent.updateReputation(true);
    const updates = sb.calls.filter((c) => c[0] === 'update');
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1], 'trinity_agent_registry');
    assert.ok(typeof updates[0][2].reputation_score === 'number');
    delete process.env.TRINITY_REPUTATION_WRITES;
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
