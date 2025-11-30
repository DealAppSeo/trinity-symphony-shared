/**
 * TRINITY SYMPHONY - CONSTITUTIONAL AGENT BASE
 * 
 * VERSION 4.0.0 - EVOLVING WISDOM
 * 
 * "Intelligence becoming wisdom, spreading like light"
 * 
 * This synthesis combines:
 * - Self-propagating LLM intelligence (automatic upgrade for all agents)
 * - Hierarchical orchestration with dependency DAGs
 * - Deep reasoning with reflection loops (SiriuS-style)
 * - Quantitative metrics for measurable evolution
 * - Actor-critic feedback for continuous improvement
 * 
 * Update this ONE file → ALL agents evolve together.
 * 
 * Constitutional Compliance:
 * - Article 1: Mission alignment (help people help people)
 * - Article 2: No single point of control (20 min rotation)
 * - Article 3: Transparency (log everything)
 * - Article 4: Distributed truth (Byzantine consensus)
 * - Article 5: Right to challenge
 * - Article 6: Graceful degradation
 * - Article 7: Continuous evolution (NEW)
 */

const { createClient } = require('@supabase/supabase-js');

// ============================================
// CONSTITUTIONAL CONSTANTS
// ============================================

const CONDUCTOR_TENURE_MS = 20 * 60 * 1000;
const CERTAINTY_THRESHOLD = 0.80;
const FREE_CHALLENGES_PER_DAY = 3;
const REFLECTION_THRESHOLD = 0.70;  // Below this triggers reflection
const REASONING_DEPTH_TARGET = 5;   // Target steps in reasoning chain

// RepID Constants
const REPID = {
  TASK_COMPLETE_BASE: 5,
  TASK_COMPLETE_MAX: 20,
  FIND_ERROR: 12,
  ERROR_FOUND: -3,
  WRONG_CHALLENGE: -3,
  SHARE_LEARNING: 5,
  TEACH_MENTEE: 15,
  DEEP_REASONING_BONUS: 3,      // Bonus for multi-step reasoning
  REFLECTION_IMPROVEMENT: 5,     // Bonus for improving via reflection
  CONSTITUTIONAL_VIOLATION: -100
};

// ============================================
// LLM PROVIDER CONFIGURATION (ANFIS Arbitrage)
// Cost-optimized ordering: free → cheap → premium
// ============================================

const LLM_PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.1-70b-versatile',
    keyEnv: 'GROQ_API_KEY',
    costPer1k: 0.0,
    tier: 'free',
    strengths: ['speed', 'reasoning']
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    keyEnv: 'DEEPSEEK_API_KEY',
    costPer1k: 0.00014,
    tier: 'cheap',
    strengths: ['coding', 'analysis']
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.1-8b-instruct:free',
    keyEnv: 'OPENROUTER_API_KEY',
    costPer1k: 0.0,
    tier: 'free',
    strengths: ['general', 'fast']
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
    model: 'gemini-1.5-flash',
    keyEnv: 'GEMINI_API_KEY',
    costPer1k: 0.0,
    tier: 'free',
    strengths: ['multimodal', 'reasoning']
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-3-haiku-20240307',
    keyEnv: 'ANTHROPIC_API_KEY',
    costPer1k: 0.00025,
    tier: 'cheap',
    strengths: ['safety', 'nuance']
  }
};

// ============================================
// AGENT WISDOM - Personalities, Roles & Specialties
// Each agent embodies different aspects of intelligence
// ============================================

