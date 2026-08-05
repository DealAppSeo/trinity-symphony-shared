// node tests/emergency-halt.test.js
//
// Behaviour pins for the agent-side global kill switch (L0 gate 0.4).
// Plain-node + assert, matching this repo's existing test convention.
//
// The properties asserted here are the ones that decide whether the switch is
// trustworthy in an incident, not merely present:
//   - it cannot be typo'd into being disabled (fail-closed mode parser)
//   - a flaky database can neither START a halt nor LIFT one
//   - a missing column is inert (safe to deploy before/without the DDL)
//   - the read is BOUNDED (a hung DB must not wedge the loop it protects)
//   - shadow mode does not park, and says so honestly
'use strict';
const assert = require('assert');

const halt = require('../lib/emergency-halt');
const { parseHaltMode, isHaltTruthy, readHalt, shouldParkForHalt } = halt;

/** A fake pgQuery. `behaviour` decides what the read does. */
function fakeQuery(behaviour) {
  const state = { calls: 0 };
  const fn = async () => {
    state.calls++;
    return behaviour(state.calls);
  };
  fn.state = state;
  return fn;
}

function reset(mode) {
  halt.__resetForTests();
  if (mode === undefined) delete process.env.EMERGENCY_HALT_MODE;
  else process.env.EMERGENCY_HALT_MODE = mode;
}

