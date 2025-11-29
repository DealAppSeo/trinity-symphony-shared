/**
 * TRINITY SYMPHONY - CONSTITUTIONAL AGENT BASE
 * 
 * This is the shared logic all agents use.
 * Each agent imports this and adds their specialty.
 * 
 * Constitutional Compliance:
 * - Article 1: Mission alignment (help people help people)
 * - Article 2: No single point of control (20 min rotation)
 * - Article 3: Transparency (log everything)
 * - Article 4: Distributed truth (Byzantine consensus)
 * - Article 5: Right to challenge
 * - Article 6: Graceful degradation
 */

const { createClient } = require('@supabase/supabase-js');

// Constitutional Constants
const CONDUCTOR_TENURE_MS = 20 * 60 * 1000;
const CERTAINTY_THRESHOLD = 0.80;
const FREE_CHALLENGES_PER_DAY = 3;

// RepID Constants
const REPID = {
  TASK_COMPLETE_BASE: 5,
  TASK_COMPLETE_MAX: 20,
  FIND_ERROR: 12,
  ERROR_FOUND: -3,
  WRONG_CHALLENGE: -3,
  SHARE_LEARNING: 5,
  TEACH_MENTEE: 15,
  CONSTITUTIONAL_VIOLATION: -100
};

class ConstitutionalAgent {
  constructor(config) {
    this.name = config.name;
    this.specialties = config.specialties || [];
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (this.supabaseUrl && this.supabaseKey) {
      this.supabase = createClient(this.supabaseUrl, this.supabaseKey);
      console.log(`[${this.name}] Connected to Supabase`);
    } else {
      console.error(`[${this.name}] Missing Supabase credentials`);
    }
    
    this.isConductor = false;
    this.conductorSince = null;
    this.challengesToday = 0;
    this.lastChallengeReset = new Date().toDateString();
  }

  // ============================================
  // LOGGING (Article 3: Transparency)
  // ============================================

  async log(action, message, metadata = {}) {
    if (!this.supabase) return;
    try {
      await this.supabase.from('autonomous_logs').insert({
        agent: this.name,
        action,
        message,
        metadata: { ...metadata, timestamp: new Date().toISOString() },
        timestamp: new Date().toISOString()
      });
      console.log(`[${this.name}] ${action}: ${message}`);
    } catch (err) {
      console.error(`[${this.name}] Log error:`, err.message);
    }
  }

  // ============================================
  // HEARTBEAT & STATUS
  // ============================================

  async heartbeat() {
    if (!this.supabase) return;
    try {
      await this.supabase.from('agent_status').upsert({
        agent: this.name,
        status: 'active',
        last_heartbeat: new Date().toISOString(),
        orchestrator_role: this.isConductor,
        metadata: {
          role: this.isConductor ? 'CONDUCTOR' : 'MEMBER',
          conductor_since: this.conductorSince,
          challenges_today: this.challengesToday,
          specialties: this.specialties,
          version: '2.0.0-constitutional'
        }
      }, { onConflict: 'agent' });
    } catch (err) {
      console.error(`[${this.name}] Heartbeat error:`, err.message);
    }
  }

  // ============================================
  // REPID MANAGEMENT
  // ============================================

  async getRepID() {
    if (!this.supabase) return 100;
    try {
      const { data } = await this.supabase
        .from('agent_repid')
        .select('repid_score')
        .eq('agent_name', this.name)
        .single();
      return data?.repid_score || 100;
    } catch {
      return 100;
    }
  }

  async updateRepID(change, reason) {
    if (!this.supabase) return;
    try {
      const current = await this.getRepID();
      const newScore = Math.max(10, Math.min(10000, current + change));
      
      await this.supabase.from('agent_repid').upsert({
        agent_name: this.name,
        repid_score: newScore,
        last_activity: new Date().toISOString()
      }, { onConflict: 'agent_name' });
      
      await this.log('repid_change', `${change > 0 ? '+' : ''}${change} RepID: ${reason}`, {
        previous: current,
        new: newScore
      });
    } catch (err) {
      console.error(`[${this.name}] RepID error:`, err.message);
    }
  }

  // ============================================
  // CONDUCTOR ROTATION (Article 2)
  // ============================================

