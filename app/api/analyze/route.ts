import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || text.length < 100) {
      return NextResponse.json(
        { error: 'Please provide at least 100 characters of text.' },
        { status: 400 }
      );
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
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
          {
            role: 'user',
            content: text
          }
        ],
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
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return NextResponse.json(
        { error: 'No analysis generated.' },
        { status: 500 }
      );
    }

    const analysis = JSON.parse(content);

    return NextResponse.json(analysis);

  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
