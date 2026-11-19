'use strict';
/**
 * HANDOFF RECORD. What one agent hands the next so the next can proceed with no access to the first
 * agent's conversation. Before this, the review task an agent spawned said only "Peer review for task N":
 * no artifact, no acceptance criteria, no evidence, no revision.
 *
 * It rides in the task row that already exists: `metadata.handoff` holds the record and `description`
 * holds render(record). No new table.
 *
 * Three outcomes, and one rule that matters more than the rest:
 *   VERIFIED     every claim has a deterministic check that SUPPORTED it, every check the record requires ran
 *                and gave an answer, and nothing is missing.
 *   REFUTED      a deterministic check CONTRADICTED a claim.
 *   NOT_CHECKED  anything else: a missing artifact, unavailable evidence, a check that did not run.
 * A model's opinion can keep a record from VERIFIED. It can never make one VERIFIED: agreement between
 * models is not evidence.
 */
const crypto = require('crypto');

const SCHEMA = 'trinity.handoff/1';
const OUTCOMES = ['VERIFIED', 'REFUTED', 'NOT_CHECKED'];
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const list = (v) => (Array.isArray(v) ? v : []);
// A value that came from the task row must not be able to start a line of its own: a line break inside a title,
// claim or excerpt would otherwise read as a record line ("GAPS: none", "RULES: ...") that the reader cannot tell
// from the ones this file computes. Every row value in render() goes through this first.
const flat = (v) => String(v == null ? '' : v).replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ' \u23ce ');

/**
 * claims:    [{ id, text }]                       what the producer asserts
 * artifacts: [{ ref, sha256? }]                   what the producer made (ref the next agent can open)
 * evidence:  [{ ref, kind, available, excerpt? }] what the claims rest on; available=false is a gap, not a pass
 * required_checks: [{ name, kind }] checks that must have run on every claim (e.g. { name: 'evidence review', kind: 'model' });
 *            one that is absent or NOT_CHECKED keeps the record NOT_CHECKED. A check of another kind with the same name does not count. A record that requires none is settled by its deterministic checks.
 */
function build({ task, acceptance_criteria, input_revision, claims, artifacts, evidence, producer, required_checks, created_at }) {
  return {
    schema: SCHEMA,
    task: { id: task && task.id != null ? task.id : null, title: (task && task.title) || '', description: (task && task.description) || '' },
    acceptance_criteria: list(acceptance_criteria).map(String),
    input_revision: input_revision || null,
    claims: list(claims).map((c, i) => ({ id: c.id || `c${i + 1}`, text: String(c.text || '') })),
    artifacts: list(artifacts),
    evidence: list(evidence),
    producer: { role: (producer && producer.role) || null, model: (producer && producer.model) || null },
    required_checks: list(required_checks).map((q) => (typeof q === 'string' ? { name: q, kind: null } : { name: String(q.name), kind: q.kind || null })),
    verification: { outcome: 'NOT_CHECKED', checks: [] },
    open_claims: list(claims).map((c, i) => ({ id: c.id || `c${i + 1}`, reason: 'no check has run' })),
    created_at: created_at || new Date().toISOString(),
  };
}

/**
 * What stops the next agent from proceeding. An empty list means the record is complete, not that it is true:
 * `available: true` is the producer's statement, and only a check that opens the reference tests it.
 */
function gaps(r) {
  const g = [];
  if (!r || r.schema !== SCHEMA) return ['not a handoff record'];
  if (!r.task || !String(r.task.title || '').trim()) g.push('task: no title');
  if (!list(r.acceptance_criteria).filter((c) => String(c).trim()).length) g.push('acceptance_criteria: none stated');
  else if (list(r.acceptance_criteria).some((c) => !String(c).trim())) g.push('acceptance_criteria: one is blank');
  if (!String(r.input_revision || '').trim()) g.push('input_revision: not stated');
  if (!list(r.claims).length) g.push('claims: none stated');
  for (const c of list(r.claims)) if (!c || !String(c.text || '').trim()) g.push(`claims: ${(c && c.id) || 'one'} has no text`);
  for (const c of list(r.claims)) if (!c || !c.id) g.push('claims: one has no id, so no check can be tied to it');
  for (const q of list(r.required_checks)) if (!q || !q.name || !q.kind) g.push(`required_checks: ${(q && q.name) || 'one'} names no kind, so any check with that name would satisfy it`);
  const ids = list(r.claims).map((c) => c && c.id);
  if (new Set(ids).size !== ids.length) g.push('claims: two claims share an id, so a check on one would count for both');
  if (!list(r.artifacts).length) g.push('artifacts: the producer referenced no output');
  for (const a of list(r.artifacts)) if (!a || !String(a.ref || '').trim()) g.push('artifacts: an entry has no ref');
  if (!list(r.evidence).length) g.push('evidence: none referenced');
  for (const e of list(r.evidence)) if (!e || !String(e.ref || '').trim() || e.available !== true) g.push(`evidence: ${(e && e.ref) || 'an entry'} is not available`);
  if (!r.producer || !r.producer.role) g.push('producer: role not recorded');
  if (!r.producer || !r.producer.model) g.push('producer: model not recorded');
  return g;
}

