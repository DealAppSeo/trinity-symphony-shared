/**
 * TRANSMISSION: HDM (V4 INJECTED)
 */
const ConstitutionalAgentV4 = require('./ConstitutionalAgentV4');

const rawName = process.env.AGENT_NAME;
const agentName = rawName || 'trinity-hdm';

console.log(`[BOOT] 🚀 AGENT_NAME: ${agentName} (Source: ${rawName ? 'Environment' : 'Default/Fallback'})`);

const agent = new ConstitutionalAgentV4({
  name: agentName
});

agent.start();
