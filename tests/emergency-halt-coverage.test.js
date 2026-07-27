// node tests/emergency-halt-coverage.test.js
//
// COVERAGE PIN for the global kill switch (L0 gate 0.4).
//
// Why this file exists: the engine's version of this switch shipped claiming
// "worker tick loops park" and reached 3 of 14 — including, uncovered, the
// worker that writes ERC-8004 deltas on-chain every 60s. Scope that is ASSERTED
// rather than ENUMERATED silently stops covering things as code is added.
//
// Why it is written THIS way: the first version of the engine's equivalent pin
// PASSED under two mutations (delete the gate call; move the gate after the
// breaker) because it substring-matched the module name against the whole file
// — so the leftover `require(...)` line alone made a file read as "covered".
// A test that asserts a property must be checked against the ABSENCE of that
// property. Therefore, here:
//   - require/import lines are STRIPPED before searching, so an import can
//     never be mistaken for a call;
//   - the expected number of CALL SITES is pinned per file, so deleting one of
//     two gates fails even though the other still matches;
//   - ordering is asserted against the line the gate must precede, not against
//     the import line (which is always first and therefore always "before").
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const GATE = 'shouldParkForHalt';

// ── The classification. Every loop-bearing file must appear in exactly one. ──

/** Files that must CALL the gate, and how many distinct call sites each has. */
const COVERED = {
  'lib/ConstitutionalAgentV4.js': 2, // runLoop() + runLoopLegacy()
  'constitutional-agent-base.js': 3, // main while(true) + self-diagnostic + eternal-questions
  'trinity-worker.js': 1,            // the seeding PRODUCER
};

/** Loop-bearing files deliberately NOT gated, each with the reason. */
const EXEMPT = {
  'mutual-wake.js':
    'health-ping only — enumerated for writes, there are none. Observability must survive a halt.',
  'lib/ConstitutionalAgent.ts':
    'legacy TS agent — required/imported by no file in this repo (dead).',
  'w3c.index.js':
    'standalone agent loop referenced by no file and no deploy config (dead).',
  'trinity.hdm.js':
    'calls pollAndExecute, which is defined ZERO times in the file — it throws at boot (dead).',
};

/** Loop constructs inside a covered file that are themselves exempt. */
const INTERVAL_EXEMPTIONS = [
  'heartbeat', // the 2-minute liveness setIntervals in V4 + base
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Strip require/import lines so an import can NEVER read as coverage. */
function stripImports(src) {
  return src
    .split('\n')
    .filter((l) => !/\b(require\s*\(|^\s*import\b)/.test(l))
    .join('\n');
}

/** Count real call sites: `shouldParkForHalt(` with imports removed. */
function countCallSites(src) {
  const body = stripImports(src);
  const m = body.match(new RegExp(GATE + '\\s*\\(', 'g'));
  return m ? m.length : 0;
}

/**
 * Strip comments before looking for loop constructs, so a file that merely
 * DESCRIBES `setInterval(` in prose is not counted as having one. (Without
 * this, lib/emergency-halt.js flags itself on its own header — the detector
 * would be matching documentation instead of code.) `//` is ignored when
 * preceded by `:` so a URL does not truncate the rest of the line.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Every non-test, non-node_modules file containing a loop construct. */
function enumerateLoopFiles() {
  const found = [];
  const skipDirs = new Set(['node_modules', '.git', 'tests', 'generated', 'docs', 'reports']);
  (function walk(dir, rel) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const r = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) walk(abs, r);
        continue;
      }
      if (!/\.(js|ts)$/.test(entry.name)) continue;
      if (/\.test\.(js|ts)$/.test(entry.name)) continue;
      let src;
      try { src = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
      if (/while\s*\(\s*true\s*\)|setInterval\s*\(/.test(stripComments(src))) found.push(r);
    }
  })(ROOT, '');
  return found.sort();
}

// ── 1. Every covered file calls the gate the pinned number of times ──────────
for (const [rel, expected] of Object.entries(COVERED)) {
  const src = read(rel);
  const n = countCallSites(src);
  assert.strictEqual(
    n, expected,
    `${rel}: expected ${expected} ${GATE}() call site(s), found ${n}. ` +
      'If you added or removed a loop, update COVERED here and say why in the module header.'
  );
  // An import alone must never satisfy the pin — prove the strip works on the
  // real file rather than trusting it.
  assert.ok(
    /require\([^)]*emergency-halt/.test(src),
    `${rel}: expected an emergency-halt require (the pin strips it before counting)`
  );
}
console.log(`  ok  ${Object.keys(COVERED).length} covered files call ${GATE}() the pinned number of times`);

