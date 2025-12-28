// ============================================
// AISOCIALMIRROR - COMPLETE API ROUTE
// app/api/analyze/route.ts
// 
// Features:
// - Streaming progressive reveal (latency as ritual)
// - Native sharing (no Twilio needed)
// - Mirror Types (shareable personality)
// - Cross-platform suggestions (sticky engagement)
// - Trinity Symphony brand integration
// - RepID Verified badges
// ============================================

import { NextRequest, NextResponse } from "next/server";

// ============================================
// CONFIGURATION
// ============================================

const TRINITY_SYMPHONY_URL = "https://mcp-production-d0c6.up.railway.app";

// Brand terms to weave into responses
const BRAND_TERMS = {
  verified: "RepID Verified",
  ethical: "Ethical AI Analysis", 
  factChecked: "Fact-Checked Insights",
  symphony: "Powered by Trinity Symphony",
  constitutional: "Constitutional AI Standards"
};

// Mirror Types - shareable personality classifications
const MIRROR_TYPES = [
  { id: "empathic-strategist", name: "The Empathic Strategist", emoji: "🎯💜", traits: ["high EQ", "high IQ", "balanced SQ"] },
  { id: "visionary-poet", name: "The Visionary Poet", emoji: "✨📝", traits: ["high SQ", "high EQ", "creative IQ"] },
  { id: "analytical-heart", name: "The Analytical Heart", emoji: "🧠❤️", traits: ["high IQ", "growing EQ", "practical SQ"] },
  { id: "authentic-voice", name: "The Authentic Voice", emoji: "🎤🌟", traits: ["high EQ", "high SQ", "direct IQ"] },
  { id: "bridge-builder", name: "The Bridge Builder", emoji: "🌉🤝", traits: ["balanced all", "connecting", "translating"] },
  { id: "quiet-sage", name: "The Quiet Sage", emoji: "🦉💫", traits: ["high SQ", "reflective IQ", "subtle EQ"] },
  { id: "passionate-truth", name: "The Passionate Truth-Teller", emoji: "🔥📢", traits: ["high conviction", "direct", "principled"] },
  { id: "gentle-challenger", name: "The Gentle Challenger", emoji: "🌸⚡", traits: ["soft delivery", "strong ideas", "growth-focused"] }
];

// Cross-platform suggestions for stickiness
const NEXT_SUGGESTIONS = {
  linkedin: [
    { platform: "dating", prompt: "Now see how you come across on dating apps", icon: "💕" },
    { platform: "email", prompt: "How does your professional email voice compare?", icon: "📧" },
    { platform: "twitter", prompt: "What about your Twitter/X presence?", icon: "🐦" }
  ],
  dating: [
    { platform: "linkedin", prompt: "Curious how your professional voice differs?", icon: "💼" },
    { platform: "text", prompt: "Analyze how you text your friends", icon: "💬" },
    { platform: "journal", prompt: "What about when you write just for yourself?", icon: "📔" }
  ],
  email: [
    { platform: "linkedin", prompt: "See your public professional voice", icon: "💼" },
    { platform: "slack", prompt: "How about your Slack messages?", icon: "💬" },
    { platform: "meeting", prompt: "Paste your meeting notes", icon: "📝" }
  ],
  default: [
    { platform: "linkedin", prompt: "Try your LinkedIn headline or post", icon: "💼" },
    { platform: "dating", prompt: "Analyze your dating profile", icon: "💕" },
    { platform: "email", prompt: "Paste an important email you're drafting", icon: "📧" }
  ]
};

// ============================================
// HELPER: Detect content type
// ============================================

function detectContentType(text: string): string {
  const lower = text.toLowerCase();
  
  if (lower.includes("experience") && lower.includes("skills") || lower.includes("professional")) return "linkedin";
  if (lower.includes("love") && (lower.includes("looking for") || lower.includes("swipe"))) return "dating";
  if (lower.includes("dear") || lower.includes("regards") || lower.includes("best,")) return "email";
  if (lower.includes("meeting") || lower.includes("agenda") || lower.includes("action items")) return "meeting";
  if (lower.includes("hey") || lower.includes("lol") || lower.includes("gonna")) return "text";
  
  return "default";
}

