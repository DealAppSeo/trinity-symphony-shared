/**
 * TRANSMISSION: VERITAS (V4 INJECTED)
 */
const ConstitutionalAgentV4 = require('./ConstitutionalAgentV4');

const agent = new ConstitutionalAgentV4({
  name: process.env.AGENT_NAME || 'VERITAS'
});

agent.start();
