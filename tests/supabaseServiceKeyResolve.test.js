// Fail-closed Supabase service-key resolution test.
// Run: node tests/supabaseServiceKeyResolve.test.js
//
// Proves the fix for the silent-anon degradation that made the fleet heartbeat
// RLS-loop fail quietly:
//
//  (a) A missing service key THROWS (fail-closed) rather than returning a key.
//  (b) An env that has ONLY an anon key still THROWS — anon is never an accepted
//      fallback for the admin/writer client.
//  (c) SUPABASE_SECRET_KEY (the new sb_secret_ name) resolves and takes
//      precedence over every legacy name.
//  (d) The legacy chain still works: SERVICE_ROLE_KEY > SERVICE_KEY > SUPABASE_KEY.
//  (e) The thrown error names the env vars it looked for (actionable, loud).
//
// No jest in this repo (CI runs plain `node tests/*.test.js`).

'use strict';

const assert = require('node:assert/strict');
const { resolveSupabaseServiceKey } = require('../lib/resolve-supabase-service-key');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

// (a) missing key → throws
test('throws when no service key is set (fail-closed)', () => {
  assert.throws(
    () => resolveSupabaseServiceKey({}),
    /FAIL-CLOSED/,
    'empty env must throw, not return a key'
  );
});

// (b) only anon present → still throws (anon is never a fallback)
test('throws when ONLY an anon key is present (no silent anon fallback)', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-jwt-xxx',
    SUPABASE_ANON_KEY: 'anon-jwt-xxx',
  };
  assert.throws(
    () => resolveSupabaseServiceKey(env),
    /FAIL-CLOSED/,
    'an anon-only env must throw — anon must not resolve as the service key'
  );
});

// (c) SUPABASE_SECRET_KEY wins over every legacy name
test('SUPABASE_SECRET_KEY resolves and takes precedence over legacy names', () => {
  const env = {
    SUPABASE_SECRET_KEY: 'sb_secret_NEW',
    SUPABASE_SERVICE_ROLE_KEY: 'legacy_role',
    SUPABASE_SERVICE_KEY: 'legacy_service',
    SUPABASE_KEY: 'legacy_key',
  };
  assert.equal(resolveSupabaseServiceKey(env), 'sb_secret_NEW');
});

// (d) legacy precedence order
test('legacy precedence: SERVICE_ROLE_KEY > SERVICE_KEY > SUPABASE_KEY', () => {
  assert.equal(
    resolveSupabaseServiceKey({ SUPABASE_SERVICE_ROLE_KEY: 'role', SUPABASE_SERVICE_KEY: 's', SUPABASE_KEY: 'k' }),
    'role'
  );
  assert.equal(
    resolveSupabaseServiceKey({ SUPABASE_SERVICE_KEY: 's', SUPABASE_KEY: 'k' }),
    's'
  );
  assert.equal(
    resolveSupabaseServiceKey({ SUPABASE_KEY: 'k' }),
    'k'
  );
});

// blank/whitespace-only values are treated as unset → throw
test('blank/whitespace-only values do not count as a key', () => {
  assert.throws(
    () => resolveSupabaseServiceKey({ SUPABASE_SECRET_KEY: '   ', SUPABASE_SERVICE_ROLE_KEY: '' }),
    /FAIL-CLOSED/
  );
});

// (e) error message names the vars it searched
test('error names the env vars it looked for', () => {
  try {
    resolveSupabaseServiceKey({});
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /SUPABASE_SECRET_KEY/);
    assert.match(e.message, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(e.message, /SUPABASE_SERVICE_KEY/);
  }
});

console.log('\nsupabaseServiceKeyResolve: ' + passed + ' tests passed.');
