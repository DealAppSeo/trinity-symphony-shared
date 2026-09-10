'use strict';
/**
 * FREE-TIER GATE — allow_paid=false until Sean writes `paid <loop>`.
 * OpenRouter :free ids are free. Paid models are skipped unless allowPaid.
 * Run: node tests/free-tier-gate.test.js
 */
const assert = require('node:assert/strict');
const {
  allowPaid,
  isOpenRouterFreeModel,
  isQuotaExhaustedError,
  nextUtcMidnight,
  orderProviders,
  markExhausted,
  resetExhaustion,
  allFreeExhausted,
  FREE_TRY_ORDER,
} = require('../lib/free-tier-gate');

resetExhaustion();

assert.equal(allowPaid({}), false);
assert.equal(allowPaid({ SEAN_PAID_LOOP: '' }), false);
assert.equal(allowPaid({ SEAN_PAID_LOOP: 'hold' }), false);
assert.equal(allowPaid({ SEAN_PAID_LOOP: 'loop3' }), true);

assert.equal(isOpenRouterFreeModel('deepseek/deepseek-chat'), false);
assert.equal(isOpenRouterFreeModel('meta-llama/llama-3.3-70b-instruct:free'), true);

assert.equal(isQuotaExhaustedError('429 Too Many Requests'), true);
assert.equal(isQuotaExhaustedError('insufficient_quota'), true);
assert.equal(isQuotaExhaustedError('timeout'), false);

const midnight = nextUtcMidnight(new Date(Date.UTC(2026, 8, 10, 15, 0, 0)));
assert.equal(midnight.toISOString(), '2026-09-11T00:00:00.000Z');

assert.deepEqual([...FREE_TRY_ORDER], ['groq', 'cerebras', 'openrouter', 'nvidia', 'together']);

const roster = [
  { provider: 'openai', model: 'gpt-4o' },
  { provider: 'openrouter', model: 'deepseek/deepseek-chat' },
  { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { provider: 'together', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { provider: 'cerebras', model: 'llama3.1-70b' },
];

const freeOnly = orderProviders(roster, { allowPaid: false, now: new Date() });
assert.deepEqual(
  freeOnly.map((p) => p.provider + ':' + (p.model.endsWith(':free') ? 'free' : p.provider)),
  ['groq:groq', 'cerebras:cerebras', 'openrouter:free', 'together:together'],
);
assert.ok(!freeOnly.some((p) => p.provider === 'openai'));
assert.ok(!freeOnly.some((p) => p.model === 'deepseek/deepseek-chat'));

markExhausted('groq', new Date(Date.UTC(2026, 8, 10, 12, 0, 0)));
const afterExhaust = orderProviders(roster, {
  allowPaid: false,
  now: new Date(Date.UTC(2026, 8, 10, 15, 0, 0)),
});
assert.ok(!afterExhaust.some((p) => p.provider === 'groq'));

const stillOut = orderProviders(roster, {
  allowPaid: false,
  now: new Date(Date.UTC(2026, 8, 10, 23, 59, 0)),
});
assert.ok(!stillOut.some((p) => p.provider === 'groq'));

const afterReset = orderProviders(roster, {
  allowPaid: false,
  now: new Date(Date.UTC(2026, 8, 11, 0, 0, 1)),
});
assert.ok(afterReset.some((p) => p.provider === 'groq'));

resetExhaustion();
markExhausted('groq', new Date());
markExhausted('cerebras', new Date());
markExhausted('openrouter', new Date());
markExhausted('nvidia', new Date());
markExhausted('together', new Date());
assert.equal(allFreeExhausted(new Date()), true);

console.log('free-tier-gate.test.js: PASS');
