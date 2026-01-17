/**
 * TRINITY MCP SERVER (V4 UNIFIED)
 * 
 * Uses shared ConstitutionalAgentV4 core.
 */

require('dotenv').config();
const { ConstitutionalAgent } = require('@trinity/agent-core');

const agent = new ConstitutionalAgent({
  name: process.env.AGENT_NAME || 'MCP_SERVER'
});

agent.startTrinityHealingLoop();
