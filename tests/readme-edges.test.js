// node tests/readme-edges.test.js
//
// PIN TEST for README.md "## Where this sits" and "## Squads".
//
// Sean, 2026-10-07: "Each README names only what it calls and what calls it, and
// links to the map. A pin test on those edges, not on a picture."
//
// Why: the README this replaced said every agent extends constitutional-agent-base.js
// (none does — server.js creates a ConstitutionalAgentV4, which extends nothing),
// drew executor / verifier / ANFIS layers that do not exist, and listed three squads
// where the code has four. Prose drifts silently. This makes the drift fail.
//
// BOTH DIRECTIONS are checked, because either one alone passes vacuously:
//   README -> code   every backticked token in "Where this sits" is grounded in the
//                    code the agents actually run (env var read, URL present, path
//                    present, file on the running path, identifier present).
//   code -> README   every *_URL env var, every URL default and every engine API path
//                    on that code path is named in "Where this sits".
//
// "The code the agents actually run" is DISCOVERED from server.js by following
// relative require()s, not listed by hand. A hand list goes stale silently: a new
// lib file with a new outbound call would simply never be scanned.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAP_URL = 'https://github.com/DealAppSeo/hyperdag-protocol/blob/main/BUILDERS.md#how-the-pieces-fit';

let checks = 0;
function check(cond, msg) {
  assert.ok(cond, msg);
  checks++;
}

// ── 1. The running code: server.js plus everything it requires, transitively ──
function runningFiles() {
  const seen = new Set();
  const queue = ['server.js'];
  while (queue.length) {
    const rel = path.normalize(queue.shift());
    if (seen.has(rel)) continue;
    seen.add(rel);
    for (const m of read(rel).matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const base = path.join(path.dirname(rel), m[1]);
      const hit = [base, base + '.js', path.join(base, 'index.js')].find((c) => {
        const abs = path.join(ROOT, c);
        return fs.existsSync(abs) && fs.statSync(abs).isFile();
      });
      if (hit) queue.push(hit);
    }
  }
  return [...seen];
}

const FILES = runningFiles();
const V4_FILE = path.normalize('lib/ConstitutionalAgentV4.js');
check(FILES.includes('server.js') && FILES.includes(V4_FILE),
  `require graph from server.js must reach ${V4_FILE}; got: ${FILES.join(', ')}`);
const CODE = FILES.map(read).join('\n');

