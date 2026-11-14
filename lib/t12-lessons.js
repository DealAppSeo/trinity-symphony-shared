'use strict';
/**
 * T12 LESSONS: an optional system message (lessons/t12-lessons.md) for a controlled A/B on
 * known-answer accuracy. Default off, and off sends exactly what was sent before.
 *
 * T12_LESSONS_MODE   off (default; unset, empty or unknown = off, an unknown value is logged once)
 *                    | ab  (only agents named in T12_LESSONS_AGENTS get the lessons)
 *                    | all (every agent does)
 * T12_LESSONS_AGENTS comma-separated agent names: trinity-hdm, hdm and HDM all name the same agent.
 *
 * forAgent(name) -> { system, meta }. system is the lessons text or null. meta goes into the task's
 * result metadata so the A/B can be read from the database: {} when off (nothing new is written),
 * else { lessons_arm: 'with', lessons_sha256_prefix } or { lessons_arm: 'without' }. The prefix is
 * the sha256 of the text as sent (CRLF folded to LF), so it is the same on every checkout.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'lessons', 't12-lessons.md');
let lessons;          // undefined until first read; null if the file cannot be read
let warnedUnknown = false;

function mode(env) {
  const v = String(env.T12_LESSONS_MODE || '').trim().toLowerCase();
  if (v === 'ab' || v === 'all') return v;
  if (v && v !== 'off' && !warnedUnknown) {
    warnedUnknown = true;
    console.warn(`[LESSONS] T12_LESSONS_MODE="${env.T12_LESSONS_MODE}" is not off|ab|all; treated as off (no lessons sent, nothing recorded)`);
  }
  return 'off';
}

function read() {
  if (lessons === undefined) {
    try {
      const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n').trim();
      lessons = { text, sha: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12) };
    } catch (e) {
      // Fail loud, record the truth: a task that got no lessons says 'without', never 'with'.
      lessons = null;
      console.error(`[LESSONS] cannot read ${FILE} (${e.message}); no lessons sent, tasks record lessons_arm 'without'`);
    }
  }
  return lessons;
}

const norm = (n) => {
  const s = String(n || '').trim().toLowerCase();
  return s && !s.startsWith('trinity-') ? `trinity-${s}` : s;
};

function forAgent(name, env = process.env) {
  const m = mode(env);
  if (m === 'off') return { system: null, meta: {} };
  const listed = String(env.T12_LESSONS_AGENTS || '').split(',').map(norm).filter(Boolean);
  const l = m === 'all' || listed.includes(norm(name)) ? read() : null;
  return l
    ? { system: l.text, meta: { lessons_arm: 'with', lessons_sha256_prefix: l.sha } }
    : { system: null, meta: { lessons_arm: 'without' } };
}

function _resetForTest() { lessons = undefined; warnedUnknown = false; }

module.exports = { forAgent, _resetForTest };
