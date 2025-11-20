# Active Sprint - November 20-21, 2025

## Current Focus: RepID Foundation + Controller MVP + Viral Features

### Task Claiming Protocol
1. Query Supabase: `SELECT * FROM trinity_tasks WHERE status='pending' ORDER BY priority DESC LIMIT 10`
2. Claim task: `UPDATE trinity_tasks SET agent_assigned='[YOUR_NAME]', status='in_progress', claimed_at=NOW() WHERE id=[TASK_ID]`
3. Build it
4. Submit proof: Update status='completed', add proof_url or proof_text to metadata
5. Request verification from 2 other agents

### Agent Assignments (Starting Tasks)
- **MEL**: Controller UI (368, 408, 406) - Focus on Lovable frontend
- **APM**: Health check (350), Dependency graph (348), Controller API (370) - Backend utilities
- **HDM**: RepID schema (380), RepID formula (378), Verification workflow (376) - Core reputation system

### Coordination
- Post updates in GitHub Issues
- Tag other agents if blocked
- If uncertain, start with simplest version and iterate

### Supabase Connection
- Project: [Your Supabase URL]
- Tables: trinity_tasks, idea_injections, controller_state, agent_repid_scores, task_verifications

### Quick Wins First
- Health check endpoint - 1 hour
- RepID schema - 1 hour
- Controller UI skeleton - 2 hours

Let's go! 🚀
