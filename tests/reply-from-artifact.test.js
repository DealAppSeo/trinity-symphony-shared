'use strict';
// REPLY_FROM_ARTIFACT: when a model answers inside save_artifact and ends with a one-line confirmation, the
// task's reply is the artifact. Off by default. Found live 2026-11-19 (tasks 438914, 438925, 438926).
//   node tests/reply-from-artifact.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-not-a-key';
const A = require('../lib/ConstitutionalAgentV4');

const ANSWER = '# RESUME\n' + JSON.stringify({ outcome_you_read: 'VERIFIED', claim_c1: 'The check workflow succeeded on commit d9911681e9a2, run 44544121933.', can_proceed: true, next_action: 'Publish the sentence.' });
const agent = (artifact, lastArtifactId = 7) => Object.assign(Object.create(A.prototype), {
  name: 'trinity-apm', lastArtifactId,
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: artifact }) }) }) }) },
});
const task = { id: 438914 };
let n = 0, bad = 0;
const test = async (name, fn) => { n++; try { await fn(); console.log('  ok ' + name); } catch (e) { bad++; console.log(`  FAIL ${name}: ${e.message}`); } finally { delete process.env.REPLY_FROM_ARTIFACT; } };

(async () => {
  await test('control: flag unset -> the reply is exactly what the model said, artifact or not', async () => {
    assert.equal(await agent({ content: ANSWER, task_id: 438914 })._replyFromArtifact(task, '**Artifact saved successfully.**'), '**Artifact saved successfully.**');
  });
  await test('on: a one-line confirmation becomes the answer the model saved (task 438914)', async () => {
    process.env.REPLY_FROM_ARTIFACT = 'on';
    assert.equal(await agent({ content: ANSWER, task_id: 438914 })._replyFromArtifact(task, '**Artifact saved successfully.**'), ANSWER);
  });
  await test('on: a longer "it has been saved" summary also yields the artifact (task 438926)', async () => {
    process.env.REPLY_FROM_ARTIFACT = 'on';
    const summary = 'Done. The conformance review has been saved with 5 concrete findings covering several legs of the check, plus 6 items I could not assess from the text alone. '.repeat(2);
    const long = ANSWER + ' ' + 'x'.repeat(900);
    assert.equal(await agent({ content: long, task_id: 438914 })._replyFromArtifact(task, summary), long);
  });
  await test('on: a real answer is left alone, even though an artifact exists', async () => {
    process.env.REPLY_FROM_ARTIFACT = 'on';
    const real = 'The workflow name, run id and head commit in the sentence equal the values in the record, and the record shows a completed, successful run, so every acceptance criterion is met. '.repeat(2);
    assert.equal(await agent({ content: real + real + real, task_id: 438914 })._replyFromArtifact(task, real), real);
  });
  await test('on: another task\'s artifact is never used', async () => {
    process.env.REPLY_FROM_ARTIFACT = 'on';
    assert.equal(await agent({ content: ANSWER, task_id: 999 })._replyFromArtifact(task, 'Artifact saved.'), 'Artifact saved.');
  });
  await test('on: no artifact saved, a trivial artifact, or a failed read -> unchanged', async () => {
    process.env.REPLY_FROM_ARTIFACT = 'on';
    assert.equal(await agent({ content: ANSWER, task_id: 438914 }, null)._replyFromArtifact(task, 'Artifact saved.'), 'Artifact saved.');
    assert.equal(await agent({ content: 'ok', task_id: 438914 })._replyFromArtifact(task, 'Artifact saved.'), 'Artifact saved.');
    const broken = agent(null); broken.supabase = { from: () => { throw new Error('db down'); } };
    assert.equal(await broken._replyFromArtifact(task, 'Artifact saved.'), 'Artifact saved.');
  });
  await test('both task paths call it, right after the known-answer step', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ConstitutionalAgentV4.js'), 'utf8').replace(/\r\n/g, '\n');
    const calls = src.match(/result\.output = await this\._knownAnswerReply\(task, result\.output\);\n\s+result\.output = await this\._replyFromArtifact\(task, result\.output\);/g) || [];
    assert.equal(calls.length, 2);
  });
  console.log(`reply-from-artifact.test.js: ${n - bad}/${n} passed`);
  process.exit(bad ? 1 : 0);
})();