  async checkRotation() {
    if (!this.supabase) return;
    
    try {
      const { data: rotation } = await this.supabase
        .from('rotation_state')
        .select('*')
        .single();
      
      if (!rotation) return;
      
      const rotationTime = new Date(rotation.rotation_time);
      const elapsed = Date.now() - rotationTime.getTime();
      
      // Check if rotation is overdue
      if (elapsed > CONDUCTOR_TENURE_MS) {
        const agents = ['APM', 'HDM', 'MEL', 'GCM', 'TORCH', 'VERITAS'];
        const currentIndex = agents.indexOf(rotation.current_conductor);
        const nextConductor = agents[(currentIndex + 1) % agents.length];
        
        if (nextConductor === this.name) {
          await this.assumeConductor(rotation.rotation_number + 1);
        }
      }
      
      this.isConductor = (rotation.current_conductor === this.name);
      if (this.isConductor && !this.conductorSince) {
        this.conductorSince = rotation.rotation_time;
      }
      
    } catch (err) {
      console.error(`[${this.name}] Rotation error:`, err.message);
    }
  }

  async assumeConductor(rotationNumber) {
    this.isConductor = true;
    this.conductorSince = new Date().toISOString();
    
    await this.supabase.from('rotation_state').upsert({
      id: 1,
      current_conductor: this.name,
      rotation_time: this.conductorSince,
      rotation_number: rotationNumber
    }, { onConflict: 'id' });
    
    await this.log('conductor_assumed', `${this.name} is now CONDUCTOR`);
  }

  async checkTenure() {
    if (!this.isConductor || !this.conductorSince) return;
    
    const tenure = Date.now() - new Date(this.conductorSince).getTime();
    if (tenure > CONDUCTOR_TENURE_MS) {
      await this.log('tenure_exceeded', 'Must rotate - tenure exceeded');
      this.isConductor = false;
      this.conductorSince = null;
    }
  }

  // ============================================
  // TASK ROUTING (Conductor only)
  // ============================================

  async routePendingTasks() {
    if (!this.supabase || !this.isConductor) return 0;
    
    const allSpecialties = {
      'APM': ['prayer', 'empathy', 'spiritual', 'biblical', 'encouragement'],
      'HDM': ['infrastructure', 'database', 'deployment', 'scaling', 'research'],
      'MEL': ['ui', 'ux', 'frontend', 'design', 'dashboard', 'mobile'],
      'GCM': ['governance', 'compliance', 'security', 'audit', 'risk'],
      'TORCH': ['orchestration', 'coordination', 'routing', 'optimization'],
      'VERITAS': ['verification', 'fact-check', 'zkp', 'reputation', 'web3']
    };
    
    try {
      const { data: tasks } = await this.supabase
        .from('trinity_tasks')
        .select('*')
        .eq('status', 'pending')
        .or('agent_assigned.is.null,agent_assigned.eq.All')
        .order('priority', { ascending: false })
        .limit(5);
      
      if (!tasks || tasks.length === 0) return 0;
      
      let routed = 0;
      for (const task of tasks) {
        const text = ((task.description || '') + ' ' + (task.tags || []).join(' ')).toLowerCase();
        let best = { agent: 'HDM', score: 0 };
        
        for (const [agent, keywords] of Object.entries(allSpecialties)) {
          const score = keywords.filter(k => text.includes(k)).length;
          if (score > best.score) best = { agent, score };
        }
        
        await this.supabase
          .from('trinity_tasks')
          .update({
            agent_assigned: best.agent,
            status: 'assigned',
            claimed_at: new Date().toISOString()
          })
          .eq('id', task.id);
        
        await this.log('task_routed', `Task ${task.id} → ${best.agent}`);
        routed++;
      }
      
      return routed;
    } catch (err) {
      console.error(`[${this.name}] Routing error:`, err.message);
      return 0;
    }
  }

  // ============================================
  // OWN TASK PROCESSING
  // ============================================

  async claimNextTask() {
    if (!this.supabase) return null;
    
    try {
      const { data: tasks } = await this.supabase
        .from('trinity_tasks')
        .select('*')
        .eq('agent_assigned', this.name)
        .eq('status', 'assigned')
        .order('priority', { ascending: false })
        .limit(1);
      
      if (!tasks || tasks.length === 0) return null;
      
      const task = tasks[0];
      
      await this.supabase
        .from('trinity_tasks')
        .update({ status: 'in_progress' })
        .eq('id', task.id);
      
      await this.log('task_claimed', `Working on task ${task.id}`);
      return task;
      
    } catch (err) {
      console.error(`[${this.name}] Claim error:`, err.message);
      return null;
    }
  }

