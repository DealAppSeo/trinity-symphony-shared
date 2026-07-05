'use strict';

/**
 * ENGINE_LLM_PROXY — thin client for repid-engine POST /api/v1/llm/complete.
 *
 * When ENGINE_LLM_PROXY=true, ConstitutionalAgentV4.callLLM routes here first so
 * ANFIS + llm_call_log + cost caps apply. Direct provider keys remain the fallback.
 *
 * Env:
 *   ENGINE_LLM_PROXY=true|false   (default off — direct providers)
 *   REPID_API_URL / ENGINE_URL    engine base (no trailing slash)
 *   REPID_API_KEY                 agent-scoped key with llm_complete scope
 */

const { randomUUID, createHash } = require('node:crypto');

function engineBaseUrl() {
  const raw = process.env.REPID_API_URL || process.env.ENGINE_URL || '';
  return String(raw).replace(/\/+$/, '');
}

function isProxyEnabled() {
  return process.env.ENGINE_LLM_PROXY === 'true';
}

function canUseProxy() {
  return isProxyEnabled() && !!engineBaseUrl() && !!process.env.REPID_API_KEY;
}

/**
 * @param {object} opts
 * @param {string} opts.agentName  e.g. trinity-mel
 * @param {string} opts.prompt
 * @param {string} [opts.taskHint]
 * @param {string} [opts.tierPreference]
 * @param {string} [opts.idempotencyKey]
 * @returns {Promise<{ output: string, provider: string, tier?: number, tokens_in?: number, tokens_out?: number, cost_estimate_usd?: number, engine_proxy: true }>}
 */
async function callEngineComplete(opts) {
  const base = engineBaseUrl();
  const apiKey = process.env.REPID_API_KEY;
  if (!base) throw new Error('REPID_API_URL/ENGINE_URL unset');
  if (!apiKey) throw new Error('REPID_API_KEY unset');

  const {
    agentName,
    prompt,
    taskHint = 'agent',
    tierPreference = 'auto',
    idempotencyKey = randomUUID(),
  } = opts || {};

  if (!agentName || !prompt) throw new Error('agentName and prompt required');

  const url = `${base}/api/v1/llm/complete`;
  const body = {
    prompt: String(prompt),
    agent_id: agentName,
    tier_preference: tierPreference,
    task_hint: taskHint,
    idempotency_key: idempotencyKey,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`engine non-JSON ${res.status}: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`engine ${res.status}: ${data.error || data.message || text.slice(0, 200)}`);
  }

  const answer = data.answer ?? data.output ?? '';
  if (!answer) throw new Error('engine returned empty answer');

  return {
    output: String(answer),
    provider: data.provider || 'engine',
    tier: data.tier,
    tokens_in: data.tokens_in,
    tokens_out: data.tokens_out,
    cost_estimate_usd: data.cost_estimate_usd,
    engine_proxy: true,
    idempotency_key: idempotencyKey,
    prompt_sha256: createHash('sha256').update(String(prompt)).digest('hex'),
  };
}

module.exports = {
  callEngineComplete,
  canUseProxy,
  isProxyEnabled,
  engineBaseUrl,
};