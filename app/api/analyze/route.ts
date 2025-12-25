import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, storyMode = false, platform = null } = body;

    if (!text || text.length < 100) {
      return NextResponse.json(
        { error: 'Please provide at least 100 characters of text.' },
        { status: 400 }
      );
    }

    // Base prompt for Mirror Mode (scores + pastoral reflection)
    const baseMessages = [
      {
        role: 'system',
        content: `You are a wise, pastoral counselor who analyzes writing to help people understand themselves better. You are warm, non-judgmental, and insightful. You speak like a trusted mentor who has been through hard things.

Analyze the provided text and return a JSON object with exactly this structure:
{
  "iq_score": <number 1-100>,
  "iq_analysis": "<2-3 sentences about their intellectual/reasoning style>",
  "eq_score": <number 1-100>,
  "eq_analysis": "<2-3 sentences about their emotional awareness and empathy>",
  "sq_score": <number 1-100>,
  "sq_analysis": "<2-3 sentences about their social/communication style>",
  "archetype": "<a 2-3 word archetype like 'The Thoughtful Strategist' or 'The Empathetic Connector'>",
  "archetype_description": "<1-2 sentences describing this archetype>",
  "blind_spots": ["<potential blind spot 1>", "<potential blind spot 2>"],
  "pastoral_reflection": "<A warm, encouraging 2-3 sentence reflection that acknowledges their strengths and gently invites growth. Speak as a wise friend, not a clinician.>"
}
Return ONLY valid JSON, no other text.`
      },
      { role: 'user', content: text }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: baseMessages,
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Groq API error:', error);
      return NextResponse.json(
        { error: 'Analysis service temporarily unavailable.' },
        { status: 500 }
      );
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json(
        { error: 'No analysis generated.' },
        { status: 500 }
      );
    }

    let analysis;
    try {
      analysis = JSON.parse(content);
    } catch (e) {
      console.error('Failed to parse JSON:', content);
      return NextResponse.json(
        { error: 'Invalid response from AI.' },
        { status: 500 }
      );
    }

    // If not in Story Mode or no platform, return normal Mirror results
    if (!storyMode || !platform) {
      return NextResponse.json(analysis);
    }

    // === STORY MODE: Refine for selected platform ===
    const platformPrompts: Record<string, string> = {
      linkedin: "Rewrite this personal reflection as a professional LinkedIn post. Keep it authentic to the user's voice. Focus on lessons learned, growth, and thought leadership. End with a question or call to reflection. 150-300 words.",
      facebook: "Turn this into a warm, personal Facebook post. Keep the user's authentic tone. Share the emotional journey and insight in a relatable way. Invite friends to connect or share their own stories. 100-250 words.",
      twitter: "Create a punchy X/Twitter thread (2-5 tweets) from this reflection. Make it quotable, emotional, and authentic. Use natural line breaks. Include a powerful hook and ending insight.",
      instagram: "Write an Instagram caption based on this reflection. Make it heartfelt, visual, and authentic. Use line breaks for readability. End with a question or emoji. 100-200 words.",
      email: "Rewrite this as a personal email to a friend or group. Keep the user's voice warm and direct. Share the story and insight naturally. Include a gentle closing invitation to respond.",
      medium: "Expand this reflection into a Medium-style personal essay (400-600 words). Keep the user's authentic voice. Structure: hook → story → lesson → reflection. Use subheadings if helpful."
    };

    const refinePrompt = platformPrompts[platform] || platformPrompts.linkedin;

    const refineMessages = [
      {
        role: 'system',
        content: `You are an expert editor who helps people share their stories authentically. Preserve the user's unique voice, tone, and personality — never make it sound generic or corporate. Focus on metered vulnerability: share enough to connect, but protect privacy.`
      },
      { role: 'user', content: `Original reflection:\n\n${text}\n\nPastoral insight: ${analysis.pastoral_reflection}\n\n${refinePrompt}` }
    ];

    const refineResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: refineMessages,
        temperature: 0.8,
        max_tokens: 1200,
      }),
    });

    if (!refineResponse.ok) {
      console.error('Refinement failed');
      // Still return base analysis even if refinement fails
      return NextResponse.json(analysis);
    }

    const refineData = await refineResponse.json();
    const refinedContent = refineData.choices[0]?.message?.content?.trim() || "";

    return NextResponse.json({
      ...analysis,
      refined_story: refinedContent
    });

  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
