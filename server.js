/**
 * TRINITY MCP SERVER (V4 UNIFIED)
 * 
 * Uses shared ConstitutionalAgentV4 core.
 */

require('dotenv').config();
const ConstitutionalAgent = require('./lib/ConstitutionalAgentV4');

const agent = new ConstitutionalAgent({
  name: process.env.AGENT_NAME || 'trinity-orch'
});

agent.start();
