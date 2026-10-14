'use strict';

/**
 * Peer-verify HMAC key purpose (CC1 2026-10-14).
 *
 * _postPeerVerdict signs with PEER_VERIFY_HMAC_SECRET and nothing else. It used to fall back
 * to `<AGENT>_PRIVATE_KEY` (the agent's wallet signing key) and then TRUSTRAILS_HMAC_SECRET.
 * A signing key must never double as an HMAC secret, so a missing secret now refuses to post.
 *
 * Run: node tests/peerVerifyHmacKey.test.js
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

// Stub direct-pg before the agent module loads (same pattern as t12Claimable.test.js).
const PG_PATH = require.resolve('../lib/direct-pg');
require.cache[PG_PATH] = new Module(PG_PATH, null);
Object.assign(require.cache[PG_PATH], {
  filename: PG_PATH, path: path.dirname(PG_PATH), loaded: true,
  exports: { getPgPool: () => { throw new Error('no pg in this test'); }, pgQuery: async () => [], pgPing: async () => ({ ok: true }), closePgPool: async () => {} },
});

const A = require('../lib/ConstitutionalAgentV4');

const ORIG_ENV = { ...process.env };
const ORIG_FETCH = global.fetch;

const agent = () => Object.assign(Object.create(A.prototype), { name: 'trinity-mel' });

async function run() {
  let passed = 0;
  const test = async (name, fn) => {
    process.env = { ...ORIG_ENV, REPID_API_URL: 'https://engine.example', REPID_API_KEY: 'repid-test' };
    delete process.env.PEER_VERIFY_HMAC_SECRET;
    delete process.env.TRUSTRAILS_HMAC_SECRET;
    try {
      await fn();
      console.log(`  ok ${name}`);
      passed++;
    } catch (e) {
      console.log(`  FAIL ${name}: ${e.message}`);
      process.exitCode = 1;
    } finally {
      process.env = { ...ORIG_ENV };
      global.fetch = ORIG_FETCH;
    }
  };

  await test('signs with PEER_VERIFY_HMAC_SECRET (scheme unchanged)', async () => {
    process.env.PEER_VERIFY_HMAC_SECRET = 'hmac-test';
    process.env.MEL_PRIVATE_KEY = 'wallet-test';
    let body;
    global.fetch = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({}) }; };
    const res = await agent()._postPeerVerdict(42, 'verified');
    assert.equal(res.ok, true);
    const expected = crypto.createHmac('sha256', 'hmac-test').update(`42:${body.verifier_response_id}:verified`).digest('hex');
    assert.equal(body.signature, expected);
  });

  await test('no PEER_VERIFY_HMAC_SECRET: refuses, never signs with the wallet key or TRUSTRAILS', async () => {
    process.env.MEL_PRIVATE_KEY = 'wallet-test';
    process.env.TRUSTRAILS_HMAC_SECRET = 'trustrails-test';
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    await assert.rejects(agent()._postPeerVerdict(42, 'verified'), /PEER_VERIFY_HMAC_SECRET is not set/);
    assert.equal(called, false, 'a verdict must not be POSTed without the HMAC secret');
  });

  await test('the signing code names no *_PRIVATE_KEY or TRUSTRAILS fallback', async () => {
    // Comments may describe the old fallback; only code counts.
    const src = A.prototype._postPeerVerdict.toString().replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(src, /_PRIVATE_KEY`|process\.env\[/, 'no computed env name in the signer');
    assert.doesNotMatch(src, /process\.env\.TRUSTRAILS_HMAC_SECRET/);
  });

  await test('boot line: loud when unset, silent when set; start() emits it', async () => {
    assert.match(A.peerVerifyHmacBootLine('trinity-mel'), /PEER_VERIFY_HMAC_SECRET unset — peer verdicts will be REFUSED/);
    process.env.PEER_VERIFY_HMAC_SECRET = 'hmac-test';
    assert.equal(A.peerVerifyHmacBootLine('trinity-mel'), null);
    assert.match(A.prototype.start.toString(), /peerVerifyHmacBootLine\(this\.name\)/, 'start() must log it once per boot');
  });

  console.log(`\n${passed} passed`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
