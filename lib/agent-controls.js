/**
 * Agent loop control — reads `agent_controls.enabled` (live SSOT table).
 * Cache: Upstash Redis (10s TTL) + in-process fallback.
 * Default-off when the control store is unreachable (CLAUDE-RULE-8 safe mode).
 */
const { pgQuery } = require('./direct-pg');
const { Redis } = require('@upstash/redis');

const CACHE_TTL_SEC = Number(process.env.AGENT_CONTROL_CACHE_TTL_SEC || 10);
const memCache = new Map();

let redisClient = null;

// Circuit breaker: once Redis/Dragonfly proves unreachable we stop hitting it
// (and stop logging) for a cooldown window, so an unreachable cache degrades to
// the mem/DB path QUIETLY — a single warn, not per-call red spam.
const REDIS_COOLDOWN_MS = Number(process.env.AGENT_CONTROL_REDIS_COOLDOWN_MS || 60000);
let redisUnavailableUntil = 0;
let redisWarned = false;

function redisAvailable() {
  // Presence check: no configured URL → cache disabled cleanly (never an error).
  if (!process.env.UPSTASH_REDIS_REST_URL) return false;
  // Within cooldown after a failure → skip quietly.
  if (Date.now() < redisUnavailableUntil) return false;
  return true;
}

// Trip the breaker on a connection failure. Logs ONE warn per cooldown window,
// then stays silent while unreachable.
function markRedisDown(op, message) {
  redisUnavailableUntil = Date.now() + REDIS_COOLDOWN_MS;
  if (!redisWarned) {
    console.warn(`[agent-controls] redis/dragonfly unreachable (${op}: ${message}) — using mem/DB fallback, muting for ${Math.round(REDIS_COOLDOWN_MS / 1000)}s`);
    redisWarned = true;
  }
}

function getRedis() {
  if (!redisAvailable()) return null;
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
  } catch (e) {
    markRedisDown('write', e.message);
  }
}

async function readRemoteCache(key) {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get(key);
    redisWarned = false; // recovered → re-arm the single-warn for any future outage
    if (v === '1' || v === true) return true;
    if (v === '0' || v === false) return false;
    return null;
  } catch (e) {
    markRedisDown('read', e.message);
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