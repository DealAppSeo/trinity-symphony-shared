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
const WebSocket = require('ws');
const { provenance } = require('./provenance');
const { Redis } = require('@upstash/redis');
const express = require('express');
const { validateArtifactQuality } = require('./artifactGuard');
const substanceGateClient = require('./substance-gate-client');
const { withTimeout } = require('./withTimeout');
const { pgQuery, pgPing, getPgPool } = require('./direct-pg');

// Sprint 14 R-1 — per-call timeout budgets for awaits inside the loop body.
// Picked from Sprint 13 diagnostic: production observed LLM <10s, Supabase <1s.
// These values are upper bounds — a hung underlying call now becomes a thrown
// TimeoutError caught by the existing loop catch, instead of a permanent hang.
const LOOP_TIMEOUTS = {
    DB_QUERY: 10_000,         // single Supabase read/write
    LLM_OR_INTERNAL: 30_000,  // LLM calls or helpers that may LLM
    SURVIVOR_HELPER: 15_000,  // survivor multi-query helpers (group health, reaper)
    SERVICE_CONTRACT: 35_000  // ServiceContractClient — has its own 30s AbortController; outer is safety net
};

// ============================================
// THE CONSTITUTION - IMMUTABLE PRINCIPLES
// ============================================
const CONSTITUTION = {
    VERSION: '8.2.0-reflect-wired',
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
    grok: { baseUrl: 'https://api.x.ai/v1/chat/completions', envKey: 'GROK_API_KEY', model: 'grok-2', priority: 2 },
    together: { baseUrl: 'https://api.together.xyz/v1/chat/completions', envKey: 'TOGETHER_API_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', priority: 1 },
    deepinfra: { baseUrl: 'https://api.deepinfra.com/v1/openai/chat/completions', envKey: 'DEEPINFRA_API_KEY', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', priority: 1 }
};

function canonicalizeProvider(providerKey) {
    if (!providerKey) return null;
    const clean = providerKey.toLowerCase().trim();
    if (clean.includes('gemini')) return 'gemini';
    if (clean.includes('anthropic') || clean.includes('claude')) return 'anthropic';
    if (clean.includes('openai') || clean.includes('gpt')) return 'openai';
    if (clean.includes('deepseek')) return 'deepseek';
    if (clean.includes('groq') || clean.includes('grok')) return 'groq';
    if (clean.includes('cerebras')) return 'cerebras';
    if (clean.includes('cohere')) return 'cohere';
    return clean;
}

class ConstitutionalAgentV4 {
    constructor(config = {}) {
        // PATENT-PENDING: MULTIPLICATIVE_GNN_O(LOG_N) TRUST_SCALING
        const rawName = process.env.AGENT_NAME || config.name || 'trinity-orch';
        this.name = this.resolveLegacyName(rawName);

        console.log(`[CONSTRUCTOR] 🛠️ Initializing agent: ${this.name} (from ${rawName})`);
        
        const gateEnabled = process.env.HAL_SUBSTANCE_GATE_ENABLED === 'true';
        console.log(`[SUBSTANCE_GATE] Mode: ${gateEnabled ? 'ENFORCING' : 'SHADOW'}`);
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
            this.supabase = createClient(url, key, { realtime: { transport: WebSocket } });
        console.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');
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

        this.sessionMetrics = { tasksCompleted: 0, tasksFailed: 0, llmCalls: 0, startTime: Date.now() };

        // Sprint 14 R-3 — per-iteration progress counter, published to
        // agent_heartbeat from inside the loop. Distinguishes "loop is
        // iterating" from "loop hung but heartbeat setInterval still firing"
        // (the false-positive that hid Sprint 13's 17h staggered freeze).
        this.loopCount = 0;

        // [ANTIGRAVITY] Task Claim Blacklist - prevent infinite retries on problematic tasks
        this.claimHistory = new Map();
        this.MAX_CLAIM_RETRIES = 3;

        // Phase 7C (Unbounded Wait Disease — heartbeat resilience) — circuit
        // breaker against sustained-degraded Supabase. heartbeat() runs every
        // 120s via setInterval AND inline within runLoop. Without bounded
        // upserts, a slow upstream pinned each call until network completed,
        // piling up in-flight requests + delaying the runLoop. With this
        // breaker: after HEARTBEAT_CIRCUIT_OPEN_THRESHOLD consecutive failures,
        // future heartbeat() calls short-circuit return until the cool-down
        // window passes. Counter resets on first full success.
        // Per CLAUDE-RULE-8 NEVER UNBOUNDED WAIT.
        this.consecutiveHeartbeatFailures = 0;
        this.heartbeatCircuitOpenUntil = 0;          // ms timestamp; 0 = closed
        this.heartbeatCircuitOpenLogged = false;
        this.resolveAgentUuid();
        this.inFlightCount = 0;
        this.maxConcurrency = parseInt(process.env.MAX_CONCURRENCY || '5', 10);
        this.taskArtifacts = new Map();
        this.activeTaskIds = new Set();
    }

    get HEARTBEAT_CIRCUIT_OPEN_THRESHOLD() { return 5; }
    get HEARTBEAT_CIRCUIT_OPEN_SLEEP_MS() { return 5 * 60 * 1000; }

    detectProviders() {
        return Object.keys(PROVIDERS).filter(k => process.env[PROVIDERS[k].envKey]).sort((a, b) => PROVIDERS[a].priority - PROVIDERS[b].priority);
    }

    get isEscalationContractEnabled() {
        return process.env.ESCALATION_CONTRACT === 'true';
    }

    get currentTaskId() {
        if (!this.activeTaskIds || this.activeTaskIds.size === 0) return null;
        return [...this.activeTaskIds][0];
    }

    set currentTaskId(val) {
        if (!this.activeTaskIds) this.activeTaskIds = new Set();
        if (val) {
            this.activeTaskIds.add(val);
        } else if (this.activeTaskIds.size <= 1) {
            this.activeTaskIds.clear();
        }
    }

    async start() {
        console.log(`[BOOT] ${this.name} ONLINE | Version: ${this.version}`);
        // PostgREST bypass (2026-05-21) — boot diagnostic. heartbeat/getNextTask/
        // claimTask now use direct-pg, so confirm pooler reachability up front.
        // Loud, non-fatal: a failure here means this agent can't heartbeat/claim
        // until DATABASE_URL is set; the per-call breakers surface it thereafter.
        const pgHealth = await pgPing();
        if (pgHealth.ok) {
            console.log(`[direct-pg] ping OK: latency=${pgHealth.latencyMs}ms (pool max=5)`);
        } else {
            console.error(`[direct-pg] PING FAILED after ${pgHealth.latencyMs}ms: ${pgHealth.error} — set DATABASE_URL (Supavisor transaction pooler, port 6543)`);
        }
        await this.hydrateMetrics();
        await this.heartbeat();
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = setInterval(() => this.heartbeat(), 2 * 60 * 1000);
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
        // Phase 7C — circuit-open early-return. Skip the call entirely if
        // we're in the cool-down window from a recent failure burst. Logged
        // once at the open boundary (heartbeatCircuitOpenLogged gate).
        if (this.heartbeatCircuitOpenUntil > Date.now()) {
            return;
        }

        const timestamp = new Date().toISOString();
        try {
            // [TRINITY SSOT]: PRIMARY STATUS UPDATE (Patent: BFT Consensus Dashboard)
            // PostgREST bypass (2026-05-21) — direct pg INSERT..ON CONFLICT in
            // place of supabase upsert. retries:1 + 10s ceiling preserves the
            // prior single-withTimeout latency; pgQuery owns the timeout, and
            // the method-level heartbeat circuit breaker (below) owns
            // consecutive-failure handling. Per CLAUDE-RULE-8.
            const taskSummary = this.currentTaskId ? `Working on task ${this.currentTaskId}` : statusMessage;
            const pgOpts = { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY };

            await pgQuery(
                `INSERT INTO trinity_agent_registry
                   (agent_name, status, last_active, current_tier, tasks_completed, current_task_summary)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (agent_name) DO UPDATE SET
                   status = EXCLUDED.status,
                   last_active = EXCLUDED.last_active,
                   current_tier = EXCLUDED.current_tier,
                   tasks_completed = EXCLUDED.tasks_completed,
                   current_task_summary = EXCLUDED.current_task_summary`,
                [this.name, 'online', timestamp, this.wisdom.tier || 'specialist', this.sessionMetrics.tasksCompleted, taskSummary],
                { ...pgOpts, label: 'heartbeat:trinity_agent_registry' }
            );

            // Sprint 14 R-3 — publish the previously-dead instrumentation
            // columns so the data layer can distinguish loop-alive from
            // heartbeat-alive. loop_count is owned by the runLoop (incremented
            // inside the loop body); this writer only publishes it.
            await pgQuery(
                `INSERT INTO agent_heartbeat
                   (agent_name, status, last_ping, loop_count, current_task_id,
                    tasks_completed_session, tasks_failed_session, code_version, railway_service_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (agent_name) DO UPDATE SET
                   status = EXCLUDED.status,
                   last_ping = EXCLUDED.last_ping,
                   loop_count = EXCLUDED.loop_count,
                   current_task_id = EXCLUDED.current_task_id,
                   tasks_completed_session = EXCLUDED.tasks_completed_session,
                   tasks_failed_session = EXCLUDED.tasks_failed_session,
                   code_version = EXCLUDED.code_version,
                   railway_service_id = EXCLUDED.railway_service_id`,
                [this.name, 'online', timestamp, this.loopCount, this.currentTaskId || null,
                 this.sessionMetrics.tasksCompleted, this.sessionMetrics.tasksFailed, this.version, process.env.RAILWAY_SERVICE_ID || null],
                { ...pgOpts, label: 'heartbeat:agent_heartbeat' }
            );

            // [ANTIGRAVITY] Sync with trinity_heartbeat for audit-heartbeats compatibility
            await pgQuery(
                `INSERT INTO trinity_heartbeat
                   (agent, status, last_seen, version, current_task_summary, config)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                 ON CONFLICT (agent) DO UPDATE SET
                   status = EXCLUDED.status,
                   last_seen = EXCLUDED.last_seen,
                   version = EXCLUDED.version,
                   current_task_summary = EXCLUDED.current_task_summary,
                   config = EXCLUDED.config`,
                [this.name, 'online', timestamp, this.version, taskSummary,
                 JSON.stringify({ group: this.wisdom.squad || 'ORCHESTRATION', tier: this.wisdom.tier || 'specialist' })],
                { ...pgOpts, label: 'heartbeat:trinity_heartbeat' }
            );

            // Phase 7C — full success → reset breaker state.
            if (this.consecutiveHeartbeatFailures > 0 || this.heartbeatCircuitOpenLogged) {
                console.log(`[${this.name}] [heartbeat] circuit-breaker reset after ${this.consecutiveHeartbeatFailures} consecutive failures`);
                this.consecutiveHeartbeatFailures = 0;
                this.heartbeatCircuitOpenLogged = false;
                this.heartbeatCircuitOpenUntil = 0;
            }
        } catch (e) {
            // Phase 7C — bounded-failure path. Increment counter; open the
            // circuit once threshold crosses. heartbeat() is observability,
            // not gating (Sean spec) — NEVER re-throws.
            this.consecutiveHeartbeatFailures += 1;
            console.error(`[${this.name}] Heartbeat failed (consecutive=${this.consecutiveHeartbeatFailures}/${this.HEARTBEAT_CIRCUIT_OPEN_THRESHOLD}):`, e.message);
            if (this.consecutiveHeartbeatFailures >= this.HEARTBEAT_CIRCUIT_OPEN_THRESHOLD && !this.heartbeatCircuitOpenLogged) {
                this.heartbeatCircuitOpenLogged = true;
                this.heartbeatCircuitOpenUntil = Date.now() + this.HEARTBEAT_CIRCUIT_OPEN_SLEEP_MS;
                console.error(`[${this.name}] [heartbeat] CIRCUIT OPEN — ${this.HEARTBEAT_CIRCUIT_OPEN_THRESHOLD}+ consecutive failures; suppressing heartbeat() for ${this.HEARTBEAT_CIRCUIT_OPEN_SLEEP_MS}ms (5min) until cool-down`);
            }
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
        const { data: members, error } = await this.supabase
            .from('trinity_heartbeat')
            .select('agent, last_seen, current_task_summary')
            .filter('config->>group', 'eq', this.groupName);

        if (error) {
            console.error(`[${this.name}] ❌ runSurvivorResurrection query error:`, error.message);
            return;
        }

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

    async runStaleTaskReaper() {
        if (!this.isSurvivor) return; // Only survivor squad reaps

        try {
            // Find stale tasks
            const { data: stale, error } = await this.supabase
                .from('trinity_tasks')
                .select('id, claimed_by, claimed_at, title, metadata')
                .in('status', ['doing', 'in_progress'])
                .lt('claimed_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
                .limit(50);

            if (error) {
                console.error(`[${this.name}] ❌ Reaper query error:`, error.message);
                return;
            }

            if (!stale || stale.length === 0) {
                return;
            }

            console.log(`[REAPER] 🧹 ${this.name} found ${stale.length} stale tasks to release`);

            for (const task of stale) {
                const updatedMetadata = task.metadata || {};
                updatedMetadata.reap_count = (updatedMetadata.reap_count || 0) + 1;
                updatedMetadata.last_reaped_at = new Date().toISOString();

                const { error: updateError } = await this.supabase
                    .from('trinity_tasks')
                    .update({
                        status: 'pending',
                        claimed_by: null,
                        claimed_at: null,
                        metadata: updatedMetadata
                    })
                    .eq('id', task.id)
                    .in('status', ['doing', 'in_progress']); // Re-check at update to avoid race

                if (updateError) {
                    console.error(`[REAPER] ❌ Failed to reap task ${task.id}:`, updateError.message);
                } else {
                    console.log(`[REAPER] ✅ Released task ${task.id} from ${task.claimed_by} (was claimed ${task.claimed_at})`);
                    await this.log('task_reaped', `Released stale task ${task.id} from ${task.claimed_by}`, {
                        taskId: task.id,
                        originalClaimer: task.claimed_by,
                        claimedAt: task.claimed_at
                    });
                }
            }
        } catch (e) {
            console.error(`[REAPER] ❌ Reaper exception:`, e.message);
        }
    }

    /**
     * Sprint MVP-Delivery Phase 4 (A1) — Evergreen Spawner.
     *
     * Fires from the runLoop idle branch on every iteration that finds no work.
     * Polls trinity_tasks for is_evergreen=true rows where recurring_minutes
     * has elapsed since last_spawned_at (or NULL last_spawned_at = never spawned).
     * Atomic optimistic-concurrency guard on the parent update prevents two
     * agents from double-spawning the same parent.
     *
     * γ policy on recurring_minutes: skip NULL (Strategy Claude ruling for Sean
     * triage). A separate manifest of NULL-recurring evergreens lives in
     * E:\dev\reports\2026-05-20\CC_PHASE_4_REPORT.md.
     *
     * Bugfixes vs the un-deployed lib/ConstitutionalAgent.ts scaffold:
     *  1. Uses is_evergreen=true (was title-match '[EVERGREEN]')
     *  2. Sets last_spawned_at on parent (was missing)
     *  3. Sets parent_task_id on child (was missing)
     *  4. Increments spawned_count on parent (was missing)
     *  5. Honors recurring_minutes cadence (was ignored)
     *  6. Not gated on verified-status only (cadence-driven, status-agnostic)
     */
    async respawnEvergreensIfDue() {
        try {
            const { data: due, error: selErr } = await this.supabase
                .from('trinity_tasks')
                .select('id, title, description, task_type, assigned_to, priority, success_criteria, max_duration_minutes, last_spawned_at, spawned_count, recurring_minutes, metadata')
                .eq('is_evergreen', true)
                .not('recurring_minutes', 'is', null)
                .or(`last_spawned_at.is.null,last_spawned_at.lt.${new Date(Date.now() - 60_000).toISOString()}`)
                .order('last_spawned_at', { ascending: true, nullsFirst: true })
                .limit(100);

            if (selErr) {
                console.error(`[EVERGREEN] select error:`, selErr.message, selErr);
                return { processed: 0 };
            }
            if (!due || due.length === 0) return { processed: 0 };

            let processed = 0;
            const nowIso = new Date().toISOString();

            for (const parent of due) {
                const minutesSince = parent.last_spawned_at
                    ? (Date.now() - new Date(parent.last_spawned_at).getTime()) / 60_000
                    : Infinity;
                if (minutesSince < parent.recurring_minutes) continue;

                // Atomic guard: claim the cadence slot.
                // Predicate matches the captured last_spawned_at OR NULL → other agents lose the race.
                let claimQuery = this.supabase
                    .from('trinity_tasks')
                    .update({
                        last_spawned_at: nowIso,
                        spawned_count: (parent.spawned_count || 0) + 1
                    })
                    .eq('id', parent.id)
                    .eq('is_evergreen', true);
                if (parent.last_spawned_at === null) {
                    claimQuery = claimQuery.is('last_spawned_at', null);
                } else {
                    claimQuery = claimQuery.eq('last_spawned_at', parent.last_spawned_at);
                }
                const { data: claimed, error: claimErr } = await claimQuery.select('id').maybeSingle();

                if (claimErr) {
                    console.error(`[EVERGREEN] cadence-slot claim error parent=${parent.id}:`, claimErr.message, claimErr);
                    continue;
                }
                if (!claimed) {
                    // Lost the race to another agent. Not an error.
                    continue;
                }

                // Insert the child spawn. is_evergreen=false; parent_task_id set.
                const childTitle = parent.title || `[EVERGREEN spawn ${parent.id}]`;
                const childDescription = parent.description || `Evergreen recurrence of task ${parent.id}`;
                const childMeta = Object.assign({}, parent.metadata || {}, {
                    spawned_from_evergreen: parent.id,
                    spawned_at: nowIso,
                    spawner_agent: this.name,
                    spawner_phase: 'CC_MVP_DELIVERY_PHASE_4_A1'
                });

                const childRow = {
                    title: childTitle,
                    description: childDescription,
                    task_type: parent.task_type,
                    assigned_to: parent.assigned_to,
                    priority: parent.priority || 5,
                    status: 'pending',
                    is_evergreen: false,
                    parent_task_id: parent.id,
                    success_criteria: parent.success_criteria,
                    max_duration_minutes: parent.max_duration_minutes,
                    metadata: childMeta
                };

                const { data: child, error: insErr } = await this.supabase
                    .from('trinity_tasks')
                    .insert(childRow)
                    .select('id')
                    .single();

                if (insErr) {
                    console.error(`[EVERGREEN] child insert failed parent=${parent.id}:`, insErr.message, insErr);
                    // Parent's last_spawned_at is already advanced — this cadence is consumed.
                    // Next cadence interval will retry. Acceptable trade-off vs UPDATE-after-INSERT
                    // which permits double-INSERT under contention.
                    continue;
                }
                processed += 1;
                console.log(`[EVERGREEN] ♻️ spawned child ${child?.id} from parent ${parent.id} (cadence=${parent.recurring_minutes}min, spawned_count=${(parent.spawned_count || 0) + 1})`);
            }

            return { processed };
        } catch (e) {
            console.error(`[EVERGREEN] respawnEvergreensIfDue exception:`, e?.message, e?.stack);
            return { processed: 0 };
        }
    }

    async runLoop() {
        if (!this.isEscalationContractEnabled) {
            return this.runLoopLegacy();
        }

        console.log(`[${this.name}] 🚀 Entering Escalation-Contract runLoop...`);
        while (true) {
            try {
                // Sprint 14 R-3 — bump per-iteration progress counter BEFORE any
                // await. A hung await leaves loop_count stale.
                this.loopCount++;

                // Concurrency throttling
                if (this.inFlightCount >= this.maxConcurrency) {
                    await this.sleep(1000);
                    continue;
                }

                const task = await withTimeout(this.getNextTask(), LOOP_TIMEOUTS.DB_QUERY, 'getNextTask');
                if (!task) {
                    // Phase 2.10: service-contract fulfilment — strictly lower
                    // priority than trinity_tasks (only when no task available).
                    // If a contract was processed, skip the idle sleep (more
                    // may be queued). Graceful: any failure falls through to idle.
                    try {
                        const { ServiceContractClient } = require('./service-contract-client');
                        // processOne has its own 30s AbortController; outer is safety net.
                        const sc = await withTimeout(ServiceContractClient.processOne(this.name), LOOP_TIMEOUTS.SERVICE_CONTRACT, 'ServiceContractClient.processOne');
                        if (sc && sc.processed) {
                            console.log(`[${this.name}] processed service contract ${sc.contract_id}`);
                            continue;
                        }
                    } catch (e) {
                        console.error(`[${this.name}] service contract poll error:`, e?.message, e?.stack);
                    }
                    if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.checkGroupHealth(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'checkGroupHealth(idle)');
                    if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.runStaleTaskReaper(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'runStaleTaskReaper(idle)');
                    // Sprint MVP-Delivery Phase 4 (A1) — evergreen spawner on idle.
                    // Lower priority than service-contract poll (above) and survivor checks.
                    try {
                        await withTimeout(this.respawnEvergreensIfDue(), LOOP_TIMEOUTS.DB_QUERY, 'respawnEvergreensIfDue(idle-contract)');
                    } catch (e) {
                        console.error(`[${this.name}] respawnEvergreensIfDue error:`, e?.message, e?.stack);
                    }
                    await this.sleep(30000);
                    continue;
                }

                console.log(`[${this.name}] 📋 Processing (Contract): ${task.title}`);
                // Phase 7C — heartbeat is observability, not gating. Wrap
                // in inline try/catch so a degraded Supabase doesn't insert
                // a 30s stall into the task-claim path (per Sean spec).
                try {
                    await withTimeout(this.heartbeat(`Claimed: ${task.title}`), LOOP_TIMEOUTS.DB_QUERY, `heartbeat(Claimed task=${task.id})`);
                } catch (e) {
                    console.warn(`[${this.name}] heartbeat non-fatal in runLoop(claimed): ${e?.message ?? e}`);
                }

                // STEP 1: Atomic Claim *SYNCHRONOUSLY* immediately upon retrieval
                const claimed = await withTimeout(this.claimTask(task.id), LOOP_TIMEOUTS.DB_QUERY, `claimTask(${task.id})`);
                if (!claimed) {
                    console.log(`[${this.name}] ⚠️ Task ${task.id} already claimed. Skipping.`);
                    continue;
                }

                // ASYNC TASK EXECUTION PIPELINE via IIFE
                this.inFlightCount++;
                this.activeTaskIds.add(task.id);
                (async () => {
                    const tid = task.id;
                    try {
                        // Reset for Step 6 guard
                        this.taskArtifacts.set(tid, null);

                        // STEP 2: Understand Task
                        const understanding = await withTimeout(this.understandTask(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `understandTask(${tid})`);
                        if (!understanding.ok) {
                            const retries = (this.claimHistory.get(tid) || 0) + 1;
                            this.claimHistory.set(tid, retries);
                            await withTimeout(this.insertHitlRequest(tid, 'clarification_needed', understanding.reason), LOOP_TIMEOUTS.DB_QUERY, `insertHitlRequest(${tid}, clarification)`);
                            await withTimeout(this.releaseTask(tid, `Unclear: ${understanding.reason}`), LOOP_TIMEOUTS.DB_QUERY, `releaseTask(${tid}, Unclear)`);
                            return;
                        }

                        // STEP 3: Capability Check
                        const capable = await withTimeout(this.checkCapability(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `checkCapability(${tid})`);
                        if (!capable.ok) {
                            const retries = (this.claimHistory.get(tid) || 0) + 1;
                            this.claimHistory.set(tid, retries);
                            await withTimeout(this.log('escalation_contract', `Escalating: ${capable.reason}`, { taskId: tid }), LOOP_TIMEOUTS.DB_QUERY, `log(escalation_contract ${tid})`);
                            await withTimeout(this.insertEscalationLog(tid, `Capability gap: ${capable.reason}`), LOOP_TIMEOUTS.DB_QUERY, `insertEscalationLog(${tid})`);
                            await withTimeout(this.insertHitlRequest(tid, 'capability_gap', capable.reason), LOOP_TIMEOUTS.DB_QUERY, `insertHitlRequest(${tid}, capability_gap)`);
                            await withTimeout(this.releaseTask(tid, `Escalated: ${capable.reason}`), LOOP_TIMEOUTS.DB_QUERY, `releaseTask(${tid}, Escalated)`);
                            return;
                        }

                        // STEP 4 & 5: Execute and Evaluate
                        try {
                            await withTimeout(this.processTaskContract(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `processTaskContract(${tid})`);
                        } catch (err) {
                            this.sessionMetrics.tasksFailed++; // Sprint 14 R-3 — count failed task executions
                            await withTimeout(this.recordConfused(task, err.message, { stack: err.stack }), LOOP_TIMEOUTS.DB_QUERY, `recordConfused(${tid})`);
                            // Wire escalation system (S-WIRE-AGENTS): failed tasks auto-retry with better models (higher tier)
                            try {
                              if (this.state && this.state.tier === '0a') {
                                await this.supabase.from('trinity_tasks').update({
                                  metadata: { ...(task.metadata || {}), escalated: true, escalate_to_tier: '1', escalated_at: new Date().toISOString() },
                                  status: 'pending'
                                }).eq('id', task.id);
                                console.log(`[${this.name}] Escalated failed task ${tid} to tier 1 for retry with better model`);
                              }
                            } catch (escErr) {
                              console.warn(`[${this.name}] escalation non-fatal:`, escErr.message);
                            }
                        }

                        if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.checkGroupHealth(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'checkGroupHealth(post)');
                        if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.runStaleTaskReaper(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'runStaleTaskReaper(post)');
                    } catch (asyncErr) {
                        console.error(`[${this.name}] Async task processing exception:`, asyncErr.message);
                    } finally {
                        this.activeTaskIds.delete(tid);
                        this.taskArtifacts.delete(tid);
                        this.inFlightCount--;
                    }
                })();
                await this.sleep(500);
            } catch (err) {
                this.sessionMetrics.tasksFailed++; // Sprint 14 R-3 — count failed iterations
                console.error(`[${this.name}] Loop Error (Contract):`, err.message, err.name === 'TimeoutError' ? `(${err.label})` : '');
                await this.sleep(30000);
            }
        }
    }

    async runLoopLegacy() {
        console.log(`[${this.name}] 🚀 Entering Main Task Loop (Legacy)...`);
        while (true) {
            try {
                // Sprint 14 R-3 — per-iteration progress counter (see runLoop).
                this.loopCount++;

                // Concurrency throttling
                if (this.inFlightCount >= this.maxConcurrency) {
                    await this.sleep(1000);
                    continue;
                }

                const task = await withTimeout(this.getNextTask(), LOOP_TIMEOUTS.DB_QUERY, 'getNextTask');
                if (!task) {
                    if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.checkGroupHealth(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'checkGroupHealth');
                    if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.runStaleTaskReaper(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'runStaleTaskReaper');
                    // Sprint MVP-Delivery Phase 4 (A1) — evergreen spawner on each loop iteration.
                    // Legacy path runs even when a task is processed (cheap; cadence-gated server-side).
                    try {
                        await withTimeout(this.respawnEvergreensIfDue(), LOOP_TIMEOUTS.DB_QUERY, 'respawnEvergreensIfDue(legacy)');
                    } catch (e) {
                        console.error(`[${this.name}] respawnEvergreensIfDue error:`, e?.message, e?.stack);
                    }
                    await this.sleep(30000);
                    continue;
                }

                console.log(`[${this.name}] 📋 Processing (Legacy): ${task.title}`);
                // Phase 7C — heartbeat is observability, not gating
                // (per Sean spec). Inline try/catch so a degraded
                // Supabase doesn't stall the legacy work path.
                try {
                    await withTimeout(this.heartbeat(`Claimed: ${task.title}`), LOOP_TIMEOUTS.DB_QUERY, `heartbeat(Claimed task=${task.id})`);
                } catch (e) {
                    console.warn(`[${this.name}] heartbeat non-fatal in runLoopLegacy(claimed): ${e?.message ?? e}`);
                }

                // SYNCHRONOUS ATOMIC CLAIM
                const claimed = await withTimeout(this.claimTask(task.id), LOOP_TIMEOUTS.DB_QUERY, `claimTask(${task.id})`);
                if (!claimed) {
                    console.log(`[${this.name}] ⚠️ Task ${task.id} already claimed. Skipping.`);
                    continue;
                }

                // ASYNC TASK EXECUTION PIPELINE via IIFE
                this.inFlightCount++;
                this.activeTaskIds.add(task.id);
                (async () => {
                    const tid = task.id;
                    const title = task.title;
                    try {
                        this.taskArtifacts.set(tid, null);
                        await withTimeout(this.processTask(task, true), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `processTask(id=${tid})`);
                        try {
                            await withTimeout(this.heartbeat(`Completed: ${title}`), LOOP_TIMEOUTS.DB_QUERY, `heartbeat(Completed task=${tid})`);
                        } catch (e) {
                            console.warn(`[${this.name}] heartbeat non-fatal in runLoopLegacy(completed): ${e?.message ?? e}`);
                        }
                    } catch (err) {
                        this.sessionMetrics.tasksFailed++;
                        console.error(`[${this.name}] Async task processing error:`, err.message);
                    } finally {
                        this.activeTaskIds.delete(tid);
                        this.taskArtifacts.delete(tid);
                        this.inFlightCount--;
                    }
                })();
                await this.sleep(500);
            } catch (err) {
                this.sessionMetrics.tasksFailed++; // Sprint 14 R-3 — count failed iterations
                console.error(`[${this.name}] Loop Error:`, err.message, err.name === 'TimeoutError' ? `(${err.label})` : '');
                await this.sleep(30000);
            }
        }
    }

    // --- ESCALATION CONTRACT HELPERS ---

    async understandTask(task) {
        if (!task.success_criteria || task.success_criteria.trim().length === 0) {
            return { ok: false, reason: 'success_criteria_missing' };
        }
        if (!task.description || task.description.length < 10) {
            return { ok: false, reason: 'insufficient_description' };
        }
        return { ok: true };
    }

    async checkCapability(task) {
        // Simplified capability check for Phase 1
        const knownTypes = ['research', 'code', 'docs', 'artifact', 'review', 'meta', 'critique', 'peer_verify'];
        if (task.task_type && !knownTypes.includes(task.task_type)) {
            return { ok: false, reason: `unknown_task_type: ${task.task_type}` };
        }
        // Wire capability filter (S-WIRE-AGENTS): agents only claim tasks they can handle (tier based)
        const agentTier = this.state ? this.state.tier : '0a';
        if (agentTier === '0a' && task.task_type && ['research', 'code'].includes(task.task_type)) {
          return { ok: false, reason: 'tier_0a_cannot_handle_complex' };
        }
        return { ok: true };
    }

    // ============================================================
    // DETERMINISTIC INFRA PULSE-CHECK EXECUTOR (Sprint cc2-2026-05-26)
    // ------------------------------------------------------------
    // Root cause fix: 5 recurring "review" tasks are infra pulse-checks
    // (SQL aggregates / HTTP probes), NOT LLM-judgment work. The LLM path
    // in processTaskContract cannot run a SQL aggregate or an HTTP probe,
    // so it never produces save_artifact → artifact_missing → failed.
    // mel failed 40 of these in 7 days, 100% with that signature.
    //
    // This executor ACTUALLY performs the op, saves a real artifact, and
    // completes the task using the SAME success tail as processTaskContract.
    // It fires ONLY for task_type==='review' with one of the 5 exact titles;
    // returns null for everything else (zero regression for all other tasks
    // and all other agents). Any internal error returns null so the caller
    // falls through to the normal LLM path (never crashes the loop).
    // ============================================================
    static get PULSE_CHECK_TITLES() {
        return new Set([
            'REPID_SCORE_EVENTS_AUDIT',
            'RECEIPT_INDEXER_PULSE_CHECK',
            'ZKP_PROOF_SELF_TEST',
            'HAL_HITL_QUEUE_PULSE',
            'HAL_ACCURACY_SPOT_CHECK'
        ]);
    }

    async tryDeterministicPulseCheck(task) {
        // Exact-match guard: only the 5 named review pulse-checks.
        if (!task || task.task_type !== 'review' || !task.title) return null;
        if (!ConstitutionalAgentV4.PULSE_CHECK_TITLES.has(task.title)) return null;

        try {
            let pulse;
            switch (task.title) {
                case 'REPID_SCORE_EVENTS_AUDIT':
                    pulse = await this._pulseRepidScoreEventsAudit(task);
                    break;
                case 'RECEIPT_INDEXER_PULSE_CHECK':
                    pulse = await this._pulseReceiptIndexer(task);
                    break;
                case 'ZKP_PROOF_SELF_TEST':
                    pulse = await this._pulseZkpProofSelfTest(task);
                    break;
                case 'HAL_HITL_QUEUE_PULSE':
                    pulse = await this._pulseHalHitlQueue(task);
                    break;
                case 'HAL_ACCURACY_SPOT_CHECK':
                    pulse = await this._pulseHalAccuracySpotCheck(task);
                    break;
                default:
                    return null; // unreachable given the Set guard above
            }

            if (!pulse || typeof pulse.markdown !== 'string') {
                // Executor produced nothing usable — fall through to LLM path.
                return null;
            }

            return await this._completePulseCheck(task, pulse);
        } catch (err) {
            // CRITICAL: never crash the loop. Fall through to the existing LLM path.
            console.warn(`[PULSE] ${task.title} executor error (falling through to LLM): ${err?.message ?? err}`);
            return null;
        }
    }

    // Shared completion: save a real artifact + mirror processTaskContract's
    // success tail (lines ~844-857). Returns a truthy result so the caller
    // short-circuits the LLM path.
    async _completePulseCheck(task, pulse) {
        const summary = pulse.summary || `Pulse check ${task.title} complete`;
        await this.log('pulse_check_executed', `${task.title}: ${summary}`, { taskId: task.id });

        // saveArtifact sets this.lastArtifactId and returns the db:// url.
        const artifactUrl = await this.saveArtifact(
            task.id,
            pulse.markdown,
            'report',
            `Pulse Check: ${task.title}`
        );

        const artId = this.getLastArtifactId(task.id);
        if (!artId) {
            // Artifact persistence failed (e.g. DB down). Don't fake success —
            // fall through to the normal path so the existing guards apply.
            console.warn(`[PULSE] ${task.title}: artifact save returned no id; falling through.`);
            return null;
        }

        // Success tail — byte-for-byte the same shape as processTaskContract.
        await this.supabase.from('trinity_tasks').update({
            status: 'done',
            result: summary,
            artifact_url: artifactUrl || `db://trinity_artifacts/${artId}`,
            completed_at: new Date().toISOString(),
            belief: 0.95,
            disbelief: 0,
            uncertainty: 0.05
        }).eq('id', task.id);

        await this.spawnNextStep(task, summary, { score: 95 });
        await this.updateReputation(true);
        this.sessionMetrics.tasksCompleted++;

        console.log(`[PULSE] ✅ ${this.name} completed deterministic pulse-check ${task.title} (task ${task.id})`);
        return { ok: true, pulse_check: task.title, artifact_url: artifactUrl };
    }

    // --- Individual pulse-check operations ---
    // All reads use this.supabase. supabase-js / PostgREST cannot run GROUP BY or
    // sign() server-side, so we fetch the windowed rows and aggregate in JS
    // (consistent with how the rest of this file uses this.supabase).

    async _pulseRepidScoreEventsAudit(task) {
        // "Count repid_score_events grouped by (delta sign, agent_id) for the last N hours.
        //  Flag any agent receiving only positive OR only negative deltas (concentration
        //  risk). Flag any single agent receiving >50% of all positive events."
        const sinceIso = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
        const { data, error } = await this.supabase
            .from('repid_score_events')
            .select('agent_id, delta, created_at')
            .gte('created_at', sinceIso)
            .limit(5000);
        if (error) throw new Error(`repid_score_events read: ${error.message}`);

        const rows = data || [];
        const byAgent = new Map(); // agent_id -> { pos, neg, zero }
        let totalPositive = 0;
        for (const r of rows) {
            const d = Number(r.delta) || 0;
            const a = r.agent_id || 'null';
            if (!byAgent.has(a)) byAgent.set(a, { pos: 0, neg: 0, zero: 0 });
            const bucket = byAgent.get(a);
            if (d > 0) { bucket.pos++; totalPositive++; }
            else if (d < 0) { bucket.neg++; }
            else { bucket.zero++; }
        }

        const anomalies = [];
        for (const [agent, b] of byAgent.entries()) {
            const onlyPos = b.pos > 0 && b.neg === 0;
            const onlyNeg = b.neg > 0 && b.pos === 0;
            if (onlyPos) anomalies.push({ agent_id: agent, type: 'only_positive', pos: b.pos });
            if (onlyNeg) anomalies.push({ agent_id: agent, type: 'only_negative', neg: b.neg });
            if (totalPositive > 0 && b.pos / totalPositive > 0.5) {
                anomalies.push({ agent_id: agent, type: 'positive_concentration', share: +(b.pos / totalPositive).toFixed(3) });
            }
        }

        const distinctAgents = byAgent.size;
        const summary = `repid_score_events audit (4h): ${rows.length} events, ${distinctAgents} agents, ${anomalies.length} anomalies`;
        const lines = [
            `# REPID_SCORE_EVENTS_AUDIT`,
            ``,
            `- window: last 4 hours (since ${sinceIso})`,
            `- total_events: ${rows.length}`,
            `- distinct_agents: ${distinctAgents}`,
            `- total_positive_events: ${totalPositive}`,
            `- anomalies: ${anomalies.length}`,
            ``,
            `## Per-agent breakdown (sign counts)`,
            ...[...byAgent.entries()].map(([a, b]) => `- ${a}: +${b.pos} / -${b.neg} / 0:${b.zero}`),
            ``,
            `## Anomalies`,
            anomalies.length ? anomalies.map(x => `- ${JSON.stringify(x)}`).join('\n') : `- none`,
            ``,
            `_executed_by ${this.name} at ${new Date().toISOString()}_`
        ];
        return { markdown: lines.join('\n'), summary };
    }

    async _pulseReceiptIndexer(task) {
        // "Query trinity_kv_store for keys starting with receipt_indexer_cursor:.
        //  For each, verify lastBlock has advanced ... If indexer stale >30 min, flag."
        const { data, error } = await this.supabase
            .from('trinity_kv_store')
            .select('key, value, updated_at')
            .like('key', 'receipt_indexer_cursor:%')
            .limit(1000);

        // If the table genuinely doesn't exist, record that as a clear (still successful) finding.
        if (error && (error.code === '42P01' || /does not exist|relation/i.test(error.message || ''))) {
            const summary = `RECEIPT_INDEXER_PULSE_CHECK: trinity_kv_store not available (${error.message})`;
            return {
                markdown: [
                    `# RECEIPT_INDEXER_PULSE_CHECK`,
                    ``,
                    `- finding: trinity_kv_store table not available`,
                    `- error: ${error.message}`,
                    `- indexer_count: 0`,
                    `- stale_count: 0`,
                    ``,
                    `_executed_by ${this.name} at ${new Date().toISOString()}_`
                ].join('\n'),
                summary
            };
        }
        if (error) throw new Error(`trinity_kv_store read: ${error.message}`);

        const rows = data || [];
        const STALE_MS = 30 * 60 * 1000;
        const now = Date.now();
        let staleCount = 0;
        const detail = rows.map(r => {
            const v = r.value || {};
            const lastIndexedAt = v.lastIndexedAt || r.updated_at;
            const ageMs = lastIndexedAt ? (now - new Date(lastIndexedAt).getTime()) : null;
            const stale = ageMs != null && ageMs > STALE_MS;
            if (stale) staleCount++;
            return { key: r.key, lastBlock: v.lastBlock ?? null, age_min: ageMs != null ? Math.round(ageMs / 60000) : null, stale };
        });

        const summary = `receipt_indexer pulse: ${rows.length} cursors, ${staleCount} stale (>30m)`;
        return {
            markdown: [
                `# RECEIPT_INDEXER_PULSE_CHECK`,
                ``,
                `- indexer_count: ${rows.length}`,
                `- stale_count: ${staleCount}`,
                ``,
                `## Cursors`,
                detail.length ? detail.map(d => `- ${d.key} | lastBlock=${d.lastBlock} | age=${d.age_min}m | stale=${d.stale}`).join('\n') : `- none found`,
                ``,
                `_executed_by ${this.name} at ${new Date().toISOString()}_`
            ].join('\n'),
            summary
        };
    }

    async _pulseZkpProofSelfTest(task) {
        // "Send a known-good request to https://zkp-postcard-production.up.railway.app ..."
        // We perform a lightweight, non-mutating health probe (GET) rather than a
        // signed prove request: deterministic, no secrets needed, records status + snippet.
        const descUrl = (task.description || '').match(/https?:\/\/[^\s"')]+/);
        const baseFromDesc = descUrl ? descUrl[0].replace(/\/prove\/.*$/, '') : null;
        const base = baseFromDesc || 'https://zkp-postcard-production.up.railway.app';
        const url = `${base.replace(/\/+$/, '')}/health`;

        const t0 = Date.now();
        let status = null, bodySnippet = '', ok = false, errMsg = null;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(url, { method: 'GET', signal: controller.signal });
            clearTimeout(timer);
            status = res.status;
            ok = res.ok;
            const text = await res.text();
            bodySnippet = (text || '').substring(0, 500);
        } catch (e) {
            errMsg = e?.message ?? String(e);
        }
        const responseMs = Date.now() - t0;

        const summary = `ZKP self-test ${url}: status=${status ?? 'ERR'} ${responseMs}ms${errMsg ? ` (${errMsg})` : ''}`;
        return {
            markdown: [
                `# ZKP_PROOF_SELF_TEST`,
                ``,
                `- url: ${url}`,
                `- status: ${status ?? 'ERROR'}`,
                `- ok: ${ok}`,
                `- response_ms: ${responseMs}`,
                errMsg ? `- error: ${errMsg}` : `- error: none`,
                ``,
                `## Body snippet`,
                '```',
                bodySnippet || '(empty)',
                '```',
                ``,
                `_note: deterministic GET /health probe (no signed prove call). executed_by ${this.name} at ${new Date().toISOString()}_`
            ].join('\n'),
            summary
        };
    }

    async _pulseHalHitlQueue(task) {
        // "Count trinity_hitl_requests rows where status=pending in the last 1 hour."
        const sinceIso = new Date(Date.now() - 3600 * 1000).toISOString();
        const { data, error } = await this.supabase
            .from('trinity_hitl_requests')
            .select('id, requested_at')
            .eq('status', 'pending')
            .gte('requested_at', sinceIso)
            .limit(5000);
        if (error) throw new Error(`trinity_hitl_requests read: ${error.message}`);

        const pendingCount = (data || []).length;
        const summary = `HAL HITL queue pulse: ${pendingCount} pending in last 1h`;
        return {
            markdown: [
                `# HAL_HITL_QUEUE_PULSE`,
                ``,
                `- window: last 1 hour (since ${sinceIso})`,
                `- pending_count: ${pendingCount}`,
                ``,
                `_executed_by ${this.name} at ${new Date().toISOString()}_`
            ].join('\n'),
            summary
        };
    }

    async _pulseHalAccuracySpotCheck(task) {
        // "Query hal_runner_results joined with hal_test_prompts for the last 6 hours.
        //  Compute precision/recall/F1. Compare against rolling 7-day baseline (F1=0.86).
        //  ... drift_detected boolean (true if accuracy dropped >5% from baseline)."
        // Read sample done in design phase confirmed columns: hal_runner_results has
        // ground_truth_is_hallucination, hal_vetoed, was_caught, false_positive.
        const sinceIso = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
        const { data, error } = await this.supabase
            .from('hal_runner_results')
            .select('ground_truth_is_hallucination, hal_vetoed, was_caught, false_positive, created_at')
            .gte('created_at', sinceIso)
            .limit(5000);
        if (error) throw new Error(`hal_runner_results read: ${error.message}`);

        const rows = data || [];
        const totalRuns = rows.length;

        if (totalRuns === 0) {
            // No runs in window — record a structured "needs-data" finding (valid completion,
            // NOT a CONFUSED fail). Spec is unambiguous; there is simply nothing to score.
            const summary = `HAL_ACCURACY_SPOT_CHECK: 0 runs in last 6h (no data to score)`;
            return {
                markdown: [
                    `# HAL_ACCURACY_SPOT_CHECK`,
                    ``,
                    `- total_runs: 0`,
                    `- finding: no hal_runner_results in last 6 hours; precision/recall/F1 undefined`,
                    `- drift_detected: false`,
                    `- baseline_f1: 0.86`,
                    ``,
                    `_executed_by ${this.name} at ${new Date().toISOString()}_`
                ].join('\n'),
                summary
            };
        }

        // Confusion matrix on hallucination detection:
        //   positive class = "is hallucination". prediction = caught/vetoed.
        let tp = 0, fp = 0, fn = 0, tn = 0;
        for (const r of rows) {
            const actual = r.ground_truth_is_hallucination === true;
            // Treat was_caught (preferred) else hal_vetoed as the positive prediction.
            const predicted = (r.was_caught === true) || (r.was_caught == null && r.hal_vetoed === true);
            if (actual && predicted) tp++;
            else if (!actual && predicted) fp++;
            else if (actual && !predicted) fn++;
            else tn++;
        }
        const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
        const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
        const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        const fpr = (fp + tn) > 0 ? fp / (fp + tn) : 0;
        const BASELINE_F1 = 0.86;
        const driftDetected = (BASELINE_F1 - f1) > 0.05;

        const round = n => +n.toFixed(4);
        const summary = `HAL accuracy spot-check (6h): runs=${totalRuns} F1=${round(f1)} drift=${driftDetected}`;
        return {
            markdown: [
                `# HAL_ACCURACY_SPOT_CHECK`,
                ``,
                `- window: last 6 hours (since ${sinceIso})`,
                `- total_runs: ${totalRuns}`,
                `- confusion: tp=${tp} fp=${fp} fn=${fn} tn=${tn}`,
                `- precision: ${round(precision)}`,
                `- recall: ${round(recall)}`,
                `- F1: ${round(f1)}`,
                `- FPR: ${round(fpr)}`,
                `- baseline_F1: ${BASELINE_F1}`,
                `- drift_detected: ${driftDetected}`,
                ``,
                `_executed_by ${this.name} at ${new Date().toISOString()}_`
            ].join('\n'),
            summary
        };
    }

    async processTaskContract(task) {
        if (task.task_type === 'peer_verify') {
            try {
                await this.processPeerVerifyTask(task);
            } catch (err) {
                console.error(`[${this.name}] peer_verify task ${task.id} failed:`, err.message);
                await this.supabase.from('trinity_tasks').update({
                    status: 'failed',
                    result: `[PEER_VERIFY_FAILED] ${err.message}`
                }).eq('id', task.id);
            }
            return;
        }

        // Sprint cc2-2026-05-26 — deterministic infra pulse-check executor.
        // FIRST STEP, fully guarded: fires ONLY for the 5 named review pulse-checks
        // (see tryDeterministicPulseCheck). Returns a result object for those; null
        // for everything else, so all normal tasks fall through byte-identically.
        const pc = await this.tryDeterministicPulseCheck(task);
        if (pc) return pc;

        console.log(`[TASK] Executing (Contract): ${task.title}`);
        await this.log('task_processing_contract', `Processing ${task.title}`, { taskId: task.id });

        const context = `
[CONSTITUTIONAL DIRECTIVE]
${CONSTITUTION.ARTICLE_MINUS_1.text}

[MANDATORY ARTIFACT REQUIREMENT]
You MUST call 'save_artifact' to finalize. Escalation is high-status; faking is unconstitutional.
TASK: ${task.title}
DESC: ${task.description}
CRITERIA: ${task.success_criteria}
`;

        const result = await this.callLLM(context, { taskId: task.id });

        // STEP 6: Artifact Guard
        let artId = this.getLastArtifactId(task.id);
        if (!artId) {
            // Check smart-parse one last time (callLLM might have done it, but let's be sure)
            if (result.output.includes('```md') || result.output.includes('# Artifact')) {
                 await this.saveArtifact(task.id, result.output, 'report', `Artifact from ${this.name}`);
            }
        }

        const finalArtId = this.getLastArtifactId(task.id);
        if (!finalArtId) {
            return await this.recordConfused(task, 'artifact_missing', { output: result.output.substring(0, 500) });
        }

        // ARTIFACT_GUARD_HARDENED: stronger content-quality check (independent of ESCALATION_CONTRACT)
        const guard = await this._runArtifactGuardCheck(task);
        if (!guard.skipped && !guard.verdict.valid) {
            return await this.handleArtifactRejection(task, guard.artifact, guard.verdict.reason);
        }

        const evaluation = await this.evaluateResult(result.output, task);

        const substanceGate = await this.validateSubstance(result.output, task, finalArtId);
        const gateEnabled = process.env.HAL_SUBSTANCE_GATE_ENABLED === 'true';

        // Phase 2.8 — record substance gate event server-side (shadow mode; no slash).
        // Fires for PASS and FAIL alike so substance_gate_events accumulates.
        const gateRecord = await this._postSubstanceGateEvent(task, result.output, substanceGate);

        if (!substanceGate.ok) {
            if (gateEnabled) {
                console.log(`[SUBSTANCE_GATE] 🚫 Rejecting task ${task.id}: ${substanceGate.reason}`);
                await this.log('substance_gate_rejected', `Task ${task.id} rejected: ${substanceGate.reason}`, { taskId: task.id, claimed_by: this.name });
                await this.supabase.from('trinity_tasks').update({
                    status: 'pending_clarification',
                    claimed_by: null,
                    claimed_at: null,
                    result: `[SUBSTANCE_GATE_REJECTED] ${substanceGate.reason}`
                }).eq('id', task.id);
                await this.insertHitlRequest(task.id, 'substance_gate_rejected', substanceGate.reason, { gate_check_failed: substanceGate.reason });
                this.currentTaskId = null;
                return;
            } else {
                console.log(`[SUBSTANCE_GATE] 👁️ Shadow mode reject task ${task.id}: ${substanceGate.reason}`);
                await this.log('substance_gate_shadow_reject', `Task ${task.id} shadow-rejected: ${substanceGate.reason}`, { taskId: task.id, claimed_by: this.name });
                // Phase 2.8 — gate FAIL recorded server-side → shadow_reject (no slash).
                // gate ERROR (not recorded) → graceful degradation: fall through to PASS.
                if (gateRecord && gateRecord.recorded) {
                    await this.supabase.from('trinity_tasks').update({
                        status: 'shadow_reject',
                        result: result.output,
                        completed_at: new Date().toISOString(),
                        metadata: {
                            ...(typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {})),
                            provider_used: result.provider,
                            provider: result.provider,
                            substance_gate_event_id: gateRecord.gateEventId,
                            substance_gate_failure: gateRecord.fastResult ? gateRecord.fastResult.failures : [substanceGate.reason],
                            substance_gate_reasoning: substanceGate.reason
                        }
                    }).eq('id', task.id);
                    this.currentTaskId = null;
                    return;
                }
            }
        }
        
        if (evaluation.score < 40) {
            return await this.recordConfused(task, 'low_confidence_score', { score: evaluation.score });
        }

        // Record Success
        await this.supabase.from('trinity_tasks').update({
            status: 'done',
            result: result.output,
            artifact_url: `db://trinity_artifacts/${finalArtId}`,
            completed_at: new Date().toISOString(),
            belief: evaluation.score / 100,
            disbelief: 0,
            uncertainty: 0.1,
            metadata: {
                ...(task.metadata || {}),
                provider_used: result.provider,
                provider: result.provider
            }
        }).eq('id', task.id);

        await this.spawnNextStep(task, result.output, evaluation);
        await this.updateReputation(true);
        this.sessionMetrics.tasksCompleted++;
    }

    async insertHitlRequest(taskId, status, reason, context = {}) {
        await this.supabase.from('trinity_hitl_requests').insert({
            task_id: taskId,
            agent_id: this.name,
            status: 'pending',
            reason: `${status.toUpperCase()}: ${reason}`,
            context: context,
            requested_at: new Date().toISOString()
        });
    }

    async insertEscalationLog(taskId, reason) {
        await this.supabase.from('escalation_log').insert({
            from_agent: this.name,
            blocker: reason,
            status: 'sean_needed',
            severity: 'high',
            escalation_path: `${this.name} -> Contract Escalation`,
            created_at: new Date().toISOString()
        });
    }

    async recordConfused(task, reason, context = {}) {
        console.warn(`[CONFUSED] 😵 Agent ${this.name} confused on task ${task.id}: ${reason}`);
        await this.insertHitlRequest(task.id, 'confused', reason, context);
        await this.supabase.from('trinity_tasks').update({
            status: 'failed',
            result: `[CONFUSED] ${reason}`
        }).eq('id', task.id);
    }

    async releaseTask(taskId, reason) {
        await this.supabase.from('trinity_tasks').update({
            status: 'pending',
            claimed_by: null,
            claimed_at: null,
            result: `[RELEASED] ${reason}`
        }).eq('id', taskId);
    }

    // --- ARTIFACT GUARD HARDENING (gated by ARTIFACT_GUARD_HARDENED env flag) ---

    async _runArtifactGuardCheck(task) {
        if (process.env.ARTIFACT_GUARD_HARDENED !== 'true') {
            return { skipped: true };
        }
        let artifact = null;
        const artId = this.getLastArtifactId(task.id);
        if (artId) {
            try {
                const { data } = await this.supabase
                    .from('trinity_artifacts')
                    .select('id, content')
                    .eq('id', artId)
                    .maybeSingle();
                artifact = data || null;
            } catch (e) {
                console.warn(`[GUARD] Read failed for artifact ${artId}: ${e.message}`);
            }
        }
        const verdict = validateArtifactQuality(artifact, task);
        return { skipped: false, artifact, verdict };
    }

    async handleArtifactRejection(task, artifact, reason) {
        const detail = `artifact_guard_rejection:${reason}`;
        const artifactRef = artifact && artifact.id != null ? artifact.id : 'none';
        console.warn(`[GUARD] 🛑 ${this.name} rejected task ${task.id}: ${reason} (artifact ${artifactRef})`);
        try {
            await this.supabase.from('trinity_tasks').update({
                status: 'failed',
                result: `[GUARD_REJECTED] ${reason}`
            }).eq('id', task.id);
        } catch (e) {
            console.error(`[GUARD] Task update failed: ${e.message}`);
        }
        try {
            await this.insertEscalationLog(task.id, detail);
        } catch (e) {
            console.error(`[GUARD] escalation_log insert failed: ${e.message}`);
        }
        try {
            await this.insertHitlRequest(
                task.id,
                'guard_rejected',
                `${detail}; artifact_id=${artifactRef}`,
                { artifact_id: artifact && artifact.id != null ? artifact.id : null, rejection_reason: reason }
            );
        } catch (e) {
            console.error(`[GUARD] hitl insert failed: ${e.message}`);
        }
        this.currentTaskId = null;
    }

    async getVerificationTask() {
        const { data, error } = await this.supabase
            .from('trinity_tasks')
            .select('*')
            .in('status', ['done', 'completed'])
            .neq('claimed_by', this.name)
            .not('verified_by', 'cs', `{${this.name}}`)
            .order('priority', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error(`[${this.name}] ❌ getVerificationTask query error:`, error.message);
            return null;
        }

        return data || null;
    }

    async verifyPeerTask(task) {
        console.log(`[BFT] ⚔️ Commencing Triad Consensus on: ${task.title}`);

        const { data: artifacts, error } = await this.supabase
            .from('trinity_artifacts')
            .select('id', { count: 'exact', head: false })
            .eq('task_id', String(task.id));

        if (error) {
            console.error(`[${this.name}] ❌ verifyPeerTask artifacts query error:`, {
                message: error.message,
                details: error.details || null,
                hint: error.hint || null,
                code: error.code || null
            });
            return;
        }

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
        // PostgREST bypass (2026-05-21) — direct pg SELECT in place of the
        // supabase query builder. Same predicates: agent-or-unassigned, open
        // statuses, unclaimed, priority DESC then oldest-first. LIMIT 1 and
        // FOR UPDATE SKIP LOCKED added to optimize concurrency and network egress.
        // Blacklisted tasks are filtered out directly in the query.
        const blacklistedIds = Array.from(this.claimHistory.entries())
            .filter(([_, retries]) => retries >= this.MAX_CLAIM_RETRIES)
            .map(([id]) => Number(id));

        let tasks;
        try {
            tasks = await pgQuery(
                `SELECT id, title, description, task_type, success_criteria, max_duration_minutes, metadata, parent_task_id, assigned_to, agent_assigned, status, priority, created_at, context, github_issue_number, requires_external_artifact, claimed_by, verify_count, verified_by
                 FROM trinity_tasks
                 WHERE (assigned_to = $1 OR (assigned_to IS NULL AND (agent_assigned = $1 OR agent_assigned IS NULL)))
                   AND status = 'pending'
                   AND claimed_by IS NULL
                   AND NOT (id = ANY($2))
                 ORDER BY priority DESC, created_at ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`,
                [this.name, blacklistedIds.length > 0 ? blacklistedIds : [-1]],
                { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY, label: 'getNextTask' }
            );
        } catch (error) {
            console.error(`[${this.name}] ❌ getNextTask query error:`, {
                message: error.message,
                code: error.code || null
            });
            return null;
        }

        if (!tasks || tasks.length === 0) return null;
        return tasks[0];
    }

    async claimTask(taskId) {
        try {
            // PostgREST bypass (2026-05-21) — atomic optimistic claim via direct
            // pg UPDATE..RETURNING (replaces the supabase update+select). The
            // WHERE guard (status pending AND claimed_by IS NULL) keeps the claim
            // race-safe. retries:1 — never re-issue a claim. RULE-8 (10s ceiling).
            const now = new Date().toISOString();
            const rows = await pgQuery(
                `UPDATE trinity_tasks
                 SET status = 'doing', claimed_by = $1, claimed_at = $2, started_at = $2
                 WHERE id = $3 AND status = 'pending' AND claimed_by IS NULL
                 RETURNING id`,
                [this.name, now, taskId],
                { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY, label: 'claimTask' }
            );
            return rows.length > 0;
        } catch (e) {
            console.error(`[${this.name}] ❌ Claim error:`, {
                message: e.message,
                code: e.code || null,
                details: e.details || null
            });
            return false;
        }
    }

    async processTask(task, isAlreadyClaimed = false) {
        // [PHASE 20] ATOMIC CLAIM: Ensure we own the task before starting
        if (!isAlreadyClaimed) {
            const claimed = await this.claimTask(task.id);
            if (!claimed) {
                console.log(`[${this.name}] ⚠️ Task ${task.id} already claimed by another agent. Skipping.`);
                const retries = (this.claimHistory.get(task.id) || 0) + 1;
                this.claimHistory.set(task.id, retries);
                return;
            }
        }

        this.currentTaskId = task.id;
        console.log(`[TASK] Executing: ${task.title}`);

        if (task.task_type === 'peer_verify') {
            try {
                await this.processPeerVerifyTask(task);
            } catch (err) {
                console.error(`[${this.name}] peer_verify task ${task.id} failed:`, err.message);
                await this.supabase.from('trinity_tasks').update({
                    status: 'failed',
                    result: `[PEER_VERIFY_FAILED] ${err.message}`
                }).eq('id', task.id);
            }
            this.currentTaskId = null;
            return;
        }

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
            const result = await this.callLLM(context, { taskId: task.id });

            // [ANTIGRAVITY] MANDATORY ARTIFACT CHECK
            let artifactUrl = null;
            // Even if tool wasn't called, try to capture if valid output exists
            if (result.output) {
                await callAnfisReward(this, task.id, result.provider, { success: true, latency: result.latency });
            }

            const evaluation = await this.evaluateResult(result.output, task);

            const substanceGate = await this.validateSubstance(result.output, task, this.getLastArtifactId(task.id));
            const gateEnabled = process.env.HAL_SUBSTANCE_GATE_ENABLED === 'true';

            // Phase 2.8 — record substance gate event server-side (shadow mode; no slash).
            // Fires for PASS and FAIL alike so substance_gate_events accumulates.
            const gateRecord = await this._postSubstanceGateEvent(task, result.output, substanceGate);

            if (!substanceGate.ok) {
                if (gateEnabled) {
                    console.log(`[SUBSTANCE_GATE] 🚫 Rejecting task ${task.id}: ${substanceGate.reason}`);
                    await this.log('substance_gate_rejected', `Task ${task.id} rejected: ${substanceGate.reason}`, { taskId: task.id, claimed_by: this.name });
                    await this.supabase.from('trinity_tasks').update({
                        status: 'pending_clarification',
                        claimed_by: null,
                        claimed_at: null,
                        result: `[SUBSTANCE_GATE_REJECTED] ${substanceGate.reason}`
                    }).eq('id', task.id);
                    await this.insertHitlRequest(task.id, 'substance_gate_rejected', substanceGate.reason, { gate_check_failed: substanceGate.reason });
                    this.currentTaskId = null;
                    return;
                } else {
                    console.log(`[SUBSTANCE_GATE] 👁️ Shadow mode reject task ${task.id}: ${substanceGate.reason}`);
                    await this.log('substance_gate_shadow_reject', `Task ${task.id} shadow-rejected: ${substanceGate.reason}`, { taskId: task.id, claimed_by: this.name });
                    // Phase 2.8 — gate FAIL recorded server-side → shadow_reject (no slash).
                    // gate ERROR (not recorded) → graceful degradation: fall through to PASS.
                    if (gateRecord && gateRecord.recorded) {
                        await this.supabase.from('trinity_tasks').update({
                            status: 'shadow_reject',
                            result: result.output,
                            completed_at: new Date().toISOString(),
                            metadata: {
                                ...(typeof task.metadata === 'string' ? JSON.parse(task.metadata) : (task.metadata || {})),
                                provider_used: result.provider,
                                provider: result.provider,
                                substance_gate_event_id: gateRecord.gateEventId,
                                substance_gate_failure: gateRecord.fastResult ? gateRecord.fastResult.failures : [substanceGate.reason],
                                substance_gate_reasoning: substanceGate.reason
                            }
                        }).eq('id', task.id);
                        this.currentTaskId = null;
                        return;
                    }
                }
            }

            // [PHASE 10] UNCERTAINTY AS OPPORTUNITY (Logical Escalation)
            const lowBelief = evaluation.score < 40;
            const explicitEscalate = result.output.toLowerCase().includes('escalate') || result.output.toLowerCase().includes('more info');

            if (lowBelief || explicitEscalate) {
                console.log(`[ESCALATE] ⚠️ ${this.name} escalating task ${task.id} - reason: ${lowBelief ? 'low_belief' : 'explicit'}, score: ${evaluation.score}`);
                await this.log('task_escalated', `Task ${task.id} escalated by ${this.name}`, {
                    taskId: task.id,
                    reason: lowBelief ? 'low_belief' : 'explicit',
                    score: evaluation.score
                });

                console.log(`[ANTIGRAVITY] 🚨 UNCERTAINTY DETECTED (Score: ${evaluation.score}). Escalating to Architect...`);

                await this.supabase.from('trinity_tasks').update({
                    status: 'pending_clarification',
                    claimed_by: null, // [ANTIGRAVITY] Release claim so agent can do other work
                    claimed_at: null,
                    result: `[ESCALATED] Agent ${this.name} is seeking clarification. \n\nReason: ${lowBelief ? 'Low certainty score' : 'Explicit escalation request'}. \n\nQuery: ${result.output.substring(0, 500)}`,
                    verification_result: `Searching high-dimension databases... seeking expert consensus.`
                }).eq('id', task.id);

                // Spawn "Question for Architect" artifact
                const questionContent = `# Question for Architect \n\n**Agent**: ${this.name} \n**Task**: ${task.title} \n\n**The Right Question**: \n${result.output} \n\n---\n*The smartest person is not the one with all the answers, but the one asking the right questions.*`;
                await this.saveArtifact(task.id, questionContent);

                this.currentTaskId = null;
                return;
            }

            // ARTIFACT_GUARD_HARDENED: stronger content-quality check (legacy path)
            const guard = await this._runArtifactGuardCheck(task);
            if (!guard.skipped && !guard.verdict.valid) {
                return await this.handleArtifactRejection(task, guard.artifact, guard.verdict.reason);
            }

            await this.supabase.from('trinity_tasks').update({
                status: 'done', // Moving to 'done' for verification pipeline
                result: result.output,
                artifact_url: artifactUrl || (this.getLastArtifactId(task.id) ? `db://trinity_artifacts/${this.getLastArtifactId(task.id)}` : null),
                completed_at: new Date().toISOString(),
                // SUBJECTIVE LOGIC: b+d+u=1
                belief: evaluation.score / 100,
                disbelief: (evaluation.score < 50) ? (50 - evaluation.score) / 100 : 0,
                uncertainty: (evaluation.score > 90) ? 0.05 : 0.2,
                metadata: {
                    ...(task.metadata || {}),
                    provider_used: result.provider,
                    provider: result.provider
                }
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
                claimed_at: null,
                result: `Failure ${retries}/${this.MAX_CLAIM_RETRIES}: ${e.message}`
            }).eq('id', task.id);

            this.currentTaskId = null;
        }
    }

    async processPeerVerifyTask(task) {
        console.log(`[${this.name}] Starting peer_verify task ${task.id}`);
        const queueId = task.metadata?.peer_verification_queue_id;
        if (!queueId) {
            throw new Error('Missing peer_verification_queue_id in task metadata');
        }

        // 1. Atomic claim on the queue entry
        const { data: queueEntries, error: queueErr } = await this.supabase
            .from('peer_verification_queue')
            .update({ verification_status: 'in_review' })
            .eq('id', queueId)
            .in('verification_status', ['pending', 'in_review'])
            .select('*');

        if (queueErr) {
            throw new Error(`Failed to query queue entry ${queueId}: ${queueErr.message}`);
        }
        if (!queueEntries || queueEntries.length === 0) {
            console.log(`[${this.name}] Soft-skipping task ${task.id}: Queue entry ${queueId} is already processed.`);
            await this.supabase.from('trinity_tasks').update({
                status: 'done',
                result: `Soft-skipped: Queue entry ${queueId} was already processed by another verifier.`,
                completed_at: new Date().toISOString()
            }).eq('id', task.id);
            return;
        }
        const queueEntry = queueEntries[0];

        // 2. Call LLM to verify claim
        const prompt = `You are a verifier agent. Please verify the following claim:
Claim: "${queueEntry.claim_text}"
Certainty at claim: ${queueEntry.certainty_at_claim}

Analyze this claim for accuracy. If the claim is factual, logical, and correct, respond with the verdict: "verified".
If the claim is incorrect, has an error, or is a hallucination, respond with the verdict: "disputed".
If the claim is vague, unprovable, or has timed out, respond with the verdict: "timeout".

You must output your final verdict in the format:
[VERDICT] <verdict>
Where <verdict> is exactly one of: verified, disputed, timeout.

Provide your reasoning and analysis first, and end with the [VERDICT] line.`;

        const result = await this.callLLM(prompt);
        const verdictMatch = result.output.match(/\[VERDICT\]\s*(verified|disputed|timeout)/i);
        const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'timeout';
        console.log(`[${this.name}] Peer verify verdict: ${verdict} for queue ${queueId}`);

        // 3. Generate verifier_response_id
        const crypto = require('crypto');
        const verifierResponseId = crypto.randomUUID();

        // 4. Compute HMAC signature
        const cleanName = this.name.replace('trinity-', '').toUpperCase().trim();
        const envKey = `${cleanName}_PRIVATE_KEY`;
        const secretKey = process.env.PEER_VERIFY_HMAC_SECRET || process.env[envKey] || process.env.TRUSTRAILS_HMAC_SECRET || 'trinity-default-sbt-secret';
        
        const dataToSign = `${queueId}:${verifierResponseId}:${verdict}`;
        const signature = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('hex');

        // 5. Call back to repid-engine POST /api/v1/peer-verification/respond
        const baseUrl = process.env.REPID_API_URL || 'http://localhost:3000';
        const respondUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/peer-verification/respond`;
        
        console.log(`[${this.name}] Sending verdict to engine: ${respondUrl}`);
        const apiKey = process.env.REPID_API_KEY || 'test-key-123';
        const response = await fetch(respondUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                queue_id: Number(queueId),
                verifier_agent_id: this.name,
                verifier_response_id: verifierResponseId,
                verdict,
                signature
            })
        });

        if (!response.ok) {
            const errTxt = await response.text();
            if (response.status === 400 && errTxt.includes('already processed')) {
                console.log(`[${this.name}] Soft-skipping task ${task.id}: respond API returned already processed.`);
                await this.supabase.from('trinity_tasks').update({
                    status: 'done',
                    result: `Soft-skipped: Respond API confirmed queue entry ${queueId} was already processed.`,
                    completed_at: new Date().toISOString()
                }).eq('id', task.id);
                return;
            }
            throw new Error(`Engine respond API call failed with status ${response.status}: ${errTxt}`);
        }

        const resData = await response.json();
        console.log(`[${this.name}] Engine response:`, JSON.stringify(resData));

        // 6. Update trinity_tasks row status='done'
        await this.supabase.from('trinity_tasks').update({
            status: 'done',
            result: `Peer verification completed with verdict: ${verdict}. Response ID: ${verifierResponseId}`,
            completed_at: new Date().toISOString(),
            metadata: {
                ...(task.metadata || {}),
                provider_used: result.provider,
                provider: result.provider
            }
        }).eq('id', task.id);

        console.log(`[${this.name}] Completed peer_verify task ${task.id}`);
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

    /**
     * Phase 2.8 — record the substance gate event in repid-engine.
     * Never throws: on any HTTP failure it returns { degraded:true } and the
     * caller defaults to PASS (graceful degradation, non-negotiable).
     */
    async _postSubstanceGateEvent(task, output, substanceGate) {
        try {
            const res = await substanceGateClient.recordEvent({
                task,
                output,
                substanceGate,
                agentName: this.name,
            });
            if (res.degraded) {
                console.warn(`[SUBSTANCE_GATE] ⚠️ event NOT recorded (${res.degradeReason}) task ${task.id} — defaulting to PASS`);
                await this.log('substance_gate_degraded', `Gate event degraded: ${res.degradeReason}`, { taskId: task.id, degradeReason: res.degradeReason, claimed_by: this.name });
            } else if (res.recorded) {
                console.log(`[SUBSTANCE_GATE] 📡 event recorded ${res.gateEventId} task ${task.id} passed=${res.passed}`);
            }
            return res;
        } catch (e) {
            console.error(`[SUBSTANCE_GATE] ❌ unexpected error posting gate event task ${task.id}: ${e.message}`);
            return { recorded: false, degraded: true, degradeReason: 'helper_exception', passed: !!(substanceGate && substanceGate.ok) };
        }
    }

    async validateSubstance(output, task, artifactId) {
        // Template placeholder check
        const placeholderRegex = /\[insert\s|\[INSERT\s|\[TODO|\[PLACEHOLDER|\[FILL_IN|\{\{|\}\}|<placeholder/i;
        const match = output.match(placeholderRegex);
        if (match) {
            return { ok: false, reason: `template_placeholder_detected: ${match[0]}` };
        }

        // Minimum length check
        const stripped = output.replace(/^#+.*$/gm, '').replace(/```[\s\S]*?```/g, '').trim();
        const minLength = parseInt(process.env.HAL_MIN_SUBSTANCE_CHARS || '200', 10);
        if (stripped.length < minLength) {
            return { ok: false, reason: `output_too_short: ${stripped.length}/${minLength}` };
        }

        // Success criteria overlap check
        if (task.success_criteria && task.success_criteria.length > 50) {
            const getWords = (text) => {
                const words = (text.toLowerCase().match(/\b\w{4,}\b/g) || []);
                const stopwords = new Set(['this', 'that', 'with', 'from', 'your', 'have', 'what', 'will', 'then', 'they']);
                return new Set(words.filter(w => !stopwords.has(w)));
            };
            const criteriaWords = getWords(task.success_criteria);
            if (criteriaWords.size > 0) {
                const outputWords = getWords(output);
                let overlap = 0;
                for (const word of criteriaWords) {
                    if (outputWords.has(word)) overlap++;
                }
                const pct = (overlap / criteriaWords.size) * 100;
                if (pct < 30) {
                    return { ok: false, reason: `success_criteria_unmet: ${Math.round(pct)}%` };
                }
            } else {
                await this.log('success_criteria_skipped', 'Criteria parsed to 0 distinctive words', { taskId: task.id });
            }
        } else {
            await this.log('success_criteria_skipped', 'Criteria missing or too short', { taskId: task.id });
        }

        // Artifact presence check
        const artifactTypes = ['code', 'research', 'docs', 'artifact', 'content', 'report', 'design', 'data'];
        if (artifactTypes.includes(task.task_type)) {
            let query = this.supabase.from('trinity_artifacts').select('content, content_preview');
            if (artifactId) {
                query = query.eq('id', artifactId);
            } else {
                query = query.eq('task_id', String(task.id)).order('created_at', { ascending: false }).limit(1);
            }
            const { data } = await query.maybeSingle();
            if (!data || (!data.content && !data.content_preview)) {
                return { ok: false, reason: 'artifact_missing_or_empty' };
            }
        }

        return { ok: true };
    }


    async spawnNextStep(originalTask, result, evaluation) {
        if (originalTask.title.includes('[SURGERY]') || originalTask.title.startsWith('[SURGERY]')) {
            console.log(`[SURGERY] 🛑 Loop breaker triggered in spawnNextStep for Task ${originalTask.id}. Not spawning recursive review.`);
            return;
        }
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
                        parent_task_id: parentId,
                        metadata: { disputed_task_id: parentId, disputed_agent: parentTask.claimed_by, ...provenance('T2a_INTERNAL_REAL_ORGANIC', 'agent_self_spawn_reorg') }
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
                parent_task_id: originalTask.id,
                metadata: { parent_task_id: originalTask.id, ...provenance('T2a_INTERNAL_REAL_ORGANIC', 'agent_self_spawn_verify') }
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
                reputation_score: score,
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

    async resolveAgentUuid() {
        try {
            const lcName = this.name.toLowerCase();
            const lookupName = lcName.startsWith('trinity-') ? lcName : `trinity-${lcName}`;
            const { data } = await this.supabase
                .from('repid_agents')
                .select('id')
                .eq('agent_name', lookupName)
                .maybeSingle();
            if (data && data.id) {
                this.agent_id = data.id;
                console.log(`[INIT] Resolved agent_id UUID: ${this.agent_id} for ${this.name}`);
            }
        } catch (e) {
            console.warn(`[INIT] Failed to resolve agent_id UUID:`, e.message);
        }
    }

    calculateCostLocal(provider, model, tokensIn, tokensOut) {
        const PRICING = {
            openai: {
                'gpt-4o': { in: 2.50, out: 10.00 },
                'gpt-4o-mini': { in: 0.15, out: 0.60 }
            },
            anthropic: {
                'claude-3-5-sonnet-20241022': { in: 3.00, out: 15.00 },
                'claude-haiku-4-5': { in: 1.00, out: 5.00 },
                'claude-sonnet-4-6': { in: 3.00, out: 15.00 }
            },
            gemini: {
                'gemini-1.5-flash-latest': { in: 0.075, out: 0.30 },
                'gemini-1.5-flash': { in: 0.075, out: 0.30 },
                'gemini-2.0-flash': { in: 0.075, out: 0.30 },
                'gemini-1.5-pro': { in: 1.25, out: 5.00 }
            },
            deepseek: {
                'deepseek-chat': { in: 0.27, out: 1.10 }
            },
            openrouter: {
                'deepseek/deepseek-chat': { in: 0.27, out: 1.10 }
            },
            grok: {
                'grok-2': { in: 2.00, out: 10.00 }
            },
            together: {
                'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free': { in: 0.0, out: 0.0 }
            }
        };

        const p = PRICING[provider];
        if (!p) return 0;
        let m = p[model];
        if (!m) {
            const keys = Object.keys(p);
            if (keys.length > 0) m = p[keys[0]];
        }
        if (!m) return 0;
        const costIn = (tokensIn / 1000000) * m.in;
        const costOut = (tokensOut / 1000000) * m.out;
        return Math.round((costIn + costOut) * 1000000) / 1000000;
    }

    async getRecentLlmSpend() {
        try {
            const pool = getPgPool();
            if (pool) {
                const { rows } = await pool.query(
                    "SELECT COALESCE(SUM(cost_usd), 0) as total_spend FROM llm_call_log WHERE created_at > NOW() - INTERVAL '24 hours'"
                );
                return parseFloat(rows[0].total_spend || '0');
            }
        } catch (e) {
            console.error('[SPEND-TRACKER] Error querying spend:', e.message);
        }
        return 0;
    }

    async directLogLlmCall(entry) {
        try {
            const pool = getPgPool();
            if (pool) {
                await pool.query(
                    `INSERT INTO llm_call_log (
                        call_id, provider, tier, model, prompt_tokens, completion_tokens, cost_usd, latency_ms, status, error_message, agent_id, task_hint
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                    [
                        entry.call_id,
                        entry.provider,
                        entry.tier,
                        entry.model,
                        entry.prompt_tokens || 0,
                        entry.completion_tokens || 0,
                        entry.cost_usd || 0,
                        entry.latency_ms || 0,
                        entry.status,
                        entry.error_message || null,
                        this.agent_id || null,
                        entry.task_hint || 'swarm'
                    ]
                );
                console.log(`[${this.name}] directLogLlmCall direct-pg successful write for ${entry.provider}`);
                return;
            }
        } catch (e) {
            console.error(`[${this.name}] directLogLlmCall direct-pg exception:`, e.message);
        }

        try {
            const { error } = await this.supabase.from('llm_call_log').insert({
                call_id: entry.call_id,
                provider: entry.provider,
                tier: entry.tier,
                model: entry.model,
                prompt_tokens: entry.prompt_tokens || 0,
                completion_tokens: entry.completion_tokens || 0,
                cost_usd: entry.cost_usd || 0,
                latency_ms: entry.latency_ms || 0,
                status: entry.status,
                error_message: entry.error_message || null,
                agent_id: this.agent_id || null,
                task_hint: entry.task_hint || 'swarm'
            });
            if (error) {
                console.warn(`[${this.name}] directLogLlmCall error:`, error.message);
            }
        } catch (e) {
            console.error(`[${this.name}] directLogLlmCall exception:`, e.message);
        }
    }

    hashPrompt(prompt) {
        return require('crypto').createHash('sha256').update(prompt).digest('hex');
    }

    async callLLM(prompt, options = {}) {
        // Attempt engine routing call first
        try {
            console.log(`[${this.name}] 🤖 Routing call to repid-engine complete API...`);
            if (!this.agent_id) {
                await this.resolveAgentUuid();
            }
            const response = await fetch('http://localhost:3000/api/v1/llm/complete', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.REPID_API_KEY || 'test-key-123'}`
                },
                body: JSON.stringify({
                    prompt,
                    tier_preference: 'auto',
                    task_hint: 'swarm',
                    agent_id: this.name
                })
            });
            if (response.ok) {
                const data = await response.json();
                if (data && data.answer) {
                    console.log(`[${this.name}] 🚀 Engine routing success: ${data.provider} (${data.tier_used})`);
                    // Wire tool_call_log for engine-routed LLM call too (S-WIRE-AGENTS)
                    if (this.supabase) {
                      this.supabase.from('tool_call_log').insert({
                        agent_id: this.agent_id || this.name,
                        tool_name: 'llm_call',
                        input: { prompt: (prompt || '').substring(0, 500) },
                        output: { text: (data.answer || '').substring(0, 1000), provider: data.provider, fromEngine: true },
                        metadata: { tier: data.tier_used || '0a', effective_repid: (this.state && this.state.current_repid) || null },
                        created_at: new Date().toISOString()
                      }).then(null, e => console.warn(`[${this.name}] tool_call_log (engine) failed:`, e.message));
                    }
                    return { output: data.answer, provider: data.provider, fromEngine: true };
                }
            } else {
                const errText = await response.text();
                console.warn(`[${this.name}] ⚠️ Engine API failed with status ${response.status}: ${errText}`);
            }
        } catch (e) {
            console.warn(`[${this.name}] ⚠️ Engine API unreachable, falling back to direct provider loop:`, e.message);
        }

        for (const providerKey of this.availableProviders) {
            const spendCeiling = parseFloat(process.env.SPEND_CEILING_USD || '5.00');
            const currentSpend = await this.getRecentLlmSpend();
            const isFree = providerKey === 'groq' || providerKey === 'cerebras' || providerKey === 'together' || providerKey === 'sambanova';
            if (currentSpend >= spendCeiling && !isFree) {
                console.warn(`[SPEND-CEILING] 🚨 SPEND CEILING REACHED ($${currentSpend.toFixed(4)} >= $${spendCeiling.toFixed(2)})! Blocked paid provider: ${providerKey}`);
                continue;
            }

            const provider = PROVIDERS[providerKey];
            const call_id = require('crypto').randomUUID();
            const providerStartTime = Date.now();
            
            let retries = 0;
            const maxRetries = 3;
            let currentDelay = 1000;
            let res;
            let lastError;

            while (retries < maxRetries) {
                try {
                    res = await this.callProvider(provider, prompt, { ...options, providerKey });
                    this.sessionMetrics.llmCalls++;

                    const prompt_tokens = res.usage?.prompt_tokens || Math.ceil(prompt.length / 4);
                    const completion_tokens = res.usage?.completion_tokens || Math.ceil((res.output || '').length / 4);
                    const cost = this.calculateCostLocal(providerKey, provider.model, prompt_tokens, completion_tokens);
                    const tier = (providerKey === 'openai' || providerKey === 'anthropic' || providerKey === 'openrouter') ? '1' : '0a';

                    this.directLogLlmCall({
                        call_id,
                        provider: providerKey,
                        tier,
                        model: provider.model,
                        prompt_tokens,
                        completion_tokens,
                        cost_usd: cost,
                        latency_ms: Date.now() - providerStartTime,
                        status: 'success',
                        task_hint: 'swarm'
                    }).catch(err => console.error('Error logging direct LLM call:', err));

                    // Wire tool_call_log (S-WIRE-AGENTS): every LLM call logged with effective repid etc for delegation/audit
                    if (this.supabase) {
                      this.supabase.from('tool_call_log').insert({
                        agent_id: this.agent_id || this.name,
                        tool_name: 'llm_call',
                        input: { prompt: (prompt || '').substring(0, 500), options: options || {} },
                        output: { text: (res.output || '').substring(0, 1000), provider: providerKey, model: provider.model },
                        metadata: {
                          tier,
                          cost_usd: cost,
                          latency_ms: Date.now() - providerStartTime,
                          effective_repid: (this.state && this.state.current_repid) || null,
                          delegation_depth: 0
                        },
                        created_at: new Date().toISOString()
                      }).then(null, e => console.warn(`[${this.name}] tool_call_log insert failed (non-fatal):`, e.message));
                    }

                    return { ...res, provider: canonicalizeProvider(providerKey) };
                } catch (e) {
                    lastError = e;
                    const isRate = e.message?.toLowerCase().includes('rate limit') || e.message?.toLowerCase().includes('429') || e.message?.toLowerCase().includes('too many requests');
                    if (isRate && retries < maxRetries - 1) {
                        console.warn(`[${this.name}] ⚠️ Rate limit hit on ${providerKey}. Retrying in ${currentDelay}ms...`);
                        await this.sleep(currentDelay);
                        retries++;
                        currentDelay *= 2;
                        continue;
                    }
                    break;
                }
            }

            console.warn(`${providerKey} failed:`, lastError?.message ?? lastError);
            const isRate = lastError?.message?.toLowerCase().includes('rate limit') || lastError?.message?.toLowerCase().includes('429') || lastError?.message?.toLowerCase().includes('too many requests');
            const status = isRate ? 'rate_limited' : 'failed';
            const tier = (providerKey === 'openai' || providerKey === 'anthropic' || providerKey === 'openrouter') ? '1' : '0a';

            this.directLogLlmCall({
                call_id,
                provider: providerKey,
                tier,
                model: provider.model,
                prompt_tokens: 0,
                completion_tokens: 0,
                cost_usd: 0,
                latency_ms: Date.now() - providerStartTime,
                status,
                error_message: lastError?.message || String(lastError),
                task_hint: 'swarm'
            }).catch(lerr => console.error('Error logging failed direct LLM call:', lerr));
        }
        throw new Error('All LLMs failed');
    }

    async callProvider(provider, prompt, options = {}) {
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
                const pk = options.providerKey || 'unknown';
                if (res.status === 401 || res.status === 404) {
                    console.warn(`[FAILOVER] ${pk} returned ${res.status}. Demoting provider for this session.`);
                    this.availableProviders = this.availableProviders.filter(p => p !== pk);
                }
                throw new Error(errorText);
            }

            const data = await res.json();
            const pk = options.providerKey || 'unknown';
            if (data.error) throw new Error(`${pk} API Error: ${JSON.stringify(data.error)}`);

            let output = "";
            let toolCalls = null;
            let usage = null;

            if (provider.isGemini) {
                if (!data.candidates || data.candidates.length === 0) throw new Error("Gemini returned no candidates");
                output = data.candidates[0].content.parts[0].text;
                if (data.usageMetadata) {
                    usage = {
                        prompt_tokens: data.usageMetadata.promptTokenCount,
                        completion_tokens: data.usageMetadata.candidatesTokenCount
                    };
                }
            } else if (provider.isAnthropic) {
                if (!data.content || data.content.length === 0) throw new Error("Anthropic returned no content");
                output = data.content[0].text;
                if (data.usage) {
                    usage = {
                        prompt_tokens: data.usage.input_tokens,
                        completion_tokens: data.usage.output_tokens
                    };
                }
            } else {
                if (!data.choices || data.choices.length === 0) throw new Error(`${pk} returned no choices`);
                const message = data.choices[0].message;
                output = message.content || "";
                toolCalls = message.tool_calls;
                messages.push(message);
                if (data.usage) {
                    usage = {
                        prompt_tokens: data.usage.prompt_tokens,
                        completion_tokens: data.usage.completion_tokens
                    };
                }
            }

            if (toolCalls && toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    const fnName = toolCall.function.name;
                    const args = JSON.parse(toolCall.function.arguments);
                    console.log(`[${this.name}] Tool Call: ${fnName}`);

                    if (fnName === 'save_artifact') {
                        const taskId = options.taskId || this.currentTaskId || ('mcp-gen-' + Date.now());
                        await this.saveArtifact(taskId, args.content, args.type, args.title);
                        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Artifact saved.` });
                    }
                }
            } else {
                // [PHASE 10] Smart-Parse Artifact Fallback for JS version
                if (output.includes('```md') || output.includes('# Artifact')) {
                    console.log(`[${this.name}] Smart-Parse Artifact detected.`);
                    const taskId = options.taskId || this.currentTaskId || ('mcp-gen-' + Date.now());
                    await this.saveArtifact(taskId, output, 'report', `Report from ${this.name}`);
                }
                return { output, usage };
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
                creator_agent: this.name,
                content_preview: (content || '').substring(0, 5000)
            }).select('id').single();

            if (error) {
                console.warn(`[ARTIFACT] V5 Schema failed (error: ${error.message}), trying V4...`);
                // Attempt V4 (Legacy)
                const { data: v4Data, error: v4Error } = await this.supabase.from('trinity_artifacts').insert({
                    ...payload,
                    content_preview: (content || '').substring(0, 5000),
                    agent: this.name,
                    status: 'created'
                }).select('id').single();

                if (v4Error) throw v4Error;
                artifactId = v4Data?.id;
            } else {
                artifactId = data?.id;
            }
        } catch (e) {
            console.error(`[ARTIFACT] DB Save Failed: ${e.message}`);
        }

        if (artifactId) {
            this.lastArtifactId = artifactId;
            if (taskId) {
                if (!this.taskArtifacts) this.taskArtifacts = new Map();
                this.taskArtifacts.set(taskId, artifactId);
            }
        }
        return artifactId ? `db://trinity_artifacts/${artifactId}` : null;
    }

    getLastArtifactId(taskId) {
        if (taskId && this.taskArtifacts && this.taskArtifacts.has(taskId)) {
            return this.taskArtifacts.get(taskId);
        }
        return this.lastArtifactId;
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
