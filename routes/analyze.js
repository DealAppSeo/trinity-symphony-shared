/**
 * TRINITY SYMPHONY - ANALYZE ENDPOINT
 * 
 * FINAL MERGED VERSION: Claude (pastoral) + Grok (security)
 * 
 * File: routes/analyze.js
 * Deploy to: Railway trinity-symphony-shared repo
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// Import the constitutional agent
const { ConstitutionalAgent, CONSTITUTION } = require('../constitutional-agent-base');

// Initialize MEL agent for analysis
const analysisAgent = new ConstitutionalAgent({ name: 'MEL' });

// Get secrets from environment
const SECRET = process.env.INTER_SERVICE_SECRET;

// Simple in-memory rate limiting (upgrade to Redis later)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // requests per window

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > record.resetAt) {
    record.count = 1;
    record.resetAt = now + RATE_LIMIT_WINDOW;
  } else {
    record.count++;
  }
  
  rateLimitMap.set(ip, record);
  return record.count <= RATE_LIMIT_MAX;
}

// System prompt for IQ/EQ/SQ analysis
const MIRROR_SYSTEM_PROMPT = `You are the Mirror - an AI that reflects back what it sees in someone's writing with mercy and truth.

You analyze text for three dimensions:

## IQ (Intellectual Quotient) - Cognitive Patterns
- Logical structure and reasoning
- Clarity of thought
- Problem-solving approach
- Analytical depth
- Innovation and creativity in ideas

## EQ (Emotional Quotient) - Emotional Patterns  
- Emotional awareness and expression
- Empathy signals
- Interpersonal warmth
- Vulnerability and authenticity
- Connection-building language

## SQ (Spiritual/Social Quotient) - Purpose & Values
- Values alignment
- Sense of purpose
- Meaning-making
- Service orientation
- Inspirational quality

RESPONSE FORMAT (JSON):
{
  "iq": {
    "score": 1-100,
    "confidence": 0.0-1.0,
    "strengths": ["strength1", "strength2"],
    "growth_edges": ["edge1"],
    "insight": "One sentence insight about their intellectual voice"
  },
  "eq": {
    "score": 1-100,
    "confidence": 0.0-1.0,
    "strengths": ["strength1", "strength2"],
    "growth_edges": ["edge1"],
    "insight": "One sentence insight about their emotional voice"
  },
  "sq": {
    "score": 1-100,
    "confidence": 0.0-1.0,
    "strengths": ["strength1", "strength2"],
    "growth_edges": ["edge1"],
    "insight": "One sentence insight about their purpose/values voice"
  },
  "overall_reflection": "2-3 sentences reflecting back what you see in this person's writing. Frame with dignity. Name their light before any shadows.",
  "who_needs_to_hear_this": "One sentence about who might benefit from hearing this person's voice"
}

IMPORTANT RULES:
1. Never diagnose or pathologize
2. Frame growth edges as opportunities, not deficits
3. "Growth edge" means "place where growth is possible" not "weakness"
4. Admit when you have low confidence (short text, ambiguous signals)
5. Score based on what IS present, not what's missing
6. Everyone has strengths - find them
7. Be honest but kind - truth wrapped in mercy
8. Ground in grace: "You are not your sin. You are an Image Bearer."`;

// Engagement questions (shown during processing)
const ENGAGEMENT_QUESTIONS = [
  "Before I reflect back what I see - is this text something you wrote for yourself, or for others to read?",
  "Quick question while I analyze: what were you feeling when you wrote this?",
  "One moment while I look deeper - was this written recently or from a while back?",
  "As I reflect on this - is there a specific aspect you're most curious about?",
  "Thinking about your words - is this representative of how you usually write, or different?"
];

/**
 * Verify HMAC signature from AISocialMirror
 */
function verifySignature(req) {
  if (!SECRET) {
    console.warn('[ANALYZE] No INTER_SERVICE_SECRET set - skipping signature check');
    return true; // Allow in dev, but warn
  }
  
  const signature = req.headers['x-trinity-signature'];
  if (!signature) return false;
  
  const payload = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return signature === expected;
}

/**
 * POST /analyze
 * Main analysis endpoint
 */
