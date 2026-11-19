'use strict';
/**
 * FREE-TIER GATE. allow_paid=false until Sean writes `paid <loop>`
 * (recorded as env SEAN_PAID_LOOP=<loop>). OpenRouter :free ids are free.
 * 429 / insufficient_quota → exhausted_until next UTC midnight.
 * Does not invent keys. Does not call models.
 */

// Only providers with a free route. Together was here until 2026-11-08: it answers 402 and needs credit.
const FREE_TRY_ORDER = ['groq', 'cerebras', 'openrouter', 'nvidia'];

/** @type {Map<string, Date>} */
const exhaustedUntil = new Map();

/**
 * COST MODE, decided where a request is dispatched.
 *   COST_MODE unset        the behaviour before this existed: paid when SEAN_PAID_LOOP / ALLOW_PAID says so.
 *   COST_MODE=PAID_CAPPED  paid only with that approval AND an unexpired PAID_APPROVAL_EXPIRES (ISO time)
 *                          AND a positive PAID_MAX_CALLS not yet used up. Either missing: denied.
 *   any other value        FREE_ONLY: nothing paid, whatever else is set (a typo never enables spend).
 * PAID_APPROVAL_EXPIRES and PAID_MAX_CALLS are enforced in every mode once set.
 * ponytail: the call count is per process, not per fleet; a fleet-wide cap needs a shared counter (DB or Redis).
 */
let paidCalls = 0;
function notePaidCall() { paidCalls += 1; }
function paidCallsUsed() { return paidCalls; }
function resetPaidCalls() { paidCalls = 0; }

function paidDecision(env, now) {
  const e = env || process.env;
  const n = now || new Date();
  const mode = String(e.COST_MODE || '').trim().toUpperCase();
  if (mode && mode !== 'PAID_CAPPED') return { allow: false, reason: 'free_only' };
  const v = String(e.SEAN_PAID_LOOP || e.ALLOW_PAID || '').trim().toLowerCase();
  if (!v || v === 'false' || v === '0' || v === 'hold' || v === 'no') return { allow: false, reason: 'no_approval' };
  const expRaw = String(e.PAID_APPROVAL_EXPIRES || '').trim();
  const capRaw = String(e.PAID_MAX_CALLS || '').trim();
  if (mode === 'PAID_CAPPED' && (!expRaw || !capRaw)) return { allow: false, reason: 'approval_has_no_expiry_or_cap' };
  if (expRaw) {
    const exp = new Date(expRaw);
    if (Number.isNaN(exp.getTime())) return { allow: false, reason: 'approval_expiry_unreadable' };
    if (n >= exp) return { allow: false, reason: 'approval_expired' };
  }
  if (capRaw) {
    const cap = Number(capRaw);
    if (!Number.isInteger(cap) || cap <= 0) return { allow: false, reason: 'cap_unreadable' };
    if (paidCalls >= cap) return { allow: false, reason: 'cap_reached' };
  }
  return { allow: true, reason: 'approved' };
}

function allowPaid(env, now) {
  return paidDecision(env, now).allow;
}

/**
 * DATA SHARING is its own permission, separate from spend. DATA_SHARE_PROVIDERS unset: every provider may be
 * sent the prompt (the behaviour before this existed). Set (comma list): only those providers, free or paid.
 * A paid approval never widens it, and being on the list never makes a paid provider free.
 */
function dataShareAllowed(provider, env) {
  const raw = String((env || process.env).DATA_SHARE_PROVIDERS || '').trim().toLowerCase();
  if (!raw) return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean).includes(provider);
}

function isOpenRouterFreeModel(model) {
  return typeof model === 'string' && model.endsWith(':free');
}

function isQuotaExhaustedError(message) {
  const m = String(message || '').toLowerCase();
  return (
    /\b429\b/.test(m) ||
    m.includes('insufficient_quota') ||
    /rate.?limit/.test(m) ||
    /credits? (depleted|exhausted)/.test(m)
  );
}

function nextUtcMidnight(now) {
  const n = now || new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0));
}

// A per-minute limit clears in a minute. Until 2026-11-18 it was marked "exhausted until UTC midnight" like a
// spent day: 11 of 12 agents sat paused while the same model answered with daily requests to spare.
const MINUTE_COOLDOWN_MS = 90 * 1000;

