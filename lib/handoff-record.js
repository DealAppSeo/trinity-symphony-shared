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
 *   VERIFIED     every claim has a deterministic check that SUPPORTED it, and nothing is missing.
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

/**
 * claims:    [{ id, text }]                       what the producer asserts
 * artifacts: [{ ref, sha256? }]                   what the producer made (ref the next agent can open)
 * evidence:  [{ ref, kind, available, excerpt? }] what the claims rest on; available=false is a gap, not a pass
 */
function build({ task, acceptance_criteria, input_revision, claims, artifacts, evidence, producer, created_at }) {
  return {
    schema: SCHEMA,
    task: { id: task && task.id != null ? task.id : null, title: (task && task.title) || '', description: (task && task.description) || '' },
    acceptance_criteria: list(acceptance_criteria).map(String),
    input_revision: input_revision || null,
    claims: list(claims).map((c, i) => ({ id: c.id || `c${i + 1}`, text: String(c.text || '') })),
    artifacts: list(artifacts),
    evidence: list(evidence),
    producer: { role: (producer && producer.role) || null, model: (producer && producer.model) || null },
    verification: { outcome: 'NOT_CHECKED', checks: [] },
    open_claims: list(claims).map((c, i) => ({ id: c.id || `c${i + 1}`, reason: 'no check has run' })),
    created_at: created_at || new Date().toISOString(),
  };
}

/** What stops the next agent from proceeding. An empty list means the record is complete, not that it is true. */
function gaps(r) {
  const g = [];
  if (!r || r.schema !== SCHEMA) return ['not a handoff record'];
  if (!r.task || !r.task.title) g.push('task: no title');
  if (!list(r.acceptance_criteria).length) g.push('acceptance_criteria: none stated');
  if (!r.input_revision) g.push('input_revision: not stated');
  if (!list(r.claims).length) g.push('claims: none stated');
  if (!list(r.artifacts).length) g.push('artifacts: the producer referenced no output');
  for (const a of list(r.artifacts)) if (!a || !a.ref) g.push('artifacts: an entry has no ref');
  if (!list(r.evidence).length) g.push('evidence: none referenced');
  for (const e of list(r.evidence)) if (!e || !e.ref || e.available !== true) g.push(`evidence: ${(e && e.ref) || 'an entry'} is not available`);
  if (!r.producer || !r.producer.role) g.push('producer: role not recorded');
  if (!r.producer || !r.producer.model) g.push('producer: model not recorded');
  return g;
}

/**
 * checks: [{ claim, name, kind: 'deterministic' | 'model', outcome: 'SUPPORTED' | 'CONTRADICTED' | 'NOT_CHECKED', by?, ref?, reason? }]
 * Returns a new record with the outcome and the claims still open. Checks accumulate across calls.
 */
function settle(record, checks) {
  const all = [...list(record.verification && record.verification.checks), ...list(checks)];
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
    `TASK: ${r.task.title}${r.task.id != null ? ` (task ${r.task.id})` : ''}`,
    r.task.description ? `DETAIL: ${r.task.description}` : null,
    `INPUT REVISION: ${r.input_revision || 'NOT STATED'}`,
    `PRODUCED BY: role ${r.producer.role || 'not recorded'}, model ${r.producer.model || 'not recorded'}`,
    'ACCEPTANCE CRITERIA:', ...list(r.acceptance_criteria).map((c, i) => `  ${i + 1}. ${c}`),
    'CLAIMS:', ...list(r.claims).map((c) => `  [${c.id}] ${c.text}`),
    'OUTPUT ARTIFACTS:', ...(list(r.artifacts).length ? list(r.artifacts).map((a) => `  - ${a.ref}${a.sha256 ? ` sha256 ${a.sha256}` : ''}`) : ['  (none)']),
    'EVIDENCE:', ...(list(r.evidence).length ? list(r.evidence).flatMap((e) => [`  - ${e.ref} (${e.kind || 'unspecified'}; ${e.available === true ? 'available' : 'NOT AVAILABLE'})`, ...(e.excerpt ? [`    ${String(e.excerpt).replace(/\n/g, '\n    ')}`] : [])]) : ['  (none)']),
    `VERIFICATION SO FAR: ${r.verification.outcome}`,
    ...list(r.verification.checks).map((k) => `  - ${k.name} [${k.kind}] on ${k.claim}: ${k.outcome}${k.reason ? ` (${k.reason})` : ''}`),
    'OPEN CLAIMS:', ...(list(r.open_claims).length ? r.open_claims.map((o) => `  - ${o.id}: ${o.reason}`) : ['  (none)']),
    g.length ? `GAPS (each one keeps this NOT_CHECKED): ${g.join('; ')}` : 'GAPS: none',
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
 * SUPPORTED needs both: exit 0 and every part of the sentence SUPPORTED. No card, a crash, a 404: NOT_CHECKED.
 */
function inspectOutcome(card, exit) {
  const st = list(card && card.record && card.record.claims).map((c) => c && c.status);
  if (st.includes('CONTRADICTED')) return 'CONTRADICTED';
  if (exit === 0 && st.length && st.every((x) => x === 'SUPPORTED')) return 'SUPPORTED';
  return 'NOT_CHECKED';
}

module.exports = { inspectOutcome, SCHEMA, OUTCOMES, sha256, build, gaps, settle, render, parseReview };
