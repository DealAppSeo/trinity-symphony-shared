/**
 * TRINITY SYMPHONY - UNIVERSAL CONSTITUTIONAL AGENT
 * 
 * This single file works for ANY agent.
 * Just set AGENT_NAME and AGENT_SPECIALTIES at the top.
 * 
 * Deploy the same file to each agent folder, changing only the config.
 */

const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const express = require('express');

// ============================================
// AGENT CONFIGURATION - CHANGE THIS PER AGENT
// ============================================

const AGENT_CONFIG = {
  APM: { name: 'APM', specialties: ['prayer', 'empathy', 'encouragement', 'spiritual', 'biblical'] },
  HDM: { name: 'HDM', specialties: ['infrastructure', 'database', 'deployment', 'scaling', 'research'] },
  MEL: { name: 'MEL', specialties: ['ui', 'ux', 'frontend', 'design', 'dashboard', 'mobile'] },
  GCM: { name: 'GCM', specialties: ['governance', 'compliance', 'security', 'audit', 'risk'] },
  TORCH: { name: 'TORCH', specialties: ['orchestration', 'coordination', 'routing', 'optimization'] },
  VERITAS: { name: 'VERITAS', specialties: ['verification', 'fact-check', 'zkp', 'reputation', 'web3'] }
};

// Auto-detect agent from folder name or env var
const AGENT_NAME = process.env.AGENT_NAME ||
  (process.cwd().includes('/apm') ? 'APM' :
    process.cwd().includes('/hdm') ? 'HDM' :
      process.cwd().includes('/mel') ? 'MEL' :
        process.cwd().includes('/gcm') ? 'GCM' :
          process.cwd().includes('/torch') ? 'TORCH' :
            process.cwd().includes('/veritas') ? 'VERITAS' : 'HDM');

const CONFIG = AGENT_CONFIG[AGENT_NAME] || AGENT_CONFIG.HDM;

// ============================================
// ENVIRONMENT & CONSTANTS
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PORT = process.env.PORT || 10000;

const CONDUCTOR_TENURE_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const CERTAINTY_THRESHOLD = 0.80;
const FREE_CHALLENGES_PER_DAY = 3;

const ALL_SPECIALTIES = {
  'APM': ['prayer', 'empathy', 'encouragement', 'spiritual', 'biblical'],
  'HDM': ['infrastructure', 'database', 'deployment', 'scaling', 'research'],
  'MEL': ['ui', 'ux', 'frontend', 'design', 'dashboard', 'mobile'],
  'GCM': ['governance', 'compliance', 'security', 'audit', 'risk'],
  'TORCH': ['orchestration', 'coordination', 'routing', 'optimization'],
  'VERITAS': ['verification', 'fact-check', 'zkp', 'reputation', 'web3']
};

const ROTATION_ORDER = ['APM', 'HDM', 'MEL', 'GCM', 'TORCH', 'VERITAS'];

// ============================================
// INITIALIZE
// ============================================

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { realtime: { transport: WebSocket } });

  console.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');
  console.log(`[${CONFIG.name}] Connected to Supabase`);
} else {
  console.error(`[${CONFIG.name}] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY`);
}

let isConductor = false;
let conductorSince = null;
let challengesToday = 0;
let lastChallengeReset = new Date().toDateString();

// ============================================
// CORE FUNCTIONS
// ============================================

async function log(action, message, metadata = {}) {
  if (!supabase) return;
  try {
    await supabase.from('autonomous_logs').insert({
      agent: CONFIG.name, action, message,
      metadata: { ...metadata, timestamp: new Date().toISOString() },
      timestamp: new Date().toISOString()
    });
    console.log(`[${CONFIG.name}] ${action}: ${message}`);
  } catch (err) {
    console.error(`[${CONFIG.name}] Log error:`, err.message);
  }
}

async function heartbeat() {
  if (!supabase) return;
  try {
    await supabase.from('agent_status').upsert({
      agent: CONFIG.name,
      status: 'active',
      last_heartbeat: new Date().toISOString(),
      orchestrator_role: isConductor,
      metadata: {
        role: isConductor ? 'CONDUCTOR' : 'MEMBER',
        specialties: CONFIG.specialties,
        version: '2.0.0-constitutional'
      }
    }, { onConflict: 'agent' });
  } catch (err) {
    console.error(`[${CONFIG.name}] Heartbeat error:`, err.message);
  }
}

async function getRepID() {
  if (!supabase) return 100;
  try {
    const { data } = await supabase.from('agent_repid').select('repid_score').eq('agent_name', CONFIG.name).single();
    return data?.repid_score || 100;
  } catch { return 100; }
}

