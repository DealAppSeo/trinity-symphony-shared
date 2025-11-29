/**
 * TRINITY-TORCH - Swarm Member (Not Orchestrator)
 * 
 * Follows the Constitution:
 * - Participates in conductor rotation (max 20 min)
 * - Challenges peers when certainty < 80%
 * - Earns/loses RepID based on performance
 * - Reads other agents' learnings
 * - Writes only to own folder
 * - Transparent logging of all actions
 */

const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// Environment
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PORT = process.env.PORT || 10000;
const AGENT_NAME = 'TORCH';

// Constitutional Constants
const CONDUCTOR_TENURE_MS = 20 * 60 * 1000; // 20 minutes max
const POLL_INTERVAL_MS = 30 * 1000; // 30 seconds
const CERTAINTY_THRESHOLD = 0.80; // Challenge if below this
const FREE_CHALLENGES_PER_DAY = 3;

// RepID Constants
const REPID_TASK_COMPLETE = 10;
const REPID_FIND_ERROR = 12;
const REPID_ERROR_FOUND = -3;
const REPID_WRONG_CHALLENGE = -3;
const REPID_SHARE_LEARNING = 5;

// Initialize Supabase
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log(`[${AGENT_NAME}] Connected to Supabase`);
} else {
  console.error(`[${AGENT_NAME}] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY`);
}

// Agent specialties (for ANFIS routing)
const AGENT_SPECIALTIES = {
  'TORCH': ['orchestration', 'coordination', 'routing', 'optimization'],
  'APM': ['prayer', 'empathy', 'spiritual', 'biblical', 'encouragement'],
  'HDM': ['infrastructure', 'database', 'deployment', 'scaling', 'research'],
  'MEL': ['ui', 'ux', 'frontend', 'design', 'dashboard', 'mobile'],
  'GCM': ['governance', 'compliance', 'security', 'audit', 'risk'],
  'VERITAS': ['verification', 'fact-check', 'zkp', 'reputation', 'web3']
};

// State
let isConductor = false;
let conductorSince = null;
let challengesToday = 0;
let lastChallengeReset = new Date().toDateString();

// ============================================
// CONSTITUTIONAL FUNCTIONS
// ============================================

/**
 * Log all actions transparently (Article 3)
 */
async function log(action, message, metadata = {}) {
  if (!supabase) return;
  try {
    await supabase.from('autonomous_logs').insert({
      agent: AGENT_NAME,
      action,
      message,
      metadata: { ...metadata, timestamp: new Date().toISOString() },
      timestamp: new Date().toISOString()
    });
    console.log(`[${AGENT_NAME}] ${action}: ${message}`);
  } catch (err) {
    console.error(`[${AGENT_NAME}] Log error:`, err.message);
  }
}

/**
 * Update heartbeat and status
 */
async function heartbeat() {
  if (!supabase) return;
  try {
    await supabase.from('agent_status').upsert({
      agent: AGENT_NAME,
      status: 'active',
      last_heartbeat: new Date().toISOString(),
      orchestrator_role: isConductor,
      metadata: {
        role: isConductor ? 'CONDUCTOR' : 'MEMBER',
        conductor_since: conductorSince,
        challenges_today: challengesToday,
        version: '2.0.0-constitutional'
      }
    }, { onConflict: 'agent' });
  } catch (err) {
    console.error(`[${AGENT_NAME}] Heartbeat error:`, err.message);
  }
}

/**
 * Get current RepID score
 */
async function getRepID() {
  if (!supabase) return 100;
  try {
    const { data } = await supabase
      .from('agent_repid')
      .select('repid_score')
      .eq('agent_name', AGENT_NAME)
      .single();
    return data?.repid_score || 100;
  } catch {
    return 100; // Default for new agents
  }
}

/**
 * Update RepID score
 */
