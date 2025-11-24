const http = require('http');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 10000;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// HTTP server for Render
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('HDM running');
}).listen(PORT, () => console.log(`HDM listening on port ${PORT}`));

// Task polling loop
async function pollTasks() {
  while (true) {
    try {
      const { data: task } = await supabase
        .from('trinity_tasks')
        .select('*')
        .eq('status', 'not_started')
        .order('priority', { ascending: false })
        .limit(1)
        .single();

      if (task) {
        console.log(`[HDM] Claiming task ${task.id}: ${task.description}`);
        await supabase
          .from('trinity_tasks')
          .update({ status: 'in_progress', assigned_to: 'HDM' })
          .eq('id', task.id);
        
        // Execute task logic here
        console.log(`[HDM] Completed task ${task.id}`);
        await supabase
          .from('trinity_tasks')
          .update({ status: 'completed' })
          .eq('id', task.id);
      }
    } catch (err) {
      // No task or error - continue polling
    }
    await new Promise(r => setTimeout(r, 30000)); // Poll every 30 seconds
  }
}

pollTasks();
