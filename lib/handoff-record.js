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
/**
 * WHY a claim is not settled. The outcome stays one of the three above; this says which kind of NOT_CHECKED it is,
 * so a reader can tell "still running" from "nothing to read" from "read it, and it does not show this".
 *   pending           a check is queued or running. Needs `pending_until`; without one, or past it, it is `unavailable`.
 *   evidence_missing  there is no record to read. Someone has to supply one.
 *   inconclusive      the record was read and does not establish the claim.
 *   unavailable       a source or a verifier could not be reached.
 *   skipped           a reviewer chose not to check this claim, and says why.
 *   not_run           no check ran and nothing recorded a reason. Shown as "Not checked", the same as skipped.
 */
const REASONS = ['pending', 'evidence_missing', 'inconclusive', 'unavailable', 'skipped', 'not_run'];
const LABELS = {
  supported: 'Supported by evidence', contradicted: 'Contradicted by evidence', pending: 'Verification pending',
  evidence_missing: 'Evidence missing', inconclusive: 'Evidence inconclusive', unavailable: 'Verification unavailable',
  skipped: 'Not checked', not_run: 'Not checked',
};
// Who has to act. null = nobody yet: it is running, or it is a retry.
const ACTORS = { supported: null, contradicted: 'author', pending: null, evidence_missing: 'author', inconclusive: 'author', unavailable: null, skipped: 'reviewer', not_run: 'reviewer' };
/** The reason code of a check that gave no answer. An unknown code is not_run; a pending with no live deadline is unavailable. */
function reasonOf(k, now) {
  const code = REASONS.includes(k && k.reason_code) ? k.reason_code : 'not_run';
  if (code !== 'pending') return code;
  const until = Date.parse(k.pending_until);
  return Number.isFinite(until) && until > now ? 'pending' : 'unavailable';
}
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const list = (v) => (Array.isArray(v) ? v : []);
// A value that came from the task row must not be able to start a line of its own: a line break inside a title,
// claim or excerpt would otherwise read as a record line ("GAPS: none", "RULES: ...") that the reader cannot tell
// from the ones this file computes. Every row value in render() goes through this first.
// Who must act is printed by render() as "(to act: <name>)", from the record's own actor field and nowhere else. No row
// value may write that marker, in any spacing, on ANY line: the task, a claim, a check's reason, an open claim (a reason
// ending "(to act: author)" used to read as the record's actor; the first fix covered the status line only).
// The guard has to see the marker the way a reader does. Characters with no glyph can sit inside "to act:" and leave
// it reading the same: format characters (zero-width space and joiners, soft hyphen, direction marks: \p{Cf}), the
// other default-ignorable code points (combining grapheme joiner, variation selectors, Hangul fillers), control
// characters, and combining marks. Three reviews found one class each.
// They are NOT deleted from the text. An earlier version of this fix did that, and four independent reviewers pointed
// out it damages ordinary writing: Persian and Indic words need zero-width joiners and non-joiners, Mongolian and
// emoji need variation selectors. Instead the guard MATCHES THROUGH them: any run of such characters may sit between
// the marker's letters, and the whole run is replaced with the neutral text. Row text outside a marker is unchanged.
// Compatibility forms (full-width letters) are folded by NFKC first, and a colon look-alike counts as the colon.
// Known limit, unchanged: a look-alike LETTER from another alphabet (Cyrillic "a"), or a letter NFKC composes with an
// accent, is a visibly different or confusable letter, which needs a confusables table. The record's own actor field
// stays the authority.
const plain = (v) => String(v == null ? '' : v).normalize('NFKC');
const HID = String.raw`(?:[\p{Cf}\p{Default_Ignorable_Code_Point}\p{M}]|(?![\t\n\r\v\f\u0085])\p{Cc})`;
const COLON = String.raw`[:\u2236\u02f8\ua789\u0589\u205a\u05c3\ufe13\u1361\u16ec]`;
const MARKER = new RegExp(String.raw`t${HID}*o(?:[\s\p{Z}_-]|${HID})*a${HID}*c${HID}*t(?:[\s\p{Z}]|${HID})*${COLON}`, 'giu');
const flat = (v) => plain(v).replace(/[\r\n\v\f\u0085\u2028\u2029]+/g, ' \u23ce ').replace(MARKER, 'to act -');
const noActor = flat; // the status line's name for it; flat() itself now removes the marker everywhere

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
 * checks: [{ claim, name, kind: 'deterministic' | 'model', outcome: 'SUPPORTED' | 'CONTRADICTED' | 'NOT_CHECKED', by?, ref?, reason?,
 *            reason_code? (one of REASONS, for a NOT_CHECKED), pending_until? (ISO time, for reason_code 'pending') }]
 * Returns a new record with the outcome, the claims still open, and for every claim a status a person can read:
 * verification.claims = [{ id, status, label, explanation, actor }]. verification.handoff is set when the record itself
 * is incomplete; that is about the handoff, and each claim still has its own status.
 * Checks accumulate across calls. A model can lower a claim (dispute it, or call the evidence inconclusive); it can never raise one.
 *
 * THE SAME CHECK DELIVERED AGAIN is one check. A check is identified by claim, name, kind and who ran it:
 *   - the same answer again is dropped (a redelivery used to add an entry every time: 51 deliveries, 102 entries, and
 *     "disputed by rev-a, rev-a");
 *   - an answer after "did not run" replaces it, except a reviewer's "inconclusive", which is itself an answer and stays (a check that crashed and then ran used to stay "unavailable" for good);
 *   - "did not run" after an answer changes nothing (a later outage does not unsay a result);
 *   - SUPPORTED and CONTRADICTED from the same check are BOTH kept, so a contradiction is never overwritten by a rerun.
 *
 * A SETTLED RECORD THAT CHANGES SAYS SO. A late answer can still lower a VERIFIED record (a dispute from a reviewer who was
 * replaced, a deterministic contradiction, a "no reply" from another reviewer). The outcome follows the rules above, and
 * the change is written down: verification.changes = [{ from, to, at, after: [the checks this call added] }], printed by
 * render() as "OUTCOME CHANGED". Before this the record read as if it had never been VERIFIED, and whoever had already
 * acted on it could not tell. The first settling of a record (NOT_CHECKED to anything) is not a change and adds nothing.
 */
