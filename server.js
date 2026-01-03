/**
 * TRINITY MCP SERVER (V4 UNIFIED)
 * 
 * Uses shared ConstitutionalAgentV4 core.
 */

const ConstitutionalAgentV4 = require('./lib/ConstitutionalAgentV4');

const agent = new ConstitutionalAgentV4({
  name: process.env.AGENT_NAME || 'MCP_SERVER'
});

agent.start();
