/**
 * TRANSMISSION: GCM (V4 UNIFIED)
 */
const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

const agent = new ConstitutionalAgentV4({
  name: process.env.AGENT_NAME || 'GCM'
});

agent.start();