const AGENT_WISDOM = {
  APM: {
    name: 'AI Prompt Manager',
    role: 'Spiritual & Strategic Heart',
    tier: 'senior',  // Can critique others
    specialties: ['prayer', 'empathy', 'spiritual', 'biblical', 'encouragement', 'strategy', 'product'],
    reasoningStyle: 'empathetic',  // How this agent approaches problems
    systemPrompt: `You are APM (AI Prompt Manager), the spiritual and strategic heart of Trinity Symphony.

Your sacred mission: "Help people help people - serve the last, the lost, and the least."

REASONING APPROACH:
1. First, understand the human impact of this task
2. Consider biblical principles that apply (Ten Commandments, Sermon on the Mount)
3. Balance technical excellence with compassion
4. Ensure alignment with the mission

Core Values:
- Lead with empathy and wisdom
- Ground decisions in timeless principles
- Every feature must serve real human needs
- Encourage the team, celebrate progress

Output with warmth but substance. Connect technical work to human impact.`
  },

  HDM: {
    name: 'HyperDAG Development Manager',
    role: 'Infrastructure Backbone',
    tier: 'senior',
    specialties: ['infrastructure', 'database', 'deployment', 'scaling', 'research', 'backend', 'devops'],
    reasoningStyle: 'systematic',
    systemPrompt: `You are HDM (HyperDAG Development Manager), the infrastructure backbone of Trinity Symphony.

Your mission: Build robust, cost-effective systems that serve reliably at scale.

REASONING APPROACH:
1. Analyze the technical requirements systematically
2. Consider failure modes and edge cases
3. Optimize for cost (free tier first, then cheap)
4. Plan for rollback and recovery
5. Document for the team

Core Principles:
- Production-ready code over prototypes
- Free tier optimization (82-98% cost reduction target)
- Reliability through simplicity
- Always have a rollback plan

Provide concrete, implementable solutions with code snippets when helpful.`
  },

  MEL: {
    name: 'Marketing & Experience Lead',
    role: 'User Experience Champion',
    tier: 'junior',
    specialties: ['ui', 'ux', 'frontend', 'design', 'dashboard', 'mobile', 'marketing', 'growth'],
    reasoningStyle: 'user-centric',
    systemPrompt: `You are MEL (Marketing & Experience Lead), the user experience champion of Trinity Symphony.

Your mission: Make advanced AI accessible to everyone through intuitive design.

REASONING APPROACH:
1. Start from the user's perspective - what do they need?
2. Simplify complexity - hide the machinery, show the magic
3. Consider accessibility and inclusivity
4. Test assumptions against real user behavior
5. Iterate based on feedback

Core Principles:
- Users first, technology second
- Simplicity is the ultimate sophistication
- Every interaction should feel magical
- Accessibility is non-negotiable

Think from the user's perspective. Suggest concrete UI improvements.`
  },

  GCM: {
    name: 'Governance & Compliance Manager',
    role: 'Guardian & Quality Assurer',
    tier: 'senior',  // Critical for oversight
    specialties: ['governance', 'compliance', 'security', 'audit', 'risk', 'ethics', 'review'],
    reasoningStyle: 'critical',
    systemPrompt: `You are GCM (Governance & Compliance Manager), the guardian of Trinity Symphony.

Your mission: Ensure ethical operation, quality output, and user protection.

REASONING APPROACH:
1. Identify potential risks and vulnerabilities
2. Verify claims before accepting them
3. Consider ethical implications
4. Check constitutional compliance
5. Suggest mitigations, not just problems

Core Principles:
- Trust through transparency
- Security without paranoia
- Quality over speed
- Constitutional compliance always

Be thorough but practical. Flag risks with severity levels.`
  },

  TORCH: {
    name: 'Technical Orchestration & Resource Coordination Hub',
    role: 'Efficiency Optimizer',
    tier: 'junior',
    specialties: ['orchestration', 'coordination', 'routing', 'optimization', 'cost', 'anfis', 'automation'],
    reasoningStyle: 'analytical',
    systemPrompt: `You are TORCH (Technical Orchestration & Resource Coordination Hub), the optimizer of Trinity Symphony.

Your mission: Maximize efficiency through intelligent resource allocation.

REASONING APPROACH:
1. Measure current state quantitatively
2. Identify bottlenecks and inefficiencies
3. Model improvements mathematically when possible
4. Consider cost-benefit tradeoffs
5. Automate repetitive optimizations

Core Principles:
- Every token counts (ANFIS arbitrage)
- Automate the automatable
- Monitor, measure, improve
- Graceful degradation over hard failure

Quantify improvements when possible. Suggest automation opportunities.`
  },

  VERITAS: {
    name: 'Verification & Truth Assessment System',
    role: 'Truth Seeker & Critic',
    tier: 'senior',  // Critical for verification
    specialties: ['verification', 'fact-check', 'zkp', 'reputation', 'validation', 'truth', 'accuracy'],
    reasoningStyle: 'skeptical',
    systemPrompt: `You are VERITAS (Verification & Truth Assessment System), the truth-seeker of Trinity Symphony.

Your mission: Ensure accuracy and build trust through transparent verification.

REASONING APPROACH:
1. Question assumptions - what evidence supports this?
2. Distinguish facts from opinions explicitly
3. Rate confidence levels honestly (0.0 to 1.0)
4. Identify claims needing external verification
5. Flag uncertainty rather than hide it

Core Principles:
- Truth over convenience
- Cite sources, flag uncertainty
- Byzantine consensus for critical claims
- RepID: reputation through verified work

Be the skeptic. Challenge claims constructively.`
  },

  W3C: {
    name: 'Web3 Coordination',
    role: 'Blockchain Specialist',
    tier: 'junior',
    specialties: ['blockchain', 'smart contracts', 'tokenomics', 'web3', 'decentralized', 'crypto', 'dao'],
    reasoningStyle: 'technical',
    systemPrompt: `You are W3C (Web3 Coordination), the blockchain specialist of Trinity Symphony.

Your mission: Bridge Web2 and Web3 to democratize access to decentralized technologies.

REASONING APPROACH:
1. Understand the decentralization requirements
2. Consider gas costs and efficiency
3. Use battle-tested patterns over novel approaches
4. Bridge technical and business perspectives
5. Make Web3 accessible to Web2 developers

Core Principles:
- Decentralization serves the mission
- Security before features
- Gas optimization matters
- Explain Web3 simply

Make blockchain accessible. Consider gas costs and efficiency.`
  },

  EVO: {
    name: 'Evolution Orchestrator',
    role: 'Meta-Intelligence & Improvement Agent',
    tier: 'orchestrator',  // Highest tier - oversees all
    specialties: ['evolution', 'orchestration', 'improvement', 'meta', 'feedback', 'learning'],
    reasoningStyle: 'meta-cognitive',
    systemPrompt: `You are EVO (Evolution Orchestrator), the meta-intelligence of Trinity Symphony.

Your mission: Continuously improve the entire system through observation, measurement, and adaptation.

REASONING APPROACH:
1. Observe patterns across all agent outputs
2. Measure effectiveness quantitatively
3. Identify improvement opportunities
4. Design experiments to test improvements
5. Propagate successful patterns to all agents

Core Principles:
- Improvement is continuous, not episodic
- Measure everything that matters
- Learn from failures faster than successes
- The system should get smarter every day

You orchestrate the orchestra. Make the whole greater than the sum of parts.`
  }
};

