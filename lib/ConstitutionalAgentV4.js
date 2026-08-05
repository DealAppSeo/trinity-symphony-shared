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
const { pgQuery, pgPing } = require('./direct-pg');
const { isAgentEnabled: readAgentControlEnabled } = require('./agent-controls');
const { shouldParkForHalt } = require('./emergency-halt'); // L0 gate 0.4 — GLOBAL kill switch
const { logToolCall } = require('./tool-call-logger'); // S-QUORUM Phase 4 (gated TOOL_CALL_LOGGING)
const toolbelt = require('./swarm-toolbelt'); // read-only instruments (gated SWARM_TOOLBELT)

// ============================================
// CHANGE 1 — REAL WEB SEARCH TOOL (Tavily)
// ============================================
// Prior state: the live JS runtime had NO web/research tool at all; the stub
// lived only in the un-loaded lib/ConstitutionalAgent.ts and returned a FAKE
// example.com row when TAVILY_API_KEY was unset. This gives the JS runtime a
// real search. Contract: with a key set, it performs ONE real Tavily fetch and
// returns real source URLs. With no key (or on error) it DEGRADES LOUDLY —
// console.warn + an explicit { degraded:true, reason, results:[] } — never a
// fabricated result. Callers must treat degraded:true as "no sources".
const WEB_SEARCH_TIMEOUT_MS = 15_000;

class WebResearchTool {
    /**
     * @param {string} query
     * @returns {Promise<{degraded:boolean, reason?:string, results:{url:string,title:string,content:string}[]}>}
     */
    async searchWeb(query) {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) {
            console.warn('[ResearchTool] ⚠️ TAVILY_API_KEY unset — web search DEGRADED (no live sources). Set TAVILY_API_KEY to enable real search.');
            return { degraded: true, reason: 'TAVILY_API_KEY not set', results: [] };
        }
        try {
            console.log(`[ResearchTool] 🔎 Tavily search: "${query}"`);
            const response = await withTimeout(
                fetch('https://api.tavily.com/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: apiKey,
                        query,
                        search_depth: 'basic',
                        max_results: 3
                    })
                }),
                WEB_SEARCH_TIMEOUT_MS,
                'tavily-search'
            );
            if (!response.ok) {
                const body = await response.text().catch(() => '');
                console.warn(`[ResearchTool] ⚠️ Tavily HTTP ${response.status} — DEGRADED. ${body.slice(0, 200)}`);
                return { degraded: true, reason: `Tavily HTTP ${response.status}`, results: [] };
            }
            const data = await response.json();
            if (!data || !Array.isArray(data.results)) {
                console.warn('[ResearchTool] ⚠️ Tavily returned no results array — DEGRADED.');
                return { degraded: true, reason: 'no results field', results: [] };
            }
            const results = data.results.map(r => ({
                url: r.url,
                title: r.title,
                content: r.content
            }));
            return { degraded: false, results };
        } catch (e) {
            console.warn(`[ResearchTool] ⚠️ Tavily search failed (${e.message}) — DEGRADED (no fabricated result).`);
            return { degraded: true, reason: e.message, results: [] };
        }
    }
}

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

/**
 * Resolve the tri-state presence-write mode from the new HEARTBEAT_MODE env and
 * the legacy HEARTBEAT_DB_WRITES flag. Precedence:
 *   1. Explicit HEARTBEAT_MODE = full|throttled|off  → wins.
 *   2. Otherwise map legacy HEARTBEAT_DB_WRITES: 'off' → 'off', anything else → 'full'.
 *   3. Neither set → 'full' (preserves today's exact default behavior).
 * Any unrecognized HEARTBEAT_MODE value falls through to the legacy mapping.
 */
