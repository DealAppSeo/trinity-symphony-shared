/**
 * SUBSTANCE GATE CLIENT (Phase 2.8 — wire the swarm through HAL)
 *
 * Posts a client-computed FastPathResult to repid-engine's recording
 * endpoint:  POST {REPID_API_URL}/api/v1/substance-gate/events
 *
 * The endpoint does NOT evaluate substance — it RECORDS a pre-computed
 * FastPathResult (4 signals: chars / wrapper / artifact / noop), runs the
 * audit chain, and on PASS + T2a+ tier inserts a validation_queue row.
 * Slash is server-side and skipped whenever shadow_mode === true.
 *
 * This module owns the mapping from ConstitutionalAgentV4.validateSubstance()'s
 * { ok, reason } shape into the endpoint's FastPathResult schema, plus the
 * HTTP client with a 2s timeout and graceful degradation (never throws,
 * never crashes the agent — an unreachable gate defaults to PASS and logs).
 *
 * Env (set as AITrinitySymphony shared variables, Phase 2.8):
 *   REPID_API_URL   e.g. http://repid-engine.railway.internal:3000
 *   REPID_API_KEY   one key from repid-engine's REPID_API_KEYS set
 *   HAL_MIN_SUBSTANCE_CHARS  optional; mirrors validateSubstance (default 200)
 */

'use strict';

const crypto = require('crypto');

const TIMEOUT_MS = 2000;
const DEFAULT_MIN_CHARS = 200;
const RESULT_CAP = 2000; // endpoint only stores a 500-char excerpt; cap payload

// Mirror of the checks inside ConstitutionalAgentV4.validateSubstance() so the
// 4-signal FastPathResult reflects the same evidence the gate decision used.
const PLACEHOLDER_REGEX = /\[insert\s|\[INSERT\s|\[TODO|\[PLACEHOLDER|\[FILL_IN|\{\{|\}\}|<placeholder/i;

/**
 * Map validateSubstance()'s { ok, reason } + raw output into the endpoint's
 * FastPathResult. composite_score is the fraction of signals that passed.
 */
function buildFastPathResult(output, substanceGate) {
  const text = String(output || '');
  const stripped = text
    .replace(/^#+.*$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .trim();
  const minLen = parseInt(process.env.HAL_MIN_SUBSTANCE_CHARS || String(DEFAULT_MIN_CHARS), 10);

  const ok = !!(substanceGate && substanceGate.ok);
  const reason = ok ? null : ((substanceGate && substanceGate.reason) || 'substance_gate_failed');

  const charsPassed = stripped.length >= minLen;
  const wrapperPassed =
    !PLACEHOLDER_REGEX.test(text) &&
    !(reason && reason.startsWith('template_placeholder_detected'));
  const artifactPassed = reason !== 'artifact_missing_or_empty';
  const noopPassed = !(reason && reason.startsWith('success_criteria_unmet'));

  const signals = {
    chars: { passed: charsPassed, value: stripped.length },
    wrapper: { passed: wrapperPassed },
    artifact: { passed: artifactPassed },
    noop: { passed: noopPassed },
  };
  const signalPassCount = [charsPassed, wrapperPassed, artifactPassed, noopPassed].filter(Boolean).length;

  return {
    passed: ok,
    failures: ok ? [] : [reason],
    composite_score: Number((signalPassCount / 4).toFixed(4)),
    signals,
  };
}

/**
 * Record a substance gate event. Never throws. Returns a normalized result:
 *   { recorded, gateEventId?, passed, reason, fastResult, degraded?, degradeReason? }
 * degraded === true means the event was NOT recorded server-side and the
 * caller must default to PASS (graceful degradation — caveat 4).
 */
async function recordEvent({ task, output, substanceGate, agentName }) {
  const fastResult = buildFastPathResult(output, substanceGate);
  const baseResult = {
    passed: fastResult.passed,
    reason: fastResult.failures[0] || null,
    fastResult,
  };

  const baseUrl = process.env.REPID_API_URL;
  const apiKey = process.env.REPID_API_KEY;
  if (!baseUrl) {
    return { ...baseResult, recorded: false, degraded: true, degradeReason: 'env_not_configured' };
  }

  const slimTask = {
    id: task && task.id,
    result: String(output || '').slice(0, RESULT_CAP),
    metadata: (task && task.metadata) || {},
  };
  const payload = {
    task: slimTask,
    fastResult,
    agentName,
    contentHash: crypto.createHash('sha256').update(String(output || '')).digest('hex'),
    shadow_mode: true, // Phase 2.8: slash flags at 0 — server skips RepID slash
  };

  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/substance-gate/events`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      let bodyTxt = '';
      try { bodyTxt = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
      return {
        ...baseResult,
        recorded: false,
        degraded: true,
        degradeReason: `gate_http_${resp.status}`,
        httpBody: bodyTxt,
      };
    }

    let json = {};
    try { json = await resp.json(); } catch (_) { /* ignore */ }
    const recorded = !!(json && json.success === true && json.gateEventId);
    if (!recorded) {
      return { ...baseResult, recorded: false, degraded: true, degradeReason: 'gate_no_event_id' };
    }
    return { ...baseResult, recorded: true, gateEventId: json.gateEventId };
  } catch (e) {
    clearTimeout(timer);
    const degradeReason = e && e.name === 'AbortError' ? 'gate_timeout' : 'gate_unreachable';
    return { ...baseResult, recorded: false, degraded: true, degradeReason, error: e && e.message };
  }
}

module.exports = { recordEvent, buildFastPathResult, TIMEOUT_MS };
