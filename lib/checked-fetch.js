'use strict';

/**
 * checkedFetch(url, init, hosts): a fetch that can only reach the hostnames in `hosts`.
 *
 * Every hop is checked: the URL given and each redirect target. A hop must
 *   - be https;
 *   - name a host exactly on `hosts` (case and trailing dot normalised);
 *   - not be an IP literal;
 *   - not resolve to a private, loopback, CGNAT, link-local (169.254.169.254 is
 *     cloud metadata), multicast or reserved address.
 * Redirects are followed by hand (redirect:'manual') and re-checked. A 4th is refused.
 * A refused hop throws `REFUSED: ...` before anything is sent to it. Network errors
 * throw as fetch's do. On success it returns the final Response.
 *
 * Follow-up (dedupe): PR #87 carries the same rule as hopRefusal() inside
 * lib/swarm-toolbelt.js. That branch is unmerged and the function is unexported, so it
 * cannot be shared without stacking. Once both land, point the toolbelt at this module.
 */

const net = require('node:net');
const dns = require('node:dns');

// BlockList checks IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 rules itself.
const PRIVATE = new net.BlockList();
for (const [a, p] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(a, p, 'ipv6');

const MAX_REDIRECTS = 3;

async function assertHopAllowed(url, hosts) {
  if (url.protocol !== 'https:') throw new Error(`REFUSED: ${url.protocol}// is not https (${url.host})`);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (net.isIP(host)) throw new Error(`REFUSED: ${host} is an IP literal`);
  if (!hosts.includes(host)) throw new Error(`REFUSED: ${host} is not on the allowlist (${hosts.join(', ')})`);
  // ponytail: DNS rebinding. The name is resolved and checked here, then fetch resolves it
  // AGAIN to connect, so a resolver that answers public now and 169.254.169.254 a moment
  // later passes the check. The ceiling holds while the allowlist names only our own
  // hosts. Upgrade path: resolve once, then connect to the checked IP (an undici Agent
  // with connect.lookup pinned to that address, and the original name kept for SNI/Host).
  const addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  const bad = addrs.find((a) => PRIVATE.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
  if (bad) throw new Error(`REFUSED: ${host} resolves to the private or link-local address ${bad.address}`);
}

async function checkedFetch(rawUrl, init = {}, hosts = []) {
  let url = new URL(String(rawUrl));
  for (let hop = 0; ; hop++) {
    await assertHopAllowed(url, hosts);
    const res = await fetch(url.toString(), { ...init, redirect: 'manual' });
    const location = res.status >= 300 && res.status < 400 && res.headers ? res.headers.get('location') : null;
    if (!location) return res;
    if (res.body) res.body.cancel().catch(() => {});
    if (hop === MAX_REDIRECTS) throw new Error(`REFUSED: more than ${MAX_REDIRECTS} redirects from ${rawUrl}`);
    url = new URL(location, url);
  }
}

module.exports = { checkedFetch, MAX_REDIRECTS };
