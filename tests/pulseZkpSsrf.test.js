'use strict';

/**
 * S2-9: the ZKP pulse probe is no longer an SSRF (SECURITY_RUN 2026-10-16, F4).
 *
 * Before: _pulseZkpProofSelfTest took its URL from the task description (any scheme, any host),
 * let fetch follow redirects, and wrote the response body into the artifact. A task inserted by
 * anyone (S1-A) could make an agent GET 169.254.169.254 and publish the answer.
 *
 * Pins, offline (fetch and DNS stubbed; the fetch stub follows redirects the way real fetch does
 * unless it is given redirect:'manual'):
 *  1. control: the probe GETs https://zkp-postcard-production.up.railway.app/health and records 200
 *  2. a description naming an off-list host does not move the probe there
 *  3. a description naming http://169.254.169.254 does not move the probe there
 *  4. a redirect from the probe host to a private IP (10.0.0.5) is refused, never contacted
 *  5. a redirect to the metadata service is refused, never contacted
 *  6. a redirect to an off-list host is refused, never contacted
 *  7. the probe host resolving to a private address is refused, nothing contacted
 *  8. a 4th redirect is refused
 *
 * Run: node tests/pulseZkpSsrf.test.js
 */

const assert = require('node:assert/strict');
const dns = require('node:dns');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const HOST = 'zkp-postcard-production.up.railway.app';
const HEALTH = `https://${HOST}/health`;

let dnsMap = {};
dns.promises.lookup = async (host) => {
  const a = dnsMap[host];
  if (!a) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' });
  return [{ address: a, family: 4 }];
};

let routes = {};
let contacted = [];
global.fetch = async function stubFetch(url, init = {}) {
  url = String(url);
  for (let i = 0; i < 20; i++) {
    contacted.push(url);
    const [status, location] = routes[url] || [200];
    if (!location) return new Response(`{"status":"ok","from":"${url}"}`, { status });
    if (init.redirect === 'manual') return new Response(null, { status, headers: { location } });
    url = new URL(location, url).toString();
  }
  throw new TypeError('redirect count exceeded');
};

const V4 = require('../lib/ConstitutionalAgentV4');
const agent = { name: 'trinity-test' };

async function probe(description, r = {}, d = { [HOST]: '66.33.22.11' }) {
  routes = r;
  dnsMap = d;
  contacted = [];
  return V4.prototype._pulseZkpProofSelfTest.call(agent, { id: 1, title: 'ZKP_PROOF_SELF_TEST', description });
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
  await t('control: probes the fixed /health URL and records 200', async () => {
    const out = await probe('Send a known-good request to https://zkp-postcard-production.up.railway.app/prove/x');
    assert.deepEqual(contacted, [HEALTH]);
    assert.match(out.markdown, /- status: 200/);
  });

  await t('a description naming an off-list host does not move the probe', async () => {
    await probe('Send a known-good request to https://evil.example/prove/x');
    assert.ok(!touched('evil.example'), `contacted: ${contacted}`);
    assert.deepEqual(contacted, [HEALTH]);
  });

  await t('a description naming http://169.254.169.254 does not move the probe', async () => {
    await probe('check http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    assert.ok(!touched('169.254.169.254'), `contacted: ${contacted}`);
  });

  await t('a redirect to a private IP is refused and never contacted', async () => {
    const out = await probe('', { [HEALTH]: [302, 'https://10.0.0.5/admin'] });
    assert.ok(!touched('10.0.0.5'), `contacted: ${contacted}`);
    assert.match(out.markdown, /- error: REFUSED: 10\.0\.0\.5 is an IP literal/);
    assert.match(out.markdown, /- status: ERROR/);
  });

  await t('a redirect to the metadata service is refused and never contacted', async () => {
    const out = await probe('', { [HEALTH]: [301, 'http://169.254.169.254/latest/meta-data/'] });
    assert.ok(!touched('169.254.169.254'), `contacted: ${contacted}`);
    assert.match(out.markdown, /- error: REFUSED:/);
  });

  await t('a redirect to an off-list host is refused and never contacted', async () => {
    const out = await probe('', { [HEALTH]: [307, 'https://attacker.up.railway.app/x'] }, { [HOST]: '66.33.22.11', 'attacker.up.railway.app': '66.33.22.12' });
    assert.ok(!touched('attacker'), `contacted: ${contacted}`);
    assert.match(out.markdown, /not on the allowlist/);
  });

  await t('the probe host resolving to a private address is refused, nothing contacted', async () => {
    const out = await probe('', {}, { [HOST]: '10.1.2.3' });
    assert.equal(contacted.length, 0, `contacted: ${contacted}`);
    assert.match(out.markdown, /private or link-local address 10\.1\.2\.3/);
  });

  await t('a 4th redirect is refused', async () => {
    const r = {
      [HEALTH]: [302, '/h1'],
      [`https://${HOST}/h1`]: [302, '/h2'],
      [`https://${HOST}/h2`]: [302, '/h3'],
      [`https://${HOST}/h3`]: [302, '/h4'],
    };
    const out = await probe('', r);
    assert.ok(!touched('/h4'), `contacted: ${contacted}`);
    assert.match(out.markdown, /more than 3 redirects/);
  });

  console.log(`\n${n} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
