'use strict';

/**
 * C4 — app-level worm brake on tasks an agent creates.
 * (HARNESS_ARCHITECTURE_SYNTHESIS 2026-10-16 §2; SECURITY_RUN S3-9, S3-11 and §4 item 4.)
 *
 * The auto_lineage trigger already records generation (parent's + 1), but nothing caps
 * it. check_spawn_explosion() only reports. So an injected task that tells an agent to
 * create a copy of itself can keep copying. Before an agent inserts into trinity_tasks,
 * this checks two rules:
 *   - generation: the new task's generation (parent's + 1, the auto_lineage rule) must
 *     be at most 3;
 *   - rate: one creator may create at most TASK_WORM_BRAKE_HOURLY_CAP tasks (default 20)
 *     per hour.
 *
 * TASK_WORM_BRAKE_ENFORCE=1 refuses. Unset (the default) is shadow: a would-block is
 * logged and the task is created as before.
 *
 * ponytail: the hourly count lives in this process (one agent per process), so a restart
 * resets it. The cross-process version, which also catches inserts that bypass this
 * code, is the DB trigger: review-only SQL at
 * E:\dev\reports\2026-10-16\C4_WORM_BRAKE_TRIGGER.sql, not applied.
 * This brake is in addition to fixing S1-A (who may insert tasks at all), not a
 * substitute for it.
 */

const MAX_GENERATION = 3;
const HOUR_MS = 3_600_000;
const created = new Map(); // creator -> timestamps of creations this brake allowed in the last hour

/**
 * @param {{creator: string, parentGeneration: number|null, now?: number}} p
 *   parentGeneration null = unknown; then only the rate rule applies.
 * @returns {{allow: boolean, generation: number|null, reasons: string[]}}
 */
function checkSpawn({ creator, parentGeneration, now = Date.now() }) {
  const cap = Number(process.env.TASK_WORM_BRAKE_HOURLY_CAP || 20);
  const generation = Number.isInteger(parentGeneration) ? parentGeneration + 1 : null;
  const times = (created.get(creator) || []).filter((t) => now - t < HOUR_MS);
  const reasons = [];
  if (generation !== null && generation > MAX_GENERATION) reasons.push(`generation ${generation} > ${MAX_GENERATION}`);
  if (times.length >= cap) reasons.push(`${times.length} tasks created by ${creator} in the last hour (cap ${cap})`);

  const enforce = process.env.TASK_WORM_BRAKE_ENFORCE === '1';
  const allow = !(enforce && reasons.length);
  if (allow) times.push(now);
  created.set(creator, times);
  if (reasons.length) {
    console.warn(`[worm-brake] ${enforce ? 'BLOCKED' : 'SHADOW would block'} a task by ${creator}: ${reasons.join('; ')}`);
  }
  return { allow, generation, reasons };
}

function __resetForTests() {
  created.clear();
}

module.exports = { checkSpawn, MAX_GENERATION, __resetForTests };
