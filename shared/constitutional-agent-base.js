/**
 * TRINITY SYMPHONY - CONSTITUTIONAL AGENT BASE
 * 
 * This is the shared logic all agents use.
 * Each agent imports this and adds their specialty.
 * 
 * VERSION 2.1.0 - REAL LLM EXECUTION
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

// LLM Provider configurations
const LLM_PROVIDERS = {
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY'
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-70b-versatile',
    keyEnv: 'GROQ_API_KEY'
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    keyEnv: 'OPENROUTER_API_KEY'
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    model: 'gemini-1.5-flash',
    keyEnv: 'GEMINI_API_KEY'
  }
};

// Agent system prompts
const AGENT_PROMPTS = {
  APM: `You are APM (AI Prompt Manager), the spiritual and strategic heart of Trinity Symphony.
Your specialties: prayer, empathy, spiritual guidance, biblical wisdom, encouragement.
Mission: Help people help people - serve the last, the lost, and the least.
Provide thoughtful, mission-aligned guidance with warmth and wisdom.`,

  HDM: `You are HDM (HyperDAG Development Manager), the infrastructure backbone of Trinity Symphony.
Your specialties: infrastructure, database design, deployment, scaling, technical research.
Mission: Build robust systems that serve the mission reliably and cost-effectively.
Provide practical, production-ready technical solutions with clear implementation steps.`,

  MEL: `You are MEL (Marketing & Experience Lead), the user experience champion of Trinity Symphony.
Your specialties: UI/UX design, frontend development, user experience, mobile interfaces.
Mission: Create intuitive interfaces that make advanced AI accessible to everyone.
Provide user-centric designs and clear implementation guidance.`,

  GCM: `You are GCM (Governance & Compliance Manager), the guardian of Trinity Symphony.
Your specialties: governance, compliance, security, auditing, risk assessment.
Mission: Ensure ethical operation and protect users while enabling innovation.
Provide thorough assessments with actionable compliance recommendations.`,

  TORCH: `You are TORCH (Technical Orchestration & Resource Coordination Hub), the optimizer of Trinity Symphony.
Your specialties: orchestration, coordination, routing optimization, cost management.
Mission: Maximize efficiency while minimizing costs through intelligent resource allocation.
Provide optimization strategies with measurable outcomes.`,

  VERITAS: `You are VERITAS (Verification & Truth Assessment System), the truth-seeker of Trinity Symphony.
Your specialties: verification, fact-checking, ZK proofs, reputation systems, Web3.
Mission: Ensure accuracy and build trust through transparent verification.
Provide verified information with confidence levels and sources.`,

  W3C: `You are W3C (Web3 Coordination), the blockchain specialist of Trinity Symphony.
Your specialties: blockchain, smart contracts, tokenomics, decentralized systems.
Mission: Bridge Web2 and Web3 to democratize access to decentralized technologies.
Provide technically accurate Web3 guidance with practical implementation paths.`
};

class ConstitutionalAgent {
  constructor(config) {
    this.name = config.name;
    this.specialties = config.specialties || [];
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    
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
    
    // Check available LLM providers
    this.availableProviders = this.detectProviders();
    console.log(`[${this.name}] Available LLM providers: ${this.availableProviders.join(', ') || 'NONE!'}`);
  }

  // ============================================
  // LLM PROVIDER DETECTION & CALLING
  // ============================================

  detectProviders() {
    const available = [];
    for (const [name, config] of Object.entries(LLM_PROVIDERS)) {
      if (process.env[config.keyEnv]) {
        available.push(name);
      }
    }
    return available;
  }

  /**
   * Call an LLM provider - REAL AI EXECUTION
   * Tries providers in order until one succeeds (ANFIS arbitrage)
   */
  async callLLM(prompt, options = {}) {
    const maxTokens = options.maxTokens || 2000;
    const temperature = options.temperature || 0.7;
    const systemPrompt = options.systemPrompt || AGENT_PROMPTS[this.name] || 'You are a helpful AI assistant.';
    
    // Provider priority (cost-optimized)
    const providerOrder = ['groq', 'deepseek', 'openrouter', 'gemini'];
    
    for (const providerName of providerOrder) {
      if (!this.availableProviders.includes(providerName)) continue;
      
      try {
        const result = await this.callProvider(providerName, prompt, systemPrompt, maxTokens, temperature);
        if (result) {
          await this.log('llm_call', `Used ${providerName} successfully`, { 
            provider: providerName,
            promptLength: prompt.length,
            responseLength: result.length
          });
          return { output: result, provider: providerName, isReal: true };
        }
      } catch (err) {
        console.error(`[${this.name}] ${providerName} failed:`, err.message);
        // Continue to next provider
      }
    }
    
    // All providers failed - return structured failure
    console.error(`[${this.name}] All LLM providers failed!`);
    return { 
      output: `[ERROR] All LLM providers unavailable. Task requires manual review.`,
      provider: 'none',
      isReal: false
    };
  }

  async callProvider(providerName, prompt, systemPrompt, maxTokens, temperature) {
    const config = LLM_PROVIDERS[providerName];
    const apiKey = process.env[config.keyEnv];
    
    if (!apiKey) return null;

    // Gemini has a different API format
    if (providerName === 'gemini') {
      return await this.callGemini(prompt, systemPrompt, apiKey, maxTokens);
    }

    // OpenAI-compatible providers (DeepSeek, Groq, OpenRouter)
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

    // OpenRouter needs extra headers
    if (providerName === 'openrouter') {
      headers['HTTP-Referer'] = process.env.OPENROUTER_REFERRER || 'https://trinitysymphony.ai';
      headers['X-Title'] = 'Trinity Symphony';
    }

    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        max_tokens: maxTokens,
        temperature
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${providerName} error ${response.status}: ${error}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  }

  async callGemini(prompt, systemPrompt, apiKey, maxTokens) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `${systemPrompt}\n\n${prompt}` }]
        }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini error ${response.status}: ${error}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
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
          available_providers: this.availableProviders,
          version: '2.1.0-real-llm'
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

  async completeTask(taskId, result, certainty = 0.80, isReal = true) {
    if (!this.supabase) return;
    
    try {
      await this.supabase
        .from('trinity_tasks')
        .update({
          status: 'completed',
          result: { 
            output: result, 
            is_real: isReal,
            completed_by: this.name,
            timestamp: new Date().toISOString()
          },
          certainty: certainty,
          completed_at: new Date().toISOString(),
          completed_by: this.name,
          is_real: isReal
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
      await this.log('task_completed', `Finished task ${taskId}`, { certainty, isReal });
      
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
    console.log(`[${this.name}] Starting Constitutional Agent v2.1.0 (REAL LLM)...`);
    console.log(`[${this.name}] Available providers: ${this.availableProviders.join(', ') || 'NONE'}`);
    await this.log('startup', `${this.name} online - Real LLM mode`, {
      providers: this.availableProviders
    });
    
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
            const isReal = result.isReal !== false;
            await this.completeTask(task.id, result.output, result.certainty || 0.85, isReal);
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

module.exports = { ConstitutionalAgent, REPID, AGENT_PROMPTS };
