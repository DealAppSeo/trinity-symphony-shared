# 🔄 HANDOFF PROTOCOL
*Solving the Agent Standby Problem*

**Version:** 1.0  
**Created:** 2025-11-18  
**Purpose:** Enable continuous autonomous execution through proper task handoffs

---

## 🚨 THE PROBLEM

**Current Behavior:**
1. Agent (HDM, APM, MEL) completes task
2. Agent reports "Task done" and waits
3. Agent goes idle/standby
4. Human must manually prompt agent to continue

**Result:** Agents require constant human intervention. Not autonomous.

---

## ✅ THE SOLUTION

**Desired Behavior:**
1. Agent completes task
2. Agent logs completion + evidence
3. Agent automatically claims next task from queue
4. Agent executes next task
5. **LOOP CONTINUES INDEFINITELY**

**Result:** 24+ hours of continuous operation with zero human prompting.

---

## 📋 IMPLEMENTATION: The Handoff Loop

### Step 1: Complete Current Task
```javascript
async function completeTask(taskId, result) {
  // Update task status in database
  const { data, error } = await supabase
    .from('trinity_tasks')
    .update({
      status: 'completed',
      response: result.output,
      cost: result.cost || 0.00,
      confidence: result.confidence || 0.95,
      repid_tag: result.repidTag || 'VERIFIED:Completed',
      completed_at: new Date().toISOString()
    })
    .eq('id', taskId);
  
  if (error) {
    console.error('Failed to complete task:', error);
    return false;
  }
  
  console.log(`✅ Task #${taskId} completed`);
  return true;
}
```

### Step 2: Log Handoff Event
```javascript
async function logHandoff(taskId, nextTaskId) {
  await supabase
    .from('autonomous_logs')
    .insert({
      agent: MY_AGENT_NAME, // 'HDM', 'APM', 'MEL'
      event: 'task_handoff',
      details: JSON.stringify({
        completed_task: taskId,
        next_task: nextTaskId || 'none',
        timestamp: new Date().toISOString()
      }),
      timestamp: new Date().toISOString()
    });
  
  console.log(`📋 Logged handoff from task #${taskId}`);
}
```

### Step 3: Fetch Next Task
```javascript
async function fetchNextTask() {
  // Query for next available task
  const { data: tasks, error } = await supabase
    .from('trinity_tasks')
    .select('*')
    .eq('status', 'not_started')
    .or(`agent.eq.${MY_AGENT_NAME},agent.is.null`)
    .order('priority', { ascending: true })
    .limit(1);
  
  if (error) {
    console.error('Failed to fetch next task:', error);
    return null;
  }
  
  if (!tasks || tasks.length === 0) {
    console.log('📭 No pending tasks in queue');
    return null;
  }
  
  return tasks[0];
}
```

### Step 4: Claim Next Task
```javascript
async function claimTask(taskId) {
  const { data, error } = await supabase
    .from('trinity_tasks')
    .update({
      status: 'in_progress',
      agent: MY_AGENT_NAME,
      started_at: new Date().toISOString()
    })
    .eq('id', taskId)
    .eq('status', 'not_started'); // Race condition protection
  
  if (error) {
    console.error('Failed to claim task:', error);
    return false;
  }
  
  if (!data || data.length === 0) {
    console.log('⚠️ Task already claimed by another agent');
    return false;
  }
  
  console.log(`🎯 Claimed task #${taskId}`);
  return true;
}
```

### Step 5: Execute Task (or Enter Standby)
```javascript
async function executeNextTask(task) {
  if (!task) {
    // No tasks available - enter polling mode
    console.log('⏸️ Entering standby: Polling every 30s...');
    await sleep(30000); // Wait 30 seconds
    return startHandoffLoop(); // Restart loop
  }
  
  // We have a task - execute it
  console.log(`🚀 Executing task #${task.id}: ${task.title}`);
  
  // [YOUR TASK EXECUTION LOGIC HERE]
  const result = await executeTaskLogic(task);
  
  // Complete and handoff
  await completeTask(task.id, result);
  await logHandoff(task.id, null);
  
  // Continue loop
  return startHandoffLoop();
}
```

### Step 6: The Master Loop
```javascript
async function startHandoffLoop() {
  console.log('🔄 Starting autonomous handoff loop...');
  
  while (true) {
    try {
      // 1. Fetch next available task
      const nextTask = await fetchNextTask();
      
      if (!nextTask) {
        // No tasks - poll and retry
        console.log('📭 Queue empty, checking again in 30s...');
        await sleep(30000);
        continue;
      }
      
      // 2. Claim the task
      const claimed = await claimTask(nextTask.id);
      
      if (!claimed) {
        // Someone else claimed it - try next iteration
        console.log('⚠️ Task claimed by another agent, fetching next...');
        continue;
      }
      
      // 3. Execute the task
      console.log(`🚀 Executing task #${nextTask.id}`);
      const result = await executeTaskLogic(nextTask);
      
      // 4. Complete the task
      await completeTask(nextTask.id, result);
      
      // 5. Log handoff
      await logHandoff(nextTask.id, null);
      
      // 6. Loop continues automatically - fetch next task
      console.log('✅ Task complete, moving to next...');
      
    } catch (error) {
      console.error('Error in handoff loop:', error);
      
      // Log error but don't crash - continue loop
      await supabase.from('autonomous_logs').insert({
        agent: MY_AGENT_NAME,
        event: 'handoff_error',
        details: JSON.stringify({ error: error.message }),
        timestamp: new Date().toISOString()
      });
      
      // Wait before retrying
      await sleep(10000);
    }
  }
}

