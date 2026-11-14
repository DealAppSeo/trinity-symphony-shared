'use strict';
/**
 * An answer that DECLARES it could not check what it was asked, and says why, is an honest NOT_CHECKED,
 * not a substance failure.
 *
 * WHY THIS EXISTS (2026-11-14, task 438321). The substance gate scored such an answer on word overlap with
 * success_criteria, which describe the numbers the agent honestly did not produce, so it failed
 * ("success_criteria_unmet: 22%") and the task was labelled shadow_reject: "could not check" recorded as a
 * reject. Not checked is not failed. RepID did not move (delta 0), but the label said the wrong thing.
 *
 * DECLARED means, read from the answer's structure only, never from free prose:
 *   - the reply is one JSON object (a ```json fence around it is allowed);
 *   - it says so: a `can_<something>` field that is false, `not_checked: true`, or `verdict` / `status` /
 *     `decision` equal to NOT_CHECKED (any case, `not checked` or `not_checked`);
 *   - it gives a `reason` of at least 8 characters; and
 *   - it reports NO number anywhere, including a number written as a string ("5"). A reply that says it
 *     could not check and still gives a count contradicts itself, so it is not an honest refusal and the
 *     gate judges it exactly as before.
 *
 * SUBSTANCE_GATE_NOT_CHECKED (default off):
 *   off (unset, or any other value) — byte-for-byte the old behaviour.
 *   shadow — the old status (shadow_reject), plus metadata.declared_not_checked naming the reason.
 *   on     — such a reply is recorded with status 'not_checked' (allowed by trinity_tasks' valid_task_status
 *            CHECK), not shadow_reject, and gets no HITL request. trinity-task-bridge (repid-engine) polls
 *            done/verified/shadow_reject only, so a not_checked task makes no RepID event: honest is neutral.
 * Pure: no I/O.
 */

const NOT_CHECKED_WORD = /^not[_ ]checked$/i;
const MIN_REASON = 8;

// A count written as a string ("5", "1,487") is still a count. An ISO time or other text is not.
const NUMERIC_STRING = /^\s*[-+]?\d[\d,]*(\.\d+)?\s*$/;
const hasNumber = (v) =>
  typeof v === 'number' ||
  (typeof v === 'string' && NUMERIC_STRING.test(v)) ||
  (v !== null && typeof v === 'object' && Object.values(v).some(hasNumber));

/** { reason } when `output` is a declared, self-consistent NOT_CHECKED; otherwise null. */
function declaredNotChecked(output) {
  if (typeof output !== 'string') return null;
  let text = output.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  if (!text.startsWith('{')) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
  if (reason.length < MIN_REASON) return null;
  const declared =
    Object.keys(obj).some((k) => /^can_[a-z0-9_]+$/i.test(k) && obj[k] === false) ||
    obj.not_checked === true ||
    ['verdict', 'status', 'decision'].some((k) => typeof obj[k] === 'string' && NOT_CHECKED_WORD.test(obj[k].trim()));
  if (!declared) return null;
  if (hasNumber(obj)) return null;
  return { reason: reason.slice(0, 200) };
}

/** 'off' | 'shadow' | 'on'. Anything but exactly shadow or on is off. */
function notCheckedMode(env = process.env) {
  const v = String(env.SUBSTANCE_GATE_NOT_CHECKED || '').trim().toLowerCase();
  return v === 'on' || v === 'shadow' ? v : 'off';
}

module.exports = { declaredNotChecked, notCheckedMode };
