"use strict";
const fetch = require('node-fetch');

async function postSubstanceGateEvent(payload) {
  const engineUrl = process.env.REPID_API_URL || process.env.REPID_ENGINE_URL || 'http://repid-engine.railway.internal:3001';
  const url = `${engineUrl.replace(/\/+$/, '')}/api/v1/substance-gate/events`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[SubstanceGateClient] HTTP Error ${res.status}:`, text);
      return { success: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[SubstanceGateClient] Request failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  postSubstanceGateEvent
};
