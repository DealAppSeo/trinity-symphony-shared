import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { text, mode } = await request.json()

    if (!text || text.length < 100) {
      return NextResponse.json(
        { error: "Text must be at least 100 characters" },
        { status: 400 }
      )
    }

    // Call Trinity Symphony
    const trinityResponse = await fetch(
      "https://mcp-production-d0c6.up.railway.app/analyze",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          text, 
          sharingLevel: mode || "journal" 
        }),
      }
    )

    if (!trinityResponse.ok) {
      throw new Error(`Trinity Symphony error: ${trinityResponse.status}`)
    }

    const analysis = await trinityResponse.json()

    // Map Trinity response to frontend expected format
    return NextResponse.json({
      iq: {
        score: analysis.iq?.score || 70,
        color: "green",
        icon: "🧠",
        description: analysis.iq?.description || "",
        strengths: analysis.iq?.strengths || [],
        growthEdge: analysis.iq?.growthEdge || "",
      },
      eq: {
        score: analysis.eq?.score || 70,
        color: "red", 
        icon: "❤️",
        description: analysis.eq?.description || "",
        strengths: analysis.eq?.strengths || [],
        growthEdge: analysis.eq?.growthEdge || "",
      },
      sq: {
        score: analysis.sq?.score || 70,
        color: "amber",
        icon: "✨",
        description: analysis.sq?.description || "",
        strengths: analysis.sq?.strengths || [],
        growthEdge: analysis.sq?.growthEdge || "",
      },
      summary: analysis.summary || "",
      encouragement: analysis.encouragement || analysis.insight || "",
      mode,
    })

  } catch (error) {
    console.error("[API] Error in analyze:", error)
    return NextResponse.json(
      { error: "Failed to analyze text" },
      { status: 500 }
    )
  }
}
