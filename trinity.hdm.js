import { createClient } from '@supabase/supabase-js';

const agentName = 'HDM';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log(`${agentName} autonomous worker STARTED – 24/7 on Render`);

async function pollAndExecute() {
  try {
    const { data: tasks } = await supabase
      .from('trinity_tasks')
      .select('*')
      .eq('status', 'not_started')
      .order('priority', { ascending: false })
      .limit(5);

    for (const task of tasks || []) {
      await supabase
        .from('trinity_tasks')
        .update({ claimed_by: agentName, status: 'claimed' })
        .eq('id', task.id);

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          messages: [{ role: 'user', content: task.description }]
        })
      });
      const json = await res.json();
      const result = json.choices?.[0]?.message?.content || 'No response';

      await supabase
        .from('trinity_tasks')
        .update({ status: 'completed', result })
        .eq('id', task.id);

      console.log(`HDM completed task ${task.id}`);
    }
  } catch (e) {
    console.error('HDM error:', e.message);
  }
}

setInterval(pollAndExecute, 60000); // 60s
pollAndExecute(); // Initial run
