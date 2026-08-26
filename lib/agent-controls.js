/**
 * Agent loop control — reads `agent_controls.enabled` (live SSOT table).
 * Cache: Upstash Redis (10s TTL) + in-process fallback.
 * Default-off when the control store is unreachable (CLAUDE-RULE-8 safe mode).
 *
 * CIRCUIT BREAKER (added 2026-08-26): every deployed agent service
 * (trinity-gcm, trinity-sophia, trinity-hdm, trinity-torch, trinity-veritas —
 * observed directly in their Railway deploy logs) was logging "redis cache
 * read/write failed: fetch failed" on an unbroken loop for days.
 * `UPSTASH_REDIS_REST_URL` is set — otherwise getRedis() would return null
 * before ever calling the API and no warning would print at all — but the
 * endpoint it points to is unreachable. The memCache + DB fallback below
 * already keeps `isAgentEnabled` correct through that (this was never a
 * correctness bug), but every single call was still paying a live network
 * round-trip to a known-dead host and logging a warning for it, forever.
 * Past FAILURE_THRESHOLD consecutive failures this stops calling Upstash for
 * COOLDOWN_MS and logs the open/close transition once instead of on every
 * call. A live Upstash endpoint never sees a failure, so the breaker never
 * opens for it.
 */
const { pgQuery } = require('./direct-pg');
const { Redis } = require('@upstash/redis');

const CACHE_TTL_SEC = Number(process.env.AGENT_CONTROL_CACHE_TTL_SEC || 10);
const memCache = new Map();

let redisClient = null;

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = Number(process.env.AGENT_CONTROL_REDIS_COOLDOWN_MS || 5 * 60 * 1000);
let consecutiveFailures = 0;
let openUntil = 0;

function redisBreakerOpen() {
  return openUntil > Date.now();
}

function recordRedisFailure(op, message) {
  consecutiveFailures += 1;
  if (consecutiveFailures === FAILURE_THRESHOLD) {
    openUntil = Date.now() + COOLDOWN_MS;
    console.warn(
      `[agent-controls] redis cache ${op} failed ${FAILURE_THRESHOLD}x in a row (${message}) — ` +
        `opening circuit breaker for ${Math.round(COOLDOWN_MS / 1000)}s (DB + in-process cache still serve requests)`
    );
  } else {
    // Log the first couple of failures individually — enough to diagnose a
    // real blip without repeating forever once the breaker takes over.
    console.warn(`[agent-controls] redis cache ${op} failed:`, message);
  }
}

function recordRedisSuccess() {
  if (consecutiveFailures > 0 || openUntil > 0) {
    console.warn('[agent-controls] redis cache recovered — closing circuit breaker');
  }
  consecutiveFailures = 0;
  openUntil = 0;
}

function getRedis() {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  if (redisBreakerOpen()) return null;
  if (!redisClient) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    });
  }
  return redisClient;
}

/** Map trinity-mel → mel for agent_controls.agent_name */
function toControlName(agentName) {
  return String(agentName || '')
    .toLowerCase()
    .replace(/^trinity-/, '')
    .trim();
}

function cacheKey(controlName) {
  return `agent_control:${controlName}`;
}

function setMemCache(key, enabled) {
  memCache.set(key, { value: enabled, expiresAt: Date.now() + CACHE_TTL_SEC * 1000 });
}

async function setRemoteCache(key, enabled) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, enabled ? '1' : '0', { ex: CACHE_TTL_SEC });
    recordRedisSuccess();
  } catch (e) {
    recordRedisFailure('write', e.message);
  }
}

async function readRemoteCache(key) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get(key);
    recordRedisSuccess();
    if (v === '1' || v === true) return true;
    if (v === '0' || v === false) return false;
    return null;
  } catch (e) {
    recordRedisFailure('read', e.message);
    return null;
  }
}

async function readEnabledFromDb(controlName) {
  const rows = await pgQuery(
    `SELECT enabled FROM agent_controls WHERE agent_name = $1`,
    [controlName],
    { retries: 1, timeoutMs: 5000, label: 'agent-controls-read' }
  );
  if (!rows.length) return true;
  return !!rows[0].enabled;
}

/**
 * @param {string} agentName canonical agent name (trinity-mel, etc.)
 * @returns {Promise<boolean>} true = work allowed; false = heartbeat only
 */
async function isAgentEnabled(agentName) {
  const controlName = toControlName(agentName);
  const key = cacheKey(controlName);

  const remote = await readRemoteCache(key);
  if (remote !== null) return remote;

  const mem = memCache.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.value;

  try {
    const enabled = await readEnabledFromDb(controlName);
    setMemCache(key, enabled);
    await setRemoteCache(key, enabled);
    return enabled;
  } catch (e) {
    console.warn(`[agent-controls] store unreachable for ${controlName}, default-off:`, e.message);
    return false;
  }
}

/** Invalidate cache after external update (telegram / SQL) */
async function bustAgentControlCache(agentName) {
  const controlName = toControlName(agentName);
  const key = cacheKey(controlName);
  memCache.delete(key);
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch (_) { /* non-fatal */ }
  }
}

module.exports = {
  toControlName,
  isAgentEnabled,
  bustAgentControlCache,
  CACHE_TTL_SEC,
};