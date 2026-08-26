// node tests/agentControlsRedisBreaker.test.js
//
// Every deployed agent service (trinity-gcm, trinity-sophia, trinity-hdm,
// trinity-torch, trinity-veritas) was observed logging "redis cache
// read/write failed: fetch failed" on an unbroken loop for days against a
// dead UPSTASH_REDIS_REST_URL. This proves the fix: after FAILURE_THRESHOLD
// consecutive failures, agent-controls.isAgentEnabled() stops calling
// Upstash for a cooldown window instead of retrying (and logging) on every
// single call, while still returning the correct answer throughout via the
// existing DB + in-process cache fallback.
//
// Stubs ./direct-pg and @upstash/redis in the require cache before
// requiring the module under test, mirroring tests/heartbeatDbWritesGate.test.js.

'use strict';

const assert = require('node:assert/strict');

process.env.UPSTASH_REDIS_REST_URL = 'http://upstash.invalid';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
process.env.AGENT_CONTROL_REDIS_COOLDOWN_MS = '120'; // short, so the test can wait it out for real
process.env.AGENT_CONTROL_CACHE_TTL_SEC = '9999'; // keep memCache from expiring mid-test

// --- Stub ./direct-pg: always returns one enabled row, records call count. ---
let dbCalls = 0;
const directPgPath = require.resolve('../lib/direct-pg');
require.cache[directPgPath] = {
  id: directPgPath,
  filename: directPgPath,
  loaded: true,
  exports: {
    pgQuery: async () => {
      dbCalls += 1;
      return [{ enabled: true }];
    },
  },
  children: [],
  paths: [],
};

// --- Stub @upstash/redis: get/set always reject, mirroring "fetch failed". ---
let redisGetCalls = 0;
let redisSetCalls = 0;
let shouldFail = true;
class FakeRedis {
  async get() {
    redisGetCalls += 1;
    if (shouldFail) throw new Error('fetch failed');
    return null;
  }
  async set() {
    redisSetCalls += 1;
    if (shouldFail) throw new Error('fetch failed');
  }
  async del() {}
}
const upstashPath = require.resolve('@upstash/redis');
require.cache[upstashPath] = {
  id: upstashPath,
  filename: upstashPath,
  loaded: true,
  exports: { Redis: FakeRedis },
  children: [],
  paths: [],
};

const { isAgentEnabled } = require('../lib/agent-controls');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Calls 1–3: breaker is closed, every call attempts the (failing) redis GET.
  // Call 1 also misses memCache, so it reads the DB and attempts a (failing)
  // redis SET too — that is the 3rd consecutive failure, so the breaker opens
  // on THIS call, not the next one.
  assert.equal(await isAgentEnabled('trinity-test-breaker'), true);
  assert.equal(redisGetCalls, 1);
  assert.equal(redisSetCalls, 1);
  assert.equal(dbCalls, 1, 'first call is a memCache miss, so it must hit the DB');

  // Call 2: GET failure #3 (threshold) — breaker opens on this call.
  assert.equal(await isAgentEnabled('trinity-test-breaker'), true, 'memCache still serves the right answer');
  assert.equal(redisGetCalls, 2);
  assert.equal(dbCalls, 1, 'memCache hit — no second DB read');

  // Call 3: breaker should now be OPEN — getRedis() short-circuits before the
  // GET is ever attempted.
  assert.equal(await isAgentEnabled('trinity-test-breaker'), true);
  assert.equal(redisGetCalls, 2, 'breaker open: no further redis calls while cooling down');

  // Wait out the (deliberately short) cooldown, then let the next attempt
  // succeed — the breaker should close again and resume normal calls.
  await sleep(200);
  shouldFail = false;
  assert.equal(await isAgentEnabled('trinity-test-breaker'), true);
  assert.equal(redisGetCalls, 3, 'breaker closed after cooldown: GET attempted again');

  console.log('agentControlsRedisBreaker.test.js: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