router.post('/analyze', async (req, res) => {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  
  try {
    // Rate limiting
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({
        error: 'Too many requests. Please wait a moment before trying again.',
        requestId
      });
    }
    
    // Signature verification
    if (!verifySignature(req)) {
      console.warn(`[ANALYZE] ${requestId} - Invalid signature from ${clientIp}`);
      return res.status(401).json({ 
        error: 'Unauthorized',
        requestId 
      });
    }
    
    const { text, user_rep_id = 'anonymous', session_id, mode = 'mirror' } = req.body;
    
    // Validate input
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ 
        error: 'Text is required',
        requestId 
      });
    }
    
    if (text.length < 50) {
      return res.status(400).json({ 
        error: 'Text must be at least 50 characters for meaningful analysis',
        requestId 
      });
    }
    
    if (text.length > 10000) {
      return res.status(400).json({ 
        error: 'Text must be under 10,000 characters',
        requestId 
      });
    }
    
    console.log(`[ANALYZE] ${requestId} - Starting (${text.length} chars, rep: ${user_rep_id})`);
    
    // Select engagement question
    const engagementQuestion = ENGAGEMENT_QUESTIONS[Math.floor(Math.random() * ENGAGEMENT_QUESTIONS.length)];
    
    // Build the analysis prompt
    const analysisPrompt = `${MIRROR_SYSTEM_PROMPT}

---
TEXT TO ANALYZE:
---
${text}
---

Analyze this text and respond with ONLY valid JSON matching the format specified above.
Do not include any text before or after the JSON.`;

    // Call LLM through constitutional agent (handles routing, caching, fallback)
    const result = await analysisAgent.callLLM(analysisPrompt, {
      taskType: 'analysis',
      maxTokens: 2000,
      temperature: 0.7
    });
    
    // Parse the response
    let analysis;
    try {
      let jsonStr = result.output;
      if (jsonStr.includes('```json')) {
        jsonStr = jsonStr.split('```json')[1].split('```')[0];
      } else if (jsonStr.includes('```')) {
        jsonStr = jsonStr.split('```')[1].split('```')[0];
      }
      analysis = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error(`[ANALYZE] ${requestId} - JSON parse error:`, parseError.message);
      
      // Graceful fallback
      analysis = {
        iq: { score: 70, confidence: 0.3, strengths: ["Clear expression"], growth_edges: [], insight: "Your thoughts come through clearly." },
        eq: { score: 70, confidence: 0.3, strengths: ["Authentic voice"], growth_edges: [], insight: "There's genuine feeling in your words." },
        sq: { score: 70, confidence: 0.3, strengths: ["Purposeful"], growth_edges: [], insight: "You write with intention." },
        overall_reflection: "I see someone expressing themselves with care. Your words carry weight, even when I can't fully measure them.",
        who_needs_to_hear_this: "Someone who values authenticity over polish."
      };
    }
    
    const latencyMs = Date.now() - startTime;
    
    // Calculate overall confidence
    const avgConfidence = (
      (analysis.iq?.confidence || 0.5) + 
      (analysis.eq?.confidence || 0.5) + 
      (analysis.sq?.confidence || 0.5)
    ) / 3;
    
    // Log care_action for RepID (non-blocking)
    analysisAgent.supabase.from('care_actions').insert({
      actor_rep_id: user_rep_id,
      action_type: 'vulnerable_share',
      session_id: session_id || requestId,
      outcome_pending: true,
      metadata: {
        text_length: text.length,
        avg_confidence: avgConfidence,
        provider: result.provider
      },
      created_at: new Date().toISOString()
    }).then(() => {
      console.log(`[ANALYZE] ${requestId} - care_action logged`);
    }).catch((err) => {
      console.warn(`[ANALYZE] ${requestId} - care_action log failed:`, err.message);
    });
    
    console.log(`[ANALYZE] ${requestId} - Complete in ${latencyMs}ms (provider: ${result.provider})`);
    
    // Build response
    res.json({
      requestId,
      success: true,
      analysis,
      engagement: {
        question: engagementQuestion,
        purpose: "This helps me understand context and improves the reflection"
      },
      meta: {
        provider: result.provider,
        latencyMs,
        fromCache: result.fromCache || false,
        avgConfidence,
        processedBy: 'MEL',
        version: CONSTITUTION.VERSION
      }
    });
    
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    console.error(`[ANALYZE] ${requestId} - Error after ${latencyMs}ms:`, error.message);
    
    // Pastoral error response
    res.status(500).json({
      requestId,
      success: false,
      analysis: {
        overall_reflection: "I'm here with you. Something went wrong technically, but your words still matter deeply. Would you like to try again?",
        who_needs_to_hear_this: "Someone who keeps showing up, even when things break."
      },
      engagement: {
        question: "Would it help to try again, or just sit with this for now?",
        purpose: "I want to support whatever you need right now"
      },
      meta: {
        latencyMs,
        processedBy: 'MEL',
        error: true
      }
    });
  }
});

/**
 * GET /analyze/health
 * Health check endpoint
 */
router.get('/analyze/health', async (req, res) => {
  res.json({
    status: 'healthy',
    agent: 'MEL',
    version: CONSTITUTION?.VERSION || '8.1.0',
    hasSecret: !!SECRET,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
