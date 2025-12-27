const express = require('express');
const { ConstitutionalAgent } = require('./constitutional-agent-base.js');

const app = express();
const PORT = process.env.PORT || 3000;
const AGENT_NAME = process.env.AGENT_NAME || 'HDM';
const analyzeRoutes = require('./routes/analyze');

// Initialize agent
const agent = new ConstitutionalAgent({ name: AGENT_NAME });

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    agent: AGENT_NAME,
    version: agent.version,
    providers: agent.availableProviders
  });
});

// TRIGGER ENDPOINT - This is what cron will hit
app.get('/trigger', async (req, res) => {
  try {
    const task = await agent.getNextTask();
    if (task) {
      await agent.processTask(task);
      res.json({ status: 'processed', taskId: task.id, title: task.title });
    } else {
      await agent.heartbeat();
      res.json({ status: 'no_tasks', message: 'Heartbeat updated' });
    }
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[${AGENT_NAME}] 🚀 Server running on port ${PORT}`);
  console.log(`[${AGENT_NAME}] 🎯 Hit /trigger to process tasks`);
});
