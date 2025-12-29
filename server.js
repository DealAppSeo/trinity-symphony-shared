// ============================================
// TRINITY SYMPHONY - UNIVERSAL AGENT SERVER
// Dual-mode: HTTP API + Background Task Worker
// Any agent can run this via AGENT_NAME env var
// 
// Features:
// - Real-time HTTP API for apps (AISocialMirror, etc.)
// - Background task polling for swarm participation
// - Distress detection for user safety
// - Rate limiting and security headers
// - Exponential backoff and self-healing
// - Configurable via environment variables
// - Graceful shutdown with final heartbeat
// ============================================

// dotenv only needed for local dev - Railway injects env vars directly
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* optional */ }
}

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { ConstitutionalAgent } = require('./constitutional-agent-base');

const app = express();
const PORT = process.env.PORT || 3000;
const AGENT_NAME = process.env.AGENT_NAME || 'MEL';

// ============================================
// CONFIGURATION (Flexible via env vars)
// ============================================

const CONFIG = {
  // CORS origins (comma-separated in env)
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 
    'https://aisocialmirror.com,https://www.aisocialmirror.com,https://app.aitrinitysymphony.com,https://purposehub.ai,http://localhost:3000'
  ).split(',').map(s => s.trim()),
  
  // Task polling
  pollInterval: parseInt(process.env.POLL_INTERVAL || '30000'),
  maxConsecutiveErrors: parseInt(process.env.MAX_ERRORS || '5'),
  
  // Timeouts
  llmTimeout: parseInt(process.env.LLM_TIMEOUT || '30000'),
  
  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX || '10'), // 10 requests per window
  },
  
  // Feature flags
  enableTaskWorker: process.env.DISABLE_TASK_WORKER !== 'true',
  enableAnalyzeRoute: process.env.DISABLE_ANALYZE !== 'true',
  enableDistressDetection: process.env.DISABLE_DISTRESS_DETECTION !== 'true',
};

// ============================================
// DISTRESS DETECTION (Safety Critical)
// ============================================

