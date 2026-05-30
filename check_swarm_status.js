const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

async function check() {
  console.log('--- PENDING TASKS ASSIGNED_TO BREAKDOWN ---');
  // Since we don't have execute_sql, let's select all pending tasks and group them locally.
  // Note: we might have > 1000 tasks, so let's do paginated selects or just select 2000 of them.
  let allPending = [];
  let page = 0;
  while (true) {
    const { data, error } = await db.from('trinity_tasks')
      .select('id, assigned_to, task_type, title')
      .eq('status', 'pending')
      .range(page * 1000, (page + 1) * 1000 - 1);
    
    if (error) {
      console.error(error);
      break;
    }
    if (!data || data.length === 0) break;
    allPending.push(...data);
    if (data.length < 1000) break;
    page++;
  }
  
  console.log(`Total pending fetched: ${allPending.length}`);
  
  const assignedCounts = {};
  const typeCounts = {};
  allPending.forEach(t => {
    assignedCounts[t.assigned_to] = (assignedCounts[t.assigned_to] || 0) + 1;
    typeCounts[t.task_type] = (typeCounts[t.task_type] || 0) + 1;
  });
  
  console.log('\nAssigned To breakdown:', assignedCounts);
  console.log('Task Type breakdown:', typeCounts);
  
  if (allPending.length > 0) {
    console.log('\nSample Pending Tasks (first 5):');
    console.log(allPending.slice(0, 5));
  }
}
check();
