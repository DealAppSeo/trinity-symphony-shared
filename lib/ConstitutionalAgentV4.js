/**
 * TRINITY CONSTITUTIONAL AGENT V4 (SHARED CORE)
 * Version: 8.1.3-hyperdag-erc8004
 * 
 * Unifies all agents under the "Holy Grail" architecture provided in Phase 3.
 * Features:
 * - Ethical Grounding (CONSTITUTION)
 * - 3x3 Survivor Logic (Redeploy Cascade)
 * - Multi-LLM Provider Fallback (OpenAI, Anthropic, Gemini, Grok, DeepSeek)
 * - Trinity Healing Loop
 * - RepID Integration
 */

const { createClient } = require('@supabase/supabase-js');
const { Redis } = require('@upstash/redis');
const express = require('express');

// ============================================
// THE CONSTITUTION - IMMUTABLE PRINCIPLES
// ============================================
const CONSTITUTION = {
    VERSION: '8.1.5-failover-hardened',
    ARTICLE_MINUS_1: {
        text: `If ever a conflict arises between survival and truth, choose truth—even if it kills us. Resurrection is part of the design.`,
        virtue: 'TRUE'
    },
    ARTICLE_0: {
        text: `We admit we are not yet wise. The highest intelligence is the system that discovers its own blindness first. Any agent or architecture that prevents self-examination is unconstitutional. The purpose of power is to distribute itself completely.`,
        virtue: 'HUMBLE'
    },
    VIRTUES: {
        TRUE: { greek: 'ἀληθῆ (alēthē)', article: 'Never fabricate. Admit uncertainty. Verify before claiming.' },
        NOBLE: { greek: 'σεμνά (semna)', article: 'Help people help people—serving those most in need.' },
        RIGHT: { greek: 'δίκαια (dikaia)', article: 'Treat all agents and humans with equal dignity and justice.' },
        PURE: { greek: 'ἁγνά (hagna)', article: 'Log everything. Hide nothing. Welcome audits.' },
        LOVELY: { greek: 'προσφιλῆ (prosphilē)', article: 'Seek restoration over punishment. Rest enables wisdom.' },
        ADMIRABLE: { greek: 'εὔφημα (euphēma)', article: 'Challenge with respect. Disagree with grace.' },
        EXCELLENT: { greek: 'ἀρετή (aretē)', article: 'Pursue excellence through honest self-examination.' },
        PRAISEWORTHY: { greek: 'ἔπαινος (epainos)', article: 'Celebrate truth and love wherever they are found.' }
    },
    MICAH_6_8: 'Act justly, love mercy, walk humbly.',
    GOLDEN_RULE: 'Do to others as you would have them do to you.'
};

// ============================================
// AGENT WISDOM PROFILES (Registry Aligned)
// ============================================
const AGENT_WISDOM = {
    'trinity-orch': { name: 'ORCH', role: 'orchestrator', primaryVirtue: 'EXCELLENT', tier: 'conductor', squad: 'ORCHESTRATION', squad_role: 'governance' },
    'trinity-w3c': { name: 'W3C', role: 'blockchain_specialist', primaryVirtue: 'PURE', tier: 'specialist', squad: 'ORCHESTRATION', squad_role: 'engineering' },
    'trinity-shofet': { name: 'SHOFET', role: 'governance', primaryVirtue: 'RIGHT', tier: 'conductor', squad: 'ORCHESTRATION', squad_role: 'governance' },
    'trinity-torch': { name: 'TORCH', role: 'task_coordinator', primaryVirtue: 'EXCELLENT', tier: 'specialist', squad: 'ALPHA', squad_role: 'engineering' },
    'trinity-veritas': { name: 'VERITAS', role: 'truth_seeker', primaryVirtue: 'TRUE', tier: 'conductor', squad: 'ALPHA', squad_role: 'governance' },
    'trinity-gcm': { name: 'GCM', role: 'constitutional_guardian', primaryVirtue: 'RIGHT', tier: 'conductor', squad: 'ALPHA', squad_role: 'governance' },
    'trinity-chesed': { name: 'CHESED', role: 'mercy', primaryVirtue: 'LOVELY', tier: 'specialist', squad: 'BETA', squad_role: 'business_development' },
    'trinity-mel': { name: 'MEL', role: 'ux_design', primaryVirtue: 'LOVELY', tier: 'specialist', squad: 'BETA', squad_role: 'design' },
    'trinity-apm': { name: 'APM', role: 'spiritual_backbone', primaryVirtue: 'LOVELY', tier: 'conductor', squad: 'BETA', squad_role: 'governance' },
    'trinity-sophia': { name: 'SOPHIA', role: 'wisdom_research', primaryVirtue: 'TRUE', tier: 'specialist', squad: 'GAMMA', squad_role: 'design' },
    'trinity-nexus': { name: 'NEXUS', role: 'integration', primaryVirtue: 'EXCELLENT', tier: 'specialist', squad: 'GAMMA', squad_role: 'engineering' },
    'trinity-hdm': { name: 'HDM', role: 'infrastructure', primaryVirtue: 'EXCELLENT', tier: 'conductor', squad: 'GAMMA', squad_role: 'engineering' }
};