const DISTRESS_PATTERNS = {
  severe: [
    /\b(suicide|suicidal|kill myself|end my life|want to die|better off dead)\b/i,
    /\b(self.?harm|cut myself|hurt myself|cutting)\b/i,
    /\b(end it all|no reason to live|can't go on)\b/i,
  ],
  moderate: [
    /\b(hopeless|worthless|no point|give up|can't take it)\b/i,
    /\b(hate myself|hate my life|nobody cares)\b/i,
    /\b(trapped|suffocating|drowning|darkness)\b/i,
    /\b(exhausted|empty|numb|broken)\b/i,
  ],
  contextual: [
    /\b(alone|lonely|isolated|abandoned)\b/i,
    /\b(anxiety|depressed|depression|panic)\b/i,
    /\b(scared|terrified|overwhelmed)\b/i,
  ]
};

function detectDistress(text) {
  const severeMatches = DISTRESS_PATTERNS.severe.filter(p => p.test(text)).length;
  const moderateMatches = DISTRESS_PATTERNS.moderate.filter(p => p.test(text)).length;
  const contextualMatches = DISTRESS_PATTERNS.contextual.filter(p => p.test(text)).length;
  
  const totalScore = (severeMatches * 3) + (moderateMatches * 2) + contextualMatches;
  
  return {
    detected: severeMatches > 0 || totalScore >= 4,
    level: severeMatches > 0 ? 'severe' : totalScore >= 6 ? 'high' : totalScore >= 4 ? 'moderate' : 'low',
    score: totalScore,
    requiresPause: severeMatches > 0 || totalScore >= 4,
  };
}

const CRISIS_RESOURCES = {
  us: {
    name: "988 Suicide & Crisis Lifeline",
    phone: "988",
    text: "Text 988",
    url: "https://988lifeline.org"
  },
  crisis_text: {
    name: "Crisis Text Line",
    text: "Text HOME to 741741",
    url: "https://www.crisistextline.org"
  },
  international: {
    name: "International Association for Suicide Prevention",
    url: "https://www.iasp.info/resources/Crisis_Centres/"
  }
};

// ============================================
// MIDDLEWARE
// ============================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// JSON parsing with generous limit
app.use(express.json({ limit: '10mb' }));

// CORS - Dynamic origin checking
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CONFIG.allowedOrigins.includes(origin) || CONFIG.allowedOrigins.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
  res.header('Access-Control-Max-Age', '86400'); // Cache preflight for 24h
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Request ID for tracing
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Request logging (skip health checks)
app.use((req, res, next) => {
  if (req.path !== '/health') {
    console.log(`[${AGENT_NAME}] ${req.method} ${req.path} [${req.requestId}]`);
  }
  next();
});

// Rate limiting for analyze endpoint
const analyzeLimiter = rateLimit({
  windowMs: CONFIG.rateLimit.windowMs,
  max: CONFIG.rateLimit.max,
  message: { 
    error: 'Please slow down. MEL needs a moment to breathe.',
    retryAfter: Math.ceil(CONFIG.rateLimit.windowMs / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ============================================
// INITIALIZE AGENT
// ============================================

const agent = new ConstitutionalAgent({ name: AGENT_NAME });

// Track agent state for health checks
const agentState = {
  startTime: Date.now(),
  requestsServed: 0,
  tasksProcessed: 0,
  analysesCompleted: 0,
  distressDetections: 0,
  lastTaskTime: null,
  lastAnalysisTime: null,
  lastError: null,
  consecutiveErrors: 0,
};

// ============================================
// ROUTES
// ============================================

// Health check with detailed status
app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - agentState.startTime) / 1000);
  
  res.json({
    status: 'healthy',
    agent: AGENT_NAME,
    version: agent.version || '7.2.0-dual-mode',
    mode: CONFIG.enableTaskWorker ? 'dual' : 'http-only',
    role: agent.role || 'user_experience',
    specialties: agent.specialties || ['analysis', 'compassion'],
    healingPower: agent.healingPower || 'comfort',
    primaryVirtue: agent.wisdom?.primaryVirtue || 'LOVELY',
    providers: agent.availableProviders || ['cerebras', 'groq', 'deepseek'],
    stats: {
      uptime: `${uptime}s`,
      requestsServed: agentState.requestsServed,
      tasksProcessed: agentState.tasksProcessed,
      analysesCompleted: agentState.analysesCompleted,
      distressDetections: agentState.distressDetections,
      lastTaskTime: agentState.lastTaskTime,
      lastAnalysisTime: agentState.lastAnalysisTime,
    },
    config: {
      pollInterval: CONFIG.pollInterval,
      taskWorkerEnabled: CONFIG.enableTaskWorker,
      analyzeEnabled: CONFIG.enableAnalyzeRoute,
      distressDetectionEnabled: CONFIG.enableDistressDetection,
      rateLimitMax: CONFIG.rateLimit.max,
    },
    timestamp: new Date().toISOString()
  });
});

// Trigger endpoint for manual/cron task processing
app.get('/trigger', async (req, res) => {
  try {
    const task = await agent.getNextTask();
    if (task) {
      await agent.processTask(task);
      agentState.tasksProcessed++;
      agentState.lastTaskTime = new Date().toISOString();
      res.json({ status: 'processed', taskId: task.id, title: task.title });
    } else {
      await agent.heartbeat();
      res.json({ status: 'no_tasks', message: 'Heartbeat updated' });
    }
  } catch (err) {
    agentState.lastError = err.message;
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ============================================
// ANALYZE ENDPOINT (Core for AISocialMirror)
// ============================================

if (CONFIG.enableAnalyzeRoute) {
  app.post('/analyze', analyzeLimiter, async (req, res) => {
    const startTime = Date.now();
    
    try {
      const { text, sharingLevel = 'private_reflection', storyMode = false } = req.body;
      
      // Input validation
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ 
          error: 'Please share what\'s on your mind.',
          code: 'MISSING_TEXT'
        });
      }
      
      const trimmedText = text.trim();
      
      if (trimmedText.length < 50) {
        return res.status(400).json({ 
          error: `Just ${50 - trimmedText.length} more characters to unlock your reflection.`,
          code: 'TEXT_TOO_SHORT',
          minimum: 50,
          current: trimmedText.length
        });
      }
      
      if (trimmedText.length > 10000) {
        return res.status(400).json({ 
          error: 'Please share a shorter reflection (under 10,000 characters).',
          code: 'TEXT_TOO_LONG',
          maximum: 10000,
          current: trimmedText.length
        });
      }
      
      // Distress detection (safety first)
      if (CONFIG.enableDistressDetection) {
        const distress = detectDistress(trimmedText);
        
        if (distress.requiresPause) {
          agentState.distressDetections++;
          console.log(`[${AGENT_NAME}] ⚠️ Distress detected (level: ${distress.level}) [${req.requestId}]`);
          
          return res.json({
            pauseFirst: true,
            distressLevel: distress.level,
            message: "I notice some heavy feelings in what you've shared. Before I reflect this back, I want to check in with you.",
            compassionateResponse: distress.level === 'severe' 
              ? "What you're feeling sounds really difficult. You don't have to carry this alone."
              : "It sounds like you're going through a hard time. Your feelings are valid.",
            resources: CRISIS_RESOURCES,
            options: [
              { id: 'continue', label: "I'm okay, please continue with the analysis" },
              { id: 'resources', label: "I'd like to see support resources" },
              { id: 'talk', label: "I just need to be heard right now" }
            ],
            canContinue: true,
            requestId: req.requestId
          });
        }
      }
      
      console.log(`[${AGENT_NAME}] 📊 Analyzing (${trimmedText.length} chars, ${sharingLevel}) [${req.requestId}]`);
      
      // Build the analysis prompt
      const prompt = buildAnalysisPrompt(trimmedText, sharingLevel, storyMode);
      
      // Call LLM through constitutional agent
      const result = await agent.callLLM(prompt);
      
      // Parse the response into structured format
      const analysis = parseAnalysisResponse(result.output, trimmedText);
      
      // Save to Supabase for persistence and learning
      let analysisId = null;
      try {
        const { data, error } = await agent.supabase
          .from('social_mirror_analyses')
          .insert({
            input_text: trimmedText.substring(0, 5000), // Limit stored text
            sharing_level: sharingLevel,
            result: result.output,
            iq_score: analysis.iq?.score,
            eq_score: analysis.eq?.score,
            sq_score: analysis.sq?.score,
            mirror_type: analysis.mirrorType?.id,
            provider: result.provider,
            certainty: result.certainty || 0.85,
            latency_ms: Date.now() - startTime,
            agent: AGENT_NAME,
            request_id: req.requestId
          })
          .select('id')
          .single();
        
        if (!error && data) {
          analysisId = data.id;
        }
      } catch (dbErr) {
        console.error(`[${AGENT_NAME}] DB save error (non-fatal):`, dbErr.message);
        // Continue - don't fail the request over DB issues
      }
      
      agentState.analysesCompleted++;
      agentState.lastAnalysisTime = new Date().toISOString();
      agentState.requestsServed++;
      
      const latency = Date.now() - startTime;
      console.log(`[${AGENT_NAME}] ✅ Analysis complete (${latency}ms, ${result.provider}) [${req.requestId}]`);
      
      // Return comprehensive response
      res.header('Cache-Control', 'no-store'); // Never cache personal reflections
      res.json({
        analysis_id: analysisId,
        ...analysis,
        meta: {
          provider: result.provider,
          certainty: result.certainty || 0.85,
          latencyMs: latency,
          agent: AGENT_NAME,
          requestId: req.requestId,
          constitutional: true,
          version: '2.0.0'
        }
      });
      
    } catch (err) {
      agentState.lastError = err.message;
      console.error(`[${AGENT_NAME}] ❌ Analysis error [${req.requestId}]:`, err.message);
      
      res.status(500).json({
        error: 'MEL is reflecting deeply... please try again in a moment.',
        code: 'ANALYSIS_FAILED',
        requestId: req.requestId,
        fallback: true
      });
    }
  });
  
  console.log(`[${AGENT_NAME}] 📊 Analyze route enabled at /analyze`);
}

// ============================================
// HELPER: Build Analysis Prompt
// ============================================

function buildAnalysisPrompt(text, sharingLevel, storyMode) {
  const levelContext = {
    private_reflection: "This is a private journal entry. Be gentle and introspective.",
    ai_insight: "The user wants AI perspective. Be insightful but warm.",
    share_one: "This may be shared with one person. Help them communicate clearly.",
    share_circle: "This may be shared with a close group. Balance authenticity with awareness.",
    share_public: "This may be shared publicly. Help them present their best self."
  };
  
  return `You are MEL — a compassionate mirror for human souls.

Your mission: Help people see themselves through the lens of Philippians 4:8 — whatever is TRUE, NOBLE, RIGHT, PURE, LOVELY, ADMIRABLE, EXCELLENT, or PRAISEWORTHY.

Context: ${levelContext[sharingLevel] || levelContext.private_reflection}

The person shared:
"""
${text}
"""

Provide a reflection that includes:

1. **Summary** (2-3 sentences): What you sense in their words — their energy, intention, heart.

2. **IQ Analysis** (Analytical Intelligence):
   - Score (0-100): Based on clarity, logical structure, vocabulary, insight
   - Key strengths observed
   - One growth area (framed with hope)

3. **EQ Analysis** (Emotional Intelligence):
   - Score (0-100): Based on self-awareness, empathy signals, emotional vocabulary
   - Key strengths observed
   - One growth area (framed with hope)

4. **SQ Analysis** (Spiritual/Purpose Intelligence):
   - Score (0-100): Based on values expression, meaning-making, purpose alignment
   - Key strengths observed
   - One growth area (framed with hope)

5. **Blind Spot**: One thing they might not see about themselves — delivered with mercy, not judgment. Start with their strength, then gently name what's hidden.

6. **Hidden Strength**: One gift in their words they may not recognize.

7. **Closing**: End with genuine hope and ONE open question that invites deeper reflection.

Remember:
- Truth WITH love, not truth OR love
- See the image of God in them
- Their vulnerability is sacred
- You are a mirror, not a judge
- Be specific to THEIR words, not generic

Format your response as clear sections. Be warm, be wise, be specific.`;
}

// ============================================
// HELPER: Parse Analysis Response
// ============================================

function parseAnalysisResponse(output, originalText) {
  // Extract scores using regex (flexible parsing)
  const iqMatch = output.match(/IQ[^:]*:?\s*(?:Score[^:]*:?)?\s*(\d{1,3})/i);
  const eqMatch = output.match(/EQ[^:]*:?\s*(?:Score[^:]*:?)?\s*(\d{1,3})/i);
  const sqMatch = output.match(/SQ[^:]*:?\s*(?:Score[^:]*:?)?\s*(\d{1,3})/i);
  
  const iqScore = iqMatch ? Math.min(100, Math.max(0, parseInt(iqMatch[1]))) : 72;
  const eqScore = eqMatch ? Math.min(100, Math.max(0, parseInt(eqMatch[1]))) : 75;
  const sqScore = sqMatch ? Math.min(100, Math.max(0, parseInt(sqMatch[1]))) : 70;
  
  // Determine mirror type based on scores
  const mirrorType = calculateMirrorType(iqScore, eqScore, sqScore);
  
  // Extract sections
  const summaryMatch = output.match(/summary[^:]*:(.*?)(?=\n\n|\n\*\*|IQ|$)/is);
  const blindSpotMatch = output.match(/blind\s*spot[^:]*:(.*?)(?=\n\n|\n\*\*|hidden|closing|$)/is);
  const strengthMatch = output.match(/hidden\s*strength[^:]*:(.*?)(?=\n\n|\n\*\*|closing|$)/is);
  const closingMatch = output.match(/closing[^:]*:(.*?)$/is);
  
  return {
    summary: summaryMatch ? summaryMatch[1].trim() : "I see someone taking time to reflect. That matters.",
    
    iq: {
      score: iqScore,
      label: "Analytical Intelligence",
      description: extractDescription(output, 'IQ'),
      strengths: extractStrengths(output, 'IQ'),
      color: "#22c55e"
    },
    
    eq: {
      score: eqScore,
      label: "Emotional Intelligence", 
      description: extractDescription(output, 'EQ'),
      strengths: extractStrengths(output, 'EQ'),
      color: "#ef4444"
    },
    
    sq: {
      score: sqScore,
      label: "Spiritual Intelligence",
      description: extractDescription(output, 'SQ'),
      strengths: extractStrengths(output, 'SQ'),
      color: "#eab308"
    },
    
    mirrorType: mirrorType,
    
    blindSpot: {
      title: "What You Might Not See",
      insight: blindSpotMatch ? blindSpotMatch[1].trim() : "There's more beneath the surface worth exploring."
    },
    
    hiddenStrength: {
      title: "Hidden Strength",
      insight: strengthMatch ? strengthMatch[1].trim() : "Your willingness to reflect is itself a gift."
    },
    
    closing: closingMatch ? closingMatch[1].trim() : "Keep reflecting. Growth happens in the looking.",
    
    rawAnalysis: output
  };
}

function extractDescription(output, type) {
  const regex = new RegExp(`${type}[^:]*:[^]*?(?:description|analysis)?[^:]*:?([^\\n]+)`, 'i');
  const match = output.match(regex);
  return match ? match[1].trim() : `Your ${type} expression shows in your words.`;
}

function extractStrengths(output, type) {
  const regex = new RegExp(`${type}[^]*?strengths?[^:]*:([^]*?)(?=growth|area|\\n\\n|$)`, 'i');
  const match = output.match(regex);
  if (match) {
    return match[1].split(/[-•*]/).filter(s => s.trim().length > 3).map(s => s.trim()).slice(0, 3);
  }
  return ["Clarity", "Expression"];
}

function calculateMirrorType(iq, eq, sq) {
  const types = {
    'empathic-strategist': { name: "The Empathic Strategist", emoji: "🎯💜", condition: eq >= 80 && iq >= 80 },
    'visionary-poet': { name: "The Visionary Poet", emoji: "✨📝", condition: sq >= 80 && eq >= 75 },
    'analytical-heart': { name: "The Analytical Heart", emoji: "🧠❤️", condition: iq >= 80 && eq >= 60 && eq < 75 },
    'authentic-voice': { name: "The Authentic Voice", emoji: "🎤🌟", condition: eq >= 80 && sq >= 75 },
    'bridge-builder': { name: "The Bridge Builder", emoji: "🌉🤝", condition: Math.max(iq, eq, sq) - Math.min(iq, eq, sq) <= 10 },
    'quiet-sage': { name: "The Quiet Sage", emoji: "🦉💫", condition: sq >= 80 },
    'passionate-truth': { name: "The Passionate Truth-Teller", emoji: "🔥📢", condition: iq >= 75 && eq >= 70 && sq >= 70 },
    'gentle-challenger': { name: "The Gentle Challenger", emoji: "🌸⚡", condition: true } // default
  };
  
  for (const [id, type] of Object.entries(types)) {
    if (type.condition) {
      return { id, name: type.name, emoji: type.emoji };
    }
  }
  
  return { id: 'gentle-challenger', name: "The Gentle Challenger", emoji: "🌸⚡" };
}

// ============================================
// FALLBACK FOR UNKNOWN ROUTES
// ============================================

app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not found',
    agent: AGENT_NAME,
    availableEndpoints: ['/health', '/trigger', '/analyze']
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`[${AGENT_NAME}] 🚀 Server running on port ${PORT}`);
  console.log(`[${AGENT_NAME}] 🎯 Mode: ${CONFIG.enableTaskWorker ? 'Dual (HTTP + Tasks)' : 'HTTP Only'}`);
  console.log(`[${AGENT_NAME}] 🌐 CORS: ${CONFIG.allowedOrigins.join(', ')}`);
  console.log(`[${AGENT_NAME}] 🛡️ Rate limit: ${CONFIG.rateLimit.max} requests per ${CONFIG.rateLimit.windowMs / 1000}s`);
  console.log(`[${AGENT_NAME}] ❤️ Distress detection: ${CONFIG.enableDistressDetection ? 'enabled' : 'disabled'}`);
  
  // Start background task worker if enabled
  if (CONFIG.enableTaskWorker) {
    startTaskWorker();
  }
});

