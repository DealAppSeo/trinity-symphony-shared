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
  const [results, setResults] = useState<{
    archetype: string
    iq_score: number
    eq_score: number
    sq_score: number
    pastoral_reflection: string
    refined_story?: string
  } | null>(null)
  const [storyMode, setStoryMode] = useState(false)
  const [selectedPlatform, setSelectedPlatform] = useState("")
  const [error, setError] = useState<string | null>(null)

  const charCount = text.length
  const minChars = 100
  const isValid = charCount >= minChars

  const platforms = [
    "linkedin", "facebook", "twitter", "instagram", "email", "medium"
  ]

  const platformLabels = {
    linkedin: "LinkedIn (Professional, thought leadership)",
    facebook: "Facebook (Personal, warm reflection)",
    twitter: "X/Twitter (Punchy, quotable)",
    instagram: "Instagram (Caption-ready, visual hook)",
    email: "Email (Direct, personal)",
    medium: "Medium (Long-form narrative)",
  }

  const handleAnalyze = async () => {
    if (!isValid) return

    setIsLoading(true)
    setResults(null)
    setError(null)

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, storyMode, platform: selectedPlatform || null }),
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(errText || "Server error")
      }

      const data = await response.json()

      if (data.error) throw new Error(data.error)

      setResults(data)
    } catch (err: any) {
      setError("Analysis temporarily unavailable – try again soon (free AI rate limit).")
    } finally {
      setIsLoading(false)
    }
  }

  const handleAnalyzeAgain = () => {
    setResults(null)
    setError(null)
    setText("")
    setStoryMode(false)
    setSelectedPlatform("")
  }

  const handleExampleClick = (example: string) => {
    const examples = {
      LinkedIn: "Passionate software engineer with 10+ years...",
      Dating: "I'm an adventurous soul who loves hiking...",
      Email: "Hi team, I wanted to follow up on the project...",
    }
    setText(examples[example as keyof typeof examples] || "")
  }

  return (
    <>
      {/* ... same header, mirror emoji, headline, badges, textarea, char counter, privacy note ... */}

      {/* Story Mode Toggle - above button */}
      <div className="flex items-center justify-center gap-4 my-6">
        <label className="text-lg font-medium">Story Mode (Journal → Shareable Story):</label>
        <Button
          variant={storyMode ? "default" : "outline"}
          onClick={() => setStoryMode(!storyMode)}
        >
          {storyMode ? "On" : "Off"}
        </Button>
      </div>

      {error && (
        <motion.div className="text-red-400 text-center text-lg font-medium px-4">
          {error}
        </motion.div>
      )}

      {/* Button same */}

      {/* Results */}
      {results && (
        <div className="mt-12 lg:mt-16">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-white/[0.03] ... p-8 space-y-8 max-w-4xl mx-auto">
              <h2 className="text-3xl lg:text-4xl font-bold text-center">Your AI Mirror</h2>

              {/* Scores & progress bars same */}

              <div className="space-y-4">
                <h3 className="text-2xl font-bold text-center text-amber-300">Pastoral Reflection</h3>
                <p className="text-lg italic text-center text-zinc-300 max-w-3xl mx-auto">
                  {results.pastoral_reflection}
                </p>
              </div>

              {storyMode && (
                <div className="space-y-6">
                  <p className="text-xl text-center">Who needs to hear this?</p>
                  <select
                    value={selectedPlatform}
                    onChange={(e) => {
                      setSelectedPlatform(e.target.value)
                      if (e.target.value) handleAnalyze() // Re-call API for refinement
                    }}
                    className="w-full max-w-md mx-auto bg-zinc-800 text-white rounded-lg p-4 text-lg"
                  >
                    <option value="">Choose a platform...</option>
                    {platforms.map((p) => (
                      <option key={p} value={p}>{platformLabels[p]}</option>
                    ))}
                  </select>

                  {results.refined_story && (
                    <>
                      <h3 className="text-2xl font-bold text-center text-violet-300">
                        Refined for {platformLabels[selectedPlatform]}
                      </h3>
                      <Card className="bg-zinc-800/50 p-6">
                        <p className="whitespace-pre-wrap text-lg text-zinc-100">{results.refined_story}</p>
                      </Card>
                      <Button
                        onClick={() => navigator.clipboard.writeText(results.refined_story || "")}
                        className="w-full max-w-md mx-auto"
                      >
                        Copy & Share 🎄
                      </Button>
                    </>
                  )}
                </div>
              )}

              <Button onClick={handleAnalyzeAgain} className="w-full max-w-md mx-auto">
                Analyze Again
              </Button>
            </Card>
          </motion.div>
        </div>
      )}
    </>
  )
}