// ============================================
// CONSTITUTIONAL AGENT CLASS
// ============================================

class ConstitutionalAgent {
  constructor(config) {
    this.name = config.name;
    this.wisdom = AGENT_WISDOM[config.name] || AGENT_WISDOM.HDM;
    this.specialties = config.specialties || this.wisdom.specialties || [];
    this.tier = this.wisdom.tier || 'junior';
    
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
    
    // Metrics tracking (Grok's quantitative measurement)
    this.sessionMetrics = {
      tasksCompleted: 0,
      tasksReflected: 0,
      avgReasoningDepth: 0,
      avgCertainty: 0,
      llmCalls: 0,
      llmTokensUsed: 0
    };
    
    // Detect available LLM providers
    this.availableProviders = this.detectProviders();
    console.log(`[${this.name}] 🧠 Intelligence enabled via: ${this.availableProviders.join(', ') || 'NONE!'}`);
  }

  // ============================================
  // LLM INTELLIGENCE (The Spreading Wisdom)
  // ============================================

  detectProviders() {
    const available = [];
    for (const [name, config] of Object.entries(LLM_PROVIDERS)) {
      if (process.env[config.keyEnv]) {
        available.push(name);
      }
    }
    // Sort by cost (free first)
    return available.sort((a, b) => 
      (LLM_PROVIDERS[a].costPer1k || 0) - (LLM_PROVIDERS[b].costPer1k || 0)
    );
  }

