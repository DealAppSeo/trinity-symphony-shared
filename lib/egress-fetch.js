'use strict';

/**
 * C2 — egressFetch(agentId, url, init): the one outbound path for the swarm toolbelt.
 * (HARNESS_ARCHITECTURE_SYNTHESIS 2026-10-16 §2; SECURITY_RUN §4 item 2.)
 *
 * Default-deny policy. A request passes only if:
 *   - it is https;
 *   - its host is a name, not an IP literal;
 *   - the host is exactly on EGRESS_ALLOWLIST (comma list). It is set per Railway
 *     service, and a service runs one agent, so this is the per-agent list;
 *   - it does not let fetch follow redirects. A redirect is a new request and must
 *     come back through here; the toolbelt follows redirects itself, with
 *     redirect:'manual'.
 * (The private-address check after DNS is the toolbelt's per-hop check. It moves in
 * here when egressFetch becomes process-wide.)
 *
 * The kill switch (C1, scope cap:egress) is checked first.
 *
 * EGRESS_DEFAULT_DENY=1 enforces: a denied request throws and nothing is sent.
 * Unset (the default) is shadow: the would-deny is logged with the host and the request
 * goes out unchanged. That log is what the per-agent allowlists get built from before
 * anyone turns enforcement on.
 *
 * The full URL is never logged. A query string is exactly where an injected agent would
 * put what it is trying to exfiltrate.
 */

const net = require('node:net');
const killSwitch = require('./kill-switch');

/** @returns {{host: string, reasons: string[]}} reasons is empty when the request may go out. */
function egressPolicy(url, init) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return { host: '(invalid)', reasons: ['not a valid URL'] };
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  const allow = (process.env.EGRESS_ALLOWLIST || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const reasons = [];
  if (u.protocol !== 'https:') reasons.push(`${u.protocol} is not https`);
  if (net.isIP(host)) reasons.push(`${host} is an IP literal`);
  else if (!allow.includes(host)) reasons.push(`${host} is not on EGRESS_ALLOWLIST`);
  if (!init || init.redirect !== 'manual') reasons.push('fetch would follow redirects unchecked');
  return { host, reasons };
}

async function egressFetch(agentId, url, init = {}) {
  const ks = await killSwitch.check('cap:egress');
  if (ks.halted) throw new Error(`HALTED: ${ks.reason}. Nothing was sent`);

  const { host, reasons } = egressPolicy(url, init);
  if (reasons.length) {
    const why = reasons.join('; ');
    if (process.env.EGRESS_DEFAULT_DENY === '1') {
      console.warn(`[egress] DENIED agent=${agentId} host=${host}: ${why}`);
      throw new Error(`EGRESS_DENIED: ${why}. Nothing was sent`);
    }
    console.warn(`[egress] SHADOW would-deny agent=${agentId} host=${host}: ${why}`);
  }
  return globalThis.fetch(url, init);
}

module.exports = { egressFetch, egressPolicy };