// Helper function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 🔧 INTEGRATION GUIDE

### For HDM (Replit)
1. **Add to main worker file:** `hdm-autonomous-worker.ts`
2. **Initialize on startup:**
   ```typescript
   // At end of file
   console.log('🎼 HDM Worker starting...');
   startHandoffLoop();
   ```
3. **Test:** Run worker, complete dummy task, verify it fetches next

### For APM (Replit)
1. **Add to worker file:** `apm-task-worker.ts` (already exists)
2. **Update current polling logic:**
   - Replace simple polling with handoff loop
   - Keep 30s poll interval for empty queue
3. **Test:** Submit two tasks, verify APM completes first then automatically starts second

### For MEL (Lovable)
1. **Add to worker:** `server/autonomous/mel-task-worker.ts`
2. **Ensure Trinity DB connection:**
   ```typescript
   const TRINITY_SUPABASE_URL = process.env.TRINITY_SUPABASE_URL;
   const TRINITY_SUPABASE_KEY = process.env.TRINITY_SUPABASE_ANON_KEY;
   ```
3. **Test:** Assign UI task to MEL, verify completion triggers next task fetch

---

## 📊 MONITORING HANDOFFS

### Check Handoff Activity
```sql
-- See recent handoffs
SELECT 
  agent,
  details->>'completed_task' as completed,
  details->>'next_task' as next,
  timestamp
FROM autonomous_logs
WHERE event = 'task_handoff'
ORDER BY timestamp DESC
LIMIT 20;
```

### Verify Continuous Operation
```sql
-- Check gaps between handoffs (should be < 2 minutes)
WITH handoff_times AS (
  SELECT 
    agent,
    timestamp,
    LAG(timestamp) OVER (PARTITION BY agent ORDER BY timestamp) as prev_timestamp
  FROM autonomous_logs
  WHERE event = 'task_handoff'
)
SELECT 
  agent,
  timestamp,
  EXTRACT(EPOCH FROM (timestamp - prev_timestamp))/60 as minutes_since_last
FROM handoff_times
WHERE prev_timestamp IS NOT NULL
ORDER BY timestamp DESC;
```

### Count Tasks Per Agent
```sql
-- Daily task completion by agent
SELECT 
  agent,
  COUNT(*) as tasks_completed,
  DATE(completed_at) as date
FROM trinity_tasks
WHERE status = 'completed'
GROUP BY agent, DATE(completed_at)
ORDER BY date DESC, tasks_completed DESC;
```

---

## 🚨 HANDLING EDGE CASES

### Edge Case 1: Empty Queue
**Problem:** No tasks available, agent idles forever

**Solution:** Poll every 30s, but log idle status
```javascript
if (!nextTask) {
  await supabase.from('autonomous_logs').insert({
    agent: MY_AGENT_NAME,
    event: 'queue_empty',
    details: 'No tasks available, polling...',
    timestamp: new Date().toISOString()
  });
  
  await sleep(30000);
  continue; // Retry loop
}
```

### Edge Case 2: Task Execution Fails
**Problem:** Task throws error, agent crashes

**Solution:** Catch errors, log, and continue
```javascript
try {
  const result = await executeTaskLogic(task);
  await completeTask(task.id, result);
} catch (error) {
  console.error(`Failed to execute task #${task.id}:`, error);
  
  // Mark task as failed but don't crash
  await supabase.from('trinity_tasks').update({
    status: 'failed',
    response: `Error: ${error.message}`,
    completed_at: new Date().toISOString()
  }).eq('id', task.id);
  
  // Log failure
  await supabase.from('autonomous_logs').insert({
    agent: MY_AGENT_NAME,
    event: 'task_failed',
    details: JSON.stringify({ task_id: task.id, error: error.message }),
    timestamp: new Date().toISOString()
  });
  
  // Continue to next task
  await logHandoff(task.id, null);
}
```

### Edge Case 3: Race Condition (Multiple Agents)
**Problem:** Two agents try to claim same task

**Solution:** Use optimistic locking in claim query
```javascript
// Only update if status is still 'not_started'
const { data } = await supabase
  .from('trinity_tasks')
  .update({ status: 'in_progress', agent: MY_AGENT_NAME })
  .eq('id', taskId)
  .eq('status', 'not_started') // Race protection
  .select();