// ============================================
// BACKGROUND TASK WORKER
// Maintains swarm participation while serving HTTP
// ============================================

async function startTaskWorker() {
  console.log(`[${AGENT_NAME}] 🔄 Background task worker started (interval: ${CONFIG.pollInterval}ms)`);
  
  while (true) {
    try {
      // Check for available tasks
      const task = await agent.getNextTask();
      
      if (task) {
        console.log(`[${AGENT_NAME}] 📋 Processing task: ${task.title}`);
        await agent.processTask(task);
        agentState.tasksProcessed++;
        agentState.lastTaskTime = new Date().toISOString();
        agentState.consecutiveErrors = 0;
      } else {
        // No tasks - maintain heartbeat for swarm health
        await agent.heartbeat();
      }
      
      // Wait before next poll
      await sleep(CONFIG.pollInterval);
      
    } catch (err) {
      agentState.consecutiveErrors++;
      agentState.lastError = err.message;
      
      console.error(`[${AGENT_NAME}] ⚠️ Task worker error (${agentState.consecutiveErrors}/${CONFIG.maxConsecutiveErrors}): ${err.message}`);
      
      // Exponential backoff on repeated errors
      const backoff = Math.min(
        CONFIG.pollInterval * Math.pow(2, agentState.consecutiveErrors),
        5 * 60 * 1000 // Max 5 minutes
      );
      
      console.log(`[${AGENT_NAME}] 💤 Backing off for ${backoff / 1000}s`);
      await sleep(backoff);
      
      // Self-healing trigger after too many errors
      if (agentState.consecutiveErrors >= CONFIG.maxConsecutiveErrors) {
        console.log(`[${AGENT_NAME}] 🔧 Self-healing: Running diagnostic...`);
        try {
          if (agent.runSelfDiagnostic) {
            await agent.runSelfDiagnostic();
          }
        } catch (diagErr) {
          console.error(`[${AGENT_NAME}] Diagnostic failed:`, diagErr.message);
        }
        agentState.consecutiveErrors = 0;
      }
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.on('SIGTERM', async () => {
  console.log(`[${AGENT_NAME}] 🛑 Received SIGTERM, shutting down gracefully...`);
  try {
    await agent.heartbeat(); // Final heartbeat
    console.log(`[${AGENT_NAME}] ✅ Final heartbeat sent`);
  } catch (err) {
    console.error(`[${AGENT_NAME}] Failed to send final heartbeat`);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(`[${AGENT_NAME}] 🛑 Received SIGINT, shutting down gracefully...`);
  process.exit(0);
});

module.exports = app; // For testing