async function main() {
  // ── 1. MODE PARSER FAILS CLOSED ────────────────────────────────────────────
  // Only exact off/shadow (case + surrounding whitespace insensitive) weaken it.
  // NOTE: these are ALL legitimate case/whitespace variants of exactly "off".
  // `ofF ` and `off\n` belong here, not in the enforce list — a Railway field
  // with a trailing newline is a typo in the fingers, not in the intent. (My
  // first version of this test asserted the opposite and the run corrected me.)
  for (const v of ['off', 'OFF', ' off ', 'Off', 'ofF ', ' off', 'off\n', '\toff\t']) {
    assert.strictEqual(parseHaltMode(v), 'off', `expected off for ${JSON.stringify(v)}`);
  }
  for (const v of ['shadow', 'SHADOW', '  Shadow\t']) {
    assert.strictEqual(parseHaltMode(v), 'shadow', `expected shadow for ${JSON.stringify(v)}`);
  }
  // Everything else must resolve to enforce. These are the values an operator
  // or a bad deploy actually produces — each one, misparsed, silently disables
  // the kill switch.
  const mustEnforce = [
    'of', 'false', 'FALSE', '0', '1', 'disabled', 'disable', 'no', 'none',
    'null', 'undefined', '', '   ', 'enforce', 'ENFORCE', 'enforce ', 'shadowy',
    'offf', 'o ff', 'off;', 'shadow-mode', 'true', 'yes', 'halt', 'off off',
    '\u0000off', 'o​ff', 'ｏｆｆ', 'öff', 'off,shadow', 'sh adow', 'SHADOW!', '-off', 'off=1', 'off .', '["off"]', '{"mode":"off"}',
  ];
  for (const v of mustEnforce) {
    assert.strictEqual(parseHaltMode(v), 'enforce', `expected enforce for ${JSON.stringify(v)}`);
  }
  // Non-strings can never weaken it either.
  for (const v of [undefined, null, 0, 1, false, true, {}, [], ['off'], { toString: () => 'off' }]) {
    assert.strictEqual(parseHaltMode(v), 'enforce', `expected enforce for ${String(v)}`);
  }
  console.log(`  ok  mode parser fails closed (${8 + 3 + mustEnforce.length + 10} values)`);

  // ── 2. TRUTHINESS IS NARROW IN ONE DIRECTION ONLY ─────────────────────────
  for (const v of [true, 'true', 'TRUE', ' true ']) {
    assert.strictEqual(isHaltTruthy(v), true, `expected halt-truthy: ${String(v)}`);
  }
  for (const v of [false, 'false', 't', 1, '1', 'yes', null, undefined, [], {}, 'True!']) {
    assert.strictEqual(isHaltTruthy(v), false, `expected NOT halt-truthy: ${String(v)}`);
  }
  console.log('  ok  isHaltTruthy accepts true/"true" and nothing else');

  // ── 3. THE HAPPY PATHS ─────────────────────────────────────────────────────
  reset('enforce');
  halt.__setQueryImplForTests(fakeQuery(() => [{ emergency_halt: false }]));
  assert.deepStrictEqual(await readHalt(), { halted: false, source: 'db' });
  assert.strictEqual(await shouldParkForHalt('t'), false);

  reset('enforce');
  halt.__setQueryImplForTests(fakeQuery(() => [{ emergency_halt: true }]));
  assert.deepStrictEqual(await readHalt(), { halted: true, source: 'db' });
  assert.strictEqual(await shouldParkForHalt('t'), true);
  console.log('  ok  false => run, true => park');

  // A missing singleton row is NOT a halt (config absent, not set).
  reset('enforce');
  halt.__setQueryImplForTests(fakeQuery(() => []));
  assert.strictEqual((await readHalt()).halted, false);
  console.log('  ok  no row => not halted');

  // ── 4. A READ ERROR CAN NEVER *START* A HALT ──────────────────────────────
  reset('enforce');
  halt.__setQueryImplForTests(fakeQuery(() => { throw new Error('pooler unreachable'); }));
  const openRes = await readHalt();
  assert.strictEqual(openRes.halted, false);
  assert.strictEqual(openRes.source, 'error_open');
  assert.strictEqual(await shouldParkForHalt('t'), false);
  console.log('  ok  read error fails OPEN (a flaky DB cannot park the fleet)');

  // ── 5. A READ ERROR CAN NEVER *LIFT* A HALT (sticky) ──────────────────────
  // This is the one that matters most: an operator pulls the switch DURING an
  // incident; the incident must not release it.
  reset('enforce');
  halt.__setQueryImplForTests(fakeQuery((n) => {
    if (n === 1) return [{ emergency_halt: true }];
    throw new Error('pooler died right after');
  }));
  assert.strictEqual((await readHalt()).halted, true, 'first read should halt');
  halt.bustHaltCache();
  const sticky = await readHalt();
  assert.strictEqual(sticky.halted, true, 'halt must survive a failed read');
  assert.strictEqual(sticky.source, 'error_sticky');
  console.log('  ok  halt is STICKY across read failures');

  // ...and only a successful read of FALSE resumes.
  reset('enforce');
  let phase = 'halt';
  halt.__setQueryImplForTests(fakeQuery(() => {
    if (phase === 'halt') return [{ emergency_halt: true }];
    if (phase === 'error') throw new Error('flaky');
    return [{ emergency_halt: false }];
  }));
  assert.strictEqual((await readHalt()).halted, true);
  phase = 'error'; halt.bustHaltCache();
  assert.strictEqual((await readHalt()).halted, true);
  phase = 'ok'; halt.bustHaltCache();
  assert.strictEqual((await readHalt()).halted, false, 'a successful false must resume');
  console.log('  ok  only a successful read of false resumes');

  // ── 6. MISSING COLUMN IS INERT ────────────────────────────────────────────
  for (const err of [
    Object.assign(new Error('boom'), { code: '42703' }),
    Object.assign(new Error('boom'), { code: '42P01' }),
    new Error('column "emergency_halt" does not exist'),
    new Error('relation "trinity_system_config" does not exist'),
  ]) {
    reset('enforce');
    halt.__setQueryImplForTests(fakeQuery(() => { throw err; }));
    const r = await readHalt();
    assert.strictEqual(r.halted, false);
    assert.strictEqual(r.source, 'missing_column', `expected missing_column for ${err.code || err.message}`);
  }
  console.log('  ok  missing column/table => inert (safe before/without the DDL)');

  // ── 7. THE READ IS BOUNDED ────────────────────────────────────────────────
  // A hung database must not wedge the loop this switch protects. The engine
  // shipped exactly this bug and only CI caught it.
  //
  // THE WATCHDOG IS NOT DECORATION — it is the only reason this check can fail.
  // The first version of this test just awaited readHalt() and measured the
  // elapsed time. A mutation that DELETED the timeout made it pass anyway:
  // with the fake query never settling and nothing else on the event loop,
  // Node judged the loop empty and exited 0 *inside the await*, so the
  // assertions never ran and the suite "passed". That is Beat 34's
  // exit-mid-await defect reproduced in a test instead of a script. The
  // watchdog's timer keeps the loop alive AND rejects, so an unbounded read
  // now fails loudly instead of vanishing.
  reset('enforce');
  halt.__setQueryImplForTests(() => new Promise(() => {})); // never settles
  const ceiling = halt.TIMEOUT_MS + 1500;
  const t0 = Date.now();
  let watchdogTimer = null;
  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(
      () => reject(new Error(`readHalt() did not return within ${ceiling}ms — the read is NOT bounded`)),
      ceiling
    );
  });
  let hung;
  try {
    hung = await Promise.race([readHalt(), watchdog]);
  } finally {
    clearTimeout(watchdogTimer);
  }
  const elapsed = Date.now() - t0;
  assert.strictEqual(hung.halted, false, 'a hung read must fail open, not hang');
  assert.ok(elapsed < ceiling, `read took ${elapsed}ms, expected < ${ceiling}ms`);
  console.log(`  ok  hung read bounded at ${elapsed}ms (ceiling ${halt.TIMEOUT_MS}ms) and fails open`);

  // ── 8. SHADOW DOES NOT PARK; OFF DOES NOT EVEN READ ───────────────────────
  reset('shadow');
  const shadowQ = fakeQuery(() => [{ emergency_halt: true }]);
  halt.__setQueryImplForTests(shadowQ);
  assert.strictEqual(await shouldParkForHalt('t'), false, 'shadow must not park');
  assert.ok(shadowQ.state.calls > 0, 'shadow must still READ (that is the point of shadow)');

  reset('off');
  const offQ = fakeQuery(() => [{ emergency_halt: true }]);
  halt.__setQueryImplForTests(offQ);
  assert.strictEqual(await shouldParkForHalt('t'), false, 'off must not park');
  assert.strictEqual(offQ.state.calls, 0, 'off must not even query');
  console.log('  ok  shadow reads-but-does-not-park; off does not read at all');

  // ── 9. THE CACHE ACTUALLY CACHES (and busts) ──────────────────────────────
  reset('enforce');
  const cq = fakeQuery(() => [{ emergency_halt: false }]);
  halt.__setQueryImplForTests(cq);
  await readHalt(); await readHalt(); await readHalt();
  assert.strictEqual(cq.state.calls, 1, `expected 1 db call, got ${cq.state.calls}`);
  assert.strictEqual((await readHalt()).source, 'cache');
  halt.bustHaltCache();
  await readHalt();
  assert.strictEqual(cq.state.calls, 2, 'bustHaltCache must force a fresh read');
  console.log('  ok  cache holds within the window and busts on demand');

  reset(undefined);
  halt.__resetForTests();
}

main().then(() => {
  console.log('emergency-halt.test.js: OK');
}).catch((e) => {
  console.error('emergency-halt.test.js: FAILED —', e && e.stack ? e.stack : e);
  process.exit(1);
});