const ENV_READ = new Set();
for (const m of CODE.matchAll(
  /\bprocess\.env\.([A-Z][A-Z0-9_]*)|\bprocess\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]|\benv\.([A-Z][A-Z0-9_]*)/g)) {
  ENV_READ.add(m[1] || m[2] || m[3]);
}
const URL_DEFAULTS = [...CODE.matchAll(
  /process\.env\.([A-Z][A-Z0-9_]*_URL)\s*\|\|\s*['"`](https?:\/\/[^'"`]+)['"`]/g)]
  .map((m) => ({ name: m[1], url: m[2] }));
// A path appended to a configured base: `${base}/api/v1/...`. Full provider URLs
// (https://openrouter.ai/api/v1/...) are not engine calls and do not match.
const ENGINE_PATHS = [...new Set([...CODE.matchAll(/\}(\/api\/v\d+\/[A-Za-z0-9_/-]+)/g)].map((m) => m[1]))];
check(ENGINE_PATHS.length > 0, 'found no engine API paths on the running path — the scan is broken, not the README');

// ── 2. README sections ──
const README = read('README.md');
function section(title) {
  const lines = README.split(/\r?\n/);
  const starts = lines.reduce((a, l, i) => (l.trim() === title ? a.concat(i) : a), []);
  assert.strictEqual(starts.length, 1, `README must have exactly one "${title}" heading (found ${starts.length})`);
  const out = [];
  for (let i = starts[0] + 1; i < lines.length && !/^#{1,2} /.test(lines[i]); i++) out.push(lines[i]);
  return out.join('\n');
}
function between(text, a, b) {
  const i = text.indexOf(a);
  const j = text.indexOf(b);
  assert.ok(i >= 0 && j > i, `"Where this sits" must contain ${a} followed by ${b}`);
  return text.slice(i + a.length, j);
}

const WHERE = section('## Where this sits');
const CALLS = between(WHERE, '**Calls:**', '**Called by:**');
const CALLED_BY = between(WHERE, '**Called by:**', '**The whole map:**');
check(WHERE.includes(`**The whole map:** ${MAP_URL}`), `"Where this sits" must link the map: ${MAP_URL}`);

const TOKENS = [...WHERE.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
check(TOKENS.length > 0, '"Where this sits" names nothing in backticks — nothing to pin');

// ── 3. README -> code: every backticked token is grounded in the running code ──
for (const t of TOKENS) {
  let m;
  if ((m = t.match(/^([A-Z][A-Z0-9_]*)=(\S+)$/))) {
    check(ENV_READ.has(m[1]), `README names ${t}, but the running code never reads ${m[1]}`);
    check(new RegExp(`process\\.env\\.${m[1]}\\s*===\\s*['"]${esc(m[2])}['"]`).test(CODE),
      `README says ${t}, but the running code never compares ${m[1]} to '${m[2]}'`);
  } else if (/^[A-Z][A-Z0-9_]*$/.test(t)) {
    check(ENV_READ.has(t), `README names env var ${t}, but the running code never reads it`);
  } else if (/^https?:\/\//.test(t)) {
    check(CODE.includes(t), `README names ${t}, but no running file contains that URL`);
  } else if ((m = t.match(/^(?:GET|POST|PUT|PATCH|DELETE) (\/\S*)$/)) || t.startsWith('/')) {
    const p = m ? m[1] : t;
    check(CODE.includes(p), `README names ${t}, but no running file contains the path ${p}`);
  } else if (/\.(?:c|m)?js$|\.ts$|\.json$/.test(t)) {
    check(FILES.includes(path.normalize(t)),
      `README names ${t}, but it is not on the running path (server.js and what it requires)`);
  } else {
    for (const part of t.split('.')) {
      check(new RegExp(`(^|[^A-Za-z0-9_])${esc(part)}([^A-Za-z0-9_]|$)`).test(CODE),
        `README names ${t}, but "${part}" does not appear in the running code`);
    }
  }
}

// ── 4. code -> README: every endpoint the running code is configured with is named ──
for (const name of ENV_READ) {
  if (!/_URL$/.test(name)) continue;
  check(TOKENS.includes(name) || TOKENS.some((t) => t.startsWith(`${name}=`)),
    `the running code reads ${name}, an endpoint, but README "Where this sits" does not name it`);
}
for (const d of URL_DEFAULTS) {
  const paired = WHERE.split(/\r?\n/).some((l) => l.includes(`\`${d.name}\``) && l.includes(`\`${d.url}\``));
  check(paired, `the running code defaults ${d.name} to ${d.url}; README must name both on one line`);
}
for (const p of ENGINE_PATHS) {
  check(CALLS.includes(p), `the running code calls ${p}, but README "Calls" does not name it`);
}
check(CALLS.includes('DealAppSeo/repid-engine'), 'README "Calls" must name DealAppSeo/repid-engine');

// ── 5. Called by: the only inbound surface is GET routes, and README names them ──
const APPS = [...CODE.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*express(?:\.Router)?\(\s*\)/g)]
  .map((m) => m[1]);
