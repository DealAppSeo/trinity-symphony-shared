#!/usr/bin/env node
/**
 * Standalone verification for lib/artifactGuard.js.
 * No jest in this repo, so this script doubles as the unit-test harness.
 *
 * Run: node scripts/verify-artifact-guard.js
 * Exit code: 0 if all scenarios pass, 1 otherwise.
 */

const { validateArtifactQuality } = require('../lib/artifactGuard');

const scenarios = [
    {
        name: 'valid: distinct prose well over 100 chars',
        artifact: { id: 1, content: 'The query was executed against trinity_kv_store and returned 3 receipt-indexer cursor keys, all advanced within the last 30 minutes. No staleness detected. Indexer is healthy.' },
        task: { id: 1, description: 'Query trinity_kv_store for keys starting with "receipt_indexer_cursor:". For each, verify lastBlock has advanced compared to the previous reading.' },
        expectValid: true,
        expectReason: undefined,
    },
    {
        name: 'reject: empty string content',
        artifact: { id: 2, content: '' },
        task: { id: 2, description: 'Some task description that is long enough to exceed the overlap threshold of fifty characters of text.' },
        expectValid: false,
        expectReason: 'empty_content',
    },
    {
        name: 'reject: whitespace-only content',
        artifact: { id: 3, content: '   \n\t  ' },
        task: { id: 3, description: 'Some task description that is long enough to exceed the overlap threshold of fifty characters of text.' },
        expectValid: false,
        expectReason: 'empty_content',
    },
    {
        name: 'reject: null artifact',
        artifact: null,
        task: { id: 4, description: 'Some task description that is long enough to exceed the overlap threshold of fifty characters of text.' },
        expectValid: false,
        expectReason: 'empty_content',
    },
    {
        name: 'reject: row 95602-style verbatim echo',
        artifact: { id: 95602, content: 'Count trinity_hitl_requests rows where status=pending in the last 1 hour. After escalation contract activation (ESCALATION_CONTRACT=true on trinity-veritas), this should occasionally be > 0. If 0 for the whole window, that may indicate the contract is not firing.' },
        task: { id: 200443, description: 'Count trinity_hitl_requests rows where status=pending in the last 1 hour. After escalation contract activation (ESCALATION_CONTRACT=true on trinity-veritas), this should occasionally be > 0. If 0 for the whole window, that may indicate the contract is not firing.' },
        expectValid: false,
        expectReason: 'echo_identical',
    },
    {
        name: 'reject: echo with only whitespace differences',
        artifact: { id: 6, content: '\n  Count repid_score_events grouped by (delta sign, agent_id) for the last 4 hours. Flag any agent receiving only positive OR only negative deltas (concentration risk).  \n' },
        task: { id: 6, description: 'Count repid_score_events grouped by (delta sign, agent_id) for the last 4 hours. Flag any agent receiving only positive OR only negative deltas (concentration risk).' },
        expectValid: false,
        expectReason: 'echo_identical',
    },
    {
        name: 'reject: content under 100 chars',
        artifact: { id: 7, content: 'Done.' },
        task: { id: 7, description: 'Some unrelated task description that is long enough to exceed the overlap threshold of fifty characters of text.' },
        expectValid: false,
        expectReason: 'too_short',
    },
    {
        name: 'reject: content starts with first 50 chars of description',
        artifact: { id: 8, content: 'Count trinity_hitl_requests rows where status=pending and then I went on to write a bunch of additional prose claiming I did the work, padded out to comfortably exceed the 100-char floor.' },
        task: { id: 8, description: 'Count trinity_hitl_requests rows where status=pending in the last 1 hour. After escalation contract activation, etc.' },
        expectValid: false,
        expectReason: 'echo_overlap',
    },
    {
        name: 'reject: content ends with last 50 chars of description',
        artifact: { id: 9, content: 'Some lengthy preamble that pads out the front so the prefix check does not fire, followed verbatim by the trailing portion: positive OR only negative deltas (concentration risk).' },
        task: { id: 9, description: 'Count repid_score_events grouped by (delta sign, agent_id) for the last 4 hours. Flag any agent receiving only positive OR only negative deltas (concentration risk).' },
        expectValid: false,
        expectReason: 'echo_overlap',
    },
    {
        name: 'valid: short description (below overlap threshold) + distinct content',
        artifact: { id: 10, content: 'I executed the requested action and the result is documented here in over one hundred characters of prose so the floor check does not trigger.' },
        task: { id: 10, description: 'Do a thing.' },
        expectValid: true,
        expectReason: undefined,
    },
];

let passed = 0;
let failed = 0;

for (const s of scenarios) {
    const got = validateArtifactQuality(s.artifact, s.task);
    const okValid = got.valid === s.expectValid;
    const okReason = s.expectValid ? true : got.reason === s.expectReason;
    if (okValid && okReason) {
        console.log(`PASS  ${s.name}`);
        passed++;
    } else {
        console.log(`FAIL  ${s.name}`);
        console.log(`      expected: valid=${s.expectValid} reason=${s.expectReason ?? '(n/a)'}`);
        console.log(`      got:      valid=${got.valid} reason=${got.reason ?? '(n/a)'}`);
        failed++;
    }
}

console.log('');
console.log(`Total: ${scenarios.length}  Passed: ${passed}  Failed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