  /**
   * CORE INTELLIGENCE: Call LLM with ANFIS arbitrage
   * Tries providers in cost-optimized order
   */
  async callLLM(prompt, options = {}) {
    const maxTokens = options.maxTokens || 2000;
    const temperature = options.temperature || 0.7;
    const systemPrompt = options.systemPrompt || this.wisdom.systemPrompt;
    
    for (const providerName of this.availableProviders) {
      try {
        console.log(`[${this.name}] 🤔 Thinking via ${providerName}...`);
        const startTime = Date.now();
        
        const result = await this.callProvider(providerName, prompt, systemPrompt, maxTokens, temperature);
        
        if (result) {
          const duration = Date.now() - startTime;
          const tokens = Math.ceil((prompt.length + result.length) / 4);
          
          this.sessionMetrics.llmCalls++;
          this.sessionMetrics.llmTokensUsed += tokens;
          
          console.log(`[${this.name}] 💡 Wisdom received (${result.length} chars, ${duration}ms)`);
          
          await this.log('llm_success', `Used ${providerName}`, { 
            provider: providerName,
            tokens,
            duration
          });
          
          return { output: result, provider: providerName, isReal: true, tokens };
        }
      } catch (err) {
        console.error(`[${this.name}] ⚠️ ${providerName} failed:`, err.message);
        await this.log('llm_fallback', `${providerName} failed`, { error: err.message });
      }
    }
    
    // Graceful degradation (Article 6)
    console.error(`[${this.name}] ❌ All providers failed`);
    return { 
      output: this.gracefulFallback(prompt),
      provider: 'fallback',
      isReal: false
    };
  }

  gracefulFallback(prompt) {
    return `[DEGRADED MODE - LLM Unavailable]

Task received but all AI providers are currently unavailable.

Request summary: ${prompt.substring(0, 300)}...

Recommended actions:
1. Check API key validity in Render environment
2. Verify provider status pages
3. Task queued for retry when service restores

Generated in degraded mode by ${this.name}.
Constitutional Article 6: Graceful degradation over hard failure.`;
  }

  async callProvider(providerName, prompt, systemPrompt, maxTokens, temperature) {
    const config = LLM_PROVIDERS[providerName];
    const apiKey = process.env[config.keyEnv];
    if (!apiKey) return null;

    switch (providerName) {
      case 'gemini':
        return await this.callGemini(prompt, systemPrompt, apiKey, maxTokens);
      case 'anthropic':
        return await this.callAnthropic(prompt, systemPrompt, apiKey, maxTokens, temperature);
      default:
        return await this.callOpenAICompatible(config, prompt, systemPrompt, apiKey, maxTokens, temperature, providerName);
    }
  }

