"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Loader2 } from "lucide-react"
import { QRCodeComponent } from "@/components/qr-code"

export default function Home() {
  const [text, setText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const charCount = text.length
  const isValid = charCount >= 100
  const minChars = 100

  const handleAnalyze = async () => {
    if (!isValid) return
    setIsLoading(true)
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      const data = await response.json()
      if (data.error) {
        alert(data.error)
      } else {
        alert("Your Archetype: " + data.archetype + "\n\nIQ: " + data.iq_score + "/100\nEQ: " + data.eq_score + "/100\nSQ: " + data.sq_score + "/100\n\n" + data.pastoral_reflection)
      }
    } catch (error) {
      alert("Something went wrong. Please try again.")
    }
    setIsLoading(false)
  }

  const handleExampleClick = (example: string) => {
    const examples: Record<string, string> = {
      LinkedIn: "Passionate software engineer with 10+ years of experience building scalable web applications. I thrive on solving complex problems and mentoring junior developers. Always learning, always growing.",
      Dating: "I am an adventurous soul who loves hiking on weekends and trying new coffee shops. I value deep conversations over small talk and believe in kindness above all else. Looking for someone who shares my curiosity about the world.",
      Email: "Hi team, I wanted to follow up on the project timeline we discussed last week. I think we should prioritize the user authentication feature first, as it blocks several other tasks. Let me know your thoughts!",
    }
    setText(examples[example] || "")
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-white px-4 py-8 lg:py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-7xl mx-auto"
      >
        <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:items-start">
          <div className="space-y-8">
            <div className="text-center lg:text-left space-y-6">
              <div className="text-7xl lg:text-8xl inline-block">🪞</div>
              <div className="space-y-3">
                <h1 className="font-heading text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight">
                  What does AI see when you write?
                </h1>
                <p className="text-lg lg:text-xl text-zinc-400">
                  Paste any text. Discover your IQ, EQ, and SQ scores in seconds.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
              <div className="bg-green-500/10 border border-green-500/20 rounded-full px-4 py-2 flex items-center gap-2">
                <span className="text-xl">🧠</span>
                <span className="text-sm font-medium text-green-400">IQ Score</span>
              </div>
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2 flex items-center gap-2">
                <span className="text-xl">💛</span>
                <span className="text-sm font-medium text-amber-400">EQ Score</span>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-2 flex items-center gap-2">
                <span className="text-xl">✨</span>
                <span className="text-sm font-medium text-blue-400">SQ Score</span>
              </div>
            </div>

            <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-4">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste a tweet, LinkedIn bio, email, or any text you have written..."
                className="w-full min-h-[160px] lg:min-h-[200px] bg-white/[0.02] border border-white/[0.08] rounded-xl px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
              <div className={`text-sm ${isValid ? "text-green-400" : "text-zinc-500"}`}>
                {charCount} / {minChars} minimum
              </div>
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <span>🔒</span>
                <span>Your text is analyzed but never stored</span>
              </div>
            </Card>

            <Button
              onClick={handleAnalyze}
              disabled={!isValid || isLoading}
              className="w-full h-14 bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white font-semibold text-lg rounded-xl disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Analyzing...
                </>
              ) : (
                "Reveal My Mirror →"
              )}
            </Button>

            <p className="text-sm text-zinc-500 text-center lg:text-left">
              Join 12,847+ people who have discovered their reflection
            </p>
          </div>

          <div className="hidden lg:block space-y-8 lg:sticky lg:top-12">
            <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-6">
              <h2 className="font-heading text-2xl font-bold">What You will Discover</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🧠</span>
                    <h3 className="font-semibold text-lg">IQ - Intellectual Quotient</h3>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Measures your cognitive abilities, reasoning, and problem-solving reflected in your writing style.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">💛</span>
                    <h3 className="font-semibold text-lg">EQ - Emotional Quotient</h3>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Analyzes your empathy, emotional awareness, and interpersonal communication patterns.
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">✨</span>
                    <h3 className="font-semibold text-lg">SQ - Social Quotient</h3>
                  </div>
                  <p className="text-sm text-zinc-400">
                    Evaluates your social intelligence, communication effectiveness, and relationship-building skills.
                  </p>
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              <h3 className="font-heading text-lg font-semibold">Try an example:</h3>
              <div className="flex flex-wrap gap-3">
                {["LinkedIn", "Dating", "Email"].map((example) => (
                  <button
                    key={example}
                    onClick={() => handleExampleClick(example)}
                    className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-full px-4 py-2 text-sm font-medium"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>

            <QRCodeComponent />
          </div>
        </div>
      </motion.div>
    </main>
  )
}
