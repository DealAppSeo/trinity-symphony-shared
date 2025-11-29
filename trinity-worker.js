/**
 * Trinity Symphony - Unified Autonomous Worker
 * One file that handles HDM, APM, MEL, GCM, VERITAS, TORCH, or W3C
 * Based on AGENT_NAME environment variable
 * Deployed to Render.com free tier
 * 
 * 🔧 FIXED: Nov 29, 2025 - Status query now uses 'pending' (was 'not_started')
 * 🆕 UPDATED: Nov 29, 2025 - Added agent_repid heartbeat, TORCH & W3C support
 * 🆕 UPDATED: Nov 25, 2025 - Added gentle platform heartbeats for learning
 */

const http = require('http');

// ============================================
// CONFIGURATION
// ============================================

const AGENT_NAME = process.env.AGENT_NAME || 'HDM';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

// Polling interval (60 seconds)
const POLL_INTERVAL = 60000;

// Task status to look for (FIXED: was 'not_started', now 'pending')
const TASK_STATUS_PENDING = 'pending';

// ============================================
// AGENT SPECIALIZATIONS
// ============================================

const AGENT_SPECIALIZATIONS = {
  HDM: ['orchestration', 'infrastructure', 'deployment', 'coordination', 'system', 'mutual-wake', 'auto-healer'],
  APM: ['prompt', 'optimization', 'cost', 'routing', 'efficiency', 'audit', 'purpose'],
  MEL: ['research', 'learning', 'analysis', 'documentation', 'knowledge', 'ux', 'design', 'demo'],
  GCM: ['code', 'github', 'fix', 'debug', 'implementation', 'security', 'governance', 'compliance'],
  VERITAS: ['verification', 'validation', 'testing', 'quality', 'review', 'truth', 'repid', 'challenge'],
  TORCH: ['orchestration', 'conductor', 'rotation', 'meta', 'coordinate', 'workflow'],
  W3C: ['web3', 'blockchain', 'zk', 'proof', 'wallet', 'contract', 'crypto', 'chain']
};

// ============================================
// STARTUP LOGGING
// ============================================

console.log(`[${AGENT_NAME}] 🚀 Trinity Symphony Worker starting...`);
console.log(`[${AGENT_NAME}] Supabase: ${SUPABASE_URL ? '✅ configured' : '❌ missing'}`);
console.log(`[${AGENT_NAME}] Service Key: ${SUPABASE_SERVICE_ROLE_KEY ? '✅ configured' : '❌ missing'}`);
console.log(`[${AGENT_NAME}] Groq API: ${GROQ_API_KEY ? '✅ configured' : '❌ missing'}`);
console.log(`[${AGENT_NAME}] Looking for tasks with status: '${TASK_STATUS_PENDING}'`);

// ============================================
// HTTP SERVER (Health Checks)
// ============================================

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      agent: AGENT_NAME,
      uptime: process.uptime(),
      taskStatusFilter: TASK_STATUS_PENDING,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`[${AGENT_NAME}] 🌐 Health endpoint listening on port ${PORT}`);
});

// ============================================
// SUPABASE HELPER
// ============================================