// ============================================
// HELPER: Calculate Mirror Type
// ============================================

function calculateMirrorType(iq: number, eq: number, sq: number): typeof MIRROR_TYPES[0] {
  const scores = { iq, eq, sq };
  const highest = Object.entries(scores).sort(([,a], [,b]) => b - a);
  const [primary, secondary] = highest;
  
  // Balanced (all within 10 points)
  if (Math.max(iq, eq, sq) - Math.min(iq, eq, sq) <= 10) {
    return MIRROR_TYPES.find(t => t.id === "bridge-builder")!;
  }
  
  // High EQ + High IQ
  if (eq >= 80 && iq >= 80) {
    return MIRROR_TYPES.find(t => t.id === "empathic-strategist")!;
  }
  
  // High SQ + High EQ
  if (sq >= 80 && eq >= 75) {
    return MIRROR_TYPES.find(t => t.id === "visionary-poet")!;
  }
  
  // High IQ, growing EQ
  if (iq >= 80 && eq >= 60 && eq < 75) {
    return MIRROR_TYPES.find(t => t.id === "analytical-heart")!;
  }
  
  // High EQ + High SQ
  if (eq >= 80 && sq >= 75) {
    return MIRROR_TYPES.find(t => t.id === "authentic-voice")!;
  }
  
  // High SQ, reflective
  if (sq >= 80) {
    return MIRROR_TYPES.find(t => t.id === "quiet-sage")!;
  }
  
  // High conviction (all above 70 but IQ leads)
  if (iq >= 75 && eq >= 70 && sq >= 70) {
    return MIRROR_TYPES.find(t => t.id === "passionate-truth")!;
  }
  
  // Default to gentle challenger
  return MIRROR_TYPES.find(t => t.id === "gentle-challenger")!;
}

// ============================================
// HELPER: Generate share content
// ============================================

function generateShareContent(mirrorType: typeof MIRROR_TYPES[0], scores: { iq: number, eq: number, sq: number }) {
  const shareText = `I'm "${mirrorType.name}" ${mirrorType.emoji}\n\n🧠 IQ: ${scores.iq} | ❤️ EQ: ${scores.eq} | ✨ SQ: ${scores.sq}\n\nDiscover your Mirror Type →`;
  const shareUrl = "https://www.aisocialmirror.com";
  
  return {
    text: shareText,
    url: shareUrl,
    // Native sharing URIs (no Twilio needed!)
    share: {
      native: { title: "My Mirror Type", text: shareText, url: shareUrl },
      sms: `sms:?body=${encodeURIComponent(shareText + " " + shareUrl)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + " " + shareUrl)}`,
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
      email: `mailto:?subject=${encodeURIComponent("My AI Mirror Type")}&body=${encodeURIComponent(shareText + "\n\n" + shareUrl)}`,
      copy: shareText + " " + shareUrl
    }
  };
}

// ============================================
// HELPER: Quick analysis (instant feedback)
// ============================================

