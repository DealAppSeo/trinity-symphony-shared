/**
 * swarm-toolbelt.test.mjs — the property that makes the toolbelt safe to turn on.
 *
 * Run:  node tests/swarm-toolbelt.test.mjs
 *       SWARM_TOOLBELT=on node tests/swarm-toolbelt.test.mjs
 *
 * There is really only ONE thing to prove here, and everything else is detail:
 *
 *   **A tool that cannot answer must SAY SO, in words the model will read.**
 *
 * If a failed fetch returns '' or null or a default, the model reasons about it as
 * "nothing was there" and invents the content — and we will have replaced a slow
 * fabrication machine with a fast, well-instrumented one whose output flows into
 * the reputation ledger. Every assertion below is a variation on that single point.
 *
 * These tests run WITHOUT network access and without the flag, because a test that
 * needs prod to be up is a test that goes red for reasons unrelated to the code.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const belt = require('../lib/swarm-toolbelt.js');

let pass = 0;
let skipped = 0;

// A skipped test MUST NOT print `ok`. Both runs of this file reported "11 passed"
// while exercising different subsets, because every flag-guarded test returned
// early and still incremented the counter — a green that proves nothing, which is
// exactly the failure PARALLEL_AGENT_LANES §3.3 exists to catch. SKIP is a
// sentinel the harness recognises, so the two runs now report honest counts.
const SKIP = Symbol('skip');
const record = (name, r) => {
  if (r === SKIP) { console.log(`  --  ${name}  (skipped: needs SWARM_TOOLBELT=${ON ? 'off' : 'on'})`); skipped++; }
  else { console.log(`  ok  ${name}`); pass++; }
};
const t = (name, fn) => record(name, fn());
const ta = async (name, fn) => record(name, await fn());

const ON = process.env.SWARM_TOOLBELT === 'on';
console.log(`toolbelt ${ON ? 'ENABLED' : 'disabled'} for this run\n`);

console.log('DEFAULT-OFF — twelve agents do not gain capabilities by accident');

t('advertises no tools unless explicitly flipped on', () => {
  const n = belt.toolSchemas().length;
  if (ON) assert.ok(n > 0, 'flag is on, so tools must be advertised');
  else assert.equal(n, 0, 'flag is off, so the provider must see no toolbelt schema at all');
});

await ta('refuses to execute while disabled, and says why', async () => {
  if (ON) return SKIP; // not applicable in an enabled run
  const r = await belt.execute('http_get', { url: 'https://repid-engine-production.up.railway.app/health' });
  assert.ok(r.startsWith('FAILED:'), `disabled execute must fail loudly, got: ${r}`);
  assert.match(r, /SWARM_TOOLBELT/, 'the refusal must name the flag so the cause is obvious');
});

console.log('\nFAIL LOUD — the property the whole design rests on');

await ta('a blocked host is reported, never silently empty', async () => {
  if (!ON) return SKIP;
  const r = await belt.execute('http_get', { url: 'https://evil.example.com/exfiltrate' });
  assert.ok(r.startsWith('FAILED:'), 'must be an explicit failure');
  assert.ok(r.length > 40, 'must be a REASON, not a token — an empty-ish string invites invention');
  // The instruction not to guess has to travel WITH the failure. By the time the
  // model reads this, the system prompt is thousands of tokens away.
  assert.match(r, /not\s+infer|do NOT|not on the swarm allowlist/i);
});

await ta('a non-https scheme is refused rather than attempted', async () => {
  if (!ON) return SKIP;
  const r = await belt.execute('http_get', { url: 'http://repid-engine-production.up.railway.app/health' });
  assert.ok(r.startsWith('FAILED:'), 'plain http must be refused');
});

await ta('a malformed URL fails with a reason instead of throwing', async () => {
  if (!ON) return SKIP;
  const r = await belt.execute('http_get', { url: 'not a url at all' });
  assert.ok(r.startsWith('FAILED:'), 'must not throw out of the agent loop');
});

await ta('an unknown tool name is answered, not ignored', async () => {
  // An unanswered tool call leaves the message array malformed and the provider
  // rejects the NEXT request — so the error surfaces one turn later, attached to
  // the wrong cause. Answering it keeps the failure where it happened.
  const r = await belt.execute('rm_rf_the_database', {});
  assert.ok(r.startsWith('FAILED:'), 'unknown tools must produce a response, not silence');
});

console.log('\nALLOWLIST — egress is scoped, not open');

t('matches our hosts and rejects lookalikes', () => {
  assert.ok(belt.hostAllowed('repid-engine-production.up.railway.app'));
  assert.ok(!belt.hostAllowed('evil.com'));
  assert.ok(!belt.hostAllowed('up.railway.app.evil.com'));
  assert.ok(!belt.hostAllowed('notrepid-engine-production.up.railway.app.attacker.io'));
});

// THE REGRESSION THAT MATTERS. The shipped version allowlisted `.up.railway.app`
// as a suffix. That is a PUBLIC SUFFIX — anyone can deploy to it — so one entry
// meaning "our services" actually meant "any Railway customer's service". Caught
// the same day it merged, by running it rather than reading it.
t('NO wildcard: a public-suffix sibling is refused', () => {
  assert.ok(!belt.hostAllowed('attacker.up.railway.app'),
    'ANY Railway customer can register this — it must never be reachable');
  assert.ok(!belt.hostAllowed('totally-attacker-controlled.up.railway.app'));
  // read-only does not mean harmless: http_get puts the URL on the wire, so a
  // reachable attacker host is an EXFILTRATION channel via the query string.
  assert.ok(!belt.hostAllowed('exfil.up.railway.app'));
});

t('same host, different string: case and trailing dot normalise', () => {
  assert.ok(belt.hostAllowed('REPID-ENGINE-PRODUCTION.UP.RAILWAY.APP'), 'DNS is case-insensitive');
  assert.ok(belt.hostAllowed('repid-engine-production.up.railway.app.'), 'canonical trailing dot is the same host');
  // ...but normalising must not become a bypass.
  assert.ok(!belt.hostAllowed('attacker.up.railway.app.'));
});

t('an operator cannot silently reintroduce a wildcard via the env var', () => {
  // The entry is dropped at load with a loud console.error rather than honoured.
  assert.ok(!belt.ALLOWED_HOSTS.some((h) => h.startsWith('.') || h.includes('*')),
    'no wildcard may survive into the effective allowlist');
});

t('URL parsing resolves the two classic host-spoofing forms', () => {
  // Not hostAllowed's job, but the caller depends on it, so pin the behaviour.
  assert.equal(new URL('https://repid-engine-production.up.railway.app@evil.com/x').hostname, 'evil.com',
    'credentials-before-@ must not be mistaken for the host');
  assert.ok(new URL('https://exampIe.com/').hostname.length > 0);
});

t('is read-only — no tool can mutate anything', () => {
  if (!ON) return SKIP;
  const names = belt.toolSchemas().map((s) => s.function.name);
  // The swarm is the least-supervised tier we run. An agent that can write is an
  // agent that can poison the ledger this system exists to make auditable.
  for (const n of names) {
    assert.ok(!/write|post|put|delete|update|insert|send|settle|mint/i.test(n),
      `"${n}" looks like a mutation — the belt is read-only by design`);
  }
});

console.log('\nTRUNCATION — an incomplete answer must announce itself');

t('says the response was cut rather than quietly cutting it', () => {
  const long = 'x'.repeat(100_000);
  const out = belt.clip(long);
  assert.ok(out.includes('TRUNCATED'), 'a silently-cut body is reasoned about as a complete one');
  assert.ok(out.includes('INCOMPLETE'));
});

t('leaves a short response untouched', () => {
  assert.equal(belt.clip('small body'), 'small body');
});

console.log('\nTHE ESCAPE HATCH — "I could not measure that" is a success');

await ta('report_unmeasurable is accepted and echoed for the audit trail', async () => {
  if (!ON) return SKIP;
  const r = await belt.execute('report_unmeasurable', { what: 'p95 latency', why: 'no metrics endpoint is reachable' });
  assert.ok(r.startsWith('OK'), 'declaring a gap must be a SUCCESS — otherwise guessing scores better');
  assert.match(r, /p95 latency/);
  assert.match(r, /do not now guess/i, 'and it must not re-open the door it just closed');
});

console.log(`\n${pass} assertions passed`);