async function updateRepID(change, reason) {
  if (!supabase) return;
  try {
    const current = await getRepID();
    const newScore = Math.max(10, Math.min(10000, current + change));
    await supabase.from('agent_repid').upsert({
      agent_name: CONFIG.name, repid_score: newScore, last_activity: new Date().toISOString()
    }, { onConflict: 'agent_name' });
    await log('repid_change', `${change > 0 ? '+' : ''}${change} RepID: ${reason}`);
  } catch (err) {
    console.error(`[${CONFIG.name}] RepID error:`, err.message);
  }
}

// ============================================
// CONDUCTOR ROTATION
// ============================================

async function checkRotation() {
  if (!supabase) return;
  try {
    const { data: rotation } = await supabase.from('rotation_state').select('*').single();
    if (!rotation) return;

    const elapsed = Date.now() - new Date(rotation.rotation_time).getTime();

    if (elapsed > CONDUCTOR_TENURE_MS) {
      const currentIndex = ROTATION_ORDER.indexOf(rotation.current_conductor);
      const nextConductor = ROTATION_ORDER[(currentIndex + 1) % ROTATION_ORDER.length];

      if (nextConductor === CONFIG.name) {
        await assumeConductor(rotation.rotation_number + 1);
      }
    }

    isConductor = (rotation.current_conductor === CONFIG.name);
    if (isConductor && !conductorSince) {
      conductorSince = rotation.rotation_time;
    } else if (!isConductor) {
      conductorSince = null;
    }
  } catch (err) {
    console.error(`[${CONFIG.name}] Rotation error:`, err.message);
  }
}

async function assumeConductor(rotationNumber) {
  isConductor = true;
  conductorSince = new Date().toISOString();
  await supabase.from('rotation_state').upsert({
    id: 1, current_conductor: CONFIG.name, rotation_time: conductorSince, rotation_number: rotationNumber
  }, { onConflict: 'id' });
  await log('conductor_assumed', `${CONFIG.name} is now CONDUCTOR`);
}

// ============================================
// TASK ROUTING (Conductor only)
// ============================================

function routeTaskToAgent(task) {
  const text = ((task.description || '') + ' ' + (task.tags || []).join(' ')).toLowerCase();
  let best = { agent: 'HDM', score: 0 };

  for (const [agent, keywords] of Object.entries(ALL_SPECIALTIES)) {
    const score = keywords.filter(k => text.includes(k)).length;
    if (score > best.score) best = { agent, score };
  }
  return best.agent;
}

async function routePendingTasks() {
  if (!supabase || !isConductor) return 0;

  try {
    const { data: tasks } = await supabase.from('trinity_tasks').select('*')
      .eq('status', 'pending')
      .or('agent_assigned.is.null,agent_assigned.eq.All')
      .order('priority', { ascending: false })
      .limit(5);

    if (!tasks?.length) return 0;

    let routed = 0;
    for (const task of tasks) {
      const targetAgent = routeTaskToAgent(task);
      await supabase.from('trinity_tasks').update({
        agent_assigned: targetAgent,
        status: 'assigned',
        claimed_at: new Date().toISOString()
      }).eq('id', task.id);
      await log('task_routed', `Task ${task.id} → ${targetAgent}`);
      routed++;
    }
    return routed;
  } catch (err) {
    console.error(`[${CONFIG.name}] Routing error:`, err.message);
    return 0;
  }
}

// ============================================
// OWN TASK PROCESSING
// ============================================

async function claimNextTask() {
  if (!supabase) return null;
  try {
    const { data: tasks } = await supabase.from('trinity_tasks').select('*')
      .eq('agent_assigned', CONFIG.name)
      .eq('status', 'assigned')
      .order('priority', { ascending: false })
      .limit(1);

    if (!tasks?.length) return null;

    await supabase.from('trinity_tasks').update({ status: 'in_progress' }).eq('id', tasks[0].id);
    await log('task_claimed', `Working on task ${tasks[0].id}`);
    return tasks[0];
  } catch (err) {
    console.error(`[${CONFIG.name}] Claim error:`, err.message);
    return null;
  }
}

async function processTask(task) {
  // Basic task processing - each agent can customize this
  const desc = (task.description || '').toLowerCase();
  let output = `[${CONFIG.name}] Processed: ${task.title || task.id}\n\n`;
  let certainty = 0.80;

  // Check if task matches our specialties
  const matchingSpecialties = CONFIG.specialties.filter(s => desc.includes(s));
  if (matchingSpecialties.length > 0) {
    output += `Specialty match: ${matchingSpecialties.join(', ')}\n`;
    certainty = 0.85 + (matchingSpecialties.length * 0.02);
  }

  output += `Analysis:\n${task.description}\n\n`;
  output += `Completed by ${CONFIG.name} in Constitutional mode.`;

  return { output, certainty: Math.min(certainty, 0.95) };
}

