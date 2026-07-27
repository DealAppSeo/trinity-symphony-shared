#!/usr/bin/env node
'use strict';

/**
 * claim-exhausted — the read side of the durable re-claim cap.
 *
 * WHY THIS EXISTS. The cap (Beat 42) made `trinity_tasks.claim_count` the thing that stops a
 * task being served forever. An independent verification (Beat 43, finding F2) found that the
 * counter was written by the claim and read by NOTHING — no query, no worker, no cron, no UI in
 * either repo. So a task that hit the cap went quiet with zero human-visible signal, and the only
 * recovery was a hand-written UPDATE against production. A cap whose only failure mode is silent
 * is not safe to deploy; this script is the missing surface, and it ships WITH the cap.
 *
 * The SQL and the threshold live in ConstitutionalAgentV4 (EXHAUSTED_TASKS_SQL /
 * RESET_CLAIM_COUNT_SQL / isClaimExhausted) rather than here, so the suite can pin this tool to
 * the same cap the live claim enforces. A recovery tool that looks for the wrong threshold is
 * worse than no tool: it reports "nothing parked" while work sits parked.
 *
 * USAGE
 *   node scripts/ops/claim-exhausted.js                 # list parked tasks (read-only, default)
 *   node scripts/ops/claim-exhausted.js --limit 100
 *   node scripts/ops/claim-exhausted.js --reset 435029  # un-park ONE task
 *
 * There is deliberately no --reset-all. Un-parking everything at once is how the 365-claim
 * runaway comes back; raising MAX_TASK_CLAIMS has the same effect fleet-wide and is the lever to
 * reach for only after reading the list.
 */

const A = require('../../lib/ConstitutionalAgentV4');
const { pgQuery } = require('../../lib/direct-pg');

const DEFAULT_LIMIT = 50;

function parseArgs(argv) {
  const args = { mode: 'list', limit: DEFAULT_LIMIT, taskId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reset') {
      args.mode = 'reset';
      args.taskId = argv[++i];
    } else if (a === '--limit') {
      args.limit = Number.parseInt(argv[++i], 10);
    } else if (a === '--help' || a === '-h') {
      args.mode = 'help';
    }
  }
  return args;
}

async function list(limit) {
  const cap = A.maxTaskClaims();
  const rows = await pgQuery(
    A.EXHAUSTED_TASKS_SQL,
    [cap, A.CLAIMABLE_STATUSES, limit],
    { retries: 1, timeoutMs: 15_000, label: 'claim-exhausted(list)' }
  );
  if (!rows || rows.length === 0) {
    console.log(`No parked tasks: nothing at or above the cap of ${cap} claims.`);
    return 0;
  }
  console.log(`${rows.length} task(s) parked at or above the cap of ${cap} claims:\n`);
  for (const r of rows) {
    console.log(
      `  #${r.id}  claims=${r.claim_count}  status=${r.status}  type=${r.task_type || 'n/a'}  ` +
      `updated=${r.updated_at || 'n/a'}\n      ${String(r.title || '').slice(0, 100)}`
    );
  }
  console.log(`\nTo un-park one:  node scripts/ops/claim-exhausted.js --reset <id>`);
  return rows.length;
}

async function reset(taskId) {
  if (!taskId || !/^\d+$/.test(String(taskId))) {
    // trinity_tasks.id is BIGINT (CLAUDE-RULE-5), never a uuid.
    console.error('--reset needs a numeric task id, e.g. --reset 435029');
    process.exitCode = 2;
    return;
  }
  const rows = await pgQuery(
    A.RESET_CLAIM_COUNT_SQL,
    [taskId],
    { retries: 1, timeoutMs: 15_000, label: 'claim-exhausted(reset)' }
  );
  if (!rows || rows.length === 0) {
    console.error(`No task #${taskId}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Task #${rows[0].id} un-parked: claim_count=${rows[0].claim_count}, status=${rows[0].status}.`);
  console.log('It will be served again on the next poll. If it parks a second time, the task is');
  console.log('the problem, not the cap — read its artifacts before resetting it again.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'help') {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  if (args.mode === 'reset') return reset(args.taskId);
  return list(Number.isFinite(args.limit) && args.limit > 0 ? args.limit : DEFAULT_LIMIT);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('claim-exhausted failed:', e.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, DEFAULT_LIMIT };
