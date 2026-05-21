/**
 * Direct Postgres client (PostgREST bypass) — CC Sprint 2026-05-21.
 *
 * CommonJS port of repid-engine's src/db/direct-pg.ts. Mirrors the API exactly:
 * getPgPool() / pgQuery(text, params, opts) / pgPing() / closePgPool().
 *
 * High-frequency agent calls (heartbeat, getNextTask, claimTask) route here
 * instead of through supabase-js / PostgREST. Direct Postgres returns in
 * microseconds even when the REST gateway / Supavisor upstream is saturated.
 * supabase-js stays in place for everything else.
 *
 * CLAUDE-RULE-8 (NEVER UNBOUNDED WAIT) baked in: per-attempt Promise.race
 * timeout, exponential backoff (1/4/16/64/256s), process-wide circuit breaker
 * (5 consecutive fully-failed calls → 5min cool-down). Failure counting is
 * per-operation (matches ConstitutionalAgentV4 heartbeat breaker): one
 * retry-exhausted call = one consecutive failure; any success resets.
 *
 * Connection: DATABASE_URL must be the Supavisor TRANSACTION pooler URL
 * (port 6543). Pool max=5. One-shot parameterized queries only.
 */
const { Pool } = require('pg');

const DEFAULT_QUERY_TIMEOUT_MS = 10000;
const CONNECTION_TIMEOUT_MS = 5000;
const POOL_MAX = 5;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
const BACKOFF_SCHEDULE_MS = [1000, 4000, 16000, 64000, 256000];

let pool = null;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
let circuitOpenLogged = false;

function resolveConnectionString() {
  const cs = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!cs) {
    throw new Error(
      '[direct-pg] DATABASE_URL (or SUPABASE_DB_URL) is not set. ' +
        'Set the Supabase transaction-pooler connection string (port 6543).'
    );
  }
  return cs;
}

function getPgPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: resolveConnectionString(),
      max: POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      statement_timeout: DEFAULT_QUERY_TIMEOUT_MS,
      query_timeout: DEFAULT_QUERY_TIMEOUT_MS,
    });
    pool.on('error', (err) => {
      console.error('[direct-pg] idle pool client error:', err.message);
    });
  }
  return pool;
}

function timeoutReject(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`[direct-pg] query timeout after ${ms}ms: ${label}`)), ms)
  );
}

/**
 * Run a parameterized query and return rows. Throws on failure (after retries)
 * or when the circuit is open.
 *
 * @param {string} text   SQL with $1,$2,... placeholders
 * @param {Array}  params bound parameters
 * @param {{timeoutMs?:number, retries?:number, label?:string}} [opts]
 * @returns {Promise<Array>}
 */
async function pgQuery(text, params = [], opts = {}) {
  if (Date.now() < circuitOpenUntil) {
    throw new Error(`[direct-pg] circuit open until ${new Date(circuitOpenUntil).toISOString()}`);
  }

  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : DEFAULT_QUERY_TIMEOUT_MS;
  const maxAttempts = Math.max(1, opts.retries != null ? opts.retries : BACKOFF_SCHEDULE_MS.length);
  const label = opts.label || text.slice(0, 48).replace(/\s+/g, ' ');

  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await Promise.race([getPgPool().query(text, params), timeoutReject(timeoutMs, label)]);
      consecutiveFailures = 0;
      circuitOpenLogged = false;
      return result.rows;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        const delay = BACKOFF_SCHEDULE_MS[attempt] || BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1];
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && !circuitOpenLogged) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    circuitOpenLogged = true;
    console.error(
      `[direct-pg] CIRCUIT OPEN — ${CIRCUIT_BREAKER_THRESHOLD}+ consecutive failed calls; ` +
        `cool-down ${CIRCUIT_COOLDOWN_MS}ms (5min). Last error: ${lastErr && lastErr.message ? lastErr.message : String(lastErr)}`
    );
  }
  throw lastErr instanceof Error ? lastErr : new Error(`[direct-pg] query failed: ${label}`);
}

/** Boot-time reachability check. Single attempt, 5s ceiling. Never throws. */
async function pgPing() {
  const start = Date.now();
  try {
    await pgQuery('SELECT 1', [], { timeoutMs: 5000, retries: 1, label: 'pgPing' });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err && err.message ? err.message : String(err) };
  }
}

/** Close the pool (graceful shutdown). */
async function closePgPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPgPool, pgQuery, pgPing, closePgPool };