check(APPS.length > 0, 'found no express app on the running path — expected the /health server');
const getPaths = [];
for (const app of new Set(APPS)) {
  const other = [...CODE.matchAll(new RegExp(`\\b${esc(app)}\\.(post|put|patch|delete|all)\\(`, 'g'))];
  check(other.length === 0,
    `the agents now register a ${other.map((m) => m[1].toUpperCase()).join('/')} route. README "Called by" says ` +
    'nothing calls them except GET /health. Find the caller and update "Called by".');
  const used = [...CODE.matchAll(new RegExp(`\\b${esc(app)}\\.use\\(\\s*['"\`]`, 'g'))];
  check(used.length === 0, 'the agents now mount a router on a path. Update README "Called by".');
  for (const m of CODE.matchAll(new RegExp(`\\b${esc(app)}\\.get\\(\\s*(['"\`])([^'"\`]*)\\1`, 'g'))) getPaths.push(m[2]);
}
check(!/new\s+WebSocket\.Server\b|\bWebSocketServer\b|\b(?:http|https|net)\.createServer\(/.test(CODE),
  'the agents now open another server. Update README "Called by".');
for (const p of getPaths.filter((x) => x !== '*')) {
  check(CALLED_BY.includes(`\`${p}\``) || CALLED_BY.includes(`\`GET ${p}\``),
    `the agents serve GET ${p}, but README "Called by" does not name it`);
}

// ── 6. Entry point: what the services start, and what it creates ──
const pkg = JSON.parse(read('package.json'));
check(pkg.scripts && pkg.scripts.start === 'node server.js', `package.json start is "${pkg.scripts && pkg.scripts.start}", not "node server.js"`);
const server = read('server.js');
check(/require\(\s*['"]\.\/lib\/ConstitutionalAgentV4['"]\s*\)/.test(server) && /new\s+ConstitutionalAgent\(/.test(server),
  'server.js no longer creates a ConstitutionalAgentV4 — README "Where this sits" says it does');
check(TOKENS.includes('server.js') && TOKENS.includes('ConstitutionalAgentV4'),
  'README "Where this sits" must name server.js and ConstitutionalAgentV4');
if (/extends nothing/i.test(README)) {
  const V4 = require(path.join(ROOT, 'lib', 'ConstitutionalAgentV4'));
  check(Object.getPrototypeOf(V4.prototype) === Object.prototype,
    'README says ConstitutionalAgentV4 extends nothing, but it now has a parent class');
}

// ── 7. Squads: README table == AGENT_WISDOM in the class the agents run ──
const v4src = read(V4_FILE);
const block = v4src.match(/const AGENT_WISDOM = \{([\s\S]*?)\n\};/);
check(block, `AGENT_WISDOM not found in ${V4_FILE} — the roster moved; point this test at it`);
const entryLines = block[1].split('\n').filter((l) => /^\s*['"]trinity-[a-z0-9-]+['"]\s*:/.test(l));
const ROSTER = {};
let parsed = 0;
for (const m of block[1].matchAll(/['"](trinity-[a-z0-9-]+)['"]\s*:\s*\{([^}]*)\}/g)) {
  const name = m[2].match(/\bname:\s*['"]([^'"]+)['"]/);
  const squad = m[2].match(/\bsquad:\s*['"]([^'"]+)['"]/);
  check(name && squad, `${m[1]} in AGENT_WISDOM has no name or no squad`);
  (ROSTER[squad[1]] = ROSTER[squad[1]] || []).push(name[1]);
  parsed++;
}
check(parsed > 0 && parsed === entryLines.length,
  `parsed ${parsed} roster entries but AGENT_WISDOM has ${entryLines.length} lines — the parser missed some`);

const README_SQUADS = {};
for (const line of section('## Squads').split(/\r?\n/)) {
  const m = line.match(/^\|\s*([A-Z][A-Z0-9_]*)\s*\|\s*([^|]+)\|\s*$/);
  if (!m) continue;
  README_SQUADS[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
}
const fmt = (o) => Object.keys(o).sort().map((k) => `${k}: ${[...o[k]].sort().join(', ')}`).join(' | ');
check(Object.keys(README_SQUADS).length > 0, 'README "## Squads" has no table rows');
assert.strictEqual(fmt(README_SQUADS), fmt(ROSTER),
  `README squads do not match AGENT_WISDOM in ${V4_FILE}\n  README: ${fmt(README_SQUADS)}\n  code:   ${fmt(ROSTER)}`);
checks++;
for (const m of README.matchAll(/\b(\d+) agents\b/g)) {
  check(Number(m[1]) === parsed, `README says "${m[0]}", but AGENT_WISDOM has ${parsed} agents`);
}

console.log(`readme-edges.test.js: PASS — ${checks} checks. Running path: ${FILES.length} files from server.js; ` +
  `${ENGINE_PATHS.length} engine paths, ${URL_DEFAULTS.length} URL defaults, ${parsed} agents in ` +
  `${Object.keys(ROSTER).length} squads.`);