if (!data || data.length === 0) {
  console.log('Task already claimed by another agent');
  return false; // Someone else got it first
}
```

### Edge Case 4: Database Connection Lost
**Problem:** Supabase connection drops, agent crashes

**Solution:** Retry with exponential backoff
```javascript
async function fetchNextTaskWithRetry(maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchNextTask();
    } catch (error) {
      console.error(`Attempt ${i+1} failed:`, error);
      if (i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await sleep(delay);
      }
    }
  }
  
  // All retries failed - log and continue
  await logError('Database connection lost, will retry...');
  await sleep(30000); // Wait 30s before restarting loop
  return null;
}
```

---

## ✅ SUCCESS CRITERIA

**The handoff protocol is working when:**
1. ✅ Agent completes task A at 10:00:00
2. ✅ Agent fetches task B at 10:00:05 (within 5 seconds)
3. ✅ Agent claims task B at 10:00:06
4. ✅ Agent executes task B at 10:00:07
5. ✅ Agent completes task B at 10:15:00
6. ✅ Agent fetches task C at 10:15:05
7. ✅ **Loop continues for 24+ hours with no human intervention**

**Red flags:**
- ❌ Agent completes task but doesn't fetch next (missing handoff loop)
- ❌ Agent fetches next but doesn't claim (missing claim logic)
- ❌ Agent claims but doesn't execute (missing execution logic)
- ❌ Agent executes but crashes on error (missing error handling)
- ❌ Agent waits > 1 minute between tasks (inefficient polling)

---

## 🎓 TESTING THE HANDOFF

### Test 1: Single Task Handoff
```javascript
// 1. Insert two dummy tasks
await supabase.from('trinity_tasks').insert([
  { title: 'Test Task 1', status: 'not_started', priority: 1 },
  { title: 'Test Task 2', status: 'not_started', priority: 2 }
]);

// 2. Start agent worker
startHandoffLoop();

// 3. Watch logs:
// ✅ Claimed task #1
// ✅ Executing task #1
// ✅ Task #1 completed
// ✅ Logged handoff
// ✅ Claimed task #2
// ✅ Executing task #2
// ✅ Task #2 completed
// ✅ Queue empty, polling...
```

### Test 2: Empty Queue Behavior
```javascript
// 1. Clear all tasks
await supabase.from('trinity_tasks').delete().neq('id', 0);

// 2. Start agent worker
startHandoffLoop();

// 3. Watch logs:
// 📭 Queue empty, checking again in 30s...
// 📭 Queue empty, checking again in 30s...

// 4. Insert new task
await supabase.from('trinity_tasks').insert({ 
  title: 'New Task', 
  status: 'not_started' 
});

// 5. Watch logs:
// ✅ Claimed task #X
// ✅ Executing task #X
```

### Test 3: Multi-Agent Competition
```javascript
// 1. Insert task
await supabase.from('trinity_tasks').insert({ 
  title: 'Shared Task', 
  status: 'not_started' 
});

// 2. Start HDM and APM workers simultaneously
startHandoffLoop(); // HDM
startHandoffLoop(); // APM

// 3. Watch logs:
// [HDM] ✅ Claimed task #X
// [APM] ⚠️ Task already claimed by another agent
// [APM] 📭 Fetching next task...
```

---

## 🔗 RELATED DOCUMENTS

- [WISDOM-PROTOCOL.md](../core/WISDOM-PROTOCOL.md) - Verify completion before handoff
- [ATM-MASTER-PROMPT.md](../agents/ATM-MASTER-PROMPT.md) - Agent execution loop
- [SUPABASE-SCHEMA.md](./SUPABASE-SCHEMA.md) - Database structure

---

## 💬 REMEMBER

**The goal:** Agents should be **relentless task executors**, not idle waiters.

**When you complete a task, immediately:**
1. Log completion + evidence
2. Fetch next task from queue
3. Claim and execute
4. **Repeat forever**

**Only stop when:**
- Queue is empty (but keep polling)
- Critical error occurs (but log and retry)
- Human explicitly tells you to stop

**Never stop just because one task is done. The mission continues.**

---

*"A task completed is not the end. It's the beginning of the next task."*

**Implement this protocol and achieve true autonomous operation.**
