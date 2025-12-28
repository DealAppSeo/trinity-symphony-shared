import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { text, mode } = await request.json()

    if (!text || text.length < 100) {
      return NextResponse.json({ error: "Text must be at least 100 characters" }, { status: 400 })
    }

    // TODO: Implement actual AI analysis here
    // This is a placeholder response structure
    const response = {
      iq: {
        score: 85,
        color: "green",
        icon: "🧠",
      },
      eq: {
        score: 92,
        color: "red",
        icon: "❤️",
      },
      sq: {
        score: 88,
        color: "amber",
        icon: "✨",
      },
      strengths: ["Clear logical thinking", "Strong empathy", "Values-driven communication"],
      growthEdges: ["Could be more concise", "Consider your audience perspective"],
      encouragement: "It takes strength to put this into words. Your willingness to be real is rare.",
      summary: "Your writing shows a strong balance between intellect and emotion.",
      mode,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("[v0] Error in analyze API:", error)
    return NextResponse.json({ error: "Failed to analyze text" }, { status: 500 })
  }
}