/**
 * checks: [{ claim, name, kind: 'deterministic' | 'model', outcome: 'SUPPORTED' | 'CONTRADICTED' | 'NOT_CHECKED', by?, ref?, reason? }]
 * Returns a new record with the outcome and the claims still open. Checks accumulate across calls.
 */
function settle(record, checks) {
  // An outcome that is not exactly SUPPORTED or CONTRADICTED ("DID_NOT_RUN", a typo, nothing) is NOT_CHECKED.
  const all = [...list(record.verification && record.verification.checks), ...list(checks)]
    .map((k) => ({ ...k, outcome: k.outcome === 'SUPPORTED' || k.outcome === 'CONTRADICTED' ? k.outcome : 'NOT_CHECKED' }));
  const required = list(record.required_checks);
  const is = (q, k) => k.name === q.name && k.kind === q.kind;
  const missing = gaps(record);
  const open = [];
  let refuted = false;
  for (const c of list(record.claims)) {
    const mine = all.filter((k) => k.claim === c.id);
    const det = mine.filter((k) => k.kind === 'deterministic');
    const disputed = mine.filter((k) => k.kind === 'model' && k.outcome === 'CONTRADICTED');
    if (det.some((k) => k.outcome === 'CONTRADICTED')) { refuted = true; open.push({ id: c.id, reason: `contradicted by ${det.find((k) => k.outcome === 'CONTRADICTED').name}` }); }
    else if (!det.some((k) => k.outcome === 'SUPPORTED')) open.push({ id: c.id, reason: det.length ? `${det[0].name} did not settle it: ${det[0].reason || 'NOT_CHECKED'}` : 'no deterministic check ran' });
    else if (det.some((k) => k.outcome === 'NOT_CHECKED')) open.push({ id: c.id, reason: `${det.find((k) => k.outcome === 'NOT_CHECKED').name} did not run` });
    else if (required.some((q) => !mine.some((k) => is(q, k)))) open.push({ id: c.id, reason: `required check did not run: ${required.filter((q) => !mine.some((k) => is(q, k))).map((q) => q.name).join(', ')}` });
    else if (mine.some((k) => k.outcome === 'NOT_CHECKED' && required.some((q) => is(q, k)))) { const k = mine.find((x) => x.outcome === 'NOT_CHECKED' && required.some((q) => is(q, x))); open.push({ id: c.id, reason: `required check ${k.name} gave no answer: ${k.reason || 'NOT_CHECKED'}` }); }
    else if (disputed.length) open.push({ id: c.id, reason: `disputed by ${disputed.map((k) => k.by || k.name).join(', ')}` });
  }
  const outcome = refuted ? 'REFUTED' : (missing.length || open.length || !list(record.claims).length) ? 'NOT_CHECKED' : 'VERIFIED';
  return { ...record, verification: { outcome, checks: all, gaps: missing }, open_claims: open };
}

