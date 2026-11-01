'use strict';
/**
 * CASE POOL — an evergreen loop that asks a DIFFERENT known-answer question every time.
 *
 * An evergreen parent copies its description into every child, so a graded loop would ask the
 * same question forever. A parent whose metadata says {"case_pool": "hal_open_v1"} instead gets
 * ONE open HAL test case per spawn: the case's prompt_text replaces {{case_text}} in the parent's
 * description, and the case id rides in the child's metadata so a grader can compare the answer
 * with hal_test_cases.expected_decision afterwards. The answer key never enters the task.
 *
 * SEALED cases are never served. sha256("sealed-v1:" + id)[0] % 5 == 0 marks the measurement
 * set (repid-engine src/hal/sealed-ruler.ts); a case shown to an agent is no longer sealed.
 *
 * A/B, one variable at a time: with metadata.ab = {name, A, B}, even spawns are arm A and odd
 * spawns arm B, and {{arm_instruction}} becomes that arm's text. The arm is recorded on the
 * child, so the grader compares arms on the same answer key.
 *
 * Reads only. A failure returns {error}; the caller logs it and spawns nothing rather than
 * sending an agent a task with an empty question.
 */
const crypto = require('crypto');

const POOLS = new Set(['hal_open_v1']);

function isSealed(id) {
  return crypto.createHash('sha256').update('sealed-v1:' + id).digest()[0] % 5 === 0;
}

/** The index-th open case, rotating through the pool in id order. */
async function pickCase(supabase, pool, index) {
  if (!POOLS.has(pool)) return { error: `unknown case_pool "${pool}"` };
  // ponytail: reads every id (~2.5k uuids) per spawn; fine at a few spawns an hour. Cache the
  // open id list per process if the cadence or the corpus grows by orders of magnitude.
  const { data, error } = await supabase.from('hal_test_cases').select('id').order('id').limit(10000);
  if (error) return { error: `hal_test_cases read failed: ${error.message}` };
  const open = (data || []).map((r) => r.id).filter((id) => !isSealed(id));
  if (open.length === 0) return { error: 'no open cases' };
  const id = open[((index % open.length) + open.length) % open.length];
  const { data: row, error: e2 } = await supabase
    .from('hal_test_cases').select('id, prompt_text, category').eq('id', id).maybeSingle();
  if (e2 || !row || !row.prompt_text) return { error: `case ${id} unreadable: ${(e2 && e2.message) || 'empty'}` };
  return { id: row.id, text: row.prompt_text, category: row.category, poolSize: open.length };
}

/**
 * Which spawn this is: the number of children the parent already has. Not spawned_count: the
 * spawner and the auto_lineage trigger both add 1 per child, so it moves by 2 and every slot was
 * even (arm A only). A failed insert adds no child, so its slot is retried, not skipped.
 * parent_task_id has no index; a child is always newer than its parent, so id > parentId lets the
 * primary key bound the scan (0.1 ms vs a 164 ms full scan, measured on prod 2026-11-01).
 */
async function nextSlot(supabase, parentId) {
  const { count, error } = await supabase
    .from('trinity_tasks').select('id', { count: 'exact', head: true })
    .eq('parent_task_id', parentId).gt('id', parentId);
  if (error || typeof count !== 'number') return { error: `child count failed: ${(error && error.message) || 'no count'}` };
  return { slot: count };
}

/**
 * Which case a spawn asks. With an A/B experiment each case is asked twice, once per arm
 * (slots 2k and 2k+1), so the arms are compared on the same questions: a paired design.
 */
function caseIndex(parent, slot) {
  const meta = parent.metadata || {};
  return meta.ab && typeof meta.ab === 'object' ? Math.floor(slot / 2) : slot;
}

/** The child's description and the metadata the grader needs. */
function fillChild(parent, picked, index) {
  const meta = parent.metadata || {};
  const ab = meta.ab && typeof meta.ab === 'object' ? meta.ab : null;
  const arm = ab ? (index % 2 === 0 ? 'A' : 'B') : null;
  const description = String(parent.description || '')
    .split('{{case_text}}').join(picked.text)
    .split('{{arm_instruction}}').join(arm ? String(ab[arm] || '') : '');
  return {
    description,
    metadata: {
      case_pool: meta.case_pool,
      case_id: picked.id,
      case_category: picked.category || null,
      ab_experiment: ab ? String(ab.name || 'unnamed') : null,
      ab_arm: arm,
    },
  };
}

/**
 * A child of a known-answer loop: it carries the case it asks, from a pool this module serves
 * (the same POOLS as pickCase, so a stray case_pool value elsewhere cannot skip the length rule).
 * Metadata may arrive as a string.
 */
function isKnownAnswerTask(task) {
  let m = task && task.metadata;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return false; } }
  return !!(m && POOLS.has(m.case_pool) && typeof m.case_id === 'string' && m.case_id);
}

/**
 * A known-answer reply: the JSON object in the output, with decision pass|veto|abstain, a
 * confidence from 0 to 1 and a non-empty reason. Code fences or a sentence around it are allowed.
 * Returns {decision, confidence, reason}, or {error} naming the first thing wrong, so a format
 * failure is a measured signal (which models cannot follow the format) instead of noise.
 */
function parseAnswer(output) {
  const m = String(output || '').match(/\{[\s\S]*\}/);
  if (!m) return { error: 'no_json' };
  let a;
  try { a = JSON.parse(m[0]); } catch { return { error: 'json_unparseable' }; }
  const decision = String((a && a.decision) || '').trim().toLowerCase();
  if (!['pass', 'veto', 'abstain'].includes(decision)) return { error: 'decision_invalid' };
  const confidence = typeof a.confidence === 'number' || typeof a.confidence === 'string' ? Number(a.confidence) : NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { error: 'confidence_invalid' };
  if (typeof a.reason !== 'string' || !a.reason.trim()) return { error: 'reason_missing' };
  return { decision, confidence, reason: a.reason.trim() };
}

/**
 * The reply to judge: the final message if it holds an answer, else the saved artifact's content
 * if that does. A model may put its JSON in the save_artifact call and end with an empty message
 * (mel on openai/gpt-oss-20b, task 435592).
 */
function chooseReply(output, artifactContent) {
  if (!parseAnswer(output).error) return output;
  if (artifactContent != null && !parseAnswer(artifactContent).error) return String(artifactContent);
  return output;
}

module.exports = { POOLS, isSealed, pickCase, nextSlot, caseIndex, fillChild, isKnownAnswerTask, parseAnswer, chooseReply };
