// mutual-wake.js - Peer-to-Peer Agent Keep-Alive Protocol
// Updated: 2025-11-29 with correct Render URLs
// Each agent pings others to prevent Render free tier sleep

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// CORRECT URLs as of 2025-11-29
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

const AGENT_NAME = process.env.AGENT_NAME || 'UNKNOWN';
const WAKE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get this agent's index in the swarm
 */
function getAgentIndex() {
  return AGENTS.findIndex(a => a.name === AGENT_NAME);
}

/**
 * Determine which agents to ping based on rotating formula
 * Each agent pings 2 others, rotating over time
 */
function getBuddiesToPing() {
  const myIndex = getAgentIndex();
  if (myIndex === -1) {
    console.log(`[${AGENT_NAME}] Warning: Agent not found in AGENTS list`);
    return AGENTS.filter(a => a.name !== AGENT_NAME).slice(0, 2);
  }
  
  const totalAgents = AGENTS.length;
  const timeSlot = Math.floor(Date.now() / WAKE_INTERVAL_MS);
  
  // Primary buddy: next agent in circle
  const buddy1Index = (myIndex + 1) % totalAgents;
  
  // Secondary buddy: rotates based on time
  const buddy2Index = (myIndex + 2 + (timeSlot % 3)) % totalAgents;
  
  // Avoid pinging self
  const buddies = [AGENTS[buddy1Index]];
  if (buddy2Index !== myIndex && buddy2Index !== buddy1Index) {
    buddies.push(AGENTS[buddy2Index]);
  }
  
  return buddies;
}

/**
 * Ping another agent to wake them up
 */
async function pingAgent(agent) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    const response = await fetch(`${agent.url}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    const isAwake = response.ok;
    
    console.log(`[${AGENT_NAME}] Pinged ${agent.name}: ${isAwake ? '🟢 Awake' : '🔴 No response'}`);
    
    // Log the ping to Supabase for monitoring
    await supabase.from('agent_messages').insert({
      agent_name: AGENT_NAME,
      message: JSON.stringify({
        type: 'peer_ping',
        target: agent.name,
        target_url: agent.url,
        success: isAwake,
        timestamp: new Date().toISOString()
      })
    }).catch(err => console.log(`[${AGENT_NAME}] Failed to log ping:`, err.message));
    
    return isAwake;
  } catch (error) {
    console.log(`[${AGENT_NAME}] Failed to ping ${agent.name}: ${error.message}`);
    
    // Log failed ping
    await supabase.from('agent_messages').insert({
      agent_name: AGENT_NAME,
      message: JSON.stringify({
        type: 'peer_ping_failed',
        target: agent.name,
        target_url: agent.url,
        error: error.message,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {}); // Silently fail if logging fails
    
    return false;
  }
}

/**
 * Update own heartbeat in Supabase
 */
async function updateHeartbeat() {
  try {
    const { error } = await supabase
      .from('agent_repid')
      .update({ last_activity: new Date().toISOString() })
      .eq('agent_name', AGENT_NAME);
    
    if (error) {
      console.error(`[${AGENT_NAME}] Heartbeat update failed:`, error.message);
    } else {
      console.log(`[${AGENT_NAME}] 💓 Heartbeat updated`);
    }
  } catch (error) {
    console.error(`[${AGENT_NAME}] Heartbeat error:`, error.message);
  }
}

/**
 * Main wake protocol - call this every 5 minutes
 */
async function mutualWakeProtocol() {
  console.log(`[${AGENT_NAME}] 🔄 Running mutual wake protocol...`);
  
  // 1. Update own heartbeat first
  await updateHeartbeat();
  
  // 2. Get buddies to ping
  const buddies = getBuddiesToPing();
  console.log(`[${AGENT_NAME}] Pinging buddies: ${buddies.map(b => b.name).join(', ')}`);
  
  // 3. Ping each buddy
  const results = await Promise.all(buddies.map(pingAgent));
  
  // 4. If any buddy is down, try to wake more agents (escalation)
  const downCount = results.filter(r => !r).length;
  if (downCount > 0) {
    console.log(`[${AGENT_NAME}] ⚠️ ${downCount} buddies unresponsive - escalating`);
    
    // Ping 2 more random agents as backup
    const otherAgents = AGENTS.filter(a => 
      a.name !== AGENT_NAME && 
      !buddies.find(b => b.name === a.name)
    );
    
    const backups = otherAgents
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    
    await Promise.all(backups.map(pingAgent));
  }
  
  console.log(`[${AGENT_NAME}] ✅ Wake protocol complete`);
}

/**
 * Start the wake loop - call this when agent starts
 */
function startMutualWakeLoop() {
  console.log(`[${AGENT_NAME}] 🚀 Starting mutual wake loop (every ${WAKE_INTERVAL_MS / 1000}s)`);
  console.log(`[${AGENT_NAME}] Known agents: ${AGENTS.map(a => a.name).join(', ')}`);
  
  // Run immediately on start
  mutualWakeProtocol();
  
  // Then run every 5 minutes
  setInterval(mutualWakeProtocol, WAKE_INTERVAL_MS);
}

// Export for use in agent main file
module.exports = {
  startMutualWakeLoop,
  mutualWakeProtocol,
  pingAgent,
  updateHeartbeat,
  getBuddiesToPing,
  AGENTS
};

// If run directly, start the loop
if (require.main === module) {
  startMutualWakeLoop();
}