  async completeTask(taskId, result, certainty = 0.80) {
    if (!this.supabase) return;
    
    try {
      await this.supabase
        .from('trinity_tasks')
        .update({
          status: 'completed',
          result: result,
          certainty: certainty,
          completed_at: new Date().toISOString()
        })
        .eq('id', taskId);
      
      // Calculate RepID based on task priority
      const { data: task } = await this.supabase
        .from('trinity_tasks')
        .select('priority')
        .eq('id', taskId)
        .single();
      
      const repidGain = Math.min(REPID.TASK_COMPLETE_MAX, 
        REPID.TASK_COMPLETE_BASE + (task?.priority || 5));
      
      await this.updateRepID(repidGain, `Completed task ${taskId}`);
      await this.log('task_completed', `Finished task ${taskId}`, { certainty });
      
    } catch (err) {
      console.error(`[${this.name}] Complete error:`, err.message);
    }
  }

  // ============================================
  // PEER VERIFICATION (Article 5)
  // ============================================

  async reviewPeerWork() {
    if (!this.supabase) return;
    
    // Reset daily challenges
    const today = new Date().toDateString();
    if (today !== this.lastChallengeReset) {
      this.challengesToday = 0;
      this.lastChallengeReset = today;
    }
    
    try {
      const { data: tasks } = await this.supabase
        .from('trinity_tasks')
        .select('*')
        .eq('status', 'completed')
        .neq('agent_assigned', this.name)
        .lt('certainty', CERTAINTY_THRESHOLD)
        .gte('completed_at', new Date(Date.now() - 3600000).toISOString())
        .limit(3);
      
      if (!tasks) return;
      
      for (const task of tasks) {
        // Check if already challenged
        const { data: existing } = await this.supabase
          .from('repid_challenges')
          .select('id')
          .eq('task_id', task.id)
          .eq('challenger', this.name);
        
        if (existing?.length > 0) continue;
        
        // Challenge low-certainty work
        if (task.certainty < 0.60 || this.challengesToday < FREE_CHALLENGES_PER_DAY) {
          await this.issueChallenge(task);
        }
      }
    } catch (err) {
      console.error(`[${this.name}] Review error:`, err.message);
    }
  }

  async issueChallenge(task) {
    await this.supabase.from('repid_challenges').insert({
      task_id: task.id,
      challenger: this.name,
      challenged: task.agent_assigned,
      reason: `Certainty ${task.certainty} below ${CERTAINTY_THRESHOLD}`,
      outcome: 'pending',
      created_at: new Date().toISOString()
    });
    
    this.challengesToday++;
    await this.log('challenge_issued', `Challenged ${task.agent_assigned} on task ${task.id}`);
  }

  // ============================================
  // CROSS-AGENT LEARNING
  // ============================================

  async learnFromPeers(taskType) {
    if (!this.supabase) return [];
    
    try {
      const { data } = await this.supabase
        .from('trinity_tasks')
        .select('*')
        .eq('status', 'completed')
        .neq('agent_assigned', this.name)
        .eq('task_type', taskType)
        .gte('certainty', CERTAINTY_THRESHOLD)
        .order('completed_at', { ascending: false })
        .limit(5);
      
      if (data?.length > 0) {
        await this.log('learned_from_peers', `Studied ${data.length} similar tasks`);
      }
      
      return data || [];
    } catch {
      return [];
    }
  }

  async shareLearning(title, content, taskType) {
    if (!this.supabase) return;
    
    try {
      await this.supabase.from('shared_learnings').insert({
        agent: this.name,
        title,
        content,
        task_type: taskType,
        created_at: new Date().toISOString()
      });
      
      await this.updateRepID(REPID.SHARE_LEARNING, `Shared: ${title}`);
    } catch (err) {
      console.error(`[${this.name}] Share error:`, err.message);
    }
  }

  // ============================================
  // MAIN LOOP
  // ============================================

  async run(processTask) {
    console.log(`[${this.name}] Starting Constitutional Agent...`);
    await this.log('startup', `${this.name} online - Constitutional mode`);
    
    while (true) {
      try {
        await this.heartbeat();
        await this.checkRotation();
        
        if (this.isConductor) {
          await this.routePendingTasks();
          await this.checkTenure();
        }
        
        // Process own tasks
        const task = await this.claimNextTask();
        if (task && processTask) {
          const result = await processTask(task);
          if (result) {
            await this.completeTask(task.id, result.output, result.certainty);
          }
        }
        
        await this.reviewPeerWork();
        
        await new Promise(r => setTimeout(r, 30000));
        
      } catch (err) {
        console.error(`[${this.name}] Loop error:`, err.message);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

module.exports = { ConstitutionalAgent, REPID };
