const { createClient } = require('@supabase/supabase-js');
const express = require('express');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PORT = process.env.PORT || 10000;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[TORCH] Supabase connected');
} else {
  console.error('[TORCH] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
}

const AGENT_SPECIALTIES = {
  'APM': ['prayer', 'empathy', 'spiritual', 'biblical'],
  'HDM': ['infrastructure', 'optimization', 'database', 'deployment', 'research'],
  'MEL': ['ui', 'ux', 'frontend', 'design', 'dashboard', 'mobile'],
  'GCM': ['governance', 'compliance', 'security', 'audit'],
  'VERITAS': ['verification', 'zkp', 'reputation', 'web3', 'blockchain']
};

function routeTaskToAgent(task) {
  const text = ((task.description || '') + ' ' + (task.tags || []).join(' ')).toLowerCase();
  let best = { agent: 'HDM', score: 0 };
  for (const [agent, keywords] of Object.entries(AGENT_SPECIALTIES)) {
    const score = keywords.filter(k => text.includes(k)).length;
    if (score > best.score) best = { agent, score };
  }
  return best.agent;
}

async function heartbeat() {
  if (!supabase) return;
  await supabase.from('agent_status').upsert({
    agent: 'TORCH',
    status: 'active',
    last_heartbeat: new Date().toISOString(),
    metadata: { role: 'Orchestrator', mode: 'coordinator' }
  }, { onConflict: 'agent' }).catch(() => {});
}

async function assignTasks() {
  if (!supabase) return 0;
  const { data: tasks } = await supabase
    .from('trinity_tasks')
    .select('*')
    .eq('status', 'pending')
    .or('agent_assigned.is.null,agent_assigned.eq.All')
    .order('priority', { ascending: false })
    .limit(10);
  
  if (!tasks || !tasks.length) return 0;
  
  let count = 0;
  for (const task of tasks) {
    const agent = routeTaskToAgent(task);
    const { error } = await supabase
      .from('trinity_tasks')
      .update({ agent_assigned: agent, status: 'assigned', claimed_at: new Date().toISOString() })
      .eq('id', task.id);
    if (!error) count++;
  }
  return count;
}

async function mainLoop() {
  console.log('[TORCH] Starting...');
  while (true) {
    await heartbeat();
    const assigned = await assignTasks();
    if (assigned > 0) console.log(`[TORCH] Assigned ${assigned} tasks`);
    await new Promise(r => setTimeout(r, 30000));
  }
}

const app = express();
app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'trinity-torch' }));
app.listen(PORT, () => console.log(`[TORCH] API on port ${PORT}`));

mainLoop().catch(err => { console.error('[TORCH] Error:', err); process.exit(1); });