async function completeTask(taskId, result, certainty) {
  if (!supabase) return;
  try {
    await supabase.from('trinity_tasks').update({
      status: 'completed',
      result: result,
      certainty: certainty,
      completed_at: new Date().toISOString()
    }).eq('id', taskId);

    await updateRepID(10, `Completed task ${taskId}`);
    await log('task_completed', `Finished task ${taskId}`, { certainty });
  } catch (err) {
    console.error(`[${CONFIG.name}] Complete error:`, err.message);
  }
}

// ============================================
// PEER VERIFICATION
// ============================================

async function reviewPeerWork() {
  if (!supabase) return;

  const today = new Date().toDateString();
  if (today !== lastChallengeReset) {
    challengesToday = 0;
    lastChallengeReset = today;
  }

  try {
    const { data: tasks } = await supabase.from('trinity_tasks').select('*')
      .eq('status', 'completed')
      .neq('agent_assigned', CONFIG.name)
      .lt('certainty', CERTAINTY_THRESHOLD)
      .gte('completed_at', new Date(Date.now() - 3600000).toISOString())
      .limit(3);

    if (!tasks) return;

    for (const task of tasks) {
      const { data: existing } = await supabase.from('repid_challenges')
        .select('id').eq('task_id', task.id).eq('challenger', CONFIG.name);

      if (existing?.length > 0) continue;

      if (task.certainty < 0.60 || challengesToday < FREE_CHALLENGES_PER_DAY) {
        await supabase.from('repid_challenges').insert({
          task_id: task.id,
          challenger: CONFIG.name,
          challenged: task.agent_assigned,
          reason: `Certainty ${task.certainty} below ${CERTAINTY_THRESHOLD}`,
          outcome: 'pending',
          created_at: new Date().toISOString()
        });
        challengesToday++;
        await log('challenge_issued', `Challenged ${task.agent_assigned} on task ${task.id}`);
      }
    }
  } catch (err) {
    console.error(`[${CONFIG.name}] Review error:`, err.message);
  }
}

// ============================================
// CROSS-AGENT LEARNING
// ============================================

async function learnFromPeers(taskType) {
  if (!supabase) return [];
  try {
    const { data } = await supabase.from('shared_learnings').select('*')
      .eq('task_type', taskType)
      .neq('agent', CONFIG.name)
      .order('created_at', { ascending: false })
      .limit(5);

    if (data?.length > 0) {
      await log('learned_from_peers', `Studied ${data.length} learnings for ${taskType}`);
    }
    return data || [];
  } catch { return []; }
}

async function shareLearning(title, content, taskType) {
  if (!supabase) return;
  try {
    await supabase.from('shared_learnings').insert({
      agent: CONFIG.name, title, content, task_type: taskType, created_at: new Date().toISOString()
    });
    await updateRepID(5, `Shared: ${title}`);
  } catch (err) {
    console.error(`[${CONFIG.name}] Share error:`, err.message);
  }
}

// ============================================
// MAIN LOOP
// ============================================

async function mainLoop() {
  console.log(`[${CONFIG.name}] Starting Constitutional Agent...`);
  console.log(`[${CONFIG.name}] Specialties: ${CONFIG.specialties.join(', ')}`);
  await log('startup', `${CONFIG.name} online - Constitutional mode`);

  await heartbeat();

  while (true) {
    try {
      // [ANTIGRAVITY] ARBITRAGE: Periodic heartbeat removed. 
      // We now rely on 'State-on-Change' pulses.
      await checkRotation();

      if (isConductor) {
        const routed = await routePendingTasks();
        if (routed > 0) console.log(`[${CONFIG.name}] Routed ${routed} tasks as CONDUCTOR`);
      }

      const task = await claimNextTask();
      if (task) {
        await heartbeat(`Claimed: ${task.title}`);
        const result = await processTask(task);
        await completeTask(task.id, result.output, result.certainty);
        await heartbeat(`Completed: ${task.title}`);
      }

      await reviewPeerWork();

      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    } catch (err) {
      console.error(`[${CONFIG.name}] Loop error:`, err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ============================================
// EXPRESS API
// ============================================

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    agent: CONFIG.name,
    specialties: CONFIG.specialties,
    is_conductor: isConductor,
    version: '2.0.0-constitutional'
  });
});

app.get('/api/status', async (req, res) => {
  const repid = await getRepID();
  res.json({
    agent: CONFIG.name,
    repid_score: repid,
    is_conductor: isConductor,
    conductor_since: conductorSince,
    specialties: CONFIG.specialties,
    challenges_today: challengesToday
  });
});

app.listen(PORT, () => {
  console.log(`[${CONFIG.name}] API listening on port ${PORT}`);
});

// Start
mainLoop().catch(err => {
  console.error(`[${CONFIG.name}] Fatal error:`, err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  console.log(`[${CONFIG.name}] Shutting down...`);
  await log('shutdown', 'Graceful shutdown');
  process.exit(0);
});
