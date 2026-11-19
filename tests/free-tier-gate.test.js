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
  isFreeSlot,
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

assert.deepEqual([...FREE_TRY_ORDER], ['groq', 'cerebras', 'openrouter', 'nvidia']);

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
  ['groq:groq', 'cerebras:cerebras', 'openrouter:free'],
);
// Free-only must not reach any metered or unpriced endpoint, whatever keys are present.
for (const paid of ['together', 'deepseek', 'deepinfra', 'fireworks', 'openai', 'anthropic', 'grok', 'gemini']) {
  assert.equal(isFreeSlot({ provider: paid, model: 'any' }, false), false, paid + ' is not a free slot');
}
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
assert.equal(allFreeExhausted(new Date()), true);

console.log('free-tier-gate.test.js: PASS');

// ── a per-minute limit is 90 seconds, not the rest of the day (2026-11-18) ────
{
  const g = require('../lib/free-tier-gate');
  const T = new Date(Date.UTC(2026, 10, 19, 3, 0, 0));
  const MID = '2026-11-20T00:00:00.000Z';
  const minute = '429 Rate limit reached for model `openai/gpt-oss-20b` in organization `org_x` on tokens per minute (TPM): Limit 8000, Used 7900. Please try again in 7.5s.';
  const day = '429 Rate limit reached for model `openai/gpt-oss-20b` on tokens per day (TPD): Limit 200000. Please try again in 7m12.5s.';
  assert.equal(g.exhaustionUntil(minute, T).getTime(), T.getTime() + g.MINUTE_COOLDOWN_MS);
  assert.equal(g.exhaustionUntil(day, T).toISOString(), MID, 'a daily limit still waits for midnight');
  assert.equal(g.exhaustionUntil('insufficient_quota', T).toISOString(), MID);
  assert.equal(g.exhaustionUntil('429 Too Many Requests', T).toISOString(), MID, 'an unnamed 429 keeps the old behaviour');
  assert.equal(g.exhaustionUntil(undefined, T).toISOString(), MID, 'no message keeps the old behaviour');
  g.resetExhaustion();
  g.markExhausted('groq', T, minute);
  assert.equal(g.isExhausted('groq', T), true);
  assert.equal(g.isExhausted('groq', new Date(T.getTime() + g.MINUTE_COOLDOWN_MS + 1)), false, 'back after the cooldown');
  g.markExhausted('groq', T, day);
  g.markExhausted('groq', T, minute);
  assert.equal(g.exhaustedUntilOf('groq').toISOString(), MID, 'a minute limit never shortens a daily one');
  g.resetExhaustion();
  console.log('free-tier-gate.test.js: minute-vs-day PASS');
}
