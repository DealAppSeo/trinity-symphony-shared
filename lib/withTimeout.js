'use strict';

/**
 * Sprint 14 R-1 — withTimeout utility.
 *
 * Wraps any promise with a hard timeout. If the underlying promise doesn't
 * settle within `timeoutMs`, rejects with a TimeoutError so the agent's
 * existing loop catch can handle it (log + sleep + continue).
 *
 * Background (Sprint 13 diagnosis): the deployed runLoop has zero timeout
 * primitives on Supabase/LLM awaits. A single never-resolving await freezes
 * the loop forever — no throw, no rejection, no exit, while the heartbeat
 * setInterval keeps writing `online`. Wrapping every loop-body await with
 * this helper converts a permanent silent hang into a logged, self-healing
 * error caught by the existing loop catch.
 *
 * Properties:
 *  - resolves when the wrapped promise wins
 *  - rejects with `Error('Timeout after Xms: <label>')` when the timer wins
 *  - `.name = 'TimeoutError'` on timeout rejections (for catch filtering)
 *  - clears the timer in both win paths and on caller cancellation
 *  - never throws synchronously; safe to await directly
 *
 * @param {Promise<T>} promise        the async operation to wrap
 * @param {number}     timeoutMs      timeout in milliseconds (positive integer)
 * @param {string}     label          human-readable label for error messages
 * @returns {Promise<T>}              the wrapped promise
 */
async function withTimeout(promise, timeoutMs, label) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    // Defensive: a misconfigured zero/negative would defeat the purpose;
    // fall back to a 30s safety net rather than waiting forever.
    timeoutMs = 30000;
  }
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(`Timeout after ${timeoutMs}ms: ${label}`);
      err.name = 'TimeoutError';
      err.timeoutMs = timeoutMs;
      err.label = label;
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

module.exports = { withTimeout };
