'use strict';
/**
 * FREE-TIER GATE. allow_paid=false until Sean writes `paid <loop>`
 * (recorded as env SEAN_PAID_LOOP=<loop>). OpenRouter :free ids are free.
 * 429 / insufficient_quota → exhausted_until next UTC midnight.
 * Does not invent keys. Does not call models.
 */

const FREE_TRY_ORDER = ['groq', 'cerebras', 'openrouter', 'nvidia', 'together'];

/** @type {Map<string, Date>} */
const exhaustedUntil = new Map();

function allowPaid(env) {
  const e = env || process.env;
  const v = String(e.SEAN_PAID_LOOP || e.ALLOW_PAID || '').trim().toLowerCase();
  if (!v || v === 'false' || v === '0' || v === 'hold' || v === 'no') return false;
  return true;
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

function markExhausted(provider, now) {
  exhaustedUntil.set(provider, nextUtcMidnight(now || new Date()));
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
  const eligible = candidates.filter((p) => isFreeSlot(p, allow) && !isExhausted(p.provider, now));
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
  isOpenRouterFreeModel,
  isQuotaExhaustedError,
  nextUtcMidnight,
  markExhausted,
  resetExhaustion,
  isExhausted,
  allFreeExhausted,
  orderProviders,
  rotationOn,
  isFreeSlot,
};
