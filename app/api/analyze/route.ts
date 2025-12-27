/**
 * AISocialMirror - Analyze API Route
 * 
 * FINAL MERGED VERSION: Claude + Grok (HMAC security)
 * 
 * File: app/api/analyze/route.ts
 * Deploy to: Vercel AISocialMirror repo
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Trinity Symphony endpoint on Railway
const TRINITY_SYMPHONY_URL = process.env.TRINITY_SYMPHONY_URL || 'https://mcp-production-d0c6.up.railway.app';
const SECRET = process.env.INTER_SERVICE_SECRET;

/**
 * Generate HMAC signature for inter-service auth
 */
function signPayload(payload: string): string {
  if (!SECRET) {
    console.warn('[AISocialMirror] No INTER_SERVICE_SECRET - requests may fail');
    return '';
  }
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body = await request.json();
    const { text, mode = 'mirror', storyMode = false } = body;
    
    // Validate
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }
    
    if (text.length < 100) {
      return NextResponse.json(
        { error: 'Please enter at least 100 characters for meaningful analysis' },
        { status: 400 }
      );
    }
    
    // Prepare payload
    const payload = JSON.stringify({
      text,
      mode,
      user_rep_id: 'web_anonymous', // TODO: Add auth later
      session_id: request.headers.get('x-session-id') || `session_${Date.now()}`
    });
    
    // Sign the request
    const signature = signPayload(payload);
    
    console.log(`[AISocialMirror] Calling Trinity Symphony (${text.length} chars)`);
    
    // Call Trinity Symphony
    const response = await fetch(`${TRINITY_SYMPHONY_URL}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trinity-Signature': signature,
        'X-Source': 'AISocialMirror',
        'X-Request-Time': new Date().toISOString()
      },
      body: payload
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AISocialMirror] Trinity error (${response.status}):`, errorText);
      
      // Parse error if possible
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      return NextResponse.json(
        { 
          error: 'Analysis service temporarily unavailable',
          details: errorData.error || 'Unknown error'
        },
        { status: response.status }
      );
    }
    
    const result = await response.json();
    
    const totalLatency = Date.now() - startTime;
    console.log(`[AISocialMirror] Analysis complete in ${totalLatency}ms`);
    
    // Add client-side metadata
    return NextResponse.json({
      ...result,
      clientMeta: {
        totalLatencyMs: totalLatency,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('[AISocialMirror] Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze text. Please try again.',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Health check
export async function GET() {
  try {
    const response = await fetch(`${TRINITY_SYMPHONY_URL}/analyze/health`, {
      headers: {
        'X-Source': 'AISocialMirror-HealthCheck'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Trinity returned ${response.status}`);
    }
    
    const health = await response.json();
    
    return NextResponse.json({
      status: 'connected',
      trinityStatus: health,
      hasSecret: !!SECRET,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({
      status: 'disconnected',
      error: error instanceof Error ? error.message : 'Cannot reach Trinity Symphony',
      hasSecret: !!SECRET,
      timestamp: new Date().toISOString()
    }, { status: 503 });
  }
}