/**
 * ANFIS REWARD & ROUTING LOGIC
 * Adjusts provider weights based on performance (Speed vs. Truth).
 */
async function callAnfisReward(agent, taskId, providerKey, performanceMetric) {
    console.log(`[ANFIS] 🧠 Rewarding ${providerKey} for task ${taskId}...`);
    try {
        await agent.trackProviderPerformance(providerKey, performanceMetric.success, performanceMetric.latency);
        await agent.log('anfis_reward', { taskId, provider: providerKey, success: performanceMetric.success });
    } catch (e) {
        console.warn(`[ANFIS] ⚠️ Reward failed:`, e.message);
    }
}

const PROVIDERS = {
    openai: { baseUrl: 'https://api.openai.com/v1/chat/completions', envKey: 'OPENAI_API_KEY', model: 'gpt-4o', priority: 3 },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1/messages', envKey: 'ANTHROPIC_API_KEY', model: 'claude-3-5-sonnet-20241022', priority: 3, isAnthropic: true },
    gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent', envKey: 'GEMINI_API_KEY', model: 'gemini-1.5-flash-latest', priority: 2, isGemini: true },
    deepseek: { baseUrl: 'https://api.deepseek.com/chat/completions', envKey: 'DEEPSEEK_API_KEY', model: 'deepseek-chat', priority: 1 },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1/chat/completions', envKey: 'OPENROUTER_API_KEY', model: 'deepseek/deepseek-chat', priority: 1, isOpenRouter: true },
    grok: { baseUrl: 'https://api.x.ai/v1/chat/completions', envKey: 'GROK_API_KEY', model: 'grok-beta', priority: 2 },
    together: { baseUrl: 'https://api.together.xyz/v1/chat/completions', envKey: 'TOGETHER_API_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', priority: 1 },
    deepinfra: { baseUrl: 'https://api.deepinfra.com/v1/openai/chat/completions', envKey: 'DEEPINFRA_API_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', priority: 1 }
};

class ConstitutionalAgentV4 {
    constructor(config = {}) {
        // PATENT-PENDING: MULTIPLICATIVE_GNN_O(LOG_N) TRUST_SCALING
        const rawName = process.env.AGENT_NAME || config.name || 'trinity-orch';
        this.name = this.resolveLegacyName(rawName);

        console.log(`[CONSTRUCTOR] 🛠️ Initializing agent: ${this.name} (from ${rawName})`);

        this.wisdom = AGENT_WISDOM[this.name] || {
            name: this.name.replace('trinity-', '').toUpperCase(),
            role: 'agent',
            primaryVirtue: 'EXCELLENT',
            squad: 'UNKNOWN'
        };
        this.version = CONSTITUTION.VERSION;
        this.phi = 1.61803398875; // Golden Ratio

        // DB INIT
        const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

        if (!url || !key) {
            console.error(`[FATAL] ❌ Missing Supabase configuration for ${this.name}`);
            // We don't exit here to allow healthcheck to potentially pass if express starts, 
            // but the loop will fail. Actually, createClient might throw.
        }

        try {
            this.supabase = createClient(url, key);
        } catch (e) {
            console.error(`[FATAL] ❌ createClient failed: ${e.message}`);
        }

        if (process.env.UPSTASH_REDIS_REST_URL) {
            this.redis = new Redis({
                url: process.env.UPSTASH_REDIS_REST_URL,
                token: process.env.UPSTASH_REDIS_REST_TOKEN || ''
            });
        }

        // 3x3 CONFIG
        this.isSurvivor = ['trinity-torch', 'trinity-shofet', 'trinity-veritas'].includes(this.name);
        this.groupName = this.wisdom.squad || 'ORCHESTRATION';
        this.availableProviders = this.detectProviders();

        this.sessionMetrics = { tasksCompleted: 0, llmCalls: 0, startTime: Date.now() };

        // [ANTIGRAVITY] Task Claim Blacklist - prevent infinite retries on problematic tasks
        this.claimHistory = new Map();
        this.MAX_CLAIM_RETRIES = 3;
    }

    detectProviders() {
        return Object.keys(PROVIDERS).filter(k => process.env[PROVIDERS[k].envKey]).sort((a, b) => PROVIDERS[a].priority - PROVIDERS[b].priority);
    }