async function supabaseQuery(table, method = 'GET', body = null, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters}`;
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase ${method} failed: ${response.status} - ${text}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`[${AGENT_NAME}] Supabase error:`, error.message);
    throw error;
  }
}

// ============================================
// GROQ LLM EXECUTION
// ============================================

async function executeWithGroq(prompt) {
  if (!GROQ_API_KEY) {
    return { result: 'Groq API key not configured', success: false };
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are ${AGENT_NAME}, an autonomous AI agent in the Trinity Symphony system. 
Your specializations: ${(AGENT_SPECIALIZATIONS[AGENT_NAME] || []).join(', ')}.
Execute tasks thoroughly and return clear, actionable results.
Be concise but complete.`
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2048,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${text}`);
    }

    const data = await response.json();
    return {
      result: data.choices[0].message.content,
      success: true,
      tokens: data.usage?.total_tokens || 0
    };
  } catch (error) {
    console.error(`[${AGENT_NAME}] Groq execution error:`, error.message);
    return { result: error.message, success: false };
  }
}

// ============================================
// TASK SPECIALIZATION MATCHING
// ============================================

function matchesSpecialization(task) {
  const keywords = AGENT_SPECIALIZATIONS[AGENT_NAME] || [];
  const taskText = `${task.title || ''} ${task.description || ''} ${task.task_type || ''}`.toLowerCase();
  return keywords.some(keyword => taskText.includes(keyword));
}

// Also check if task is explicitly assigned to this agent
function isAssignedToMe(task) {
  return task.agent_assigned && task.agent_assigned.toUpperCase() === AGENT_NAME.toUpperCase();
}

// ============================================
// TASK OPERATIONS
// ============================================

async function claimTask(taskId) {
  try {
    await supabaseQuery('trinity_tasks', 'PATCH', {
      status: 'in_progress',
      claimed_by: AGENT_NAME,
      started_at: new Date().toISOString()
    }, `?id=eq.${taskId}`);
    return true;
  } catch (error) {
    console.error(`[${AGENT_NAME}] Failed to claim task ${taskId}:`, error.message);
    return false;
  }
}

async function completeTask(taskId, result, success = true) {
  try {
    await supabaseQuery('trinity_tasks', 'PATCH', {
      status: success ? 'completed' : 'failed',
      result: typeof result === 'string' ? result : JSON.stringify(result),
      completed_at: new Date().toISOString(),
      certainty: success ? 0.85 : 0.3
    }, `?id=eq.${taskId}`);
    return true;
  } catch (error) {
    console.error(`[${AGENT_NAME}] Failed to complete task ${taskId}:`, error.message);
    return false;
  }
}

// ============================================
// HEARTBEAT FUNCTIONS
// ============================================

// Update agent_repid table (primary heartbeat)
async function updateAgentRepid() {
  try {
    await supabaseQuery('agent_repid', 'PATCH', {
      last_activity: new Date().toISOString()
    }, `?agent_name=eq.${AGENT_NAME}`);
    console.log(`[${AGENT_NAME}] 💓 RepID heartbeat updated`);
  } catch (error) {
    // Table might not exist or agent not registered
    console.log(`[${AGENT_NAME}] ⚠️ RepID heartbeat skipped`);
  }
}

// Update agent_status table (legacy heartbeat)
async function updateHeartbeat() {
  try {
    const existing = await supabaseQuery('agent_status', 'GET', null, `?agent_name=eq.${AGENT_NAME}`);
    
    if (existing && existing.length > 0) {
      await supabaseQuery('agent_status', 'PATCH', {
        status: 'active',
        last_heartbeat: new Date().toISOString()
      }, `?agent_name=eq.${AGENT_NAME}`);
    } else {
      await supabaseQuery('agent_status', 'POST', {
        agent_name: AGENT_NAME,
        status: 'active',
        last_heartbeat: new Date().toISOString()
      });
    }
    console.log(`[${AGENT_NAME}] Heartbeat updated`);
  } catch (error) {
    console.log(`[${AGENT_NAME}] Heartbeat update skipped (table may not exist)`);
  }
}

// Log platform performance (optional)
async function logPlatformHeartbeat(taskInfo) {
  try {
    await supabaseQuery('platform_heartbeats', 'POST', {
      agent_name: AGENT_NAME,
      platform: 'render',
      task_id: taskInfo.id,
      task_title: taskInfo.title,
      started_at: taskInfo.started_at,
      completed_at: new Date().toISOString(),
      duration_seconds: Math.floor((Date.now() - new Date(taskInfo.started_at)) / 1000),
      success: taskInfo.success,
      notes: taskInfo.learned || 'Completed successfully'
    });
    console.log(`[${AGENT_NAME}] 📊 Platform heartbeat logged`);
  } catch (e) {
    // Fail gracefully
    console.log(`[${AGENT_NAME}] ⚠️ Platform heartbeat skipped`);
  }
}

// ============================================
// MAIN POLLING LOOP
// ============================================

async function pollForTasks() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${AGENT_NAME}] ❌ Missing Supabase configuration. Cannot poll.`);
    return;
  }

  console.log(`[${AGENT_NAME}] 🔍 Polling for tasks...`);

  try {
    // Update both heartbeats
    await updateHeartbeat();
    await updateAgentRepid();

    // FIXED: Query for 'pending' status (was 'not_started')
    const tasks = await supabaseQuery(
      'trinity_tasks',
      'GET',
      null,
      `?status=eq.${TASK_STATUS_PENDING}&order=priority.desc,created_at.asc&limit=10`
    );

    if (!tasks || tasks.length === 0) {
      console.log(`[${AGENT_NAME}] No tasks available`);
      return;
    }

    console.log(`[${AGENT_NAME}] Found ${tasks.length} available tasks`);

    // Priority: 1) Tasks assigned to me, 2) Tasks matching specialization, 3) Any task
    let selectedTask = tasks.find(t => isAssignedToMe(t));
    if (!selectedTask) {
      selectedTask = tasks.find(t => matchesSpecialization(t));
    }
    if (!selectedTask) {
      selectedTask = tasks[0];
    }

    console.log(`[${AGENT_NAME}] 📋 Claiming task: ${selectedTask.title || selectedTask.id}`);

    const taskStartTime = new Date().toISOString();

    // Claim the task
    const claimed = await claimTask(selectedTask.id);
    if (!claimed) {
      console.log(`[${AGENT_NAME}] Failed to claim task (may already be claimed)`);
      return;
    }

    // Execute the task
    const prompt = `Execute this task:

Title: ${selectedTask.title || 'Untitled'}
Description: ${selectedTask.description || 'No description'}

Provide a clear, actionable result. If this is a code task, provide the code. If this is an analysis task, provide the analysis.`;
    
    console.log(`[${AGENT_NAME}] 🔧 Executing task...`);
    const execution = await executeWithGroq(prompt);

    // Complete the task
    await completeTask(selectedTask.id, execution.result, execution.success);
    
    console.log(`[${AGENT_NAME}] ✅ Task completed: ${selectedTask.title || selectedTask.id}`);

    // Log platform performance
    await logPlatformHeartbeat({
      id: selectedTask.id,
      title: selectedTask.title,
      started_at: taskStartTime,
      success: execution.success,
      learned: execution.success ? execution.result.substring(0, 200) : 'Task failed'
    });

  } catch (error) {
    console.error(`[${AGENT_NAME}] Polling error:`, error.message);
  }
}

// ============================================
// START THE WORKER
// ============================================

console.log(`[${AGENT_NAME}] Starting polling loop (every ${POLL_INTERVAL / 1000}s)...`);
setInterval(pollForTasks, POLL_INTERVAL);

// Run immediately on start
pollForTasks();
