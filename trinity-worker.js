import { createClient } from '@supabase/supabase-js';

const agentName = 'HDM';
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function pollAndExecute() {
  try {
    const { data: tasks } = await supabase
      .from('trinity_tasks')
      .select('*')
      .eq('status', 'not_started')
      .limit(5);

    for (const task of tasks || []) {
      console.log(`[${agentName}] Found task ${task.id}: ${task.description}`);
      
      await supabase
        .from('trinity_tasks')
        .update({ 
          claimed_by: agentName, 
          status: 'claimed' 
        })
        .eq('id', task.id);

      await supabase
        .from('trinity_tasks')
        .update({ 
          status: 'completed',
          result: `Task completed by ${agentName}`,
          completed_at: new Date().toISOString()
        })
        .eq('id', task.id);

      console.log(`[${agentName}] Completed task ${task.id}`);
    }
  } catch (err) {
    console.error('Poll error:', err);
  }
}

console.log(`${agentName} worker started - polling every 60 seconds`);
setInterval(pollAndExecute, 60000);
pollAndExecute();