// ── 2. Ordering: the halt gate precedes the per-agent gate in BOTH V4 loops ──
// A global stop that runs after a per-agent check can be masked by that check's
// behaviour, and the log line would name the wrong cause.
{
  const src = read('lib/ConstitutionalAgentV4.js');
  const body = stripImports(src);
  const lines = body.split('\n');
  const gateLines = [];
  const workEnabledLines = [];
  lines.forEach((l, i) => {
    if (l.includes(GATE + '(')) gateLines.push(i);
    if (l.includes('this.isWorkEnabled()')) workEnabledLines.push(i);
  });
  assert.strictEqual(gateLines.length, 2, `expected 2 halt gates in V4, got ${gateLines.length}`);
  assert.strictEqual(workEnabledLines.length, 2, `expected 2 isWorkEnabled gates in V4, got ${workEnabledLines.length}`);
  for (let i = 0; i < 2; i++) {
    assert.ok(
      gateLines[i] < workEnabledLines[i],
      `V4 loop #${i + 1}: the halt gate (line ${gateLines[i] + 1}) must precede ` +
        `isWorkEnabled (line ${workEnabledLines[i] + 1})`
    );
    // ...and must belong to the SAME loop, not be borrowed from the one above.
    assert.ok(
      workEnabledLines[i] - gateLines[i] < 15,
      `V4 loop #${i + 1}: the halt gate is ${workEnabledLines[i] - gateLines[i]} lines ` +
        'from its isWorkEnabled — that is too far to be the same guard block'
    );
  }
}
console.log('  ok  in both V4 loops the halt gate precedes the per-agent gate, in the same block');

// ── 3. The seeder gate is the FIRST thing in its interval body ──────────────
// A producer that checks the switch after doing its work has already acted.
{
  const body = stripImports(read('trinity-worker.js'));
  const idx = body.indexOf('startSeedingLoop');
  assert.ok(idx > 0, 'startSeedingLoop not found');
  const after = body.slice(idx);
  const gateAt = after.indexOf(GATE + '(');
  const workAt = after.indexOf('trinity_agent_registry');
  assert.ok(gateAt > 0, 'seeding loop is not gated');
  assert.ok(workAt > 0, 'seeding loop no longer reads trinity_agent_registry — re-check this pin');
  assert.ok(gateAt < workAt, 'the seeder must check the halt BEFORE it counts idle agents');
}
console.log('  ok  the seeding producer checks the halt before it does anything');

// ── 4. Nothing is unclassified — a NEW loop file fails until it is triaged ──
{
  const loopFiles = enumerateLoopFiles();
  const classified = new Set([...Object.keys(COVERED), ...Object.keys(EXEMPT)]);
  const unclassified = loopFiles.filter((f) => !classified.has(f));
  assert.deepStrictEqual(
    unclassified, [],
    'These files contain a loop but are neither COVERED nor EXEMPT in ' +
      'tests/emergency-halt-coverage.test.js:\n  ' + unclassified.join('\n  ') +
      '\nGate them with ' + GATE + '() or add an EXEMPT entry stating why.'
  );
  // The classification must not rot in the other direction either: a file
  // listed here that no longer has a loop is a stale claim.
  const enumerated = new Set(loopFiles);
  for (const rel of classified) {
    assert.ok(enumerated.has(rel), `${rel} is classified but no longer contains a loop — remove it`);
  }
  console.log(`  ok  all ${loopFiles.length} loop-bearing files classified (${Object.keys(COVERED).length} covered, ${Object.keys(EXEMPT).length} exempt)`);
}

// ── 5. Every exemption states a reason (not just a filename) ────────────────
for (const [rel, why] of Object.entries(EXEMPT)) {
  assert.ok(why && why.length > 30, `${rel}: exemption reason is too thin to be a decision`);
}
console.log(`  ok  all ${Object.keys(EXEMPT).length} exemptions carry a stated reason`);

// ── 6. The dead-file claims are still true ─────────────────────────────────
// These exemptions rest on facts about the repo, not opinions. If someone
// revives one of them, the exemption is no longer valid and must be re-decided.
{
  const hdm = read('trinity.hdm.js');
  assert.ok(
    /pollAndExecute/.test(hdm) && !/function\s+pollAndExecute|pollAndExecute\s*=/.test(hdm),
    'trinity.hdm.js now defines pollAndExecute — it is no longer dead, so gate it'
  );
  assert.ok(
    !fs.existsSync(path.join(ROOT, 'scripts/run-agent.js')),
    'scripts/run-agent.js now exists — the trinity-*.js shims may be live again; re-check coverage'
  );
  for (const dead of ['w3c.index.js', 'lib/ConstitutionalAgent.ts']) {
    const base = path.basename(dead).replace(/\.(js|ts)$/, '');
    const referenced = enumerateLoopFiles()
      .filter((f) => f !== dead)
      .some((f) => new RegExp(`require\\([^)]*${base.replace('.', '\\.')}`).test(read(f)));
    assert.ok(!referenced, `${dead} is now required by a live loop file — it is not dead; gate it`);
  }
}
console.log('  ok  the "dead file" exemptions are still factually true');

console.log('emergency-halt-coverage.test.js: OK');