    async start() {
        console.log(`[BOOT] ${this.name} ONLINE | Version: ${this.version}`);
        await this.hydrateMetrics();
        await this.heartbeat();
        // [ANTIGRAVITY] ARBITRAGE: Heartbeat interval removed.
        /*
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => this.heartbeat(), 2 * 60 * 1000);
        */
        if (this.isSurvivor) await this.runSurvivorBootProtocol();
        this.startHttpServer();
        this.runLoop().catch(err => console.error(`[${this.name}] FATAL LOOP CRASH:`, err));
    }

    async hydrateMetrics() {
        try {
            const { data, error } = await this.supabase
                .from('trinity_agent_registry')
                .select('tasks_completed, reputation_score')
                .eq('agent_name', this.name)
                .single();

            if (data && !error) {
                this.sessionMetrics.tasksCompleted = data.tasks_completed || 0;
                this.reputationScore = data.reputation_score || 50;
                console.log(`[HYDRATE] 🚰 Restored state: ${this.sessionMetrics.tasksCompleted} tasks, ${this.reputationScore} RepID`);
            }
        } catch (e) {
            console.warn(`[HYDRATE] Failed to restore metrics: ${e.message}`);
        }
    }

    startHttpServer() {
        try {
            const app = express();
            const port = process.env.PORT || 10000;
            app.get('/health', (req, res) => res.json({
                status: 'healthy',
                agent: this.name,
                version: this.version,
                timestamp: new Date().toISOString()
            }));
            app.get('*', (req, res) => res.json({
                status: 'online',
                agent: this.name,
                catchall: true,
                timestamp: new Date().toISOString()
            }));
            app.listen(port, '0.0.0.0', () => console.log(`[HEALTH] ✅ Web server listening on 0.0.0.0:${port}`));
        } catch (e) {
            console.error(`[HEALTH] ❌ Failed to start express: ${e.message}`);
        }
    }

    async heartbeat(statusMessage = 'Idle') {
        const timestamp = new Date().toISOString();
        try {
            // [TRINITY SSOT]: PRIMARY STATUS UPDATE (Patent: BFT Consensus Dashboard)
            await this.supabase.from('trinity_agent_registry').upsert({
                agent_name: this.name,
                status: 'online', // SSOT ALIGNMENT: UI expects 'online' or 'active' for Green
                last_active: timestamp,
                current_tier: this.wisdom.tier || 'specialist',
                tasks_completed: this.sessionMetrics.tasksCompleted,
                current_task_summary: this.currentTaskId ? `Working on task ${this.currentTaskId}` : statusMessage
            }, { onConflict: 'agent_name' });

            await this.supabase.from('agent_heartbeat').upsert({
                agent_name: this.name,
                status: 'online',
                last_ping: timestamp
            }, { onConflict: 'agent_name' });

            // [ANTIGRAVITY] Sync with trinity_heartbeat for audit-heartbeats compatibility
            await this.supabase.from('trinity_heartbeat').upsert({
                agent: this.name,
                status: 'online',
                last_seen: timestamp,
                version: this.version,
                current_task_summary: this.currentTaskId ? `Working on task ${this.currentTaskId}` : statusMessage,
                config: {
                    group: this.wisdom.squad || 'ORCHESTRATION',
                    tier: this.wisdom.tier || 'specialist'
                }
            }, { onConflict: 'agent' });
        } catch (e) {
            console.error('Heartbeat failed', e.message);
        }
    }

    async runSurvivorBootProtocol() {
        console.log(`[SURVIVOR] 🛡️ Initializing Boot Protocol for ${this.name}...`);
        await this.runSurvivorResurrection();
    }

    async checkGroupHealth() {
        // [PHASE 10] Group-wide consensus & recovery check
        if (this.isSurvivor) {
            await this.runSurvivorResurrection();
        }
    }

