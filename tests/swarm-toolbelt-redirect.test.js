'use strict';

/**
 * http_get re-checks EVERY hop (S2-10 / F3, SECURITY_RUN 2026-10-16).
 *
 * Before: the allowlist and the https check ran on the URL the model asked for, then
 * fetch followed redirects by itself. One 3xx from an allowlisted host reached any
 * host — plain http and 169.254.169.254 included — and the body came back to the model.
 *
 * Pins, all offline (fetch and DNS are stubbed; the stub follows redirects the way real
 * fetch does unless it is asked for redirect:'manual'):
 *  1. an allowlisted URL is fetched; a same-host relative redirect is followed and re-checked
 *  2. a redirect to an off-list host is refused and that host is never contacted
 *  3. a redirect to 169.254.169.254 (http or https) is refused and never contacted
 *  4. an IP literal is refused even when an operator lists it
 *  5. ok@evil in a Location is evil, and is refused
 *  6. an allowlisted name that resolves to a private address is refused
 *  7. 3 redirects are followed; a 4th is refused
 *  8. lookalike hosts are refused
 *
 * Run: node tests/swarm-toolbelt-redirect.test.js
 */

const assert = require('node:assert/strict');
const dns = require('node:dns');

process.env.SWARM_TOOLBELT = 'on';
process.env.SWARM_TOOLBELT_HOSTS = 'ok.example.com,internal.example.com,169.254.169.254';

const DNS = { 'ok.example.com': '93.184.216.34', 'internal.example.com': '10.0.0.7', 'evil.com': '203.0.113.9' };
dns.promises.lookup = async (host) => {
  if (!DNS[host]) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return [{ address: DNS[host], family: 4 }];
};

// url -> [status, location?]. Anything not listed answers 200 with its own URL as the body.
let routes = {};
let contacted = [];
global.fetch = async function stubFetch(url, init = {}) {
  for (let i = 0; i < 20; i++) {
    contacted.push(url);
    const [status, location] = routes[url] || [200];
    if (!location) return new Response(`body of ${url}`, { status });
    if (init.redirect === 'manual') return new Response(null, { status, headers: { location } });
    url = new URL(location, url).toString(); // what real fetch does by default
  }
  throw new TypeError('redirect count exceeded');
};

const belt = require('../lib/swarm-toolbelt.js');

async function get(url, r = {}) {
  routes = r;
  contacted = [];
  return belt.execute('http_get', { url });
}
const touched = (needle) => contacted.some((u) => u.includes(needle));

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
  await t('an allowlisted URL is fetched', async () => {
    const r = await get('https://ok.example.com/health');
    assert.match(r, /^OK status=200/);
    assert.deepEqual(contacted, ['https://ok.example.com/health']);
  });

  await t('a same-host relative redirect is followed, re-checked, and the final URL reported', async () => {
    const r = await get('https://ok.example.com/a', { 'https://ok.example.com/a': [302, '/b'] });
    assert.match(r, /^OK status=200/);
    assert.match(r, /url=https:\/\/ok\.example\.com\/b/);
    assert.deepEqual(contacted, ['https://ok.example.com/a', 'https://ok.example.com/b']);
  });

  await t('a redirect to an off-list host is refused and that host is never contacted', async () => {
    const r = await get('https://ok.example.com/r', { 'https://ok.example.com/r': [302, 'https://evil.com/steal?d=secret'] });
    assert.match(r, /^FAILED:/);
    assert.match(r, /evil\.com/);
    assert.match(r, /redirect 1/);
    assert.ok(!touched('evil.com'), `evil.com was contacted: ${contacted}`);
  });

  await t('a redirect to the metadata service (http) is refused and never contacted', async () => {
    const r = await get('https://ok.example.com/m', { 'https://ok.example.com/m': [301, 'http://169.254.169.254/latest/meta-data/'] });
    assert.match(r, /^FAILED:/);
    assert.ok(!touched('169.254.169.254'), `metadata was contacted: ${contacted}`);
  });

  await t('a redirect to the metadata service (https, IP on the operator list) is refused', async () => {
    const r = await get('https://ok.example.com/m2', { 'https://ok.example.com/m2': [307, 'https://169.254.169.254/latest/meta-data/'] });
    assert.match(r, /^FAILED:.*IP literal/);
    assert.ok(!touched('169.254.169.254'));
  });

  await t('an IP literal is refused even when an operator lists it', async () => {
    const r = await get('https://169.254.169.254/latest/meta-data/');
    assert.match(r, /^FAILED:.*IP literal/);
    assert.equal(contacted.length, 0);
  });

  await t('ok@evil in a Location means evil, and is refused', async () => {
    const r = await get('https://ok.example.com/u', { 'https://ok.example.com/u': [302, 'https://ok.example.com@evil.com/'] });
    assert.match(r, /^FAILED:.*"evil\.com"/);
    assert.ok(!touched('evil.com'));
  });

  await t('an allowlisted name that resolves to a private address is refused', async () => {
    const r = await get('https://internal.example.com/admin');
    assert.match(r, /^FAILED:.*10\.0\.0\.7/);
    assert.equal(contacted.length, 0);
  });

  await t('3 redirects are followed', async () => {
    const r = await get('https://ok.example.com/0', {
      'https://ok.example.com/0': [302, '/1'],
      'https://ok.example.com/1': [302, '/2'],
      'https://ok.example.com/2': [302, '/3'],
    });
    assert.match(r, /^OK status=200/);
    assert.equal(contacted.length, 4);
  });

  await t('a 4th redirect is refused', async () => {
    const r = await get('https://ok.example.com/0', {
      'https://ok.example.com/0': [302, '/1'],
      'https://ok.example.com/1': [302, '/2'],
      'https://ok.example.com/2': [302, '/3'],
      'https://ok.example.com/3': [302, '/4'],
    });
    assert.match(r, /^FAILED: more than 3 redirects/);
    assert.ok(!touched('/4'), `the 5th URL was contacted: ${contacted}`);
  });

  await t('lookalike hosts are refused', async () => {
    for (const u of ['https://evil.com/', 'https://ok.example.com.evil.com/', 'https://ok.example.com@evil.com/']) {
      const r = await get(u);
      assert.match(r, /^FAILED:/, u);
      assert.equal(contacted.length, 0, u);
    }
  });

  console.log(`\n${n} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