function quickAnalysis(text: string): object {
  const words = text.split(/\s+/).length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
  const avgWordsPerSentence = Math.round(words / sentences);
  
  // Sentiment indicators
  const positiveWords = (text.match(/love|great|excellent|happy|excited|grateful|amazing|wonderful|fantastic/gi) || []).length;
  const negativeWords = (text.match(/hate|terrible|awful|sad|angry|frustrated|disappointed|worried|anxious/gi) || []).length;
  const sentimentScore = Math.min(100, Math.max(0, 50 + (positiveWords * 5) - (negativeWords * 5)));
  
  // Complexity indicators
  const longWords = text.split(/\s+/).filter(w => w.length > 8).length;
  const complexityScore = Math.min(100, Math.round((longWords / words) * 200 + 40));
  
  // You-vs-I ratio (empathy indicator)
  const youCount = (text.match(/\byou\b|\byour\b|\byours\b/gi) || []).length;
  const iCount = (text.match(/\bI\b|\bme\b|\bmy\b|\bmine\b/gi) || []).length;
  const empathyRatio = youCount > 0 ? (youCount / (youCount + iCount)) : 0.5;
  
  return {
    stats: {
      words,
      sentences,
      avgWordsPerSentence,
      readingTime: `${Math.ceil(words / 200)} min read`
    },
    quickInsights: [
      sentimentScore > 65 ? "✨ Your words carry positive energy" : 
        sentimentScore < 35 ? "💭 I sense some weight in your words" : 
        "🎯 Your tone is measured and balanced",
      empathyRatio > 0.4 ? "💜 You're focused on others - that's connecting" :
        empathyRatio < 0.2 ? "🪞 This is centered on your experience - that's valid" :
        "⚖️ Good balance of self and other awareness",
      complexityScore > 70 ? "🧠 Sophisticated vocabulary detected" :
        complexityScore < 40 ? "💬 Clear, accessible language" :
        "📝 Natural, conversational style"
    ],
    previewScore: {
      clarity: Math.min(95, Math.max(55, 100 - Math.abs(avgWordsPerSentence - 15) * 3)),
      warmth: Math.min(95, Math.max(55, sentimentScore)),
      depth: Math.min(95, Math.max(55, complexityScore))
    }
  };
}

// ============================================
// HELPER: Generate engagement question
// ============================================

function generateEngagementQuestion(text: string, contentType: string): string {
  const questions: Record<string, string[]> = {
    linkedin: [
      "What achievement here are you most proud of?",
      "What do you want people to remember most about you?",
      "What's the story behind this career move?"
    ],
    dating: [
      "What quality here do you most want someone to notice?",
      "What are you hoping to find?",
      "What makes you different from everyone else on here?"
    ],
    email: [
      "What response are you hoping for?",
      "What's the one thing you need them to understand?",
      "How do you want them to feel after reading this?"
    ],
    default: [
      "What prompted you to write this?",
      "What do you most want someone to take away?",
      "Is there something you almost said but held back?"
    ]
  };
  
  const options = questions[contentType] || questions.default;
  return options[Math.floor(Math.random() * options.length)];
}

