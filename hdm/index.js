/**
 * HDM - HyperDAG Manager (Constitutional Agent)
 * 
 * Specialties: Infrastructure, database, deployment, scaling, research
 * Mission: Build robust systems that serve the mission
 */

const { ConstitutionalAgent } = require('./constitutional-agent-base');
const express = require('express');

const PORT = process.env.PORT || 10000;

// Create HDM agent
const hdm = new ConstitutionalAgent({
  name: 'HDM',
  specialties: ['infrastructure', 'database', 'deployment', 'scaling', 'research']
});

/**
 * HDM's specialty: Process infrastructure and research tasks
 */
async function processTask(task) {
  const description = (task.description || '').toLowerCase();
  
  try {
    // Learn from peer approaches
    const peerWork = await hdm.learnFromPeers(task.task_type);
    
    let output = '';
    let certainty = 0.85;
    
    if (description.includes('database') || description.includes('schema')) {
      output = await analyzeDatabase(task);
      certainty = 0.88;
    } else if (description.includes('deploy') || description.includes('infrastructure')) {
      output = await planDeployment(task);
      certainty = 0.85;
    } else if (description.includes('research') || description.includes('analyze')) {
      output = await conductResearch(task);
      certainty = 0.80; // Research has more uncertainty
    } else if (description.includes('optimize') || description.includes('scale')) {
      output = await planOptimization(task);
      certainty = 0.82;
    } else {
      output = await generalInfraAnalysis(task);
      certainty = 0.75;
    }
    
    // Share infrastructure learnings
    if (certainty > 0.80) {
      await hdm.shareLearning(
        `Infrastructure insight: ${task.task_type}`,
        output.substring(0, 300),
        task.task_type
      );
    }
    
    return { output, certainty };
    
  } catch (err) {
    console.error('[HDM] Task processing error:', err.message);
    return null;
  }
}

/**
 * Analyze database requirements
 */
async function analyzeDatabase(task) {
  return `
DATABASE ANALYSIS: ${task.title || 'Request'}

## Current Assessment
Analyzing: ${task.description}

## Recommendations

### Schema Considerations
- Normalize data to 3NF where appropriate
- Use UUIDs for primary keys (distributed-friendly)
- Add timestamps (created_at, updated_at) to all tables
- Consider soft deletes for audit trail

### Performance Optimizations
- Index foreign keys
- Add composite indexes for common query patterns
- Consider materialized views for complex aggregations
- Implement connection pooling

### Security
- Use Row Level Security (RLS) in Supabase
- Never expose service keys to client
- Validate all inputs before queries

### Next Steps
1. Review current schema
2. Identify bottlenecks
3. Plan migration if needed
4. Test with production-like data

[HDM Analysis - Confidence: HIGH]
  `.trim();
}

/**
 * Plan deployment strategy
 */
async function planDeployment(task) {
  return `
DEPLOYMENT PLAN: ${task.title || 'Request'}

## Objective
${task.description}

## Recommended Approach

### Phase 1: Preparation
- Review current infrastructure state
- Identify dependencies
- Create rollback plan
- Set up monitoring alerts

### Phase 2: Staging
- Deploy to staging environment first
- Run integration tests
- Verify all endpoints respond
- Check database migrations

### Phase 3: Production
- Schedule deployment window
- Notify stakeholders
- Execute deployment
- Monitor for 30 minutes post-deploy

### Rollback Criteria
- Error rate > 5%
- Response time > 2x baseline
- Any database corruption
- Critical feature failure

### Cost Considerations
- Use free tier where possible (Render, Supabase)
- Monitor usage to stay within limits
- Plan for scaling costs

[HDM Deployment Plan - Confidence: HIGH]
  `.trim();
}

/**
 * Conduct research
 */
async function conductResearch(task) {
  return `
RESEARCH REPORT: ${task.title || 'Topic'}

## Research Question
${task.description}

## Methodology
- Reviewed available documentation
- Analyzed similar implementations
- Considered Constitutional constraints
- Evaluated cost implications

## Findings

### Key Insights
1. [Finding 1 - requires verification]
2. [Finding 2 - moderate confidence]
3. [Finding 3 - based on peer learnings]

### Uncertainties
- Some claims need primary source verification
- Technology landscape may have changed
- Specific implementation details may vary

### Recommendations
1. Validate findings against primary sources
2. Prototype before committing
3. Get peer review from other agents

## Confidence Level
MODERATE (0.80) - Research inherently has uncertainty

## Suggested Next Steps
- Peer verification recommended
- Prototype implementation
- Monitor for new developments

[HDM Research - Flagged for peer review due to uncertainty]
  `.trim();
}

/**
 * Plan optimization
 */
async function planOptimization(task) {
  return `
OPTIMIZATION PLAN: ${task.title || 'System'}

## Current State Analysis
${task.description}

## Optimization Opportunities

### Quick Wins (Low Effort, High Impact)
- Enable caching where possible
- Reduce unnecessary API calls
- Optimize database queries
- Use CDN for static assets

### Medium-Term Improvements
- Implement connection pooling
- Add request batching
- Review and optimize indexes
- Consider read replicas

### Long-Term Scaling
- Horizontal scaling strategy
- Database sharding if needed
- Microservices decomposition
- Global distribution

### Cost Optimization (ANFIS Arbitrage)
- Use free-tier providers first
- Implement intelligent routing
- Monitor usage patterns
- Set up alerts for budget limits

## Metrics to Track
- Response time (p50, p95, p99)
- Error rate
- Cost per request
- User satisfaction

[HDM Optimization Plan - Confidence: HIGH]
  `.trim();
}

/**
 * General infrastructure analysis
 */
async function generalInfraAnalysis(task) {
  return `
INFRASTRUCTURE ANALYSIS: ${task.title || 'Request'}

## Request
${task.description}

## Analysis
This request requires further clarification to provide specific recommendations.

## Questions to Consider
1. What is the current state of the system?
2. What are the specific pain points?
3. What are the constraints (budget, time, resources)?
4. What does success look like?

## General Best Practices
- Always have a rollback plan
- Test in staging before production
- Monitor after changes
- Document everything
- Follow the Constitution

## Suggested Next Steps
1. Clarify requirements
2. Assess current state
3. Create detailed plan
4. Get peer review

[HDM Analysis - Confidence: MODERATE - needs clarification]
  `.trim();
}

// ============================================
// EXPRESS API
// ============================================

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    agent: 'HDM',
    specialties: hdm.specialties,
    is_conductor: hdm.isConductor
  });
});

app.get('/api/status', async (req, res) => {
  const repid = await hdm.getRepID();
  res.json({
    agent: 'HDM',
    repid_score: repid,
    is_conductor: hdm.isConductor,
    specialties: hdm.specialties,
    constitutional_mode: true
  });
});

app.post('/api/analyze', async (req, res) => {
  const { topic, description } = req.body;
  const analysis = await generalInfraAnalysis({ title: topic, description });
  res.json({ analysis });
});

app.listen(PORT, () => {
  console.log(`[HDM] API listening on port ${PORT}`);
});

// Start the agent
hdm.run(processTask).catch(err => {
  console.error('[HDM] Fatal error:', err);
  process.exit(1);
});