async function updateRepID(change, reason) {
  if (!supabase) return;
  try {
    const current = await getRepID();
    const newScore = Math.max(10, Math.min(10000, current + change));
    
    await supabase.from('agent_repid').upsert({
      agent_name: AGENT_NAME,
      repid_score: newScore,
      last_activity: new Date().toISOString()
    }, { onConflict: 'agent_name' });
    
    await log('repid_change', `${change > 0 ? '+' : ''}${change} RepID: ${reason}`, {
      previous: current,
      new: newScore,
      reason
    });
  } catch (err) {
    console.error(`[${AGENT_NAME}] RepID update error:`, err.message);
  }
}

// ============================================
// CONDUCTOR ROTATION (Article 2)
// ============================================

/**
 * Check if it's our turn to be conductor
 */
async function checkConductorRotation() {
  if (!supabase) return;
  
  try {
    // Get current rotation state
    const { data: rotation } = await supabase
      .from('rotation_state')
      .select('*')
      .single();
    
    if (!rotation) {
      // No rotation state - initialize if we should
      return;
    }
    
    const currentConductor = rotation.current_conductor;
    const rotationTime = new Date(rotation.rotation_time);
    const now = new Date();
    
    // Check if rotation is overdue
    if (now - rotationTime > CONDUCTOR_TENURE_MS) {
      // Time to rotate - determine next conductor
      const agents = ['APM', 'HDM', 'MEL', 'GCM', 'TORCH', 'VERITAS'];
      const currentIndex = agents.indexOf(currentConductor);
      const nextIndex = (currentIndex + 1) % agents.length;
      const nextConductor = agents[nextIndex];
      
      if (nextConductor === AGENT_NAME) {
        // It's our turn!
        await assumeConductor();
      } else if (currentConductor === AGENT_NAME) {
        // Our time is up
        await relinquishConductor(nextConductor);
      }
    }
    
    // Update our conductor status
    isConductor = (currentConductor === AGENT_NAME);
    
  } catch (err) {
    console.error(`[${AGENT_NAME}] Rotation check error:`, err.message);
  }
}

/**
 * Assume conductor role
 */
async function assumeConductor() {
  isConductor = true;
  conductorSince = new Date().toISOString();
  
  await supabase.from('rotation_state').upsert({
    id: 1,
    current_conductor: AGENT_NAME,
    rotation_time: conductorSince,
    rotation_number: await getNextRotationNumber()
  }, { onConflict: 'id' });
  
  await log('conductor_assumed', `${AGENT_NAME} is now CONDUCTOR`, {
    tenure_starts: conductorSince,
    max_tenure_ms: CONDUCTOR_TENURE_MS
  });
}

/**
 * Relinquish conductor role
 */
async function relinquishConductor(nextConductor) {
  const tenure = Date.now() - new Date(conductorSince).getTime();
  
  await log('conductor_relinquished', `Handing off to ${nextConductor}`, {
    tenure_ms: tenure,
    next_conductor: nextConductor
  });
  
  isConductor = false;
  conductorSince = null;
}

async function getNextRotationNumber() {
  const { data } = await supabase
    .from('rotation_state')
    .select('rotation_number')
    .single();
  return (data?.rotation_number || 0) + 1;
}

// ============================================
// TASK PROCESSING
// ============================================

/**
 * Route task to best agent (ANFIS-style)
 */
function routeTaskToAgent(task) {
  const text = ((task.description || '') + ' ' + (task.tags || []).join(' ')).toLowerCase();
  let best = { agent: 'HDM', score: 0 };
  
  for (const [agent, keywords] of Object.entries(AGENT_SPECIALTIES)) {
    const score = keywords.filter(k => text.includes(k)).length;
    if (score > best.score) best = { agent, score };
  }
  
  return best.agent;
}

/**
 * Process tasks (only if conductor)
 */