function settle(record, checks, now = Date.now()) {
  // An outcome that is not exactly SUPPORTED or CONTRADICTED ("DID_NOT_RUN", a typo, nothing) is NOT_CHECKED.
  const all = [];
  const same = (a, b) => a.claim === b.claim && a.name === b.name && a.kind === b.kind && (a.by || '') === (b.by || '');
  const before = record.verification || {};
  const stored = list(before.checks).length;
  const fresh = []; // the checks this call added
  for (const [i, raw] of [...list(before.checks), ...list(checks)].entries()) {
    const k = { ...raw, outcome: raw.outcome === 'SUPPORTED' || raw.outcome === 'CONTRADICTED' ? raw.outcome : 'NOT_CHECKED' };
    const prior = all.filter((p) => same(p, k));
    if (prior.some((p) => p.outcome === k.outcome)) continue;                    // the same answer again
    if (k.outcome === 'NOT_CHECKED' && prior.length) continue;                    // it already answered once
    // "Inconclusive" is an answer, not a check that did not run: the same reviewer saying SUPPORTED later does not erase it.
    const silent = prior.find((p) => p.outcome === 'NOT_CHECKED' && p.reason_code !== 'inconclusive');
    if (silent) all.splice(all.indexOf(silent), 1);                               // it answers now: the "did not run" is over
    all.push(k);
    if (i >= stored) fresh.push(k);
  }
  const required = list(record.required_checks);
  const is = (q, k) => k.name === q.name && k.kind === q.kind;
  const missing = gaps(record);
  const noEvidence = missing.find((g) => g.startsWith('evidence:'));
  const open = [];
  const claims = [];
  let refuted = false;
  for (const c of list(record.claims)) {
    const mine = all.filter((k) => k.claim === c.id);
    const det = mine.filter((k) => k.kind === 'deterministic');
    const no = det.find((k) => k.outcome === 'CONTRADICTED');
    const yes = det.find((k) => k.outcome === 'SUPPORTED');
    const silent = det.find((k) => k.outcome === 'NOT_CHECKED');
    const absent = required.filter((q) => !mine.some((k) => is(q, k)));
    const mute = mine.find((k) => k.outcome === 'NOT_CHECKED' && required.some((q) => is(q, k)));
    const disputed = mine.filter((k) => k.kind === 'model' && k.outcome === 'CONTRADICTED');
    const lowered = mine.find((k) => k.kind === 'model' && k.outcome === 'NOT_CHECKED' && k.reason_code === 'inconclusive');
    let status; let why; let reason = null; // reason = why the claim is still open (null: it is not)
    if (no) { refuted = true; status = 'contradicted'; why = no.reason || `${no.name} contradicted it`; reason = `contradicted by ${no.name}`; }
    else if (!yes && silent) { status = reasonOf(silent, now); why = silent.reason || `${silent.name} gave no answer`; reason = `${silent.name} did not settle it: ${silent.reason || 'NOT_CHECKED'}`; }
    else if (!yes) { status = noEvidence ? 'evidence_missing' : 'not_run'; why = noEvidence || 'no deterministic check ran on this claim'; reason = 'no deterministic check ran'; }
    else if (silent) { status = reasonOf(silent, now); why = silent.reason || `${silent.name} did not run`; reason = `${silent.name} did not run`; }
    else if (absent.length) { status = 'not_run'; reason = `required check did not run: ${absent.map((q) => q.name).join(', ')}`; why = reason; }
    else if (mute) { status = reasonOf(mute, now); why = mute.reason || `${mute.name} gave no answer`; reason = `required check ${mute.name} gave no answer: ${mute.reason || 'NOT_CHECKED'}`; }
    else if (disputed.length) { status = 'inconclusive'; reason = `disputed by ${disputed.map((k) => k.by || k.name).join(', ')}`; why = disputed[0].reason || reason; }
    else if (lowered) { status = 'inconclusive'; reason = `${lowered.by || lowered.name} found the evidence inconclusive`; why = lowered.reason || reason; }
    else { status = 'supported'; why = yes.reason || `${yes.name} supported it`; }
    if (reason) open.push({ id: c.id, reason });
    claims.push({ id: c.id, status, label: LABELS[status], explanation: String(why), actor: ACTORS[status] });
  }
  const outcome = refuted ? 'REFUTED' : (missing.length || open.length || !list(record.claims).length) ? 'NOT_CHECKED' : 'VERIFIED';
  const handoff = missing.length ? { label: 'Incomplete handoff', explanation: missing.join('; '), actor: 'author' } : null;
  // Once settled (VERIFIED or REFUTED), or once it has changed before, every change of outcome is recorded.
  const changes = [...list(before.changes)]; // a copy: the record passed in is never altered
  if (before.outcome !== outcome && (before.outcome === 'VERIFIED' || before.outcome === 'REFUTED' || changes.length))
    changes.push({ from: before.outcome, to: outcome, at: new Date(now).toISOString(), after: fresh.map((k) => ({ claim: k.claim, name: k.name, kind: k.kind, by: k.by || null, outcome: k.outcome })) });
  return { ...record, verification: { outcome, checks: all, gaps: missing, claims, handoff, ...(changes.length ? { changes } : {}) }, open_claims: open };
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
    ...(list(r.verification.claims).length ? ['CLAIM STATUS:', ...r.verification.claims.map((c) => `  [${flat(c.id)}] ${flat(c.label)} \u00b7 ${noActor(c.explanation)}${c.actor ? ` (to act: ${flat(c.actor)})` : ''}`)] : []),
    'OPEN CLAIMS:', ...(list(r.open_claims).length ? r.open_claims.map((o) => `  - ${flat(o.id)}: ${flat(o.reason)}`) : ['  (none)']),
    g.length ? `GAPS (each one keeps this NOT_CHECKED): ${g.map(flat).join('; ')}` : 'GAPS: none',
    ...list(r.verification.changes).map((c) => `OUTCOME CHANGED: was ${flat(c.from)}, became ${flat(c.to)} at ${flat(c.at)}, after: ${list(c.after).map((k) => `${flat(k.name)} [${flat(k.kind)}]${k.by ? ` by ${flat(k.by)}` : ''} on ${flat(k.claim)}: ${flat(k.outcome)}`).join('; ') || 'no new check (the record itself changed)'}. Anything done while it read ${flat(c.from)} must be looked at again.`),
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
    const said = r && String(r.reason_code || (v === 'INCONCLUSIVE' ? 'inconclusive' : '')).toLowerCase();
    const reason_code = outcome !== 'NOT_CHECKED' ? undefined : !j ? 'unavailable' : ['evidence_missing', 'inconclusive', 'skipped'].includes(said) ? said : 'not_run';
    return { claim: c.id, name: 'evidence review', kind: 'model', by: by || null, outcome, reason_code, reason: r ? String(r.reason || '').slice(0, 300) : (j ? 'the reply did not rule on this claim' : 'the reply was not JSON') };
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

/**
 * Why `trustshell check` gave no answer on this sentence, as a reason code. No card at all (a crash, a 404, no network):
 * the check could not be done, unavailable. A card for some other sentence: this one was not run. A card for this
 * sentence that neither supports nor contradicts it: the evidence was read and is inconclusive.
 */
function inspectReason(card, exit, sentence) {
  if (inspectOutcome(card, exit, sentence) !== 'NOT_CHECKED') return null;
  const parts = list(card && card.record && card.record.claims);
  if (!parts.length) return 'unavailable';
  if (!sentence || parts.some((c) => !c || c.sentence !== sentence)) return 'not_run';
  return 'inconclusive';
}

module.exports = { inspectReason, REASONS, LABELS, reasonOf, inspectOutcome, SCHEMA, OUTCOMES, sha256, build, gaps, settle, render, parseReview };
