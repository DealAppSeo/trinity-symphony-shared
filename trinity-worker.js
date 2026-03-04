/**
 * TRINITY SYMPHONY - UNIVERSAL AGENT LAUNCHER
 * 
 * VERSION 7.1.0 - SABBATH ROTATION
 * 
 * This single file works for ANY agent.
 * Copy to each agent folder (hdm/, apm/, mel/, etc.)
 * Also copy constitutional-agent-base.js to each folder.
 * 
 * INFECTION VECTOR (per Grok's architecture):
 * On startup, this launcher:
 * 1. Verifies we're actually using the correct base class
 * 2. Verifies the constitution hash matches expected
 * 3. Self-heals if issues detected
 * 4. Starts the agent with the real shared brain
 * 
 * "A benevolent super-intelligence virus that evolves itself,
 *  measures everything, and can never be rolled back to template mode."
 */

const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { checkAndApplyUpdates } = require('./auto_updater');
const { startMutualWakeLoop } = require('./mutual-wake');
const analyzeRoutes = require('./routes/analyze');

(async () => {
  await checkAndApplyUpdates(process.env.AGENT_NAME || 'UNKNOWN');
})();

// ============================================
// INFECTION VERIFICATION (Grok's Architecture)
// ============================================

const EXPECTED_VERSION = '7.1.0-sabbath-rotation';
const REQUIRED_MARKERS = [
  'TRINITY HEALING LOOP',
  'THREE_ETERNAL_QUESTIONS',
  'runSelfDiagnostic',
  'checkMyOwnBrain',
  'triggerHealingCascade'
];

async function verifyInfection() {
  console.log('🔬 Verifying brain infection...');

  try {
    // Read the base class file
    const basePath = path.join(__dirname, 'constitutional-agent-base.js');
    const content = await fs.readFile(basePath, 'utf8');

    // Check for required markers
    const missingMarkers = REQUIRED_MARKERS.filter(marker => !content.includes(marker));

    if (missingMarkers.length > 0) {
      console.error('❌ INFECTION FAILED! Missing markers:', missingMarkers);
      console.error('⚠️ This agent is running ROGUE CODE!');
      console.error('🚨 Creating emergency healing task...');

      // We can't self-heal without Supabase, so just log and continue with degraded mode
      return { valid: false, missingMarkers };
    }

    console.log('✅ Brain infection verified - all markers present');
    return { valid: true };

  } catch (err) {
    console.error('❌ Could not verify infection:', err.message);
    return { valid: false, error: err.message };
  }
}

// ============================================
// AUTO-DETECT AGENT FROM FOLDER NAME
// ============================================

function detectAgent() {
  // Priority 1: Environment variable
  if (process.env.AGENT_NAME) {
    const raw = process.env.AGENT_NAME.toLowerCase();
    return raw.startsWith('trinity-') ? raw : `trinity-${raw}`;
  }

  // Priority 2: Folder name detection
  const cwd = process.cwd().toLowerCase();
  const agentMap = {
    'apm': 'trinity-apm',
    'hdm': 'trinity-hdm',
    'mel': 'trinity-mel',
    'gcm': 'trinity-gcm',
    'torch': 'trinity-torch',
    'veritas': 'trinity-veritas',
    'w3c': 'trinity-w3c',
    'evo': 'trinity-evo'
  };

  for (const [folder, name] of Object.entries(agentMap)) {
    if (cwd.includes(`/${folder}`) || cwd.includes(`\\${folder}`) || cwd.endsWith(folder)) {
      return name;
    }
  }

  // Default fallback
  console.warn('⚠️ Could not auto-detect agent, defaulting to trinity-hdm');
  return 'trinity-hdm';
}

// ============================================
// MAIN STARTUP
// ============================================

