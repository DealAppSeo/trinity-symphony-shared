'use strict';

/**
 * Fail-closed resolution of the Supabase SERVICE (admin / writer) key.
 *
 * Precedence (first defined, non-empty value wins):
 *   1. SUPABASE_SECRET_KEY        — new Supabase "sb_secret_..." secret-key naming
 *   2. SUPABASE_SERVICE_ROLE_KEY  — legacy service-role JWT (the ops var Sean sets in Railway)
 *   3. SUPABASE_SERVICE_KEY       — legacy alias
 *   4. SUPABASE_KEY               — oldest legacy alias
 *
 * The ANON key is DELIBERATELY not in this chain. Falling back to an anon key
 * silently degrades every admin/writer client to a role that Row-Level Security
 * rejects on write — the exact failure mode that made the fleet heartbeat loop
 * fail quietly (RLS-rejected forever, no crash, no signal). If no service key
 * resolves we THROW loudly (fail-closed) instead of handing back an anon key.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @param {{ includeLegacySupabaseKey?: boolean }} [opts]
 * @returns {string} the resolved service key (guaranteed non-empty)
 * @throws {Error} if no service key env var is set (loud, fail-closed)
 */
function resolveSupabaseServiceKey(env, opts) {
  env = env || process.env;
  const includeLegacySupabaseKey = !opts || opts.includeLegacySupabaseKey !== false;

  const candidates = [
    ['SUPABASE_SECRET_KEY', env.SUPABASE_SECRET_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY],
    ['SUPABASE_SERVICE_KEY', env.SUPABASE_SERVICE_KEY],
  ];
  if (includeLegacySupabaseKey) {
    candidates.push(['SUPABASE_KEY', env.SUPABASE_KEY]);
  }

  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i][1];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const names = candidates.map(function (c) { return c[0]; }).join(', ');
  throw new Error(
    '[SUPABASE][FAIL-CLOSED] No Supabase service key found. Looked for (in order): ' +
    names + '. Refusing to fall back to an anon key — an anon client is silently ' +
    'RLS-rejected on every write, which kills the fleet heartbeat loop with no error. ' +
    'Set SUPABASE_SECRET_KEY (new sb_secret_ name) or the legacy SUPABASE_SERVICE_ROLE_KEY ' +
    'in the environment (Railway service vars).'
  );
}

module.exports = { resolveSupabaseServiceKey };