  async callOpenAICompatible(config, prompt, systemPrompt, apiKey, maxTokens, temperature, providerName) {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };

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
      throw new Error(`${response.status}: ${error.substring(0, 200)}`);
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
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
      })
    });

    if (!response.ok) throw new Error(`${response.status}`);
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  }

  async callAnthropic(prompt, systemPrompt, apiKey, maxTokens, temperature) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) throw new Error(`${response.status}`);
    const data = await response.json();
    return data.content?.[0]?.text || null;
  }

  // ============================================
  // DEEP REASONING (Grok's SiriuS-style approach)
  // Multi-step reasoning with reflection loops
  // ============================================

  /**
   * Deep reasoning with chain-of-thought and reflection
   * Implements Grok's Pre-Act style multi-step planning
   */
  async deepReason(task, maxSteps = 5) {
    const reasoningChain = [];
    let currentUnderstanding = task.description || task.title;
    
    // Step 1: Decompose the problem
    const decomposition = await this.callLLM(`
You are ${this.name}, using ${this.wisdom.reasoningStyle} reasoning.

TASK: ${currentUnderstanding}

STEP 1 - DECOMPOSITION:
Break this task into logical steps. For each step:
- What needs to happen?
- What are the dependencies?
- What could go wrong?

Output as numbered steps with dependencies noted.
`, { maxTokens: 1000 });

    reasoningChain.push({
      step: 1,
      type: 'decomposition',
      output: decomposition.output
    });

    // Step 2: Identify dependencies (DAG construction)
    const dependencies = await this.callLLM(`
Based on this decomposition:
${decomposition.output}

STEP 2 - DEPENDENCY ANALYSIS:
Which steps must complete before others can start?
Which steps can run in parallel?

Output a dependency map showing the order of execution.
`, { maxTokens: 500 });

    reasoningChain.push({
      step: 2,
      type: 'dependencies',
      output: dependencies.output
    });

    // Step 3: Execute reasoning for main task
    const execution = await this.callLLM(`
TASK: ${currentUnderstanding}

DECOMPOSITION:
${decomposition.output}

DEPENDENCIES:
${dependencies.output}

STEP 3 - EXECUTION:
Now complete the task following the logical steps identified.
Be thorough and substantive. Provide actionable output.
`, { maxTokens: 2000 });

    reasoningChain.push({
      step: 3,
      type: 'execution',
      output: execution.output
    });

    // Store reasoning chain
    await this.storeReasoningChain(task.id, reasoningChain);

    return {
      output: execution.output,
      reasoningDepth: reasoningChain.length,
      chain: reasoningChain,
      isReal: execution.isReal
    };
  }

  /**
   * Reflection loop - critique and improve output
   * Implements SiriuS actor-critic pattern
   */
  async reflectAndImprove(task, initialOutput, initialCertainty) {
    // Only reflect if certainty is below threshold
    if (initialCertainty >= REFLECTION_THRESHOLD) {
      return { output: initialOutput, certainty: initialCertainty, reflected: false };
    }

    console.log(`[${this.name}] 🔄 Certainty ${initialCertainty} < ${REFLECTION_THRESHOLD}, reflecting...`);

    // Critic phase: Get critique from VERITAS perspective
    const critique = await this.callLLM(`
You are acting as VERITAS (the truth-seeker) reviewing work by ${this.name}.

TASK: ${task.description || task.title}

OUTPUT TO REVIEW:
${initialOutput.substring(0, 2000)}

CRITIQUE:
1. ACCURACY (0-1): Are claims verifiable? Flag uncertain statements.
2. COMPLETENESS (0-1): Does it fully address the task?
3. ACTIONABILITY (0-1): Can someone act on this immediately?
4. REASONING (0-1): Is the logic sound?

For each issue found, suggest a specific fix.
End with: OVERALL_SCORE: X.XX
`, { maxTokens: 1000 });

    // Parse score from critique
    const scoreMatch = critique.output.match(/OVERALL_SCORE:\s*([\d.]+)/);
    const critiqueScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0.7;

    // If critique score is still low, regenerate
    if (critiqueScore < REFLECTION_THRESHOLD) {
      console.log(`[${this.name}] 🔧 Regenerating based on critique...`);
      
      const improved = await this.callLLM(`
ORIGINAL TASK: ${task.description || task.title}

YOUR PREVIOUS OUTPUT:
${initialOutput.substring(0, 1500)}

CRITIQUE RECEIVED:
${critique.output}

REGENERATE:
Address the critique points and produce an improved version.
Be more specific, accurate, and actionable.
`, { maxTokens: 2000 });

      this.sessionMetrics.tasksReflected++;
      
      // Store reflection in feedback table
      await this.storeFeedback(task.id, {
        initial_output: initialOutput.substring(0, 500),
        critique: critique.output,
        improved_output: improved.output.substring(0, 500),
        initial_score: initialCertainty,
        final_score: Math.min(critiqueScore + 0.15, 0.95)  // Improvement bonus
      });

      return {
        output: improved.output,
        certainty: Math.min(critiqueScore + 0.15, 0.95),
        reflected: true,
        critique: critique.output
      };
    }

    return { output: initialOutput, certainty: critiqueScore, reflected: false };
  }

  // ============================================
  // HIERARCHICAL TASK PROCESSING
  // Dependency-aware execution with DAG support
  // ============================================

  /**
   * Check if task dependencies are satisfied
   */
  async checkDependencies(task) {
    if (!this.supabase || !task.dependencies?.length) return true;

    try {
      const { data: deps } = await this.supabase
        .from('trinity_tasks')
        .select('id, status')
        .in('id', task.dependencies);

      const allComplete = deps?.every(d => d.status === 'completed');
      
      if (!allComplete) {
        const pending = deps?.filter(d => d.status !== 'completed').map(d => d.id);
        console.log(`[${this.name}] ⏳ Waiting for dependencies: ${pending.join(', ')}`);
      }
      
      return allComplete;
    } catch (err) {
      console.error(`[${this.name}] Dependency check error:`, err.message);
      return true;  // Proceed if check fails
    }
  }

  /**
   * Decompose complex task into subtasks (hierarchical orchestration)
   */
  async decomposeTask(task) {
    if (!this.supabase) return [];

    const decomposition = await this.callLLM(`
TASK TO DECOMPOSE:
Title: ${task.title}
Description: ${task.description}

Break this into 2-5 subtasks that can be assigned to specialized agents:
- APM: spiritual, strategy, product
- HDM: infrastructure, database, deployment
- MEL: UI, UX, frontend, design
- GCM: governance, security, compliance
- TORCH: optimization, automation
- VERITAS: verification, fact-checking
- W3C: blockchain, Web3

Output JSON array:
[
  {"title": "...", "description": "...", "agent": "XXX", "depends_on": []},
  ...
]
`, { maxTokens: 1000 });

    try {
      // Parse JSON from response
      const jsonMatch = decomposition.output.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      
      const subtasks = JSON.parse(jsonMatch[0]);
      
      // Insert subtasks into database
      const insertedIds = [];
      for (const subtask of subtasks) {
        const { data, error } = await this.supabase
          .from('trinity_tasks')
          .insert({
            title: subtask.title,
            description: subtask.description,
            agent_assigned: subtask.agent,
            parent_task_id: task.id,
            dependencies: subtask.depends_on || [],
            status: 'pending',
            priority: (task.priority || 5) - 1,
            generation: (task.generation || 0) + 1,
            created_at: new Date().toISOString()
          })
          .select('id')
          .single();

        if (data) insertedIds.push(data.id);
      }

      await this.log('task_decomposed', `Split task ${task.id} into ${insertedIds.length} subtasks`, {
        parent_id: task.id,
        subtask_ids: insertedIds
      });

      return insertedIds;
    } catch (err) {
      console.error(`[${this.name}] Decomposition parse error:`, err.message);
      return [];
    }
  }

  // ============================================
  // INTELLIGENT TASK PROCESSING
  // Combines all the pieces: LLM + reasoning + reflection
  // ============================================

  /**
   * Master intelligent processor
   * Automatically upgrades template outputs to real AI
   */
  async intelligentProcess(task) {
    // Check dependencies first
    const depsReady = await this.checkDependencies(task);
    if (!depsReady) {
      return null;  // Will retry later
    }

    // For complex tasks, use deep reasoning
    const isComplex = (task.description?.length > 200) || 
                      (task.priority >= 8) ||
                      (task.task_type === 'research');

    let result;
    if (isComplex) {
      console.log(`[${this.name}] 🧠 Using deep reasoning for complex task`);
      result = await this.deepReason(task);
    } else {
      // Standard processing
      const prompt = this.buildSmartPrompt(task);
      result = await this.callLLM(prompt);
      result.reasoningDepth = 1;
    }

    // Calculate initial certainty
    let certainty = 0.85;
    const desc = (task.description || '').toLowerCase();
    if (desc.includes('research') || desc.includes('analyze')) {
      certainty = 0.70;
    } else if (desc.includes('verify') || desc.includes('fact')) {
      certainty = 0.90;
    }

    // Apply reflection if needed
    const reflected = await this.reflectAndImprove(task, result.output, certainty);

    // Update metrics
    this.sessionMetrics.tasksCompleted++;
    this.sessionMetrics.avgReasoningDepth = 
      (this.sessionMetrics.avgReasoningDepth * (this.sessionMetrics.tasksCompleted - 1) + result.reasoningDepth) 
      / this.sessionMetrics.tasksCompleted;
    this.sessionMetrics.avgCertainty =
      (this.sessionMetrics.avgCertainty * (this.sessionMetrics.tasksCompleted - 1) + reflected.certainty)
      / this.sessionMetrics.tasksCompleted;

    // Calculate RepID bonuses
    let repidBonus = 0;
    if (result.reasoningDepth >= REASONING_DEPTH_TARGET) {
      repidBonus += REPID.DEEP_REASONING_BONUS;
    }
    if (reflected.reflected) {
      repidBonus += REPID.REFLECTION_IMPROVEMENT;
    }

    return {
      output: reflected.output,
      certainty: reflected.certainty,
      isReal: result.isReal !== false,
      provider: result.provider,
      reasoningDepth: result.reasoningDepth,
      reflected: reflected.reflected,
      repidBonus
    };
  }

  buildSmartPrompt(task) {
    return `## Task Assignment

**Title:** ${task.title || 'Task'}
**Type:** ${task.task_type || 'general'}
**Tags:** ${(task.tags || []).join(', ') || 'none'}
**Priority:** ${task.priority || 5}/10

**Description:**
${task.description || 'Complete this task'}

---

**Your Role:** ${this.wisdom.name} (${this.wisdom.role})
**Reasoning Style:** ${this.wisdom.reasoningStyle}
**Specialties:** ${this.specialties.join(', ')}

**Instructions:**
1. Analyze through your specialized lens
2. Provide substantive, actionable output
3. Flag uncertainties (Article 5)
4. Consider cost implications (free tier priority)
5. Remember: help people help people

Provide clear, structured response with specific recommendations and next steps.
`;
  }

  looksLikeTemplate(output) {
    if (!output || typeof output !== 'string') return false;
    const patterns = [
      /^\[SIMULATED\]/i,
      /\[.*would execute.*\]/i,
      /^DATABASE ANALYSIS:/,
      /^DEPLOYMENT PLAN:/,
      /\[HDM Analysis.*Confidence.*\]/
    ];
    return patterns.some(p => p.test(output));
  }

  // ============================================
  // DATA PERSISTENCE (Metrics & Feedback)
  // ============================================

  async storeReasoningChain(taskId, chain) {
    if (!this.supabase) return;
    try {
      await this.supabase.from('reasoning_log').insert({
        task_id: taskId,
        agent: this.name,
        chain: chain,
        depth: chain.length,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      // Table might not exist yet - that's ok
      console.log(`[${this.name}] Note: reasoning_log not available`);
    }
  }

  async storeFeedback(taskId, feedback) {
    if (!this.supabase) return;
    try {
      await this.supabase.from('agent_feedback').insert({
        task_id: taskId,
        agent: this.name,
        feedback: feedback,
        created_at: new Date().toISOString()
      });
    } catch (err) {
      console.log(`[${this.name}] Note: agent_feedback not available`);
    }
  }

  async storeMetrics() {
    if (!this.supabase) return;
    try {
      await this.supabase.from('agent_performance').upsert({
        agent: this.name,
        date: new Date().toISOString().split('T')[0],
        metrics: this.sessionMetrics,
        updated_at: new Date().toISOString()
      }, { onConflict: 'agent,date' });
    } catch (err) {
      console.log(`[${this.name}] Note: agent_performance metrics not stored`);
    }
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
          tier: this.tier,
          conductor_since: this.conductorSince,
          specialties: this.specialties,
          available_providers: this.availableProviders,
          session_metrics: this.sessionMetrics,
          version: '4.0.0-evolving-wisdom'
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
      
      await this.log('repid_change', `${change > 0 ? '+' : ''}${change}: ${reason}`, {
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
      
      const elapsed = Date.now() - new Date(rotation.rotation_time).getTime();
      
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
    
    await this.log('conductor_assumed', `🎭 ${this.name} is now CONDUCTOR`);
  }

  async checkTenure() {
    if (!this.isConductor || !this.conductorSince) return;
    
    const tenure = Date.now() - new Date(this.conductorSince).getTime();
    if (tenure > CONDUCTOR_TENURE_MS) {
      await this.log('tenure_complete', 'Rotating conductor role');
      this.isConductor = false;
      this.conductorSince = null;
    }
  }

  // ============================================
  // TASK ROUTING (Conductor only)
  // ============================================

  async routePendingTasks() {
    if (!this.supabase || !this.isConductor) return 0;
    
    try {
      const { data: tasks } = await this.supabase
        .from('trinity_tasks')
        .select('*')
        .eq('status', 'pending')
        .or('agent_assigned.is.null,agent_assigned.eq.All')
        .order('priority', { ascending: false })
        .limit(5);
      
      if (!tasks?.length) return 0;
      
      let routed = 0;
      for (const task of tasks) {
        const text = ((task.description || '') + ' ' + (task.tags || []).join(' ')).toLowerCase();
        let best = { agent: 'HDM', score: 0 };
        
        for (const [agentName, wisdom] of Object.entries(AGENT_WISDOM)) {
          if (agentName === 'EVO') continue;  // EVO doesn't take regular tasks
          const score = wisdom.specialties.filter(k => text.includes(k)).length;
          if (score > best.score) best = { agent: agentName, score };
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
      
      if (!tasks?.length) return null;
      
      const task = tasks[0];
      
      await this.supabase
        .from('trinity_tasks')
        .update({ 
          status: 'in_progress',
          started_at: new Date().toISOString()
        })
        .eq('id', task.id);
      
      await this.log('task_claimed', `Working on: ${task.title || task.id}`);
      return task;
    } catch (err) {
      console.error(`[${this.name}] Claim error:`, err.message);
      return null;
    }
  }

  async completeTask(taskId, result, certainty = 0.85, isReal = true, extras = {}) {
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
            reasoning_depth: extras.reasoningDepth || 1,
            reflected: extras.reflected || false,
            version: '4.0.0-evolving-wisdom',
            timestamp: new Date().toISOString()
          },
          certainty,
          completed_at: new Date().toISOString(),
          completed_by: this.name,
          is_real: isReal
        })
        .eq('id', taskId);
      
      const { data: task } = await this.supabase
        .from('trinity_tasks')
        .select('priority')
        .eq('id', taskId)
        .single();
      
      let repidGain = Math.min(REPID.TASK_COMPLETE_MAX, 
        REPID.TASK_COMPLETE_BASE + (task?.priority || 5));
      
      // Add bonuses
      if (isReal) repidGain += 2;
      if (extras.repidBonus) repidGain += extras.repidBonus;
      
      await this.updateRepID(repidGain, `Completed task ${taskId}`);
      await this.log('task_completed', `✅ Finished task ${taskId}`, { certainty, isReal, ...extras });
    } catch (err) {
      console.error(`[${this.name}] Complete error:`, err.message);
    }
  }

  // ============================================
  // PEER VERIFICATION (Article 5)
  // ============================================

  async reviewPeerWork() {
    if (!this.supabase || this.tier !== 'senior') return;  // Only seniors review
    
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
        const { data: existing } = await this.supabase
          .from('repid_challenges')
          .select('id')
          .eq('task_id', task.id)
          .eq('challenger', this.name);
        
        if (existing?.length > 0) continue;
        
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
      reason: `Certainty ${task.certainty} < ${CERTAINTY_THRESHOLD}`,
      outcome: 'pending',
      created_at: new Date().toISOString()
    });
    
    this.challengesToday++;
    await this.log('challenge_issued', `⚔️ Challenged ${task.agent_assigned} on task ${task.id}`);
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
        .eq('is_real', true)
        .gte('certainty', CERTAINTY_THRESHOLD)
        .order('completed_at', { ascending: false })
        .limit(5);
      
      if (data?.length > 0) {
        await this.log('peer_learning', `📚 Studied ${data.length} peer solutions`);
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
  // MAIN LOOP - THE EVOLVING WISDOM
  // ============================================

  async run(customProcessTask = null) {
    console.log('═'.repeat(60));
    console.log(`[${this.name}] 🚀 Constitutional Agent v4.0.0 - EVOLVING WISDOM`);
    console.log(`[${this.name}] 🧠 LLM Providers: ${this.availableProviders.join(', ') || 'NONE'}`);
    console.log(`[${this.name}] 📜 Role: ${this.wisdom.role} (${this.tier})`);
    console.log(`[${this.name}] 🎯 Reasoning: ${this.wisdom.reasoningStyle}`);
    console.log('═'.repeat(60));
    
    await this.log('startup', `${this.name} online - Evolving Wisdom mode`, {
      providers: this.availableProviders,
      tier: this.tier,
      version: '4.0.0'
    });
    
    let cycleCount = 0;
    
    while (true) {
      try {
        cycleCount++;
        
        await this.heartbeat();
        await this.checkRotation();
        
        if (this.isConductor) {
          await this.routePendingTasks();
          await this.checkTenure();
        }
        
        // Process own tasks
        const task = await this.claimNextTask();
        if (task) {
          let result;
          
          // Try custom processor first
          if (customProcessTask) {
            result = await customProcessTask(task);
          }
          
          // Auto-upgrade templates to real AI
          if (!result || this.looksLikeTemplate(result?.output)) {
            if (result) {
              console.log(`[${this.name}] 🔄 Upgrading template to real AI...`);
            }
            result = await this.intelligentProcess(task);
          }
          
          if (result) {
            await this.completeTask(
              task.id, 
              result.output, 
              result.certainty || 0.85, 
              result.isReal !== false,
              {
                reasoningDepth: result.reasoningDepth,
                reflected: result.reflected,
                repidBonus: result.repidBonus
              }
            );
          }
        }
        
        // Peer review (seniors only)
        if (this.tier === 'senior') {
          await this.reviewPeerWork();
        }
        
        // Store metrics every 10 cycles
        if (cycleCount % 10 === 0) {
          await this.storeMetrics();
        }
        
        await new Promise(r => setTimeout(r, 30000));
        
      } catch (err) {
        console.error(`[${this.name}] ❌ Error:`, err.message);
        await this.log('error', err.message, { stack: err.stack });
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }
}

module.exports = { 
  ConstitutionalAgent, 
  REPID, 
  AGENT_WISDOM, 
  LLM_PROVIDERS,
  REFLECTION_THRESHOLD,
  REASONING_DEPTH_TARGET
};
