/**
 * TRINITY MCP SERVER (V4 UNIFIED)
 * 
 * Uses shared ConstitutionalAgentV4 core.
 */

require('dotenv').config();
const ConstitutionalAgent = require('./lib/ConstitutionalAgentV4');

const rawName = process.env.AGENT_NAME;
const agentName = rawName || 'trinity-orch';

console.log(`[BOOT] 🚀 AGENT_NAME: ${agentName} (Source: ${rawName ? 'Environment' : 'Default/Fallback'})`);

const agent = new ConstitutionalAgent({
  name: agentName
});

agent.start();
