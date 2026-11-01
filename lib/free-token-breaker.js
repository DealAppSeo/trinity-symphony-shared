'use strict';
/**
 * FREE-TOKEN BREAKER. free-tier-gate marks a provider exhausted until the next UTC midnight
 * when it answers 429 / insufficient_quota, and with allow_paid=false that can leave an agent
 * with nothing to call. Before this, the loop kept claiming tasks anyway and each one failed
 * "All LLMs failed" up to three times: the day's free quota was gone and the queue paid for it.
 *
 * gate.allFreeExhausted() could not catch this: it waits for ALL FIVE free providers, and a
 * provider this agent has no key for (or cerebras, PARKED) is never called, so never marked.
 * The breaker counts only the free providers this agent can actually use.
 *
 * When they are exhausted the loop stops claiming and spawning until midnight UTC, and says so
 * ONCE: one log line, and the /health field an uptime monitor can match on. How Sean is told
 * is his; this only emits the event.
 *
 * FREE_TOKEN_BREAKER_MODE: 'all' (default) pauses when every one of the agent's top three free
 * providers is exhausted, i.e. out of free tokens for the day. 'any' pauses at the first one.
 * 'off' never pauses. No paid fallback: this never widens what free-tier-gate allows.
 */
const gate = require('./free-tier-gate');

/** The agent's top free providers, in the gate's try order: has a key, a real model, and is free. */
function topFree(slots, n = 3) {
  const names = slots
    .filter((s) => s.model !== 'PARKED' && gate.isFreeSlot(s, false))
    .map((s) => s.provider);
  return gate.FREE_TRY_ORDER.filter((p) => names.includes(p)).slice(0, n);
}

function breakerMode(env) {
  const m = String((env || process.env).FREE_TOKEN_BREAKER_MODE || '').trim().toLowerCase();
  return m === 'any' || m === 'off' ? m : 'all';
}

/**
 * Should the loop pause? Never pauses when there is nothing free to count (no free keys, or the
 * litellm gateway runs first and its quota is not visible here), or when Sean allowed paid calls.
 */
function check(top, opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || new Date();
  const mode = breakerMode(env);
  const exhausted = top.filter((p) => gate.isExhausted(p, now));
  let reason = null;
  if (mode === 'off') reason = 'mode_off';
  else if (gate.allowPaid(env)) reason = 'paid_allowed';
  else if (String(env.LLM_GATEWAY_FIRST || '').trim().toLowerCase() === 'true') reason = 'gateway_first_quota_not_visible';
  else if (top.length === 0) reason = 'no_free_provider_key';
  const paused =
    reason === null && (mode === 'any' ? exhausted.length > 0 : exhausted.length === top.length);
  return {
    paused,
    mode,
    top,
    exhausted,
    until: paused ? gate.nextUtcMidnight(now).toISOString() : null,
    reason,
  };
}

let lastPaused = null;

/** Log one event when the breaker trips or resets; nothing on boot or on a repeat. */
function observe(agent, state, log = console.log, now = new Date()) {
  const prev = lastPaused;
  lastPaused = state.paused;
  if (prev === state.paused || (prev === null && !state.paused)) return null;
  const event = {
    event: state.paused ? 'free_tokens_exhausted' : 'free_tokens_restored',
    agent,
    mode: state.mode,
    top: state.top,
    exhausted: state.exhausted,
    until: state.until,
    at: now.toISOString(),
  };
  log(`[FREE_TOKEN_BREAKER] ${JSON.stringify(event)}`);
  return event;
}

/** What /health shows. 'EXHAUSTED_PAUSED' is the string to match in an uptime keyword monitor. */
function healthField(state) {
  if (!state) return 'unknown';
  return state.paused ? 'EXHAUSTED_PAUSED' : 'available';
}

function resetObserver() {
  lastPaused = null;
}

module.exports = { topFree, breakerMode, check, observe, healthField, resetObserver };