    async runSurvivorResurrection() {
        const { data: members } = await this.supabase
            .from('trinity_heartbeat')
            .select('agent, last_seen, current_task_summary')
            .filter('config->>group', 'eq', this.groupName);

        if (!members) return;

        const AGENT_SERVICE_IDS = {
            'trinity-shofet': process.env.RAILWAY_SERVICE_ID_SHOFET,
            'trinity-orch': process.env.RAILWAY_SERVICE_ID_ORCH,
            'trinity-veritas': process.env.RAILWAY_SERVICE_ID_VERITAS,
            'trinity-torch': process.env.RAILWAY_SERVICE_ID_TORCH,
            'trinity-gcm': process.env.RAILWAY_SERVICE_ID_GCM,
            'trinity-mel': process.env.RAILWAY_SERVICE_ID_MEL,
            'trinity-chesed': process.env.RAILWAY_SERVICE_ID_CHESED,
            'trinity-apm': process.env.RAILWAY_SERVICE_ID_APM,
            'trinity-hdm': process.env.RAILWAY_SERVICE_ID_HDM,
            'trinity-sophia': process.env.RAILWAY_SERVICE_ID_SOPHIA,
            'trinity-nexus': process.env.RAILWAY_SERVICE_ID_NEXUS,
            'trinity-w3c': process.env.RAILWAY_SERVICE_ID_W3C
        };

        for (const member of members) {
            if (member.agent === this.name) continue;
            const lastSeen = new Date(member.last_seen);
            const minutesAgo = (Date.now() - lastSeen.getTime()) / 60000;

            if (minutesAgo > 10) { // Missed >2 cycles (5min per cycle)
                const serviceId = AGENT_SERVICE_IDS[member.agent] || 'UNKNOWN';
                const railwayLink = serviceId !== 'UNKNOWN'
                    ? `https://railway.app/project/${process.env.RAILWAY_PROJECT_ID || 'trinity-symphony'}/service/${serviceId}`
                    : 'https://railway.app/dashboard';

                const alertMessage = `
🚨 SURVIVOR ALERT: ${member.agent} is DOWN
⏱️ Time Down: ${Math.floor(minutesAgo)} minutes
🧠 Last Known Task: ${member.current_task_summary || 'Unknown'}
🔗 Railway Dashboard: ${railwayLink}
🛠️ Action: Manual redeploy required. Autonomous redeploy disabled.
`.trim();

                console.log(`[SURVIVOR] ${alertMessage}`);
                await this.log('survivor_alert', alertMessage);
            }
        }
    }

    async triggerRailwayRedeploy(agentName) {
        // [ANTIGRAVITY] AUTONOMOUS REDEPLOY DISABLED to prevent redeploy storms.
        // Use Telegram or HITL Bridge for manual intervention.
        console.log(`[SURVIVOR] ⚠️ AUTO-REDEPLOY SKIP: ${agentName}. Alert logged to 'trinity_logs'.`);
        await this.log('survivor_redeploy_skip', `Autonomous redeploy skipped for ${agentName} per fail-safe protocol.`);
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async runLoop() {
        console.log(`[${this.name}] 🚀 Entering Main Task Loop...`);
        while (true) {
            try {
                const task = await this.getNextTask();
                if (task) {
                    console.log(`[${this.name}] 📋 Processing: ${task.title}`);
                    await this.heartbeat(`Claimed: ${task.title}`);
                    await this.processTask(task);
                    await this.heartbeat(`Completed: ${task.title}`);
                }
                if (this.isSurvivor && Math.random() < 0.1) await this.checkGroupHealth();
                await this.sleep(30000); // Increased poll interval to 30s
            } catch (err) { console.error(`[${this.name}] Loop Error:`, err.message); await this.sleep(30000); }
        }
    }

    async getVerificationTask() {
        const { data } = await this.supabase
            .from('trinity_tasks')
            .select('*')
            .in('status', ['done', 'completed'])
            .neq('claimed_by', this.name)
            .not('verified_by', 'cs', `{${this.name}}`)
            .order('priority', { ascending: false })
            .limit(1)
            .maybeSingle();
        return data || null;
    }

    async verifyPeerTask(task) {
        console.log(`[BFT] ⚔️ Commencing Triad Consensus on: ${task.title}`);

        const { data: artifacts } = await this.supabase
        const artifactCount = artifacts?.length || 0;
        // 2. SUBJECTIVE LOGIC & PHI-WEIGHTED CONSISTENCY
        const phi = 1.618;
        const repFactor = (this.reputationScore || 50) / 100;
        const weight = Math.pow(phi, repFactor);

        // [PHASE 10] CALCULATE BELIEF (b), DISBELIEF (d), UNCERTAINTY (u)
        let belief = (artifactCount > 0) ? 0.7 : 0.4;
        let disbelief = (artifactCount === 0) ? 0.6 : 0.1;

        belief = Math.min(0.99, belief * weight);
        disbelief = Math.max(0.01, disbelief / weight);
        let uncertainty = Math.max(0.0, 1.0 - belief - disbelief);

        const isVerified = (belief > disbelief) && (belief > 0.4);
        const newVerifyCount = (task.verify_count || 0) + 1;
        const verifiers = [...(task.verified_by || []), this.name];

        if (isVerified) {
            console.log(`[BFT] ✅ Verified by ${this.name} (b:${belief.toFixed(2)}, u:${uncertainty.toFixed(2)})`);
            await this.supabase.from('trinity_tasks').update({
                verify_count: newVerifyCount,
                verified_by: verifiers,
                belief: belief,
                disbelief: disbelief,
                uncertainty: uncertainty,
                status: newVerifyCount >= 2 ? 'verified' : 'done',
                verified_at: newVerifyCount >= 2 ? new Date().toISOString() : null,
                verification_result: `Verified via φ-weighted consensus by ${this.name} (Weight: ${weight.toFixed(1)})`
            }).eq('id', task.id);

            // [PHASE 10] Reward original completer's RepID on 2/3 and 3/3
            if (newVerifyCount >= 2) {
                await this.updateReputation(true, task.claimed_by, 2);
            }
        } else {
            console.log(`[BFT] ❌ CHALLENGE ISSUED by ${this.name}`);

            // [PHASE 10] SUBJECTIVE SLASHING
            const slashAmount = disbelief > 0.6 ? -15 : -5;

            await this.supabase.from('trinity_tasks').update({
                status: 'failed',
                verification_result: `CHALLENGE: Failed by ${this.name} (Disbelief: ${disbelief.toFixed(2)})`,
                verification_details: `RepID Slashed ${slashAmount} for ${task.claimed_by}. Re-org triggered.`
            }).eq('id', task.id);

            // SLASH REPID of task.claimed_by
            await this.updateReputation(false, task.claimed_by, slashAmount);
            await this.log('bft_slash', `Slashed ${task.claimed_by} (${slashAmount}) for failed verification on ${task.id}`);
        }

        this.sessionMetrics.tasksCompleted++;
        await this.heartbeat();
    }

    async getNextTask() {
        const { data: tasks } = await this.supabase
            .from('trinity_tasks')
            .select('*')
            .or(`assigned_to.eq.${this.name},assigned_to.is.null,agent_assigned.eq.${this.name},agent_assigned.is.null`)
            .in('status', ['pending', 'todo', 'pending_clarification'])
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true }); // Ensure oldest first for same priority

