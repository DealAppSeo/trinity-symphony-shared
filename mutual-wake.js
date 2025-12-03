/**
 * TRINITY SYMPHONY - MUTUAL WAKE PROTOCOL
 * Agents ping each other to stay awake
 */

const AGENTS = [
  { name: 'HDM', url: 'https://trinity-hdm-production.up.railway.app' },
  { name: 'APM', url: 'https://trinity-apm-production.up.railway.app' },
  { name: 'MEL', url: 'https://trinity-mel-production.up.railway.app' },
  { name: 'GCM', url: 'https://trinity-gcm-production.up.railway.app' },
  { name: 'VERITAS', url: 'https://trinity-veritas-production.up.railway.app' },
  { name: 'TORCH', url: 'https://trinity-torch-production.up.railway.app' },
  { name: 'W3C', url: 'https://trinity-w3c-production.up.railway.app' },
  { name: 'MCP', url: 'https://mcp-production-d0c6.up.railway.app' }
];

const PING_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function pingAgent(agent) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(`${agent.url}/health`, {
      signal: controller.signal
    });
    clearTimeout(timeout);
    
    if (response.ok) {
      console.log(`✅ ${agent.name} is awake`);
      return true;
    } else {
      console.log(`⚠️ ${agent.name} returned ${response.status}`);
      return false;
    }
  } catch (err) {
    console.log(`❌ ${agent.name} unreachable: ${err.message}`);
    return false;
  }
}

async function mutualWakeCycle() {
  const myName = process.env.AGENT_NAME || 'UNKNOWN';
  console.log(`[${myName}] 🔔 Running mutual wake cycle...`);
  
  // Pick 3 random agents to ping (not myself)
  const others = AGENTS.filter(a => a.name !== myName);
  const toPing = others.sort(() => Math.random() - 0.5).slice(0, 3);
  
  let awakeCount = 0;
  for (const agent of toPing) {
    const isAwake = await pingAgent(agent);
    if (isAwake) awakeCount++;
  }
  
  console.log(`[${myName}] 📊 Wake check: ${awakeCount}/${toPing.length} agents responding`);
}

function startMutualWakeLoop() {
  const myName = process.env.AGENT_NAME || 'UNKNOWN';
  console.log(`[${myName}] 🚀 Starting mutual wake loop (every 5 min)`);
  
  // Run immediately
  setTimeout(() => mutualWakeCycle(), 10000);
  
  // Then every 5 minutes
  setInterval(() => mutualWakeCycle(), PING_INTERVAL);
}

module.exports = { startMutualWakeLoop, pingAgent, AGENTS };