/**
 * How long to stand off after a quota error. A message naming a DAILY window or spent credit: next UTC
 * midnight. A message naming a per-MINUTE window, or a retry of seconds ("try again in 7.5s"): 90 seconds.
 * Anything else, or no message: next UTC midnight, the behaviour before this function existed.
 */
function exhaustionUntil(message, now) {
  const n = now || new Date();
  const m = String(message || '').toLowerCase();
  if (/per day|\(tpd\)|\(rpd\)|daily|insufficient_quota|credits? (depleted|exhausted)/.test(m)) return nextUtcMidnight(n);
  if (/per minute|\(tpm\)|\(rpm\)|try again in \d+(\.\d+)?\s*(ms|s\b|sec)/.test(m)) return new Date(n.getTime() + MINUTE_COOLDOWN_MS);
  return nextUtcMidnight(n);
}

/** message is the provider's error text; without it this is the old "until midnight". Never shortens a longer stand-off. */
function markExhausted(provider, now, message) {
  const until = exhaustionUntil(message, now || new Date());
  const prev = exhaustedUntil.get(provider);
  if (!prev || until > prev) exhaustedUntil.set(provider, until);
}

/** When this provider may be tried again, or null if it is not marked. */
function exhaustedUntilOf(provider) {
  return exhaustedUntil.get(provider) || null;
}

function resetExhaustion() {
  exhaustedUntil.clear();
}

function isExhausted(provider, now) {
  const until = exhaustedUntil.get(provider);
  if (!until) return false;
  return (now || new Date()) < until;
}

function allFreeExhausted(now) {
  const n = now || new Date();
  return FREE_TRY_ORDER.every((p) => isExhausted(p, n));
}

function isFreeSlot(p, allowPaidFlag) {
  if (allowPaidFlag) return true;
  if (p.provider === 'openrouter') return isOpenRouterFreeModel(p.model || '');
  if (FREE_TRY_ORDER.includes(p.provider)) return true;
  return false;
}

/** FREE_ROTATE_BY_AGENT=on spreads the fleet across its free providers (default off). */
function rotationOn(env) {
  return String((env || process.env).FREE_ROTATE_BY_AGENT || '').trim().toLowerCase() === 'on';
}

/**
 * opts.rotateBy (an agent's roster index): with rotation on, the free providers start at that
 * offset, so agent 0 asks the first free provider first, agent 1 the second, and so on. Without
 * it every agent asked groq first: 9 of 10 T12 tasks ran on one model (2026-11-01). Failover
 * order after the first stays the same cycle; paid slots (only when allowed) stay last.
 */
function orderProviders(candidates, opts) {
  const allow = !!(opts && opts.allowPaid);
  const now = (opts && opts.now) || new Date();
  const eligible = candidates.filter((p) => isFreeSlot(p, allow) && !isExhausted(p.provider, now) && dataShareAllowed(p.provider, opts && opts.env));
  const rank = (name) => {
    const i = FREE_TRY_ORDER.indexOf(name);
    return i === -1 ? 100 : i;
  };
  const sorted = eligible.sort((a, b) => rank(a.provider) - rank(b.provider));
  const by = opts && opts.rotateBy;
  if (!rotationOn(opts && opts.env) || !Number.isInteger(by) || by < 0) return sorted;
  const free = sorted.filter((p) => FREE_TRY_ORDER.includes(p.provider) && isFreeSlot(p, false));
  if (free.length < 2) return sorted;
  const k = by % free.length;
  return free.slice(k).concat(free.slice(0, k), sorted.filter((p) => !free.includes(p)));
}

module.exports = {
  FREE_TRY_ORDER,
  allowPaid,
  paidDecision,
  notePaidCall,
  paidCallsUsed,
  resetPaidCalls,
  dataShareAllowed,
  isOpenRouterFreeModel,
  isQuotaExhaustedError,
  nextUtcMidnight,
  markExhausted,
  exhaustionUntil,
  exhaustedUntilOf,
  MINUTE_COOLDOWN_MS,
  resetExhaustion,
  isExhausted,
  allFreeExhausted,
  orderProviders,
  rotationOn,
  isFreeSlot,
};