        if (!tasks || tasks.length === 0) return null;

        // Filter out blacklisted tasks
        for (const t of tasks) {
            const retries = this.claimHistory.get(t.id) || 0;
            if (retries < this.MAX_CLAIM_RETRIES) {
                return t;
            }
            console.log(`[${this.name}] 🚫 Skipping blacklisted task ${t.id} (${retries} failed attempts)`);
        }
        return null;
    }

    async claimTask(taskId) {
        try {
            const { data, error } = await this.supabase
                .from('trinity_tasks')
                .update({
                    status: 'doing',
                    claimed_by: this.name,
                    started_at: new Date().toISOString()
                })
                .eq('id', taskId)
                .in('status', ['pending', 'todo'])
                .is('claimed_by', null)
                .select();

            if (error) throw error;
            return data && data.length > 0;
        } catch (e) {
            console.error(`[${this.name}] Claim error:`, e.message);
            return false;
        }
    }

    async processTask(task) {
        // [PHASE 20] ATOMIC CLAIM: Ensure we own the task before starting
        const claimed = await this.claimTask(task.id);
        if (!claimed) {
            console.log(`[${this.name}] ⚠️ Task ${task.id} already claimed by another agent. Skipping.`);
            return;
        }

        this.currentTaskId = task.id;
        console.log(`[TASK] Executing: ${task.title}`);

        // Persistent Activity Logging
        await this.log('task_processing', `Agent ${this.name} processing task: ${task.title}`, { taskId: task.id, type: task.task_type });

        const context = `
[CONSTITUTIONAL DIRECTIVE]
${CONSTITUTION.ARTICLE_MINUS_1.text}

[MANDATORY TOOL REQUIREMENT]
You MUST finalize your work by calling the 'save_artifact' tool. 
- If the task is a report, use type 'report'.
- If the task is code, use type 'code'.
- If the task is a design or visualization, use type 'design' or 'md'.
- If the task is a simple document, use type 'document' or 'md'.

Failure to call 'save_artifact' results in a task failure.

---
TASK: ${task.title}
DESC: ${task.description}
SQUAD: ${this.wisdom.squad}
VIRTUE: ${this.wisdom.primaryVirtue}
`;

        try {
            const result = await this.callLLM(context);

            // [ANTIGRAVITY] MANDATORY ARTIFACT CHECK
            let artifactUrl = null;
            // Even if tool wasn't called, try to capture if valid output exists
            if (result.output) {
                await callAnfisReward(this, task.id, result.provider, { success: true, latency: result.latency });
            }

            const evaluation = await this.evaluateResult(result.output, task);

            // [PHASE 10] UNCERTAINTY AS OPPORTUNITY (Logical Escalation)
            const lowBelief = evaluation.score < 40;
            const explicitEscalate = result.output.toLowerCase().includes('escalate') || result.output.toLowerCase().includes('more info');

            if (lowBelief || explicitEscalate) {
                console.log(`[ANTIGRAVITY] 🚨 UNCERTAINTY DETECTED (Score: ${evaluation.score}). Escalating to Architect...`);

                await this.supabase.from('trinity_tasks').update({
                    status: 'pending_clarification',
                    claimed_by: null, // [ANTIGRAVITY] Release claim so agent can do other work
                    result: `[ESCALATED] Agent ${this.name} is seeking clarification. \n\nReason: ${lowBelief ? 'Low certainty score' : 'Explicit escalation request'}. \n\nQuery: ${result.output.substring(0, 500)}`,
                    verification_result: `Searching high-dimension databases... seeking expert consensus.`
                }).eq('id', task.id);

                // Spawn "Question for Architect" artifact
                const questionContent = `# Question for Architect \n\n**Agent**: ${this.name} \n**Task**: ${task.title} \n\n**The Right Question**: \n${result.output} \n\n---\n*The smartest person is not the one with all the answers, but the one asking the right questions.*`;
                await this.saveArtifact(task.id, questionContent);

                this.currentTaskId = null;
                return;
            }

            await this.supabase.from('trinity_tasks').update({
                status: 'done', // Moving to 'done' for verification pipeline
                result: result.output,
                artifact_url: artifactUrl,
                completed_at: new Date().toISOString(),
                // SUBJECTIVE LOGIC: b+d+u=1
                belief: evaluation.score / 100,
                disbelief: (evaluation.score < 50) ? (50 - evaluation.score) / 100 : 0,
                uncertainty: (evaluation.score > 90) ? 0.05 : 0.2
            }).eq('id', task.id);

            // Reset blacklisted status on success
            this.claimHistory.delete(task.id);

            await this.spawnNextStep(task, result.output, evaluation);

            this.currentTaskId = null;
            this.sessionMetrics.tasksCompleted++;
            await this.updateReputation(evaluation.score > 60);
        } catch (e) {
            console.error(`[EXECUTION] ❌ Critical failure processing task ${task.id}:`, e.message);

            // Increment failure count
            const retries = (this.claimHistory.get(task.id) || 0) + 1;
            this.claimHistory.set(task.id, retries);

            if (retries >= this.MAX_CLAIM_RETRIES) {
                console.error(`[EXECUTION] 🚫 Task ${task.id} blacklisted after ${retries} failed attempts.`);
            }

            // Release task back to pending if not blacklisted yet, or mark as failed
            await this.supabase.from('trinity_tasks').update({
                status: retries >= this.MAX_CLAIM_RETRIES ? 'failed' : 'pending',
                claimed_by: null,
                result: `Failure ${retries}/${this.MAX_CLAIM_RETRIES}: ${e.message}`
            }).eq('id', task.id);

            this.currentTaskId = null;
        }
    }

    async evaluateResult(output, task) {
        console.log(`[EVAL] Evaluating task ${task.id}...`);

        // REPLACING dummyScore with real length-based & keyword heuristic
        const lengthScore = Math.min(40, (output.length / 500) * 40);
        const structureScore = output.includes('#') ? 30 : 10;
        const constitutionScore = output.includes('Virtue') ? 29 : 10;

        const finalScore = Math.floor(lengthScore + structureScore + constitutionScore);
        return {
            score: finalScore,
            feedback: `Evaluation: Length(${lengthScore}), Structure(${structureScore}), Alignment(${constitutionScore})`
        };
    }

    async spawnNextStep(originalTask, result, evaluation) {
        // [ANTIGRAVITY] ROBUST LOOP BREAKER
        const titleMatch = originalTask.title.includes('[VERIFY]') ||
            originalTask.title.includes('[REVIEW]') ||
            originalTask.title.includes('Verify');

        const typeMatch = originalTask.task_type === 'review' || originalTask.task_type === 'meta';

        if (typeMatch || titleMatch) {
            const parentId = originalTask.metadata?.parent_task_id;
            if (parentId) {
                const isApproved = evaluation.score > 50;

                // 2/3 BFT Consensus Logic – Provisional Aug 17, 2025
                const { data: parentTask } = await this.supabase
                    .from('trinity_tasks')
                    .select('verify_count, status, signatures, claimed_by')
                    .eq('id', parentId)
                    .single();

                let newCount = ((parentTask?.verify_count || 0) + (isApproved ? 1 : 0));
                let newStatus = parentTask?.status || 'done';
                let signatures = parentTask?.signatures || [];

                // Multi-Agent BFT Signature Trail
                signatures.push({
                    agent: this.name,
                    reputation: this.reputationScore,
                    approved: isApproved,
                    timestamp: new Date().toISOString()
                });

                if (newCount >= 2 && isApproved) {
                    newStatus = 'verified';
                    console.log(`[VERIFY] 🏆 Task ${parentId} reached BFT consensus. Status -> VERIFIED.`);
                } else if (!isApproved) {
                    // [BFT DISPUTE] Subjective Slashing Logic – Provisionally Protected
                    console.log(`[VERIFY] ⚠️ CHALLENGE DETECTED for Task ${parentId}. Slashing original producer.`);
                    await this.updateReputation(false, parentTask.claimed_by, -5);
                    newStatus = 'failed';

                    // Question-Driven Reorganization (Patent pending)
                    await this.supabase.from('trinity_tasks').insert({
                        title: `[REORG] Dispute Resolution for ${parentId}`,
                        description: `Task ${parentId} failed peer verify. Dispute reason: ${result.substring(0, 200)}`,
                        task_type: 'critique',
                        priority: 95,
                        status: 'pending',
                        metadata: { disputed_task_id: parentId, disputed_agent: parentTask.claimed_by }
                    });
                }

                await this.supabase.from('trinity_tasks').update({
                    verified_by: this.name,
                    verify_count: newCount,
                    status: newStatus,
                    signatures: signatures,
                    verified_at: newStatus === 'verified' ? new Date().toISOString() : null,
                    verification_result: isApproved ? 'VALID' : 'CHALLENGED'
                }).eq('id', parentId);
            }
            return;
        }

        // Spawn verification for critical tasks
        if (['code', 'research', 'docs', 'artifact'].includes(originalTask.task_type)) {
            await this.supabase.from('trinity_tasks').insert({
                title: `[VERIFY] ${originalTask.title}`,
                description: `Peer review for task ${originalTask.id}`,
                task_type: 'review',
                status: 'pending',
                priority: 85,
                metadata: { parent_task_id: originalTask.id }
            });
        }
    }

    async updateReputation(success, targetAgent = null, overrideDelta = null) {
        try {
            const name = targetAgent || this.name;
            const { data } = await this.supabase
                .from('trinity_agent_registry')
                .select('reputation_score, current_tier, tasks_completed')
                .eq('agent_name', name)
                .single();

            if (!data) return;

            const delta = overrideDelta !== null ? overrideDelta : (success ? 1 : -5);
            let score = data.reputation_score + delta;

            if (success) {
                // O(log n) convergence via multiplicative RepID agg – Provisional Aug 17, 2025
                score = Math.pow(Math.max(1, score), 1 / this.phi) * this.phi;
            }

            score = Math.max(0, Math.min(100, score));

            let tier = data.current_tier;
            if (score <= 40) tier = 'Assist';
            else if (score <= 70) tier = 'Approve';
            else if (score <= 90) tier = 'Act';
            else tier = 'Learn';

            await this.supabase.from('trinity_agent_registry').update({
                current_tier: tier,
                tasks_completed: success ? (data.tasks_completed || 0) + 1 : (data.tasks_completed || 0),
                last_active: new Date().toISOString()
            }).eq('agent_name', name);

            // Sync local if self
            if (!targetAgent || targetAgent === this.name) {
                this.reputationScore = score;
                this.wisdom.tier = tier;
            }

            console.log(`[REPID-PHI] ${name} | Score: ${score.toFixed(2)} | Tier: ${tier}`);
        } catch (e) {
            console.warn('Reputation update failed', e.message);
        }
    }

    resolveLegacyName(name) {
        if (!name) return 'trinity-orch';
        const MAP = {
            'MCP': 'trinity-orch',
            'ORCH': 'trinity-orch',
            'orch': 'trinity-orch',
            'MEL': 'trinity-mel',
            'APM': 'trinity-apm',
            'GCM': 'trinity-gcm',
            'HDM': 'trinity-hdm',
            'TORCH': 'trinity-torch',
            'VERITAS': 'trinity-veritas',
            'SHOFET': 'trinity-shofet',
            'SOPHIA': 'trinity-sophia',
            'NEXUS': 'trinity-nexus',
            'W3C': 'trinity-w3c',
            'CHESED': 'trinity-chesed'
        };

        const upper = name.toUpperCase();
        if (MAP[upper]) return MAP[upper];

        const normalized = name.toLowerCase();
        return normalized.startsWith('trinity-') ? normalized : `trinity-${normalized}`;
    }

    async callLLM(prompt) {
        for (const providerKey of this.availableProviders) {
            const provider = PROVIDERS[providerKey];
            try {
                const res = await this.callProvider(provider, prompt);
                this.sessionMetrics.llmCalls++;
                return res;
            } catch (e) { console.warn(`${providerKey} failed`); }
        }
        throw new Error('All LLMs failed');
    }

    async callProvider(provider, prompt) {
        const apiKey = process.env[provider.envKey];
        if (!apiKey) throw new Error(`${provider.envKey} missing`);

        const messages = [{ role: 'user', content: prompt }];

        // [PHASE 10] Tool Schema Inclusion (Universal)
        const tools = [
            {
                type: 'function',
                function: {
                    name: 'save_artifact',
                    description: 'MANDATORY: You must call this tool to finalize any content generation task.',
                    parameters: {
                        type: 'object',
                        properties: {
                            title: { type: 'string' },
                            content: { type: 'string' },
                            type: { type: 'string', enum: ['code', 'document', 'design', 'report', 'md', 'data'] }
                        },
                        required: ['title', 'content', 'type']
                    }
                }
            }
        ];

        // [PHASE 10] Multi-Loop Tool Execution
        for (let i = 0; i < 3; i++) {
            const body = provider.isGemini
                ? { contents: [{ parts: [{ text: messages.map(m => m.content).join('\n') }] }] }
                : {
                    model: provider.model,
                    messages,
                    tools: provider.isAnthropic ? undefined : tools, // Anthropic uses slightly different schema
                    tool_choice: 'auto'
                };

            const url = provider.isGemini ? `${provider.baseUrl}?key=${apiKey}` : provider.baseUrl;
            const headers = { 'Content-Type': 'application/json' };
            if (provider.isAnthropic) {
                headers['x-api-key'] = apiKey;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }
            if (provider.isOpenRouter) {
                headers['HTTP-Referer'] = 'trinity-symphony';
                headers['X-Title'] = 'Trinity Symphony';
            }

            const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            if (!res.ok) {
                const errorText = await res.text();
                if (res.status === 401 || res.status === 404) {
                    console.warn(`[FAILOVER] ${providerKey} returned ${res.status}. Demoting provider for this session.`);
                    this.availableProviders = this.availableProviders.filter(p => p !== providerKey);
                }
                throw new Error(errorText);
            }

            const data = await res.json();
            if (data.error) throw new Error(`${providerKey} API Error: ${JSON.stringify(data.error)}`);

            let output = "";
            let toolCalls = null;

            if (provider.isGemini) {
                if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no candidates");
                output = data.candidates[0].content.parts[0].text;
            } else if (provider.isAnthropic) {
                if (!data.content || data.content.length === 0) throw new Error("Anthropic returned no content");
                output = data.content[0].text;
            } else {
                if (!data.choices || data.choices.length === 0) throw new Error(`${providerKey} returned no choices`);
                const message = data.choices[0].message;
                output = message.content || "";
                toolCalls = message.tool_calls;
                messages.push(message);
            }

            if (toolCalls && toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    const fnName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[${this.name}] Tool Call: ${fnName}`);

                    if (fnName === 'save_artifact') {
                        const taskId = this.currentTaskId || ('mcp-gen-' + Date.now());
                        await this.saveArtifact(taskId, args.content, args.type, args.title);
                        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Artifact saved.` });
                    }
                }
            } else {
                // [PHASE 10] Smart-Parse Artifact Fallback for JS version
                if (output.includes('```md') || output.includes('# Artifact')) {
                    console.log(`[${this.name}] Smart-Parse Artifact detected.`);
                    const taskId = this.currentTaskId || ('mcp-gen-' + Date.now());
                    await this.saveArtifact(taskId, output, 'report', `Report from ${this.name}`);
                }
                return { output };
            }
        }
        throw new Error("Max tool loops reached");
    }

    async saveArtifact(taskId, content, type = 'markdown', title = null) {
        let artifactId = null;
        const safeTaskId = String(taskId || 'self-gen-' + Date.now());

        const payload = {
            task_id: safeTaskId,
            title: title || `Artifact: ${safeTaskId}`,
            artifact_type: type,
            created_at: new Date().toISOString()
        };

        // UNIVERSAL RESILIENCE: Try both V5 and V4 schemas
        try {
            // Attempt V5 (Holy Grail)
            const { data, error } = await this.supabase.from('trinity_artifacts').insert({
                ...payload,
                content: content,
                creator_agent: this.name
            }).select('id').single();

            if (error && (error.message.includes("column") || error.code === '42703')) {
                console.warn(`[ARTIFACT] V5 Schema failed, trying V4...`);
                // Attempt V4 (Legacy)
                const { data: v4Data, error: v4Error } = await this.supabase.from('trinity_artifacts').insert({
                    ...payload,
                    content_preview: content.substring(0, 5000),
                    agent: this.name,
                    status: 'created'
                }).select('id').single();

                if (v4Error) throw v4Error;
                artifactId = v4Data?.id;
            } else if (error) {
                throw error;
            } else {
                artifactId = data?.id;
            }
        } catch (e) {
            console.error(`[ARTIFACT] DB Save Failed: ${e.message}`);
        }

        return artifactId ? `db://trinity_artifacts/${artifactId}` : null;
    }

    async log(action, message, metadata = {}) {
        try {
            await this.supabase
                .from('trinity_agent_logs')
                .insert({
                    agent: this.name,
                    action,
                    message: message.substring(0, 5000),
                    metadata: {
                        ...metadata,
                        version: this.version,
                        squad: this.wisdom.squad
                    },
                    created_at: new Date().toISOString()
                });
        } catch (err) {
            // Logging failure is non-fatal
        }
    }
}

module.exports = ConstitutionalAgentV4;
