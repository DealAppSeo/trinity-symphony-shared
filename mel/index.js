/**
 * TRANSMISSION: MEL (V4 INJECTED)
 */
// EGRESS FOOTGUN FIX (2026-06-26, CC): point at the SINGLE SOURCE in lib/ (atomic-claim
// poll, PR #27) instead of the stale local SELECT* copy that still burned egress.
const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

const rawName = process.env.AGENT_NAME;
const agentName = rawName || 'trinity-mel';

console.log(`[BOOT] 🚀 AGENT_NAME: ${agentName} (Source: ${rawName ? 'Environment' : 'Default/Fallback'})`);

const agent = new ConstitutionalAgentV4({
  name: agentName
});

agent.start();
