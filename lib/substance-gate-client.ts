import fetch from 'node-fetch';

export async function postSubstanceGateEvent(payload: any) {
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
      signal: controller.signal as any
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      console.error(`[SubstanceGateClient] HTTP Error ${res.status}:`, text);
      return { success: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error('[SubstanceGateClient] Request failed:', err.message);
    return { success: false, error: err.message };
  }
}
