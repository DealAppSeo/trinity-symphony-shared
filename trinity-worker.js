/**
 * Trinity Symphony - Unified Autonomous Worker
 * One file that handles HDM, APM, MEL, or GCM based on AGENT_NAME env var
 * Deployed to Render.com free tier
 */

const http = require('http');

// Configuration from environment
const AGENT_NAME = process.env.AGENT_NAME || 'HDM';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const PORT = process.env.PORT || 10000;

// Agent specializations
const AGENT_SPECIALIZATIONS = {
  HDM: ['orchestration', 'infrastructure', 'deployment', 'coordination', 'system'],
  APM: ['prompt', 'optimization', 'cost', 'routing', 'efficiency'],
  MEL: ['research', 'learning', 'analysis', 'documentation', 'knowledge'],
  GCM: ['code', 'github', 'fix', 'debug', 'implementation']
};

// Polling interval (60 seconds)
const POLL_INTERVAL = 60000;

console.log(`[${AGENT_NAME}] 🚀 Trinity Symphony Worker starting...`);
console.log(`[${AGENT_NAME}] Supabase: ${SUPABASE_URL ? '✅ configured' : '❌ missing'}`);
console.log(`[${AGENT_NAME}] Service Key: ${SUPABASE_SERVICE_ROLE_KEY ? '✅ configured' : '❌ missing'}`);
console.log(`[${AGENT_NAME}] Groq API: ${GROQ_API_KEY ? '✅ configured' : '❌ missing'}`);

// HTTP server for Render health checks (required for Web Service type)
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      agent: AGENT_NAME,
      uptime: process.uptime(),
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

// Supabase REST API helper
async function supabaseQuery(table, method = 'GET', body = null, filters = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${filters}`;
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'GET' ? 'return=representation' : 'return=representation'
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

// Groq LLM execution
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
        model: 'llama-3.1-70b-versatile',
        messages: [
          {
            role: 'system',
            content: `You are ${AGENT_NAME}, an autonomous AI agent in the Trinity Symphony system. Execute tasks thoroughly and return clear results.`
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

// Check if task matches agent specialization
function matchesSpecialization(task) {
  const keywords = AGENT_SPECIALIZATIONS[AGENT_NAME] || [];
  const taskText = `${task.title || ''} ${task.description || ''} ${task.task_type || ''}`.toLowerCase();
  return keywords.some(keyword => taskText.includes(keyword));
}

// Claim a task
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

// Complete a task
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

// Update agent heartbeat
async function updateHeartbeat() {
  try {
    // Try to upsert agent status
    await supabaseQuery('agent_status', 'POST', {
      agent_name: AGENT_NAME,
      status: 'active',
      last_heartbeat: new Date().toISOString()
    }, '?on_conflict=agent_name');
  } catch (error) {
    // Table might not exist, that's ok
    console.log(`[${AGENT_NAME}] Heartbeat update skipped (table may not exist)`);
  }
}

// Main polling loop
async function pollForTasks() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(`[${AGENT_NAME}] ❌ Missing Supabase configuration. Cannot poll.`);
    return;
  }

  console.log(`[${AGENT_NAME}] 🔍 Polling for tasks...`);

  try {
    // Update heartbeat
    await updateHeartbeat();

    // Fetch unclaimed tasks
    const tasks = await supabaseQuery(
      'trinity_tasks',
      'GET',
      null,
      `?status=eq.not_started&order=priority.desc,created_at.asc&limit=10`
    );

    if (!tasks || tasks.length === 0) {
      console.log(`[${AGENT_NAME}] No tasks available`);
      return;
    }

    console.log(`[${AGENT_NAME}] Found ${tasks.length} available tasks`);

    // Find a task matching our specialization, or take any if none match
    let selectedTask = tasks.find(t => matchesSpecialization(t));
    if (!selectedTask) {
      selectedTask = tasks[0]; // Take first available if no specialization match
    }

    console.log(`[${AGENT_NAME}] 📋 Claiming task: ${selectedTask.title || selectedTask.id}`);

    // Claim the task
    const claimed = await claimTask(selectedTask.id);
    if (!claimed) {
      console.log(`[${AGENT_NAME}] Failed to claim task (may already be claimed)`);
      return;
    }

    // Execute the task
    const prompt = `Execute this task:\n\nTitle: ${selectedTask.title || 'Untitled'}\nDescription: ${selectedTask.description || 'No description'}\n\nProvide a clear, actionable result.`;
    
    console.log(`[${AGENT_NAME}] 🔧 Executing task...`);
    const execution = await executeWithGroq(prompt);

    // Complete the task
    await completeTask(selectedTask.id, execution.result, execution.success);
    
    console.log(`[${AGENT_NAME}] ✅ Task completed: ${selectedTask.title || selectedTask.id}`);

  } catch (error) {
    console.error(`[${AGENT_NAME}] Polling error:`, error.message);
  }
}

// Start polling
console.log(`[${AGENT_NAME}] Starting polling loop (every ${POLL_INTERVAL / 1000}s)...`);
setInterval(pollForTasks, POLL_INTERVAL);

// Run immediately on start
pollForTasks();
