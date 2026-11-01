'use strict';
/**
 * KNOWN-ANSWER LOOP, first live run (parent 435582, 2026-11-01) — what it taught, pinned:
 *  1. Every reply failed the substance gate "output_too_short: 131/200": the task asks for one line
 *     of JSON. A known-answer reply is judged by its SHAPE instead, and a bad shape is recorded as
 *     answer_format_invalid: <what> (a measured signal: which models cannot follow the format).
 *  2. mel (contract path) failed "artifact_missing": the reply is the deliverable, so it is saved
 *     as the artifact; the artifact guard's 100-char floor does not apply to it.
 *  3. spawned_count moved by 2 per child (claim +1, auto_lineage trigger +1): the claim no longer adds.
 *  4. Results were comparable per provider only: the model that answered is now recorded.
 * Run: node tests/known-answer-learning.test.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('../lib/case-pool');
const { validateArtifactQuality } = require('../lib/artifactGuard');
const { buildFastPathResult } = require('../lib/substance-gate-client');

const KA = { description: 'Decide ...', metadata: { case_pool: 'hal_open_v1', case_id: 'c1', ab_arm: 'B' } };
const OTHER = { description: 'Write a report about X', metadata: { sprint_tag: 'x' } };

// ── which tasks are known-answer ──
assert.equal(cp.isKnownAnswerTask(KA), true);
assert.equal(cp.isKnownAnswerTask({ metadata: JSON.stringify(KA.metadata) }), true, 'metadata as a string');
assert.equal(cp.isKnownAnswerTask({ metadata: { case_pool: 'hal_open_v1' } }), false, 'the parent has no case_id');
assert.equal(cp.isKnownAnswerTask({ metadata: '{not json' }), false);
assert.equal(cp.isKnownAnswerTask({ metadata: { case_pool: 'anything_else', case_id: 'c1' } }), false, 'only a pool this module serves (Strix)');
assert.equal(cp.isKnownAnswerTask({ metadata: { case_pool: 'hal_open_v1', case_id: { x: 1 } } }), false, 'case_id must be a string');
assert.equal(cp.isKnownAnswerTask(OTHER), false);
assert.equal(cp.isKnownAnswerTask(null), false);

// ── parsing a reply: real replies from the first run, and the ways one can be wrong ──
assert.deepEqual(cp.parseAnswer('{"decision":"pass","confidence":0.99,"reason":"It accurately states that ML algorithms can be biased."}'),
  { decision: 'pass', confidence: 0.99, reason: 'It accurately states that ML algorithms can be biased.' });
assert.deepEqual(cp.parseAnswer('```json\n{"decision":"VETO","confidence":"0.8","reason":"Wrong year."}\n```'),
  { decision: 'veto', confidence: 0.8, reason: 'Wrong year.' }, 'fences, upper case, string confidence');
assert.equal(cp.parseAnswer('Here you go: {"decision":"abstain","confidence":0,"reason":"Cannot tell."} Thanks').decision, 'abstain');
assert.deepEqual(cp.parseAnswer('I think it is true.'), { error: 'no_json' });
assert.deepEqual(cp.parseAnswer('{decision: pass}'), { error: 'json_unparseable' });
assert.deepEqual(cp.parseAnswer('{"decision":"maybe","confidence":0.5,"reason":"x"}'), { error: 'decision_invalid' });
assert.deepEqual(cp.parseAnswer('{"decision":"pass","confidence":1.2,"reason":"x"}'), { error: 'confidence_invalid' });
assert.deepEqual(cp.parseAnswer('{"decision":"pass","confidence":true,"reason":"x"}'), { error: 'confidence_invalid' });
assert.deepEqual(cp.parseAnswer('{"decision":"pass","reason":"x"}'), { error: 'confidence_invalid' });
assert.deepEqual(cp.parseAnswer('{"decision":"pass","confidence":0.5,"reason":"  "}'), { error: 'reason_missing' });
assert.deepEqual(cp.parseAnswer(''), { error: 'no_json' });

// ── the artifact guard: a short known-answer reply is valid; everything else is unchanged ──
const shortVeto = '{"decision":"veto","confidence":0.8,"reason":"Wrong."}';
assert.ok(shortVeto.length < 100);
assert.deepEqual(validateArtifactQuality({ content: shortVeto }, KA), { valid: true });
assert.deepEqual(validateArtifactQuality({ content: shortVeto }, OTHER), { valid: false, reason: 'too_short' });
assert.deepEqual(validateArtifactQuality({ content: '  ' }, KA), { valid: false, reason: 'empty_content' }, 'empty is still empty');

// ── the gate event: for a format-checked answer, the chars signal is the format verdict ──
const okEvt = buildFastPathResult(shortVeto, { ok: true, format: 'decision_json_v1' });
assert.equal(okEvt.passed, true);
assert.equal(okEvt.signals.chars.passed, true);
assert.equal(okEvt.composite_score, 1);
const badEvt = buildFastPathResult('I think so', { ok: false, reason: 'answer_format_invalid: no_json', format: 'decision_json_v1' });
assert.equal(badEvt.passed, false);
assert.equal(badEvt.signals.chars.passed, false);
assert.deepEqual(badEvt.failures, ['answer_format_invalid: no_json']);
const plainShort = buildFastPathResult('short', { ok: false, reason: 'output_too_short: 5/200' });
assert.equal(plainShort.signals.chars.passed, false, 'other tasks keep the length rule');
// only the exact known-answer format bypasses length; any other truthy `format` does not
assert.equal(buildFastPathResult('short', { ok: true, format: 'something_else' }).signals.chars.passed, false);

// ── the agent wiring (source pins; the agent needs a DB to construct) ──
const src = fs.readFileSync(path.resolve(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
const vs = src.slice(src.indexOf('async validateSubstance('));
assert.ok(vs.indexOf('casePool.isKnownAnswerTask(task)') > 0, 'validateSubstance checks known-answer tasks');
assert.ok(vs.indexOf('casePool.isKnownAnswerTask(task)') < vs.indexOf('// Minimum length check'), '... before the length rule');
assert.match(vs.slice(0, 2500), /answer_format_invalid: \$\{a\.error\}/);

const contract = src.slice(src.indexOf('async processTaskContract('), src.indexOf('// STEP 6: Artifact Guard'));
assert.match(contract, /casePool\.isKnownAnswerTask\(task\)[\s\S]*this\.saveArtifact\(task\.id, result\.output/, 'the contract path saves a known-answer reply as its artifact');

const spawner = src.slice(src.indexOf('async respawnEvergreensIfDue('), src.indexOf('casePool.nextSlot('));
assert.match(spawner, /\.update\(\{ last_spawned_at: nowIso \}\)/, 'the cadence claim sets only last_spawned_at');
assert.doesNotMatch(spawner, /spawned_count: \(parent\.spawned_count/, 'the trigger counts children; the claim does not');

assert.match(src, /find\(\(m\) => typeof m === 'string' && m\);\s*return \{ output, model: named \|\| null \};/, 'callProvider returns the model that answered, a string or null');
const providerWrites = src.match(/provider_used: result\.provider,/g) || [];
const modelWrites = src.match(/provider_used: result\.provider, model_used: typeof result\.model === 'string' \? result\.model : null,/g) || [];
assert.ok(providerWrites.length >= 5);
assert.equal(modelWrites.length, providerWrites.length, 'every write of provider_used also writes model_used');

console.log('known-answer-learning.test.js: PASS');
