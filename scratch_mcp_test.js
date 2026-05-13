require('dotenv').config();
const ConstitutionalAgent = require('./lib/ConstitutionalAgentV4');

async function test() {
  const agent = new ConstitutionalAgent({ name: 'trinity-shofet-local' });
  console.log("Calling MCP Tool...");
  try {
    const res = await agent.callMcpTool('web_search', 'search', { query: 'Trinity Symphony MCP Gateway Test' });
    console.log("Success:", res);
  } catch (e) {
    console.error("Failed:", e.message);
  }
}
test();
