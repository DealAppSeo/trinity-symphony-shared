'use strict';

/**
 * LLM_GATEWAY_FIRST — make the trinity-litellm gateway's free pool the FIRST hop
 * of ConstitutionalAgentV4.callLLM. Default OFF: with the flag unset this returns
 * no provider and callLLM behaves exactly as before.
 *
 * Env (the last two are already set on every T12 service):
 *   LLM_GATEWAY_FIRST=true    the canary switch — one Railway variable per agent
 *   LITELLM_URL               gateway base, e.g. https://trinity-litellm-production.up.railway.app
 *   LITELLM_MASTER_KEY        gateway key; missing => the hop is SKIPPED loudly, never faked
 *
 * The hop asks for a POOL name, never a provider/model string: `auto-coder` for
 * code tasks, `auto` for everything else. The pools live in trinity-ecosystem's
 * litellm.config.yaml; the gateway picks a live member and retries inside the pool.
 * Any gateway failure falls through to the engine proxy / direct providers.
 */

const CODER_HINTS = new Set(['code']);

/** @returns {{ provider: object|null, skip: string|null }} */
function gatewayHop(taskHint) {
  if (!(process.env.LLM_GATEWAY_FIRST === 'true')) return { provider: null, skip: null };
  const base = String(process.env.LITELLM_URL || '').replace(/\/+$/, '');
  if (!base) return { provider: null, skip: 'LITELLM_URL unset' };
  if (!process.env.LITELLM_MASTER_KEY) return { provider: null, skip: 'LITELLM_MASTER_KEY unset' };
  return {
    provider: {
      baseUrl: `${base}/v1/chat/completions`,
      envKey: 'LITELLM_MASTER_KEY',
      model: CODER_HINTS.has(taskHint) ? 'auto-coder' : 'auto',
    },
    skip: null,
  };
}

module.exports = { gatewayHop };
