'use strict';
/**
 * Revive free callLLM: Groq first hop must be gpt-oss-20b.
 * llama-3.3-70b-versatile is retired on this account.
 * Run: node tests/groq-model.test.js
 */
const assert = require('node:assert/strict');
const V4 = require('../lib/ConstitutionalAgentV4');

const model = V4.GROQ_MODEL;
assert.equal(model, 'openai/gpt-oss-20b');
assert.notEqual(model, 'llama-3.3-70b-versatile');
assert.equal(V4.PROVIDERS.groq.model, 'openai/gpt-oss-20b');
assert.ok(!String(V4.PROVIDERS.groq.model).includes('llama-3.3-70b-versatile'));

require('dotenv').config({ path: 'C:\\Users\\Cash4\\repos\\.env.master' });
const key = process.env.GROQ_API_KEY;
if (!key) {
  console.log('groq-model.test.js: PASS (unit). LIVE hop SKIPPED — GROQ_API_KEY absent in this process.');
  process.exit(0);
}

(async () => {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word ok.' }],
      max_tokens: 8,
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, 'live Groq must 200 on gpt-oss-20b');
  const used = body.model || model;
  assert.ok(String(used).includes('gpt-oss-20b'), 'first successful hop model is gpt-oss-20b, got ' + used);
  assert.ok(!String(used).includes('llama-3.3-70b-versatile'), 'must never be llama-3.3-70b-versatile');
  console.log('groq-model.test.js: PASS (unit + live 200, model=' + used + ')');
})().catch((e) => {
  console.error('groq-model.test.js: FAIL', e.message);
  process.exit(1);
});