function resolveHeartbeatMode(modeEnv, legacyEnv) {
    const mode = (modeEnv || '').toLowerCase().trim();
    if (mode === 'full' || mode === 'throttled' || mode === 'off') return mode;
    // Legacy fallback: HEARTBEAT_DB_WRITES=off → off; default (on/unset) → full.
    const legacy = (legacyEnv || 'on').toLowerCase().trim();
    return legacy === 'off' ? 'off' : 'full';
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

        // CHANGE 1 — real web search tool (Tavily; degrades loudly if no key).
        this.researchTool = new WebResearchTool();

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

        // Presence-write reduction (2026-07): in-memory liveness signal for the
        // /health endpoint so an external monitor (UptimeRobot keyword check)
        // can detect a hung loop (loopCount not advancing / stale lastIterationAt)
        // WITHOUT any DB write. Bumped at the top of every runLoop iteration.
        this.lastIterationAt = null;
        // Real deployed commit SHA when running on Railway; falls back to code
        // version label locally. Surfaced in /health only — no DB write.
        this.codeVersion = process.env.RAILWAY_GIT_COMMIT_SHA || this.version;

        // HEARTBEAT_MODE tri-state gate (2026-07). Controls ONLY the per-iteration
        // presence upserts (trinity_agent_registry presence + agent_heartbeat +
        // trinity_heartbeat). Durable write-on-CHANGE for genuinely-persistent
        // registry config fields is NEVER gated by this (see persistRegistryConfig).
        //
        //   'full'      — DEFAULT. Preserve today's exact behavior: all 3 presence
        //                 upserts fire on EVERY heartbeat() call (per-iteration +
        //                 per-task-event), i.e. the ~8.6M/day churn.
        //   'throttled' — RECOMMENDED. All 3 presence upserts still fire, but at
        //                 most once per HEARTBEAT_LIVENESS_INTERVAL_MS per agent.
        //                 Keeps last_seen / last_active / status fresh for every
        //                 reader (survivor >10min check, seeder status, dashboards)
        //                 while collapsing per-iteration/per-event churn to a fixed
        //                 low cadence (default 2min).
        //   'off'       — No presence writes at all (UptimeRobot /health end-state).
        //
        // Legacy HEARTBEAT_DB_WRITES is mapped onto the new axis for back-compat:
        //   HEARTBEAT_DB_WRITES=off  ⇒ mode 'off'   (unless HEARTBEAT_MODE is set)
        //   HEARTBEAT_DB_WRITES=on/  ⇒ mode 'full'  (the historical default)
        // An explicit HEARTBEAT_MODE always wins over the legacy flag.
        this.heartbeatMode = resolveHeartbeatMode(process.env.HEARTBEAT_MODE, process.env.HEARTBEAT_DB_WRITES);
        // Back-compat boolean: true when ANY presence write can occur (full|throttled),
        // false only in 'off'. Preserved because other code / tests read it.
        this.heartbeatDbWrites = this.heartbeatMode !== 'off';
        // Throttle cadence for 'throttled' mode — presence writes fire at most once
        // per this many ms per agent. Default 120000 (2min) matches the survivor
        // >10min staleness check (≥5 write windows of headroom) and the heartbeat
        // setInterval cadence, so readers never see data older than ~2min.
        this.heartbeatLivenessIntervalMs = parseInt(process.env.HEARTBEAT_LIVENESS_INTERVAL_MS, 10) || 120000;
        // Timestamp (ms) of the last presence write, for the 'throttled' gate. 0 =
        // never written this process → first heartbeat() always writes (fresh boot).
        this._lastPresenceWriteAt = 0;
        // Last-written snapshot of durable registry config, so persistRegistryConfig
        // can write-on-CHANGE only (avoids reintroducing per-loop churn).
        this._lastRegistryConfig = null;

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
    }

    get HEARTBEAT_CIRCUIT_OPEN_THRESHOLD() { return 5; }
    get HEARTBEAT_CIRCUIT_OPEN_SLEEP_MS() { return 5 * 60 * 1000; }

    detectProviders() {
        return Object.keys(PROVIDERS).filter(k => process.env[PROVIDERS[k].envKey]).sort((a, b) => PROVIDERS[a].priority - PROVIDERS[b].priority);
    }

    get isEscalationContractEnabled() {
        return process.env.ESCALATION_CONTRACT === 'true';
    }

    get agentControlIdleMs() {
        return Number(process.env.AGENT_CONTROL_IDLE_MS || 10_000);
    }

    async isWorkEnabled() {
        return readAgentControlEnabled(this.name);
    }

    async idleWhenDisabled(statusMessage = 'sleeping (disabled)') {
        try {
            await withTimeout(this.heartbeat(statusMessage), LOOP_TIMEOUTS.DB_QUERY, 'heartbeat(disabled)');
        } catch (e) {
            console.warn(`[${this.name}] heartbeat non-fatal while disabled: ${e?.message ?? e}`);
        }
        await this.sleep(this.agentControlIdleMs);
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
            app.get('/health', (req, res) => res.json(this.healthPayload()));
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

    /**
     * In-memory liveness snapshot served by GET /health. Pure read of process
     * state — performs NO DB access, so it is safe to poll at high frequency
     * (UptimeRobot). A hung loop is detectable externally: loopCount stops
     * advancing and lastIterationAt goes stale while the process still answers.
     * Keyword-monitoring on `"alive":true` + a freshness check on lastIterationAt
     * replaces the per-iteration agent_heartbeat write when HEARTBEAT_DB_WRITES=off.
     */
    healthPayload() {
        const startTime = (this.sessionMetrics && this.sessionMetrics.startTime) || Date.now();
        return {
            alive: true,
            status: 'healthy',
            agent: this.name,
            loopCount: this.loopCount,
            lastIterationAt: this.lastIterationAt,
            currentTaskId: this.currentTaskId || null,
            uptimeSec: Math.floor((Date.now() - startTime) / 1000),
            codeVersion: this.codeVersion,
            version: this.version,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Durable, write-on-CHANGE persistence for the genuinely-durable
     * trinity_agent_registry config fields — system_prompt, directive_source,
     * suggested_prompt (+ suggestion_* siblings), repid_proof, dbt_metadata.
     *
     * These are NOT presence/liveness data, so they are deliberately NOT gated
     * by HEARTBEAT_DB_WRITES: when a value actually changes it must persist,
     * even with presence writes turned off. To avoid reintroducing per-loop
     * churn, this only issues an UPDATE when the current snapshot differs from
     * the last one written (`_lastRegistryConfig`). No-op when nothing changed
     * or when the runtime hasn't populated any of these fields (today's default).
     *
     * NOTE: this repo's runtime does not currently set these fields; the method
     * is a forward-compatible contract surface so that if/when it does, the
     * value survives regardless of the presence-write flag.
     */
    async persistRegistryConfig(pgOpts = { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY }) {
        const snapshot = {
            system_prompt: this.systemPrompt ?? null,
            directive_source: this.directiveSource ?? null,
            suggested_prompt: this.suggestedPrompt ?? null,
            suggestion_status: this.suggestionStatus ?? null,
            suggestion_source: this.suggestionSource ?? null,
            repid_proof: this.repidProof ?? null,
            dbt_metadata: this.dbtMetadata ?? null
        };

        // Nothing to persist until the runtime actually sets at least one field.
        const hasAny = Object.values(snapshot).some(v => v !== null && v !== undefined);
        if (!hasAny) return;

        const serialized = JSON.stringify(snapshot);
        if (serialized === this._lastRegistryConfig) return; // unchanged → no write

        try {
            await pgQuery(
                `INSERT INTO trinity_agent_registry
                   (agent_name, system_prompt, directive_source, suggested_prompt,
                    suggestion_status, suggestion_source, repid_proof, dbt_metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
                 ON CONFLICT (agent_name) DO UPDATE SET
                   system_prompt = EXCLUDED.system_prompt,
                   directive_source = EXCLUDED.directive_source,
                   suggested_prompt = EXCLUDED.suggested_prompt,
                   suggestion_status = EXCLUDED.suggestion_status,
                   suggestion_source = EXCLUDED.suggestion_source,
                   repid_proof = EXCLUDED.repid_proof,
                   dbt_metadata = EXCLUDED.dbt_metadata`,
                [this.name, snapshot.system_prompt, snapshot.directive_source, snapshot.suggested_prompt,
                 snapshot.suggestion_status, snapshot.suggestion_source, snapshot.repid_proof,
                 snapshot.dbt_metadata === null ? null : JSON.stringify(snapshot.dbt_metadata)],
                { ...pgOpts, label: 'heartbeat:registry_config_on_change' }
            );
            this._lastRegistryConfig = serialized;
        } catch (e) {
            // Durable-config persistence is best-effort; never break the loop.
            console.warn(`[${this.name}] persistRegistryConfig non-fatal: ${e?.message ?? e}`);
        }
    }

    /**
     * Wall-clock now() in ms — a seam so tests can drive the 'throttled' window
     * deterministically without real timers. Defaults to Date.now().
     */
    _now() { return Date.now(); }

    async heartbeat(statusMessage = 'Idle') {
        // Phase 7C — circuit-open early-return. Skip the call entirely if
        // we're in the cool-down window from a recent failure burst. Logged
        // once at the open boundary (heartbeatCircuitOpenLogged gate).
        if (this.heartbeatCircuitOpenUntil > Date.now()) {
            return;
        }

        const timestamp = new Date().toISOString();
        try {
            const taskSummary = this.currentTaskId ? `Working on task ${this.currentTaskId}` : statusMessage;
            const pgOpts = { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY };

            // Durable write-on-CHANGE for genuinely-persistent registry config
            // fields (system_prompt, directive_source, suggested_prompt +
            // suggestion_*, repid_proof, dbt_metadata). NOT gated by
            // HEARTBEAT_DB_WRITES — these must persist when they actually change,
            // regardless of the presence-write flag. No-op unless a value changed.
            await this.persistRegistryConfig(pgOpts);

            // Presence writes (per-iteration liveness). These are the ~8.6M/day
            // meaningless writes: agent_heartbeat + the trinity_agent_registry /
            // trinity_heartbeat presence upserts. Gated by HEARTBEAT_MODE:
            //   'full'      → write on every call (default; today's behavior).
            //   'throttled' → write at most once per heartbeatLivenessIntervalMs
            //                 per agent — keeps every reader fresh (survivor
            //                 >10min check, seeder status, dashboards) at a fixed
            //                 low cadence instead of per-iteration/per-event churn.
            //   'off'       → never write; liveness delegated to UptimeRobot's
            //                 /health polling + in-memory healthPayload()
            //                 (loopCount / lastIterationAt).
            const now = this._now();
            let shouldWritePresence = false;
            if (this.heartbeatMode === 'full') {
                shouldWritePresence = true;
            } else if (this.heartbeatMode === 'throttled') {
                shouldWritePresence =
                    (now - this._lastPresenceWriteAt) >= this.heartbeatLivenessIntervalMs;
            }
            if (shouldWritePresence) {
                // Record the write time BEFORE issuing upserts so the throttle
                // window is measured from attempt-start (a slow/failed upsert does
                // not let the next call bypass the throttle). On failure the outer
                // catch still runs; the window simply resets on the next success.
                this._lastPresenceWriteAt = now;
                // [TRINITY SSOT]: PRIMARY STATUS UPDATE (Patent: BFT Consensus Dashboard)
                // PostgREST bypass (2026-05-21) — direct pg INSERT..ON CONFLICT in
                // place of supabase upsert. retries:1 + 10s ceiling preserves the
                // prior single-withTimeout latency; pgQuery owns the timeout, and
                // the method-level heartbeat circuit breaker (below) owns
                // consecutive-failure handling. Per CLAUDE-RULE-8.
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
            }

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
                .select(ConstitutionalAgentV4.REAP_SELECT_COLUMNS)
                .in('status', ConstitutionalAgentV4.REAPABLE_STATUSES)
                .lt('claimed_at', new Date(Date.now() - ConstitutionalAgentV4.REAP_STALE_AFTER_MS).toISOString())
                .limit(ConstitutionalAgentV4.REAP_BATCH_LIMIT);

            if (error) {
                console.error(`[${this.name}] ❌ Reaper query error:`, error.message);
                return;
            }

            if (!stale || stale.length === 0) {
                return;
            }

            console.log(`[REAPER] 🧹 ${this.name} found ${stale.length} stale tasks to release`);

            // BREAKER GUARD (2026-07-27, Beat 44 — raised by the verification of this very commit).
            // Moving the release from supabase-js to pgQuery put this background janitor behind
            // direct-pg's PROCESS-WIDE circuit breaker: 5 consecutive fully-failed calls open a
            // 5-minute cool-down that throws for EVERY caller. Because the loop below continues
            // past a failure, a systemic DB problem across a <=50-row batch would guarantee those
            // 5 failures — and take getNextTask, claimTask and the heartbeat down with it for five
            // minutes. A janitor must never be able to idle the fleet's claim path. Giving up
            // after a few consecutive failures keeps this loop below the breaker's threshold; the
            // tasks are still stale on the next pass, so nothing is lost by stopping early.
            let consecutiveFailures = 0;
            for (const task of stale) {
                const updatedMetadata = task.metadata || {};
                updatedMetadata.reap_count = (updatedMetadata.reap_count || 0) + 1;
                updatedMetadata.last_reaped_at = new Date().toISOString();

                // CLAIM REFUND (2026-07-27, Beat 44 — verifier findings F1/F3 on the durable cap).
                // A reap is BLAMELESS: the task did nothing wrong, its claimer died or restarted.
                // Under the cap, every reap would otherwise cost that task one claim permanently —
                // and 2,408 real tasks have already been reaped >=12 times (max 438), so agent
                // lifecycle noise alone would have parked them. Refunding the claim the reap is
                // undoing keeps the counter measuring what it says it measures: claims actually
                // spent trying to do the work. This also covers F3's other blameless consumer —
                // a transient pgQuery failure in claimTask() leaves the row in 'doing' and it
                // arrives here an hour later.
                // GREATEST(...,0) so a refund can never drive the counter negative; the status
                // re-check stays INSIDE the statement (not a second round-trip) so two reapers
                // racing the same row cannot both refund it.
                let reaped;
                try {
                    reaped = await pgQuery(
                        ConstitutionalAgentV4.REAP_SQL,
                        ConstitutionalAgentV4.buildReapParams(task.id, updatedMetadata),
                        { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY, label: 'runStaleTaskReaper(release)' }
                    );
                } catch (updateError) {
                    console.error(`[REAPER] ❌ Failed to reap task ${task.id}:`, updateError.message);
                    if (++consecutiveFailures >= ConstitutionalAgentV4.REAP_FAILURE_BUDGET) {
                        console.error(`[REAPER] ⛔ ${consecutiveFailures} consecutive failures — abandoning this batch before the shared pg circuit breaker opens on the claim path`);
                        return;
                    }
                    continue;
                }
                consecutiveFailures = 0;
                if (!reaped || reaped.length === 0) {
                    // Another reaper won the race, or the task left 'doing' on its own. Not an error.
                    continue;
                }
                const refundedTo = reaped[0].claim_count;
                console.log(`[REAPER] ✅ Released task ${task.id} from ${task.claimed_by} (was claimed ${task.claimed_at}); claim refunded → claim_count=${refundedTo}`);
                await this.log('task_reaped', `Released stale task ${task.id} from ${task.claimed_by}`, {
                    taskId: task.id,
                    originalClaimer: task.claimed_by,
                    claimedAt: task.claimed_at,
                    claimCountAfterRefund: refundedTo
                });
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
                // await. A hung await leaves loop_count stale; the data layer
                // sees that staleness even though heartbeat last_ping stays
                // fresh from the independent setInterval — exactly the signal
                // missing during the 2026-05-16/17 staggered freeze.
                this.loopCount++;
                // In-memory liveness for /health (UptimeRobot). A hung await
                // leaves this timestamp stale — the external monitor sees it
                // even with HEARTBEAT_DB_WRITES=off (no DB write required).
                // Set BEFORE the agent_controls gate so /health stays fresh
                // while the agent is intentionally idled (heartbeat-only).
                this.lastIterationAt = new Date().toISOString();
                // L0 gate 0.4 — GLOBAL emergency halt. Checked BEFORE the
                // per-agent agent_controls gate for two reasons: the log line
                // should name the real cause, and agent_controls cannot stop 9
                // of the 12 agents (no row => enabled). Parks via the SAME idle
                // path, so heartbeat/liveness keep reporting while work stops.
                if (await shouldParkForHalt(this.name)) {
                    await this.idleWhenDisabled('sleeping (EMERGENCY HALT)');
                    continue;
                }
                if (!(await this.isWorkEnabled())) {
                    console.log(`[${this.name}] 💤 Disabled via agent_controls — heartbeat only`);
                    await this.idleWhenDisabled();
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

                // STEP 1: Atomic Claim
                const claimed = await withTimeout(this.claimTask(task.id), LOOP_TIMEOUTS.DB_QUERY, `claimTask(${task.id})`);
                if (!claimed) {
                    console.log(`[${this.name}] ⚠️ Task ${task.id} already claimed. Skipping.`);
                    continue;
                }

                this.currentTaskId = task.id;
                this._activeTaskHint = task.task_type || task.title || 'agent';
                this.lastArtifactId = null; // Reset for Step 6 guard

                // STEP 2: Understand Task
                const understanding = await withTimeout(this.understandTask(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `understandTask(${task.id})`);
                if (!understanding.ok) {
                    const retries = (this.claimHistory.get(task.id) || 0) + 1;
                    this.claimHistory.set(task.id, retries);
                    await withTimeout(this.insertHitlRequest(task.id, 'clarification_needed', understanding.reason), LOOP_TIMEOUTS.DB_QUERY, `insertHitlRequest(${task.id}, clarification)`);
                    await withTimeout(this.releaseTask(task.id, `Unclear: ${understanding.reason}`), LOOP_TIMEOUTS.DB_QUERY, `releaseTask(${task.id}, Unclear)`);
                    continue;
                }

                // STEP 3: Capability Check
                const capable = await withTimeout(this.checkCapability(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `checkCapability(${task.id})`);
                if (!capable.ok) {
                    const retries = (this.claimHistory.get(task.id) || 0) + 1;
                    this.claimHistory.set(task.id, retries);
                    await withTimeout(this.log('escalation_contract', `Escalating: ${capable.reason}`, { taskId: task.id }), LOOP_TIMEOUTS.DB_QUERY, `log(escalation_contract ${task.id})`);
                    await withTimeout(this.insertEscalationLog(task.id, `Capability gap: ${capable.reason}`), LOOP_TIMEOUTS.DB_QUERY, `insertEscalationLog(${task.id})`);
                    await withTimeout(this.insertHitlRequest(task.id, 'capability_gap', capable.reason), LOOP_TIMEOUTS.DB_QUERY, `insertHitlRequest(${task.id}, capability_gap)`);
                    await withTimeout(this.releaseTask(task.id, `Escalated: ${capable.reason}`), LOOP_TIMEOUTS.DB_QUERY, `releaseTask(${task.id}, Escalated)`);
                    continue;
                }

                // STEP 4 & 5: Execute and Evaluate
                try {
                    await withTimeout(this.processTaskContract(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `processTaskContract(${task.id})`);
                } catch (err) {
                    this.sessionMetrics.tasksFailed++; // Sprint 14 R-3 — count failed task executions
                    await withTimeout(this.recordConfused(task, err.message, { stack: err.stack }), LOOP_TIMEOUTS.DB_QUERY, `recordConfused(${task.id})`);
                }

                this.currentTaskId = null;
                if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.checkGroupHealth(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'checkGroupHealth(post)');
                if (this.isSurvivor && Math.random() < 0.1) await withTimeout(this.runStaleTaskReaper(), LOOP_TIMEOUTS.SURVIVOR_HELPER, 'runStaleTaskReaper(post)');
                await this.sleep(30000);
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
                // In-memory liveness for /health (see runLoop). Set BEFORE the
                // agent_controls gate so /health stays fresh while idled.
                this.lastIterationAt = new Date().toISOString();
                // L0 gate 0.4 — GLOBAL emergency halt (see runLoop for why this
                // sits ahead of the per-agent gate). 11 of 12 agents run THIS
                // loop, so omitting it here would leave the switch covering one.
                if (await shouldParkForHalt(this.name)) {
                    await this.idleWhenDisabled('sleeping (EMERGENCY HALT)');
                    continue;
                }
                if (!(await this.isWorkEnabled())) {
                    console.log(`[${this.name}] 💤 Disabled via agent_controls — heartbeat only`);
                    await this.idleWhenDisabled();
                    continue;
                }
                const task = await withTimeout(this.getNextTask(), LOOP_TIMEOUTS.DB_QUERY, 'getNextTask');
                if (task) {
                    console.log(`[${this.name}] 📋 Processing: ${task.title}`);
                    // Phase 7C — heartbeat is observability, not gating
                    // (per Sean spec). Inline try/catch so a degraded
                    // Supabase doesn't stall the legacy work path.
                    try {
                        await withTimeout(this.heartbeat(`Claimed: ${task.title}`), LOOP_TIMEOUTS.DB_QUERY, `heartbeat(Claimed task=${task.id})`);
                    } catch (e) {
                        console.warn(`[${this.name}] heartbeat non-fatal in runLoopLegacy(claimed): ${e?.message ?? e}`);
                    }
                    await withTimeout(this.processTask(task), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `processTask(id=${task.id})`);
                    try {
                        await withTimeout(this.heartbeat(`Completed: ${task.title}`), LOOP_TIMEOUTS.DB_QUERY, `heartbeat(Completed task=${task.id})`);
                    } catch (e) {
                        console.warn(`[${this.name}] heartbeat non-fatal in runLoopLegacy(completed): ${e?.message ?? e}`);
                    }
                }
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

        if (!this.lastArtifactId) {
            // Artifact persistence failed (e.g. DB down). Don't fake success —
            // fall through to the normal path so the existing guards apply.
            console.warn(`[PULSE] ${task.title}: artifact save returned no id; falling through.`);
            return null;
        }

        // Success tail — byte-for-byte the same shape as processTaskContract.
        await this.supabase.from('trinity_tasks').update({
            status: 'done',
            result: summary,
            artifact_url: artifactUrl || `db://trinity_artifacts/${this.lastArtifactId}`,
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

        const result = await this.callLLM(context);

        // STEP 6: Artifact Guard
        if (!this.lastArtifactId) {
            // Check smart-parse one last time (callLLM might have done it, but let's be sure)
            if (result.output.includes('```md') || result.output.includes('# Artifact')) {
                 await this.saveArtifact(task.id, result.output, 'report', `Artifact from ${this.name}`);
            }
        }

        if (!this.lastArtifactId) {
            return await this.recordConfused(task, 'artifact_missing', { output: result.output.substring(0, 500) });
        }

        // ARTIFACT_GUARD_HARDENED: stronger content-quality check (independent of ESCALATION_CONTRACT)
        const guard = await this._runArtifactGuardCheck(task);
        if (!guard.skipped && !guard.verdict.valid) {
            return await this.handleArtifactRejection(task, guard.artifact, guard.verdict.reason);
        }

        const evaluation = await this.evaluateResult(result.output, task);

        const substanceGate = await this.validateSubstance(result.output, task, this.lastArtifactId);
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
            artifact_url: `db://trinity_artifacts/${this.lastArtifactId}`,
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
        if (this.lastArtifactId) {
            try {
                const { data } = await this.supabase
                    .from('trinity_artifacts')
                    .select('id, content')
                    .eq('id', this.lastArtifactId)
                    .maybeSingle();
                artifact = data || null;
            } catch (e) {
                console.warn(`[GUARD] Read failed for artifact ${this.lastArtifactId}: ${e.message}`);
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
        // EGRESS FIX (2026-06-19, CC; spec CC-egress-claim-rewrite-spec.md v2, Grok red-team GO)
        // RECONCILED with S-QUORUM Phase 5 (#25, a0863fdf) on rebase 2026-06-19.
        // The old `SELECT * ... ORDER BY ... (no LIMIT)` returned the WHOLE candidate set every poll
        // (666–1098 wide rows) — ~880 GB/day egress, the #1 driver of the Supabase breach. Replaced
        // with a SINGLE-ROW ATOMIC CLAIM: select ONE claimable row, exclude the in-memory blacklist
        // IN-SQL, FOR UPDATE SKIP LOCKED (race-safe, distinct row per agent), claim it to 'doing' in
        // the same statement, narrow RETURNING (no SELECT *). LIMIT 1 fixes egress regardless of
        // predicate width (the bug was unbounded row COUNT, not predicate). The claim now happens
        // HERE; claimTask() below is an idempotent ownership-confirm so existing call sites keep
        // working unchanged.
        // PRESERVED from #25: (a) the assigned_to/agent_assigned candidate predicate, (b) the open
        // status set incl. 'assigned', (c) the gated CAPABILITY_FILTER (default OFF => $5 NULL =>
        // task_type predicate is a no-op). trinity_tasks.id is BIGINT (CLAUDE-RULE-5) => blacklist
        // cast ::bigint[], NOT ::uuid[].
        //
        // DURABLE RE-CLAIM CAP (2026-07-27, CC autonomous loop Beat 42). The claim above is already
        // race-safe, so the runaway measured on task 435029 was NOT a claim race: it was UNBOUNDED
        // RE-CLAIM. Several paths legitimately return a task to a claimable status with
        // claimed_by=NULL — releaseTask() -> 'pending' (understand-fail, capability-gap), the
        // exception path -> 'pending', and the escalation path -> 'pending_clarification', which is
        // itself in the claimable set. The ONLY brake was this.claimHistory, an IN-MEMORY Map, so it
        // (a) is lost on restart, (b) is per-agent-process, so 11 agents each got their own budget,
        // and (c) is not incremented on the escalation path at all. Net effect measured
        // [V sql:2026-07-27]: task 435029 claimed 365x, 239 artifacts, 11 agents, ~1h40m, ~1 LLM call
        // per 25s, terminating only by luck when a substance-gate event finally recorded.
        // FIX: count claims DURABLY, in the claim statement itself, and refuse to serve a task past
        // the cap. Counting at CLAIM time (not at release time) is what makes this total: it bounds
        // every release path that exists today and every one added later, without enumerating them.
        // NOTE: an exhausted task stays 'pending' but stops being served. The original note here
        // claimed the escalation/HITL rows these cycles generate are how a human finds it. That was
        // REFUTED [V sql:2026-07-27]: trinity_hitl_requests holds 259,432 pending and 1 approved,
        // ever (2026-02-08), and the callback handler never writes trinity_tasks. The real recovery
        // surface is scripts/ops/claim-exhausted.js, which ships with this cap for that reason.
        const CAPABILITY_FILTER = process.env.CAPABILITY_FILTER === 'true';
        const HANDLED = (process.env.AGENT_TASK_TYPES ||
            'peer_verify,review,meta,system,research,code,docs,artifact,critique')
            .split(',').map(s => s.trim()).filter(Boolean);
        const capFilter = CAPABILITY_FILTER ? HANDLED : null;
        const now = new Date().toISOString();
        const blacklist = [];
        for (const [id, n] of this.claimHistory) {
            if (n >= this.MAX_CLAIM_RETRIES) blacklist.push(id);
        }
        let rows;
        try {
            rows = await pgQuery(
                ConstitutionalAgentV4.CLAIM_SQL,
                ConstitutionalAgentV4.buildClaimParams(this.name, now, blacklist, capFilter),
                { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY, label: 'getNextTask(atomic-claim)' }
            );
        } catch (error) {
            console.error(`[${this.name}] ❌ getNextTask query error:`, {
                message: error.message,
                code: error.code || null
            });
            return null;
        }

        if (!rows || rows.length === 0) return null;
        return rows[0]; // already atomically claimed by THIS agent ('doing', claimed_by = this.name)
    }

    async claimTask(taskId) {
        // EGRESS FIX (2026-06-19): the atomic claim now happens inside getNextTask() (single-row
        // UPDATE...RETURNING). This is now an idempotent OWNERSHIP-CONFIRM so the existing call sites
        // (runLoop STEP 1 + processTask) keep working unchanged: returns true iff THIS agent already
        // owns the task ('doing', claimed_by = this.name). Cheap single-row lookup; no SELECT *, no
        // re-claim race. RULE-8.
        try {
            const rows = await pgQuery(
                `SELECT 1 FROM trinity_tasks
                  WHERE id = $1 AND claimed_by = $2 AND status = 'doing'
                  LIMIT 1`,
                [taskId, this.name],
                { retries: 1, timeoutMs: LOOP_TIMEOUTS.DB_QUERY, label: 'claimTask(confirm)' }
            );
            return rows.length > 0;
        } catch (e) {
            console.error(`[${this.name}] ❌ Claim confirm error:`, {
                message: e.message,
                code: e.code || null,
                details: e.details || null
            });
            return false;
        }
    }

    async processTask(task) {
        // [PHASE 20] ATOMIC CLAIM: Ensure we own the task before starting
        const claimed = await this.claimTask(task.id);
        if (!claimed) {
            console.log(`[${this.name}] ⚠️ Task ${task.id} already claimed by another agent. Skipping.`);
            const retries = (this.claimHistory.get(task.id) || 0) + 1;
            this.claimHistory.set(task.id, retries);
            return;
        }

        this.currentTaskId = task.id;
        this._activeTaskHint = task.task_type || task.title || 'agent';
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
            const result = await this.callLLM(context);

            // [ANTIGRAVITY] MANDATORY ARTIFACT CHECK
            let artifactUrl = null;
            // Even if tool wasn't called, try to capture if valid output exists
            if (result.output) {
                await callAnfisReward(this, task.id, result.provider, { success: true, latency: result.latency });
            }

            const evaluation = await this.evaluateResult(result.output, task);

            const substanceGate = await this.validateSubstance(result.output, task, this.lastArtifactId);
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

            // CHANGE 2 — ARTIFACT ENFORCEMENT (mirrors the DB-side trigger).
            // For deliverable tasks (requires_external_artifact OR a deliverable
            // task_type), a task may NOT reach status='done' with no artifact.
            //  - artifact already saved this run (this.lastArtifactId set by the
            //    save_artifact tool / smart-parse fallback) → use its db:// url.
            //  - substantive result text but no artifact → auto-save it now.
            //  - nothing substantive to save → status 'needs_artifact', not done.
            const enforcement = await this._enforceArtifact(task, result.output);
            let finalStatus = 'done'; // default: verification pipeline
            if (enforcement.artifactUrl) {
                artifactUrl = enforcement.artifactUrl;
            }
            if (enforcement.blocked) {
                finalStatus = 'needs_artifact';
                console.warn(`[ARTIFACT_ENFORCE] ⚠️ Task ${task.id} (${task.task_type || 'n/a'}) has no artifact and no substantive output → status='needs_artifact'.`);
            }

            await this.supabase.from('trinity_tasks').update({
                status: finalStatus, // 'done' for verification pipeline, or 'needs_artifact' when deliverable produced no artifact
                result: result.output,
                artifact_url: artifactUrl,
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
                // NO claim_count RESET HERE — DELIBERATELY, and this is the second answer to
                // verifier F4 ("nothing resets claim_count, and the counter it replaces did").
                // The first answer was a reset gated on finalStatus === 'done'. An independent
                // verification then showed it was decorative AND wrong:
                //   (a) it can never matter — enumerating every write to a claimable status in
                //       this file (:854, :1522, :1584, :1613, :1926, :1974, :2393, :2417 — all
                //       new-row INSERTs, releaseTask(), or the escalation path, none reachable
                //       after this update), a row that completes leaves CLAIMABLE_STATUSES for
                //       good, so its count cannot affect whether anything is served; and
                //   (b) its premise is falsified by a live DB trigger. `enable_and_enforce_artifact()`
                //       (BEFORE UPDATE) rewrites status -> 'needs_artifact' when the app writes
                //       'done' with no artifact and a body under MIN_ARTIFACT_CHARS. The app would
                //       therefore zero the counter believing the task was done while the row landed
                //       as the exact unproductive outcome the cap exists to bound.
                // A no-op that a commit message calls a fix is worse than an acknowledged gap, so
                // it is dropped rather than kept for symmetry. The counter stays monotone by
                // design; the reap refund is what keeps it from being monotone AGAINST the task.
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

        // 1. Atomic claim on the queue entry (direct-pg — Veritas path)
        let queueEntries;
        try {
            queueEntries = await pgQuery(
                `UPDATE peer_verification_queue
                    SET verification_status = 'in_review'
                  WHERE id = $1
                    AND verification_status IN ('pending', 'in_review')
                  RETURNING id, claim_text, certainty_at_claim, source_agent_id, verification_status`,
                [queueId],
                { retries: 1, label: 'peer-verify-claim' }
            );
        } catch (queueErr) {
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

        // CHANGE 3 — wrap the verifier LLM call in a per-call timeout. Prior state:
        // this callLLM had NO per-call timeout; only the whole-task 30s withTimeout
        // (LOOP_TIMEOUTS.LLM_OR_INTERNAL) guarded it, and on that timeout processTask's
        // peer_verify catch marked the task 'failed' but NEVER POSTed a verdict — so the
        // panel got <3 votes. Now: on timeout/throw we POST verdict='timeout' ourselves,
        // computing the signature EXACTLY as the success path does (via _postPeerVerdict),
        // guaranteeing the panel always receives this verifier's vote.
        let result;
        try {
            result = await withTimeout(this.callLLM(prompt), LOOP_TIMEOUTS.LLM_OR_INTERNAL, `peer_verify:callLLM:${queueId}`);
        } catch (llmErr) {
            console.warn(`[${this.name}] peer_verify LLM call failed/timed out for queue ${queueId} (${llmErr.message}) → POSTing verdict='timeout' so the panel still gets 3 votes.`);
            const post = await this._postPeerVerdict(queueId, 'timeout');
            if (post.alreadyProcessed) {
                await this.supabase.from('trinity_tasks').update({
                    status: 'done',
                    result: `Soft-skipped: Respond API confirmed queue entry ${queueId} was already processed (LLM timeout path).`,
                    completed_at: new Date().toISOString()
                }).eq('id', task.id);
                return;
            }
            if (!post.ok) {
                throw new Error(`Engine respond API call failed with status ${post.status}: ${post.errTxt}`);
            }
            await this.supabase.from('trinity_tasks').update({
                status: 'done',
                result: `Peer verification submitted verdict: timeout (LLM ${llmErr.name === 'TimeoutError' ? 'timed out' : 'failed'}: ${llmErr.message}). Response ID: ${post.verifierResponseId}`,
                completed_at: new Date().toISOString(),
                metadata: {
                    ...(task.metadata || {}),
                    peer_verify_verdict: 'timeout',
                    peer_verify_timeout_reason: llmErr.message
                }
            }).eq('id', task.id);
            console.log(`[${this.name}] Completed peer_verify task ${task.id} via timeout verdict.`);
            return;
        }

        const verdictMatch = result.output.match(/\[VERDICT\]\s*(verified|disputed|timeout)/i);
        const verdict = verdictMatch ? verdictMatch[1].toLowerCase() : 'timeout';
        console.log(`[${this.name}] Peer verify verdict: ${verdict} for queue ${queueId}`);

        // 3–5. POST the verdict (signature computed inside _postPeerVerdict).
        const post = await this._postPeerVerdict(queueId, verdict);
        if (post.alreadyProcessed) {
            console.log(`[${this.name}] Soft-skipping task ${task.id}: respond API returned already processed.`);
            await this.supabase.from('trinity_tasks').update({
                status: 'done',
                result: `Soft-skipped: Respond API confirmed queue entry ${queueId} was already processed.`,
                completed_at: new Date().toISOString()
            }).eq('id', task.id);
            return;
        }
        if (!post.ok) {
            throw new Error(`Engine respond API call failed with status ${post.status}: ${post.errTxt}`);
        }

        // 6. Update trinity_tasks row status='done'
        await this.supabase.from('trinity_tasks').update({
            status: 'done',
            result: `Peer verification completed with verdict: ${verdict}. Response ID: ${post.verifierResponseId}`,
            completed_at: new Date().toISOString(),
            metadata: {
                ...(task.metadata || {}),
                provider_used: result.provider,
                provider: result.provider
            }
        }).eq('id', task.id);

        console.log(`[${this.name}] Completed peer_verify task ${task.id}`);
    }

    /**
     * CHANGE 3 — POST a peer-verification verdict to repid-engine.
     * Extracted from processPeerVerifyTask so the success path and the LLM-timeout
     * path compute the HMAC signature identically. Returns:
     *   { ok, status, errTxt, alreadyProcessed, verifierResponseId }
     * Never mutates trinity_tasks (caller owns that) — this only does signature + POST.
     */
    async _postPeerVerdict(queueId, verdict) {
        const crypto = require('crypto');
        const verifierResponseId = crypto.randomUUID();

        // Compute HMAC signature (identical scheme in both success + timeout paths).
        const cleanName = this.name.replace('trinity-', '').toUpperCase().trim();
        const envKey = `${cleanName}_PRIVATE_KEY`;
        // Preserve main's fail-loud HMAC handling (no weak 'trinity-default-sbt-secret'
        // fallback): a missing secret THROWS rather than silently signing with a
        // hardcoded default. Kept inside the branch's _postPeerVerdict refactor so
        // both the success and LLM-timeout paths sign identically.
        const secretKey = process.env.PEER_VERIFY_HMAC_SECRET || process.env[envKey] || process.env.TRUSTRAILS_HMAC_SECRET;
        if (!secretKey) {
            throw new Error(`Missing peer-verify HMAC secret (${envKey} or PEER_VERIFY_HMAC_SECRET)`);
        }

        const dataToSign = `${queueId}:${verifierResponseId}:${verdict}`;
        const signature = crypto.createHmac('sha256', secretKey).update(dataToSign).digest('hex');

        const baseUrl = process.env.REPID_API_URL || 'http://localhost:3000';
        const respondUrl = `${baseUrl.replace(/\/$/, '')}/api/v1/peer-verification/respond`;
        console.log(`[${this.name}] Sending verdict '${verdict}' to engine: ${respondUrl}`);
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
            const alreadyProcessed = response.status === 400 && errTxt.includes('already processed');
            return { ok: false, status: response.status, errTxt, alreadyProcessed, verifierResponseId };
        }
        const resData = await response.json().catch(() => ({}));
        console.log(`[${this.name}] Engine response:`, JSON.stringify(resData));
        return { ok: true, status: response.status, errTxt: null, alreadyProcessed: false, verifierResponseId };
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

    async callLLM(prompt, options = {}) {
        // ENGINE_LLM_PROXY (XC 2026-06-28): route through repid-engine for ANFIS + llm_call_log.
        // Gated off by default; direct providers below remain the fallback on failure or env unset.
        try {
            const { canUseProxy, callEngineComplete } = require('./engine-llm-proxy');
            if (canUseProxy()) {
                const taskHint = options.task_hint || this._activeTaskHint || 'agent';
                const res = await callEngineComplete({
                    agentName: this.name,
                    prompt,
                    taskHint,
                    tierPreference: options.tier_preference || 'auto',
                });
                this.sessionMetrics.llmCalls++;
                logToolCall({
                    agentName: this.name,
                    toolName: `llm:engine:${res.provider}`,
                    toolInput: { prompt_sha256: res.prompt_sha256, provider: res.provider, engine_proxy: true },
                    toolOutput: res,
                    repidAtCall: this.reputationScore || 0,
                    confidenceAtCall: 0.9,
                    autonomyTier: 'just_do_it',
                    hitlRequired: false,
                });
                console.log(`[${this.name}] ENGINE_LLM_PROXY ok provider=${res.provider} cost=$${res.cost_estimate_usd ?? '?'}`);
                return res;
            }
        } catch (e) {
            console.warn(`[${this.name}] ENGINE_LLM_PROXY failed, falling back to direct: ${e.message}`);
        }

        for (const providerKey of this.availableProviders) {
            const provider = PROVIDERS[providerKey];
            try {
                const res = await this.callProvider(provider, prompt);
                this.sessionMetrics.llmCalls++;
                // S-QUORUM Phase 4 — audit the LLM tool call. Fire-and-forget (never awaited so it
                // adds no latency) and never throws; no-op unless TOOL_CALL_LOGGING=true.
                logToolCall({
                    agentName: this.name,
                    toolName: `llm:${canonicalizeProvider(providerKey)}:${provider.model}`,
                    toolInput: { prompt_sha256: require('crypto').createHash('sha256').update(String(prompt)).digest('hex'), provider: canonicalizeProvider(providerKey), model: provider.model },
                    toolOutput: res,
                    repidAtCall: this.reputationScore || 0,
                    confidenceAtCall: 0.9,
                    autonomyTier: 'just_do_it',
                    hitlRequired: false,
                });
                return { ...res, provider: canonicalizeProvider(providerKey) };
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
            },
            // The read-only instruments. Resolves to [] unless SWARM_TOOLBELT=on,
            // so this line is inert until the flag is flipped.
            //
            // Until 2026-08-05 `save_artifact` was the ONLY entry in this array. An
            // agent asked to measure anything therefore had no instrument, and its
            // one affordance was to write prose — which is why 18 of 18 nightly
            // smoke reports contained zero real measurements. The loop below was
            // always correct; it had nothing to call. See lib/swarm-toolbelt.js.
            ...toolbelt.toolSchemas()
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
                    // A malformed arguments blob must not kill the run. Report the
                    // parse failure TO THE MODEL so it can retry or declare the
                    // measurement unobtainable — previously this threw out of the
                    // whole loop and the task was lost with no explanation.
                    let args = {};
                    let argError = null;
                    try {
                        args = JSON.parse(toolCall.function.arguments || '{}');
                    } catch (e) {
                        argError = `FAILED: could not parse the arguments you sent to "${fnName}" — ${e.message}. Nothing ran.`;
                    }
                    console.log(`[${this.name}] Tool Call: ${fnName}`);

                    let toolResult;
                    if (argError) {
                        toolResult = argError;
                    } else if (fnName === 'save_artifact') {
                        const taskId = this.currentTaskId || ('mcp-gen-' + Date.now());
                        await this.saveArtifact(taskId, args.content, args.type, args.title);
                        toolResult = 'Artifact saved.';
                    } else if (toolbelt.isToolbeltTool(fnName)) {
                        toolResult = await toolbelt.execute(fnName, args);
                        // Audit every instrument call on the same hash-chained trail
                        // as the LLM calls. A measurement whose provenance is not
                        // recorded is only marginally better than a guess.
                        logToolCall({
                            agentName: this.name,
                            toolName: `toolbelt:${fnName}`,
                            toolInput: args,
                            toolOutput: { result: String(toolResult).slice(0, 2000) },
                            repidAtCall: this.reputationScore || 0,
                            confidenceAtCall: 1.0,
                            autonomyTier: 'just_do_it',
                            hitlRequired: false,
                        });
                    } else {
                        // An unanswered tool call leaves the message array malformed
                        // and the provider rejects the NEXT request — so an unknown
                        // name used to surface as an unrelated API error one turn
                        // later. Answer it explicitly instead.
                        toolResult = `FAILED: "${fnName}" is not a tool available to you. Do not assume what it would have returned.`;
                    }
                    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: String(toolResult) });
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

    /**
     * CHANGE 2 — artifact enforcement decision for the completion path.
     * Mirrors the DB-side trigger so the agent and DB agree. Returns:
     *   { required, blocked, artifactUrl }
     *  - required: true if this task_type is a deliverable OR requires_external_artifact.
     *  - artifactUrl: a db:// url when an artifact exists (already saved this run,
     *    or auto-saved here from substantive result text). null otherwise.
     *  - blocked: true when required && no artifact could be produced (caller
     *    sets status='needs_artifact' instead of 'done').
     * For non-deliverable tasks this is a no-op ({ required:false, blocked:false }).
     */
    async _enforceArtifact(task, output) {
        const required = ConstitutionalAgentV4.isDeliverableTask(task);
        if (!required) {
            return { required: false, blocked: false, artifactUrl: null };
        }
        // (a) An artifact was already saved this run (save_artifact tool or the
        //     smart-parse fallback set this.lastArtifactId during callLLM).
        if (this.lastArtifactId) {
            return { required: true, blocked: false, artifactUrl: `db://trinity_artifacts/${this.lastArtifactId}` };
        }
        // (b) Substantive result text but no artifact → auto-save it now.
        const substantive = typeof output === 'string' && output.trim().length >= ConstitutionalAgentV4.MIN_ARTIFACT_CHARS;
        if (substantive) {
            const url = await this.saveArtifact(task.id, output, 'report', `Artifact from ${this.name}`);
            if (url) {
                console.log(`[ARTIFACT_ENFORCE] 💾 Task ${task.id}: auto-saved result as artifact (${url}).`);
                return { required: true, blocked: false, artifactUrl: url };
            }
            // Save failed (DB error) — do not silently pass a deliverable with no artifact.
            return { required: true, blocked: true, artifactUrl: null };
        }
        // (c) Nothing substantive to save.
        return { required: true, blocked: true, artifactUrl: null };
    }

    /**
     * CHANGE 1 — agent-facing web research helper.
     * Runs a real Tavily search (via this.researchTool) and returns both the raw
     * result and a markdown "## Sources" block listing the fetched URLs, so an
     * agent executing a research/deliverable task can splice real source URLs
     * into its output. On degrade it returns degraded:true and an explicit,
     * non-fabricated notice block — callers must NOT treat this as real sources.
     */
    async researchWeb(query) {
        const res = await this.researchTool.searchWeb(query);
        if (res.degraded) {
            return {
                degraded: true,
                reason: res.reason,
                results: [],
                sourcesBlock: `\n\n## Sources\n_Web search unavailable (${res.reason}). No live sources were fetched for this claim._`
            };
        }
        const lines = res.results.map(r => `- [${r.title || r.url}](${r.url})`);
        const sourcesBlock = res.results.length
            ? `\n\n## Sources\n${lines.join('\n')}`
            : `\n\n## Sources\n_No results returned for "${query}"._`;
        return { degraded: false, results: res.results, sourcesBlock };
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

        if (artifactId) this.lastArtifactId = artifactId;
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

// Attach the pure helper for unit tests (and any external caller that wants the
// same env→mode resolution). The default export stays the class for back-compat.
ConstitutionalAgentV4.resolveHeartbeatMode = resolveHeartbeatMode;

// CHANGE 1 — expose the web search tool for wiring/tests.
ConstitutionalAgentV4.WebResearchTool = WebResearchTool;

// CHANGE 2 — deliverable task types that MUST produce an artifact before 'done'.
// Named canonical set from the task + the codebase's existing artifactType
// synonyms ('docs','report','artifact') so agent-side and DB-side agree.
ConstitutionalAgentV4.DELIVERABLE_TASK_TYPES = new Set([
    'research', 'code', 'analysis', 'audit', 'content',
    'design', 'data', 'documentation',
    'docs', 'report', 'artifact'
]);
// Minimum result length (chars) that counts as "substantive" enough to auto-save.
ConstitutionalAgentV4.MIN_ARTIFACT_CHARS = 40;
// --- DURABLE RE-CLAIM CAP (2026-07-27, Beat 42) — see the long note in getNextTask() ---
// The task statuses a task can be claimed FROM. 'pending_clarification' is in this set by design
// (#25): an escalated task is re-offered to the pool. That is exactly why an unbounded cycle was
// possible, and why the cap below has to be durable rather than in-memory.
ConstitutionalAgentV4.CLAIMABLE_STATUSES = ['pending', 'todo', 'assigned', 'pending_clarification'];
// How many times a single task may be claimed across all agents and restarts, NOT counting claims
// that a stale-task reap later refunded (see REAP_SQL — a reap is blameless, so it gives the claim
// back). The earlier wording here said "ever", which the refund makes false. Env-tunable
// so it can be raised without a deploy. 12 = comfortably above any legitimate retry pattern
// (MAX_CLAIM_RETRIES is 3, per agent) and far below the 365 observed on task 435029.
ConstitutionalAgentV4.DEFAULT_MAX_TASK_CLAIMS = 12;
ConstitutionalAgentV4.maxTaskClaims = function () {
    const raw = Number.parseInt(process.env.MAX_TASK_CLAIMS || '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : ConstitutionalAgentV4.DEFAULT_MAX_TASK_CLAIMS;
};
// The claim statement, hoisted so tests can assert on the guards the live query actually carries.
// $6 = the cap. claim_count is incremented in the SAME statement that claims, so the count is
// exact under concurrency for the same reason the claim itself is (single-row UPDATE ... WHERE id =
// (SELECT ... FOR UPDATE SKIP LOCKED)) — no read-modify-write window.
ConstitutionalAgentV4.CLAIM_SQL =
    `UPDATE trinity_tasks
        SET status = 'doing', claimed_by = $1, claimed_at = $2, started_at = $2,
            claim_count = COALESCE(claim_count, 0) + 1
      WHERE id = (
        SELECT id FROM trinity_tasks
         WHERE (assigned_to = $1 OR (assigned_to IS NULL AND (agent_assigned = $1 OR agent_assigned IS NULL)))
           AND status = ANY($3)
           AND claimed_by IS NULL
           AND ($5::text[] IS NULL OR task_type IS NULL OR task_type = ANY($5))
           AND NOT (id = ANY($4::bigint[]))
           AND COALESCE(claim_count, 0) < $6
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, title, description, metadata, priority, task_type, agent_assigned, status, claim_count`;
// The bind list for CLAIM_SQL, hoisted for the same reason the SQL is. A missing bind is not a
// soft failure: Postgres rejects the statement, getNextTask() catches and returns null, and every
// agent goes quietly idle — an outage that looks exactly like an empty queue. The accompanying test
// asserts this array's length against the highest $N placeholder in CLAIM_SQL, so the two cannot
// drift out of step. (Found by mutation M12, which survived the first version of that test suite.)
ConstitutionalAgentV4.buildClaimParams = function (agentName, now, blacklist, capFilter) {
    return [agentName, now, ConstitutionalAgentV4.CLAIMABLE_STATUSES, blacklist, capFilter,
        ConstitutionalAgentV4.maxTaskClaims()];
};
// --- CLAIM REFUND ON REAP (2026-07-27, Beat 44 — verifier F1/F3) ---
// The statuses runStaleTaskReaper() reclaims FROM. Kept separate from CLAIMABLE_STATUSES: those
// are the statuses a task is served from, these are the in-flight statuses it is rescued from.
ConstitutionalAgentV4.REAPABLE_STATUSES = ['doing', 'in_progress'];
// The columns the reaper FETCHES. Hoisted 2026-07-27 (Beat 46 — round-3 verifier, HIGH #1/#2).
// This was an inline string asserted only by a regex requiring the word `metadata`, so `id` — the
// value the release statement binds to `WHERE id = $1` — was pinned by nothing. Dropping it left
// all 28 tests green while making `task.id` undefined in production, which node-pg binds as SQL
// NULL: `WHERE id = NULL` matches no row, so the reaper would silently reap and refund NOTHING,
// forever, while still logging as though it were working. The test does not restate this list —
// it reads the reaper's own source for every `task.<prop>` it dereferences and requires each one
// to be selected, so adding a consumer without adding its column fails too.
ConstitutionalAgentV4.REAP_SELECT_COLUMNS = 'id, claimed_by, claimed_at, title, metadata';
// --- THE REAPER'S TRIGGER CONDITIONS, HOISTED (2026-07-27, Beat 45 — round-2 verifier, HIGH #1) ---
// These were inline literals inside runStaleTaskReaper() and pinned by nothing: the test's supabase
// stub accepted and discarded every argument. Mutating the staleness window from one HOUR to one
// SECOND left all 44 tests green — and that mutation alone neutralises the entire cap, because the
// reaper would rip tasks back mid-work and refund the claim before it could ever accumulate. That is
// precisely the runaway this PR exists to stop, invisible to the PR's own suite. A background job
// that WRITES the cap counter cannot have unpinned trigger conditions.
ConstitutionalAgentV4.REAP_STALE_AFTER_MS = 60 * 60 * 1000;
ConstitutionalAgentV4.REAP_BATCH_LIMIT = 50;
// The status a reaped task is released BACK to. Must be in CLAIMABLE_STATUSES or the reap is a
// permanent strand rather than a rescue — releasing to 'blocked' left every test green.
ConstitutionalAgentV4.REAP_RELEASE_STATUS = 'pending';
// The ONLY status whose claim is refunded. 'doing' is what CLAIM_SQL sets, and CLAIM_SQL is the only
// path that INCREMENTS the counter. The base class (constitutional-agent-base.js:1441/:1491) and
// w3c.index.js:241 move tasks to 'in_progress' without incrementing anything; refunding those was a
// pure downward driver on the counter — claim uncounted, reap, −1 — which drains the cap to zero and
// disables it. Reaped either way (the rescue is the point); refunded only where a claim was spent.
ConstitutionalAgentV4.REFUNDABLE_STATUS = 'doing';
// The reaper's release, as one statement, so the refund is exact under concurrency for the same
// reason the claim is. GREATEST(...,0) makes the refund saturating rather than signed — a counter
// that can go negative is a cap that can be farmed by provoking reaps. `status` on the right-hand
// side of SET is the OLD row value, so the CASE tests what the task was claimed as.
ConstitutionalAgentV4.REAP_SQL =
    `UPDATE trinity_tasks
        SET status = '${ConstitutionalAgentV4.REAP_RELEASE_STATUS}', claimed_by = NULL, claimed_at = NULL,
            claim_count = CASE WHEN status = '${ConstitutionalAgentV4.REFUNDABLE_STATUS}'
                               THEN GREATEST(COALESCE(claim_count, 0) - 1, 0)
                               ELSE COALESCE(claim_count, 0) END,
            metadata = $2::jsonb
      WHERE id = $1 AND status = ANY($3)
      RETURNING id, claim_count`;
// How many CONSECUTIVE reap failures end the batch, because the reap runs through direct-pg's
// PROCESS-WIDE breaker: N consecutive fully-failed calls open a 5-minute cool-down that throws for
// every caller, getNextTask and the heartbeat included.
//
// STATED HONESTLY, because the previous comment here claimed more than the code delivers: the
// reaper CANNOT guarantee it never opens that breaker. The failure counter is global and is reset
// only by a success, so the reaper's abandonment does not clear it — successive passes accumulate.
// What is guaranteed, and what the invariant below pins, is that TWO full failing passes still stay
// under the threshold (2 x 2 < 5). Three can reach it; by then getNextTask is failing on every poll
// anyway and the reaper is not the marginal cause. The budget is asserted against direct-pg's
// exported threshold rather than a duplicated literal, so lowering that threshold breaks the test
// instead of silently making this guard useless.
ConstitutionalAgentV4.REAP_FAILURE_BUDGET = 2;
ConstitutionalAgentV4.buildReapParams = function (taskId, metadata) {
    return [taskId, JSON.stringify(metadata ?? {}), ConstitutionalAgentV4.REAPABLE_STATUSES];
};
// --- RECOVERY SURFACE (2026-07-27, Beat 44 — verifier F2) ---
// F2 was that `claim_count` was written by the claim and read by NOTHING: no query, worker, cron
// or UI in either repo. A parked task produced no human-visible signal and recovery needed a
// hand-written UPDATE. These two statements plus scripts/ops/claim-exhausted.js are that missing
// read side. They are hoisted here (rather than living only in the script) so the test suite pins
// them against the cap the live claim actually enforces — a recovery tool that looks for the wrong
// threshold is worse than none, because it reports "nothing parked" while tasks sit parked.
ConstitutionalAgentV4.EXHAUSTED_TASKS_SQL =
    `SELECT id, title, task_type, status, claim_count, updated_at
       FROM trinity_tasks
      WHERE COALESCE(claim_count, 0) >= $1
        AND status = ANY($2)
      ORDER BY claim_count DESC, updated_at DESC
      LIMIT $3`;
// Recovery is deliberately a RESET, not a raise: raising the cap un-parks every exhausted task at
// once, which is how the 365-claim runaway would return. $1 scopes it to one task on purpose.
ConstitutionalAgentV4.RESET_CLAIM_COUNT_SQL =
    `UPDATE trinity_tasks SET claim_count = 0 WHERE id = $1 RETURNING id, claim_count, status`;
// Pure predicate mirroring the live claim's `COALESCE(claim_count,0) < $6` guard, so callers and
// tests can ask "is this parked?" without reimplementing the boundary (which is exclusive).
ConstitutionalAgentV4.isClaimExhausted = function (task, maxClaims) {
    const cap = maxClaims == null ? ConstitutionalAgentV4.maxTaskClaims() : maxClaims;
    return ((task && task.claim_count) || 0) >= cap;
};
// Pure mirror of CLAIM_SQL's selector, for tests that need to exercise the CYCLE rather than the
// string. It is deliberately a mirror and not the source of truth: the accompanying test asserts
// that CLAIM_SQL still carries each guard this function implements, so the two cannot drift apart
// silently (a mirror that moved with the implementation would prove nothing).
ConstitutionalAgentV4.selectClaimableTask = function (tasks, opts) {
    const { agentName, blacklist = [], maxClaims = ConstitutionalAgentV4.maxTaskClaims(), taskTypes = null } = opts || {};
    const black = new Set(blacklist);
    const claimable = ConstitutionalAgentV4.CLAIMABLE_STATUSES;
    const candidates = (tasks || []).filter((t) =>
        (t.assigned_to === agentName || (t.assigned_to == null && (t.agent_assigned === agentName || t.agent_assigned == null)))
        && claimable.includes(t.status)
        && t.claimed_by == null
        && (taskTypes == null || t.task_type == null || taskTypes.includes(t.task_type))
        && !black.has(t.id)
        && (t.claim_count || 0) < maxClaims);
    candidates.sort((a, b) => (b.priority || 0) - (a.priority || 0)
        || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const picked = candidates[0];
    if (!picked) return null;
    picked.status = 'doing';
    picked.claimed_by = agentName;
    picked.claim_count = (picked.claim_count || 0) + 1;
    return picked;
};
// Pure predicate: is this a deliverable task that requires an artifact?
ConstitutionalAgentV4.isDeliverableTask = function (task) {
    if (!task) return false;
    if (task.requires_external_artifact === true) return true;
    return ConstitutionalAgentV4.DELIVERABLE_TASK_TYPES.has(task.task_type);
};

module.exports = ConstitutionalAgentV4;