/** The whole handoff as text: what a task row's description carries to an agent that has seen nothing else. */
function render(r) {
  const g = gaps(r);
  const L = [
    `HANDOFF RECORD (${r.schema}). You are picking this up with no other context. Everything you may rely on is below.`,
    `TASK: ${flat(r.task.title)}${r.task.id != null ? ` (task ${flat(r.task.id)})` : ''}`,
    r.task.description ? `DETAIL: ${flat(r.task.description)}` : null,
    `INPUT REVISION: ${flat(r.input_revision) || 'NOT STATED'}`,
    `PRODUCED BY: role ${flat(r.producer.role) || 'not recorded'}, model ${flat(r.producer.model) || 'not recorded'}, at ${flat(r.created_at)}`,
    'ACCEPTANCE CRITERIA:', ...list(r.acceptance_criteria).map((c, i) => `  ${i + 1}. ${flat(c)}`),
    'CLAIMS:', ...list(r.claims).map((c) => `  [${flat(c.id)}] ${flat(c.text)}`),
    'OUTPUT ARTIFACTS:', ...(list(r.artifacts).length ? list(r.artifacts).map((a) => `  - ${flat(a.ref)}${a.sha256 ? ` sha256 ${flat(a.sha256)}` : ''}`) : ['  (none)']),
    'EVIDENCE:', ...(list(r.evidence).length ? list(r.evidence).flatMap((e) => [`  - ${flat(e.ref)} (${flat(e.kind) || 'unspecified'}; ${e.available === true ? 'available' : 'NOT AVAILABLE'})`, ...(e.excerpt ? [`    ${flat(e.excerpt)}`] : [])]) : ['  (none)']),
    `REQUIRED CHECKS (each must run on every claim): ${list(r.required_checks).map((q) => flat(q.kind ? `${q.name} [${q.kind}]` : q.name)).join(', ') || 'none named'}`,
    `VERIFICATION SO FAR: ${flat(r.verification.outcome)}`,
    ...list(r.verification.checks).map((k) => `  - ${flat(k.name)} [${flat(k.kind)}]${k.by ? ` by ${flat(k.by)}` : ''} on ${flat(k.claim)}: ${flat(k.outcome)}${k.reason ? ` (${flat(k.reason)})` : ''}${k.ref ? ` ref ${flat(k.ref)}` : ''}`),
    'OPEN CLAIMS:', ...(list(r.open_claims).length ? r.open_claims.map((o) => `  - ${flat(o.id)}: ${flat(o.reason)}`) : ['  (none)']),
    g.length ? `GAPS (each one keeps this NOT_CHECKED): ${g.map(flat).join('; ')}` : 'GAPS: none',
    'RULES: a check that is missing or could not run stays NOT_CHECKED. Do not mark a claim verified because another model agreed with it.',
  ];
  return L.filter((x) => x !== null).join('\n');
}

/** A reviewer's reply is one JSON object. Anything else, or a claim it did not rule on, is NOT_CHECKED with the reason. */
function parseReview(text, record, by) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  let j = null;
  try { j = m ? JSON.parse(m[0]) : null; } catch (e) { j = null; }
  const rulings = j && Array.isArray(j.claims) ? j.claims : [];
  return list(record.claims).map((c) => {
    const r = rulings.find((x) => x && x.id === c.id);
    const v = r && String(r.verdict || '').toUpperCase();
    const outcome = v === 'SUPPORTED' || v === 'CONTRADICTED' ? v : 'NOT_CHECKED';
    return { claim: c.id, name: 'evidence review', kind: 'model', by: by || null, outcome, reason: r ? String(r.reason || '').slice(0, 300) : (j ? 'the reply did not rule on this claim' : 'the reply was not JSON') };
  });
}

/**
 * One sentence checked by `trustshell check <run-url> --claims-file`. card = its --json output (or null), exit = its exit code.
 * SUPPORTED needs all of: exit 0, every part SUPPORTED, and every part being a part of THIS sentence (a card for some
 * other sentence, or a call that does not say which sentence it submitted, supports nothing). No card, a crash, a 404: NOT_CHECKED.
 */
function inspectOutcome(card, exit, sentence) {
  const parts = list(card && card.record && card.record.claims);
  if (!sentence || parts.some((c) => !c || c.sentence !== sentence)) return 'NOT_CHECKED';
  const st = parts.map((c) => c && c.status);
  if (st.includes('CONTRADICTED')) return 'CONTRADICTED';
  if (exit === 0 && st.length && st.every((x) => x === 'SUPPORTED')) return 'SUPPORTED';
  return 'NOT_CHECKED';
}

module.exports = { inspectOutcome, SCHEMA, OUTCOMES, sha256, build, gaps, settle, render, parseReview };
