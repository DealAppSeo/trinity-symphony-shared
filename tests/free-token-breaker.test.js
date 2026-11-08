'use strict';
/**
 * FREE-TOKEN BREAKER — the loop stops claiming when this agent's free providers are spent.
 * Run: node tests/free-token-breaker.test.js
 */
const assert = require('node:assert/strict');
const gate = require('../lib/free-tier-gate');
const b = require('../lib/free-token-breaker');

const NOON = new Date(Date.UTC(2026, 9, 31, 12, 0, 0));
const ENV = {}; // allow_paid=false, mode 'all', gateway off

// ── which providers count ─────────────────────────────────────────────────────
const slots = [
  { provider: 'openai', model: 'gpt-4o' },                                  // paid: never counted
  { provider: 'cerebras', model: 'PARKED' },                                // parked: never called
  { provider: 'openrouter', model: 'deepseek/deepseek-chat' },              // paid id on a free host
  { provider: 'openrouter', model: 'nvidia/nemotron-3.5-lightning:free' },
  { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  { provider: 'nvidia', model: 'meta/llama-3.1-8b-instruct' },
];
assert.deepEqual(b.topFree(slots), ['groq', 'openrouter', 'nvidia']);
assert.deepEqual(
  b.topFree([...slots, { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' }]),
  ['groq', 'openrouter', 'nvidia'],
);

// A provider that answers 401/404 is dropped from this.availableProviders for the session
// (ConstitutionalAgentV4.js callProvider). topFree is recomputed from that list on every loop,
// so a dead slot (a model no longer served) leaves the top three after its first failure and
// cannot hold the breaker open.
{
  const live = slots.filter((s) => s.provider !== 'openrouter'); // after its 404 demotion
  assert.deepEqual(b.topFree(live), ['groq', 'nvidia']);
  gate.resetExhaustion();
  gate.markExhausted('groq', NOON);
  gate.markExhausted('nvidia', NOON);
  assert.equal(b.check(b.topFree(slots), { env: ENV, now: NOON }).paused, false, 'before demotion');
  assert.equal(b.check(b.topFree(live), { env: ENV, now: NOON }).paused, true, 'after demotion');
  gate.resetExhaustion();
}

// ── the bug this closes: gate.allFreeExhausted() never fires for a real agent ──
gate.resetExhaustion();
for (const p of ['groq', 'nvidia', 'openrouter']) gate.markExhausted(p, NOON);
assert.equal(gate.allFreeExhausted(NOON), false, 'gate waits for providers this agent cannot call');
assert.equal(b.check(['groq', 'nvidia', 'openrouter'], { env: ENV, now: NOON }).paused, true);

// ── mode 'all' (default): pause only when every top provider is spent ─────────
gate.resetExhaustion();
gate.markExhausted('groq', NOON);
let s = b.check(['groq', 'nvidia', 'openrouter'], { env: ENV, now: NOON });
assert.equal(s.paused, false);
assert.deepEqual(s.exhausted, ['groq']);
assert.equal(s.until, null);

gate.markExhausted('nvidia', NOON);
gate.markExhausted('openrouter', NOON);
s = b.check(['groq', 'nvidia', 'openrouter'], { env: ENV, now: NOON });
assert.equal(s.paused, true);
assert.equal(s.until, '2026-11-01T00:00:00.000Z');

// resets at UTC midnight with no action
assert.equal(b.check(['groq', 'nvidia', 'openrouter'], { env: ENV, now: new Date('2026-11-01T00:00:01Z') }).paused, false);

// ── mode 'any': pause at the first spent provider ─────────────────────────────
gate.resetExhaustion();
gate.markExhausted('groq', NOON);
assert.equal(b.check(['groq', 'nvidia'], { env: { FREE_TOKEN_BREAKER_MODE: 'any' }, now: NOON }).paused, true);
assert.equal(b.breakerMode({ FREE_TOKEN_BREAKER_MODE: 'typo' }), 'all', 'a typo is the default, never off');

// ── never pauses when it cannot see, or must not decide ───────────────────────
gate.markExhausted('nvidia', NOON);
const all = ['groq', 'nvidia'];
assert.equal(b.check(all, { env: { FREE_TOKEN_BREAKER_MODE: 'off' }, now: NOON }).reason, 'mode_off');
assert.equal(b.check(all, { env: { SEAN_PAID_LOOP: 'loop3' }, now: NOON }).paused, false);
assert.equal(b.check(all, { env: { LLM_GATEWAY_FIRST: 'true' }, now: NOON }).reason, 'gateway_first_quota_not_visible');
assert.equal(b.check([], { env: ENV, now: NOON }).reason, 'no_free_provider_key');
assert.equal(b.check([], { env: ENV, now: NOON }).paused, false);

// ── one event per transition, none on boot or repeat ──────────────────────────
b.resetObserver();
const lines = [];
const log = (l) => lines.push(l);
const running = { paused: false, mode: 'all', top: all, exhausted: [], until: null };
const tripped = { paused: true, mode: 'all', top: all, exhausted: all, until: '2026-11-01T00:00:00.000Z' };
assert.equal(b.observe('trinity-mel', running, log, NOON), null, 'boot running: no event');
assert.equal(b.observe('trinity-mel', tripped, log, NOON).event, 'free_tokens_exhausted');
assert.equal(b.observe('trinity-mel', tripped, log, NOON), null, 'repeat: no event');
assert.equal(b.observe('trinity-mel', running, log, NOON).event, 'free_tokens_restored');
assert.equal(lines.length, 2);
assert.match(lines[0], /^\[FREE_TOKEN_BREAKER\] \{"event":"free_tokens_exhausted","agent":"trinity-mel"/);

// ── /health ───────────────────────────────────────────────────────────────────
assert.equal(b.healthField(null), 'unknown');
assert.equal(b.healthField(tripped), 'EXHAUSTED_PAUSED');
assert.equal(b.healthField(running), 'available');

// ── placement pin: both loops check the breaker AFTER the halt and BEFORE claiming ──
// Pinned per call site, imports stripped, so deleting one gate or moving it after
// getNextTask fails here (same discipline as tests/emergency-halt-coverage.test.js).
{
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.resolve(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
  for (const loop of ['async runLoop()', 'async runLoopLegacy()']) {
    const start = src.indexOf(loop);
    assert.ok(start >= 0, `${loop} not found`);
    const body = src.slice(start, start + 6000);
    const halt = body.indexOf('shouldParkForHalt(');
    const gateAt = body.indexOf('this.freeTokensPaused()');
    const claim = body.indexOf('this.getNextTask()');
    assert.ok(halt >= 0 && gateAt > halt, `${loop}: breaker must follow the emergency halt`);
    assert.ok(claim > gateAt, `${loop}: breaker must precede getNextTask`);
  }
  const calls = src.split('\n').filter((l) => !/require\(/.test(l) && l.includes('this.freeTokensPaused()'));
  assert.equal(calls.length, 2, 'one breaker check per loop');
}

gate.resetExhaustion();
console.log('free-token-breaker.test.js: PASS');