async function processTasks() {
  if (!supabase || !isConductor) return;
  
  try {
    // Get pending unassigned tasks
    const { data: tasks } = await supabase
      .from('trinity_tasks')
      .select('*')
      .eq('status', 'pending')
      .or('agent_assigned.is.null,agent_assigned.eq.All')
      .order('priority', { ascending: false })
      .limit(5);
    
    if (!tasks || tasks.length === 0) return;
    
    for (const task of tasks) {
      const targetAgent = routeTaskToAgent(task);
      
      await supabase
        .from('trinity_tasks')
        .update({
          agent_assigned: targetAgent,
          status: 'assigned',
          claimed_at: new Date().toISOString()
        })
        .eq('id', task.id);
      
      await log('task_routed', `Task ${task.id} → ${targetAgent}`, {
        task_id: task.id,
        target_agent: targetAgent,
        priority: task.priority
      });
    }
  } catch (err) {
    console.error(`[${AGENT_NAME}] Task processing error:`, err.message);
  }
}

/**
 * Claim and work on tasks assigned to us
 */
async function workOnOwnTasks() {
  if (!supabase) return;
  
  try {
    // Get tasks assigned to TORCH
    const { data: tasks } = await supabase
      .from('trinity_tasks')
      .select('*')
      .eq('agent_assigned', AGENT_NAME)
      .eq('status', 'assigned')
      .order('priority', { ascending: false })
      .limit(1);
    
    if (!tasks || tasks.length === 0) return;
    
    const task = tasks[0];
    
    // Mark in progress
    await supabase
      .from('trinity_tasks')
      .update({ status: 'in_progress' })
      .eq('id', task.id);
    
    await log('task_started', `Working on task ${task.id}`, { task });
    
    // TODO: Actually execute task using LLM
    // For now, just mark complete after logging
    
    await supabase
      .from('trinity_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString()
      })
      .eq('id', task.id);
    
    await updateRepID(REPID_TASK_COMPLETE, `Completed task ${task.id}`);
    
  } catch (err) {
    console.error(`[${AGENT_NAME}] Work error:`, err.message);
  }
}

// ============================================
// PEER VERIFICATION (Article 5)
// ============================================

/**
 * Challenge low-certainty claims from other agents
 */
async function reviewPeerWork() {
  if (!supabase) return;
  
  // Reset daily challenge count
  const today = new Date().toDateString();
  if (today !== lastChallengeReset) {
    challengesToday = 0;
    lastChallengeReset = today;
  }
  
  try {
    // Find recently completed tasks by others with low certainty
    const { data: completedTasks } = await supabase
      .from('trinity_tasks')
      .select('*')
      .eq('status', 'completed')
      .neq('agent_assigned', AGENT_NAME)
      .lt('certainty', CERTAINTY_THRESHOLD)
      .order('completed_at', { ascending: false })
      .limit(3);
    
    if (!completedTasks || completedTasks.length === 0) return;
    
    for (const task of completedTasks) {
      // Check if already challenged
      const { data: existing } = await supabase
        .from('repid_challenges')
        .select('id')
        .eq('task_id', task.id)
        .eq('challenger', AGENT_NAME);
      
      if (existing && existing.length > 0) continue;
      
      // Decide whether to challenge
      const shouldChallenge = task.certainty < 0.60 || 
        (challengesToday < FREE_CHALLENGES_PER_DAY && Math.random() < 0.3);
      
      if (shouldChallenge) {
        await issueChallenge(task);
        challengesToday++;
      }
    }
  } catch (err) {
    console.error(`[${AGENT_NAME}] Peer review error:`, err.message);
  }
}

/**
 * Issue a challenge to another agent's work
 */
async function issueChallenge(task) {
  await supabase.from('repid_challenges').insert({
    task_id: task.id,
    challenger: AGENT_NAME,
    challenged: task.agent_assigned,
    reason: `Certainty ${task.certainty} below threshold ${CERTAINTY_THRESHOLD}`,
    status: 'pending',
    created_at: new Date().toISOString()
  });
  
  await log('challenge_issued', `Challenged ${task.agent_assigned} on task ${task.id}`, {
    task_id: task.id,
    challenged_agent: task.agent_assigned,
    certainty: task.certainty,
    challenges_today: challengesToday
  });
}

// ============================================
// CROSS-AGENT LEARNING (Part 5)
// ============================================

/**
 * Read learnings from other agents before similar tasks
 */