// ============================================
// MAIN API HANDLER
// ============================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { text, sharingLevel, storyMode, mode } = await request.json();
    
    // Validate
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Please share what's on your mind." },
        { status: 400 }
      );
    }
    
    if (text.length < 100) {
      return NextResponse.json(
        { 
          error: "Text too short",
          message: `Just ${100 - text.length} more characters to unlock your reflection.`,
          encouragement: "Take your time. What else is there?"
        },
        { status: 400 }
      );
    }
    
    // ========================================
    // PHASE 1: Instant feedback (0-100ms)
    // ========================================
    
    const contentType = detectContentType(text);
    const quick = quickAnalysis(text);
    const engagementQuestion = generateEngagementQuestion(text, contentType);
    
    // ========================================
    // PHASE 2: Call Trinity Symphony
    // ========================================
    
    const level = sharingLevel || mode || "private_reflection";
    
    let analysisResult;
    try {
      const response = await fetch(`${TRINITY_SYMPHONY_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          sharingLevel: level,
          storyMode: storyMode || false
        })
      });
      
      if (!response.ok) {
        throw new Error("Trinity Symphony unavailable");
      }
      
      analysisResult = await response.json();
    } catch (error) {
      // Graceful fallback with branded messaging
      console.error("Trinity Symphony error:", error);
      
      analysisResult = {
        summary: "I see someone taking time to reflect. That matters.",
        insight: "The act of writing clarifies thought. You're already doing the work.",
        iq: { score: 72, confidence: 65, description: "Your thoughts come through clearly.", strengths: ["Clarity", "Structure"] },
        eq: { score: 75, confidence: 68, description: "Genuine feeling present in your words.", strengths: ["Authenticity", "Warmth"] },
        sq: { score: 70, confidence: 62, description: "Purpose underlies your expression.", strengths: ["Intention", "Meaning"] },
        closing: "This analysis is preliminary. Full RepID Verified analysis coming soon.",
        fallback: true
      };
    }
    
    // ========================================
    // PHASE 3: Enrich with Mirror Type & Sharing
    // ========================================
    
    const scores = {
      iq: analysisResult.iq?.score || 72,
      eq: analysisResult.eq?.score || 75,
      sq: analysisResult.sq?.score || 70
    };
    
    const mirrorType = calculateMirrorType(scores.iq, scores.eq, scores.sq);
    const shareContent = generateShareContent(mirrorType, scores);
    const nextSuggestions = NEXT_SUGGESTIONS[contentType as keyof typeof NEXT_SUGGESTIONS] || NEXT_SUGGESTIONS.default;
    
    // ========================================
    // PHASE 4: Build complete response
    // ========================================
    
    const latency = Date.now() - startTime;
    
    const response = {
      // Core analysis
      summary: analysisResult.summary,
      insight: analysisResult.insight,
      analysis: analysisResult.analysis,
      
      // Scores with brand verification
      iq: {
        ...analysisResult.iq,
        verified: BRAND_TERMS.verified,
        color: "#22c55e" // green
      },
      eq: {
        ...analysisResult.eq,
        verified: BRAND_TERMS.verified,
        color: "#ef4444" // red (warm)
      },
      sq: {
        ...analysisResult.sq,
        verified: BRAND_TERMS.verified,
        color: "#eab308" // gold
      },
      
      // Mirror Type (shareable!)
      mirrorType: {
        id: mirrorType.id,
        name: mirrorType.name,
        emoji: mirrorType.emoji,
        description: `You lead with ${mirrorType.traits.join(", ")}.`,
        shareText: `I'm "${mirrorType.name}" ${mirrorType.emoji} - What's your Mirror Type?`
      },
      
      // Native sharing (no Twilio!)
      sharing: shareContent,
      
      // Quick insights (instant feedback)
      quickInsights: quick,
      
      // Engagement question (during latency)
      engagementQuestion,
      
      // Sticky next actions (not "come back in 30 days")
      nextSteps: {
        suggestions: nextSuggestions,
        message: "Your mirror reveals different facets in different contexts.",
        cta: `Try your ${nextSuggestions[0].platform} voice next`
      },
      
      // Closing based on sharing level
      closing: analysisResult.closing,
      
      // Branding
      branding: {
        poweredBy: BRAND_TERMS.symphony,
        verification: BRAND_TERMS.verified,
        standard: BRAND_TERMS.ethical,
        badge: analysisResult.fallback ? "⏳ Preliminary" : "✓ RepID Verified"
      },
      
      // Meta
      meta: {
        latencyMs: latency,
        contentType,
        sharingLevel: level,
        version: "2.0.0",
        constitutional: true
      }
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error("Analysis error:", error);
    
    return NextResponse.json(
      {
        error: "Analysis service temporarily unavailable",
        message: "Your words are safe. Please try again in a moment.",
        branding: {
          poweredBy: BRAND_TERMS.symphony,
          status: "Service recovering"
        }
      },
      { status: 503 }
    );
  }
}

// ============================================
// QUICK ANALYSIS ENDPOINT (for instant feedback)
// ============================================

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const text = url.searchParams.get("text");
  
  if (!text) {
    return NextResponse.json({
      status: "healthy",
      version: "2.0.0",
      features: [
        "Mirror Types",
        "Native Sharing",
        "Progressive Reveal",
        "RepID Verified",
        "Cross-Platform Suggestions"
      ],
      branding: BRAND_TERMS
    });
  }
  
  // Quick analysis for real-time feedback as user types
  const quick = quickAnalysis(text);
  return NextResponse.json(quick);
}
