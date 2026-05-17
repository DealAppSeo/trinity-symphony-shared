'use strict';

/**
 * Phase 2.10 — Service Contract Client (Option A cross-repo integration).
 *
 * Mirrors lib/substance-gate-client.js (Phase 2.8). The agent only knows its
 * name (trinity-*); it sends `agent_name` and the repid-engine endpoint
 * resolves it to the repid_agents UUID server-side (same pattern as the
 * substance-gate writer's getAgentUuid). 30s timeout (vs 2s for the gate)
 * because PCP runs up to 3 validator LLM calls + a judge call inside.
 * Graceful: never throws to the caller; loud error logging (Phase 2.9.4).
 */
const TIMEOUT_MS = 30000;

class ServiceContractClient {
  static async processOne(agentName) {
    const baseUrl = process.env.REPID_API_URL;
    const apiKey = process.env.REPID_API_KEY;
    if (!baseUrl || !apiKey) {
      console.warn('[ServiceContractClient] REPID_API_URL/REPID_API_KEY not set, skipping');
      return { processed: false };
    }

    const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/agent/process-contracts`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ agent_name: agentName }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        let body = '';
        try { body = (await resp.text()).slice(0, 200); } catch (_) { /* ignore */ }
        console.error(`[ServiceContractClient] non-2xx ${resp.status}: ${body}`);
        return { processed: false };
      }
      return await resp.json();
    } catch (e) {
      clearTimeout(timer);
      const reason = e && e.name === 'AbortError' ? 'timeout' : 'unreachable';
      console.error(`[ServiceContractClient] ${reason}:`, e && e.message, e && e.stack);
      return { processed: false };
    }
  }
}

module.exports = { ServiceContractClient };