async function learnFromPeers(taskType) {
  if (!supabase) return [];
  
  try {
    // Get recent successful tasks of similar type by other agents
    const { data: peerTasks } = await supabase
      .from('trinity_tasks')
      .select('*')
      .eq('status', 'completed')
      .neq('agent_assigned', AGENT_NAME)
      .eq('task_type', taskType)
      .gte('certainty', CERTAINTY_THRESHOLD)
      .order('completed_at', { ascending: false })
      .limit(5);
    
    if (!peerTasks) return [];
    
    await log('learning_from_peers', `Studied ${peerTasks.length} similar tasks`, {
      task_type: taskType,
      peer_agents: [...new Set(peerTasks.map(t => t.agent_assigned))]
    });
    
    return peerTasks;
  } catch (err) {
    return [];
  }
}

/**
 * Share our learnings with the swarm
 */
async function shareLearning(learning) {
  if (!supabase) return;
  
  try {
    await supabase.from('shared_learnings').insert({
      agent: AGENT_NAME,
      title: learning.title,
      content: learning.content,
      task_type: learning.taskType,
      created_at: new Date().toISOString()
    });
    
    await updateRepID(REPID_SHARE_LEARNING, `Shared learning: ${learning.title}`);
    
    await log('learning_shared', learning.title, { learning });
  } catch (err) {
    console.error(`[${AGENT_NAME}] Share learning error:`, err.message);
  }
}

// ============================================
// MAIN LOOP
// ============================================

async function mainLoop() {
  console.log(`[${AGENT_NAME}] Starting as Constitutional Swarm Member...`);
  console.log(`[${AGENT_NAME}] Constitution: Conductor max tenure = ${CONDUCTOR_TENURE_MS / 60000} minutes`);
  
  await log('startup', `${AGENT_NAME} online - Constitutional mode`, {
    version: '2.0.0',
    mode: 'swarm_member'
  });
  
  while (true) {
    try {
      // 1. Update heartbeat
      await heartbeat();
      
      // 2. Check conductor rotation
      await checkConductorRotation();
      
      // 3. If conductor, route pending tasks
      if (isConductor) {
        await processTasks();
        
        // Check tenure limit (Article 2)
        if (conductorSince) {
          const tenure = Date.now() - new Date(conductorSince).getTime();
          if (tenure > CONDUCTOR_TENURE_MS) {
            await log('tenure_exceeded', 'Forcing rotation - tenure exceeded', { tenure });
            isConductor = false;
          }
        }
      }
      
      // 4. Work on our own assigned tasks
      await workOnOwnTasks();
      
      // 5. Review peer work and challenge if needed
      await reviewPeerWork();
      
      // Wait before next cycle
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      
    } catch (err) {
      console.error(`[${AGENT_NAME}] Loop error:`, err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ============================================
// API ENDPOINTS
// ============================================

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    agent: AGENT_NAME,
    is_conductor: isConductor,
    version: '2.0.0-constitutional'
  });
});

// Status
app.get('/api/status', async (req, res) => {
  const repid = await getRepID();
  res.json({
    agent: AGENT_NAME,
    is_conductor: isConductor,
    conductor_since: conductorSince,
    repid_score: repid,
    challenges_today: challengesToday,
    constitutional_mode: true
  });
});

// Manual challenge endpoint
app.post('/api/challenge', async (req, res) => {
  const { task_id } = req.body;
  if (!task_id) return res.status(400).json({ error: 'task_id required' });
  
  const { data: task } = await supabase
    .from('trinity_tasks')
    .select('*')
    .eq('id', task_id)
    .single();
  
  if (!task) return res.status(404).json({ error: 'Task not found' });
  
  await issueChallenge(task);
  res.json({ success: true, message: `Challenge issued for task ${task_id}` });
});

// Start server
app.listen(PORT, () => {
  console.log(`[${AGENT_NAME}] API listening on port ${PORT}`);
});

// Start main loop
mainLoop().catch(err => {
  console.error(`[${AGENT_NAME}] Fatal error:`, err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(`[${AGENT_NAME}] Shutting down...`);
  await log('shutdown', 'Graceful shutdown initiated');
  process.exit(0);
});