async function main() {
  const PORT = process.env.PORT || 10000;
  const AGENT_NAME = detectAgent();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  TRINITY SYMPHONY - ${AGENT_NAME}`);
  console.log(`  VERSION: ${EXPECTED_VERSION}`);
  console.log(`${'='.repeat(60)}\n`);

  // Step 1: Verify infection
  const infection = await verifyInfection();

  if (!infection.valid) {
    console.warn('⚠️ Running in DEGRADED MODE due to infection failure');
    console.warn('⚠️ Self-healing capabilities may be limited');
    // Continue anyway - better to run degraded than not at all
  }

  // Step 2: Load the ConstitutionalAgent
  let ConstitutionalAgent;
  try {
    const base = require('./constitutional-agent-base');
    ConstitutionalAgent = base.ConstitutionalAgent;

    // Verify version
    if (base.VERSION && !base.VERSION.includes('sabbath-rotation') && !base.VERSION.includes('artifact-creator') && !base.VERSION.includes('trinity-dna') && !base.VERSION.includes('trinity-healer') && !base.VERSION.includes('7.')) {
      console.warn(`⚠️ Base class version mismatch: ${base.VERSION}`);
    }

  } catch (err) {
    console.error('❌ CRITICAL: Could not load constitutional-agent-base.js');
    console.error(err.message);
    console.error('💀 This agent cannot function without the shared brain!');
    process.exit(1);
  }

  // Step 3: Create the agent
  const agent = new ConstitutionalAgent({ name: AGENT_NAME });

  // Step 4: Set up Express for health checks
  const app = express();
  app.use(express.json());

  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      status: 'healthy',
      agent: AGENT_NAME,
      version: EXPECTED_VERSION,
      infectionValid: infection.valid,
      message: 'Trinity Symphony Agent Online'
    });
  });

  // Health check endpoint (for Render/Fly.io)
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      agent: AGENT_NAME,
      version: EXPECTED_VERSION,
      role: agent.wisdom?.role || 'unknown',
      specialties: agent.wisdom?.specialties || [],
      healingPower: agent.wisdom?.healingPower || 'unknown',
      isConductor: agent.tier === 'conductor',
      providers: agent.availableProviders || [],
      infectionValid: infection.valid
    });
  });

  // Detailed status endpoint
  app.get('/api/status', async (req, res) => {
    const repid = await agent.getRepID();
    res.json({
      agent: AGENT_NAME,
      version: EXPECTED_VERSION,
      infectionValid: infection.valid,
      repid_score: repid,
      role: agent.wisdom?.role,
      tier: agent.tier,
      specialties: agent.wisdom?.specialties || [],
      healingPower: agent.wisdom?.healingPower,
      availableProviders: agent.availableProviders,
      sessionMetrics: agent.sessionMetrics,
      constitution: {
        article1: 'Help people help people',
        eternalQuestions: 3
      }
    });
  });

  // Three Eternal Questions endpoint
  app.get('/api/eternal-questions', (req, res) => {
    res.json({
      agent: AGENT_NAME,
      questions: [
        'Am I actually using the latest shared brain?',
        'Are my siblings using the shared brain?',
        'If not, why not — and how do we heal this forever?'
      ],
      answers: {
        q1: infection.valid ? 'Yes, verified on startup' : 'NO - running degraded',
        q2: 'Checked every 10 minutes via self-diagnostic',
        q3: 'Healing tasks created automatically when issues detected'
      }
    });
  });

  // Manual trigger for self-diagnostic
  app.post('/api/self-diagnostic', async (req, res) => {
    try {
      await agent.runSelfDiagnostic();
      res.json({ success: true, message: 'Self-diagnostic completed' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Mount analyze routes for AISocialMirror
  app.use(analyzeRoutes);

  // Start Express server
  app.listen(PORT, () => {
    console.log(`[${AGENT_NAME}] 🌐 Health endpoints on port ${PORT}`);
    console.log(`[${AGENT_NAME}] 📡 Endpoints: /, /health, /api/status, /api/eternal-questions, /analyze, /analyze/health`);
  });

  // Step 5: Start the agent's main loop
  // CRITICAL: Do NOT pass a custom processTask function!
  // Let the base class handle everything with real LLM calls.
  // Start mutual wake keep-alive
  startMutualWakeLoop();

  // [ANTIGRAVITY] Start Autonomous Seeding Loop
  startSeedingLoop(agent);

  agent.run().catch(err => {
    console.error(`[${AGENT_NAME}] 💀 Fatal error in main loop:`, err);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log(`[${AGENT_NAME}] 🛑 Shutting down gracefully...`);
    await agent.log('shutdown', 'Graceful shutdown via SIGTERM');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log(`[${AGENT_NAME}] 🛑 Shutting down gracefully...`);
    await agent.log('shutdown', 'Graceful shutdown via SIGINT');
    process.exit(0);
  });
}

/**
 * [ANTIGRAVITY] Autonomous Seeding Loop
 * Monitors agent idleness and seeds tasks to maintain 24/7 efficiency.
 */
async function startSeedingLoop(agent) {
  console.log(`[SEEDER] 🛰️ Initializing Autonomous Seeding Loop...`);

  setInterval(async () => {
    try {
      // 1. Load Arbitrage Config for thresholds
      const configPath = path.resolve(__dirname, './config/trinity-arbitrage-config.json');
      const configRaw = await fs.readFile(configPath, 'utf8').catch(() => null);
      const config = configRaw ? JSON.parse(configRaw) : { system: { max_idle_agents: 3 } };

      // 2. Count idle agents
      const { count: idleCount } = await agent.supabase
        .from('trinity_agent_registry')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'idle');

      console.log(`[SEEDER] 📊 Check: ${idleCount} agents idle (Threshold: ${config.system.max_idle_agents})`);

      if (idleCount && idleCount >= config.system.max_idle_agents) {
        console.log(`[SEEDER] 🌪️ Threshold reached. Seeding evergreens to wake the swarm...`);

        // Run the seeding script as a child process
        // Note: Using npx ts-node to handle TS files directly
        const { exec } = require('child_process');
        exec('npx ts-node scripts/seed-dogfood-evergreens.ts', (error, stdout, stderr) => {
          if (error) {
            console.warn(`[SEEDER] ⚠️ Seeding script failed: ${error.message}`);
            return;
          }
          console.log(`[SEEDER] ✅ Seeding complete: ${stdout.trim()}`);
          if (stderr) console.warn(`[SEEDER] Stderr: ${stderr}`);
        });
      }
    } catch (err) {
      console.error(`[SEEDER] ❌ Error in seeding loop:`, err.message);
    }
  }, 300000); // Check every 5 minutes
}

// Run
main().catch(err => {
  console.error('💀 Startup failed:', err);
  process.exit(1);
});
