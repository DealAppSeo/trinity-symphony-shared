'use strict';
/**
 * A reply must CONTAIN its deliverable before it is stored as done.
 *
 * Tasks 439397 and 439431 (trinity-torch, 2026-11-23/24): the task asked for lines of work, the reply was
 * "saved as a document artifact" with none of the lines in it, and the row was stored with status done.
 * 13 of 47 replies that night were a summary of the work in place of the work
 * (E:\dev\reports\2026-11-23\ENGINEERING_T12.md); the word "saved" is not the signal, the missing lines are.
 *
 * A task opts in with metadata.delivery_contract = { pattern, min_lines }: at least min_lines lines of the
 * reply must match pattern (a JavaScript regular expression, no flags; min_lines defaults to 1).
 *
 * DELIVERY_CONTRACT_GATE (default off: nothing changes)
 *   on — a reply that does not meet its task's contract finishes as 'needs_artifact' (allowed by
 *        valid_task_status; not claimable, and not a status trinity-task-bridge polls), with the reply kept in
 *        result and the reason in metadata.delivery. No follow-up is spawned and no reputation is awarded.
 * A task with no contract is never touched. A contract that cannot be read (bad pattern, bad min_lines) is
 * not met: nothing can be shown delivered against it, and the reason says contract_invalid.
 *
 * It proves the deliverable is present and shaped right. It says nothing about whether it is correct.
 */
const vm = require('node:vm');

const MAX_PATTERN_CHARS = 200;
const MAX_REPLY_CHARS = 200000;
const MATCH_TIMEOUT_MS = 250;

const enabled = () => process.env.DELIVERY_CONTRACT_GATE === 'on';

/** The task's contract object, or null. metadata may arrive as an object or as a JSON string. */
function contractOf(task) {
  let md = task && task.metadata;
  if (typeof md === 'string') { try { md = JSON.parse(md); } catch { return null; } }
  const c = md && md.delivery_contract;
  return c && typeof c === 'object' && !Array.isArray(c) ? c : null;
}

/** { delivered, matched, min_lines, reason? } for a reply against a contract. Never throws. */
function check(output, contract) {
  const pattern = contract && contract.pattern;
  const min = contract && contract.min_lines === undefined ? 1 : Number(contract && contract.min_lines);
  const invalid = (why) => ({ delivered: false, matched: 0, min_lines: Number.isInteger(min) ? min : null, reason: `contract_invalid: ${why}` });
  if (typeof pattern !== 'string' || !pattern) return invalid('pattern must be a non-empty string');
  if (pattern.length > MAX_PATTERN_CHARS) return invalid(`pattern longer than ${MAX_PATTERN_CHARS} characters`);
  if (!Number.isInteger(min) || min < 1) return invalid('min_lines must be a whole number of at least 1');

  const lines = String(output ?? '').slice(0, MAX_REPLY_CHARS).split(/\r?\n/).map((l) => l.trimEnd());
  let matched;
  try {
    // The pattern comes from a task row, so it runs under a time limit: a pattern that backtracks without end
    // is cut off instead of holding the agent loop. The script text is fixed; pattern and lines are data.
    matched = vm.runInNewContext(
      'const re = new RegExp(pattern); let n = 0; for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) n++; n',
      { pattern, lines }, { timeout: MATCH_TIMEOUT_MS });
  } catch (e) {
    if (e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { delivered: false, matched: 0, min_lines: min, reason: 'contract_timeout' };
    return invalid('pattern is not a valid regular expression');
  }
  return matched >= min
    ? { delivered: true, matched, min_lines: min }
    : { delivered: false, matched, min_lines: min, reason: `matched ${matched} of ${min} required lines` };
}

module.exports = { enabled, contractOf, check };
