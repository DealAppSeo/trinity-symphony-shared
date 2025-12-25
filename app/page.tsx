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
    { value: "linkedin", label: "LinkedIn – Professional & Thought Leadership" },
    { value: "facebook", label: "Facebook – Warm & Personal" },
    { value: "twitter", label: "X/Twitter – Punchy & Quotable" },
    { value: "instagram", label: "Instagram – Caption-Ready" },
    { value: "email", label: "Email – Direct & Personal" },
    { value: "medium", label: "Medium – Long-Form Story" },
  ]

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
      setError("Analysis temporarily unavailable – try again in a few minutes.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleExampleClick = (example: string) => {
    const examples = {
      LinkedIn: "Passionate software engineer with 10+ years of experience building scalable web applications. I thrive on solving complex problems and mentoring junior developers. Always learning, always growing.",
      Dating: "I'm an adventurous soul who loves hiking on weekends and trying new coffee shops. I value deep conversations over small talk and believe in kindness above all else. Looking for someone who shares my curiosity about the world.",
      Email: "Hi team, I wanted to follow up on the project timeline we discussed last week. I think we should prioritize the user authentication feature first, as it blocks several other tasks. Let me know your thoughts!",
    }
    setText(examples[example as keyof typeof examples] || "")
  }

  const handleAnalyzeAgain = () => {
    setResults(null)
    setError(null)
    setText("")
    setStoryMode(false)
    setSelectedPlatform("")
  }

  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-violet-500 focus:text-white focus:rounded-lg">
        Skip to main content
      </a>
      <main id="main-content" className="min-h-screen bg-zinc-950 text-white px-4 py-8 lg:py-12 pb-safe" aria-label="AISocialMirror landing page">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-7xl mx-auto">
          <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:items-start">
            <div className="space-y-8">
              <div className="text-center lg:text-left space-y-6">
                <motion.div className="text-7xl lg:text-8xl animate-float animate-pulse-subtle inline-block" aria-label="Mirror emoji" initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.5, type: "spring", stiffness: 200 }}>
                  🪞
                </motion.div>
                <div className="space-y-3">
                  <h1 className="font-heading text-4xl lg:text-5xl xl:text-6xl font-bold text-balance leading-tight">
                    What does AI see when you write?
                  </h1>
                  <p className="text-lg lg:text-xl text-zinc-400 text-pretty">
                    Paste any text. Discover your IQ, EQ, and SQ scores in seconds.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                {/* IQ, EQ, SQ badges same */}
              </div>

              <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="text-input" className="sr-only">Enter your text for analysis</label>
                  <textarea
                    id="text-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste a tweet, LinkedIn bio, email, or any text you've written..."
                    className="w-full min-h-[160px] lg:min-h-[200px] bg-white/[0.02] border border-white/[0.08] rounded-xl px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
                    aria-describedby="char-counter privacy-note"
                    autoFocus
                  />
                </div>
                <div id="char-counter" className={`text-sm ${isValid ? "text-green-400" : "text-red-400"}`} aria-live="polite">
                  {charCount} / {minChars} minimum
                </div>
                <div id="privacy-note" className="flex items-center gap-2 text-sm text-zinc-400">
                  <span aria-hidden="true">🔒</span>
                  <span>Your text is analyzed but never stored</span>
                </div>
              </Card>

              {/* NEW: Clear, inviting Story Mode toggle */}
              <div className="my-10 text-center">
                <p className="text-xl font-semibold mb-4 text-zinc-200">
                  Want gentle feedback + help turning your reflection into a shareable post?
                </p>
                <div className="flex items-center justify-center gap-6">
                  <span className="text-2xl font-bold">Story Mode</span>
                  <Button
                    variant={storyMode ? "default" : "outline"}
                    size="lg"
                    onClick={() => setStoryMode(!storyMode)}
                    className="px-8 py-6 text-xl"
                  >
                    {storyMode ? "On ✨" : "Off"}
                  </Button>
                </div>
                <p className="text-sm text-zinc-400 mt-4 max-w-md mx-auto">
                  Private journal → Wise pastoral insight → Refined version for social/email (sounds like YOU)
                </p>
              </div>

              {error && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-center text-lg font-medium px-4">
                  {error}
                </motion.div>
              )}

              <div className="sticky bottom-4 lg:static">
                <motion.div whileTap={{ scale: isValid && !isLoading ? 0.98 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 17 }}>
                  <Button
                    onClick={handleAnalyze}
                    disabled={!isValid || isLoading}
                    className="w-full h-14 min-h-[48px] bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white font-semibold text-lg rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/25"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>Reveal My Mirror →</>
                    )}
                  </Button>
                </motion.div>
              </div>

              <div className="text-center lg:text-left">
                <p className="text-sm text-zinc-500">Join 12,847+ people who've discovered their reflection</p>
              </div>
            </div>

            {/* Right column: What You'll Discover, examples, QR — same as before */}

          </div>

          {/* Results Section */}
          {results && (
            <div className="mt-12 lg:mt-16">
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-8 space-y-8 max-w-4xl mx-auto">
                  <h2 className="font-heading text-3xl lg:text-4xl font-bold text-center">Your AI Mirror</h2>
                  <p className="text-xl lg:text-2xl text-center text-violet-400">
                    Archetype: {results.archetype}
                  </p>

                  {/* Scores with progress bars — same as before */}

                  <div className="space-y-4">
                    <h3 className="text-2xl font-bold text-center text-amber-300">Pastoral Reflection</h3>
                    <p className="text-lg lg:text-xl italic text-center text-zinc-300 max-w-3xl mx-auto">
                      {results.pastoral_reflection}
                    </p>
                  </div>

                  {storyMode && (
                    <div className="space-y-8">
                      <p className="text-2xl text-center font-medium">Who needs to hear this?</p>
                      <select
                        value={selectedPlatform}
                        onChange={(e) => {
                          setSelectedPlatform(e.target.value)
                          if (e.target.value) handleAnalyze() // Re-run for refinement
                        }}
                        className="w-full max-w-lg mx-auto bg-zinc-800 text-white rounded-xl p-4 text-lg border border-white/[0.1]"
                      >
                        <option value="">Choose a platform...</option>
                        {platforms.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>

                      {results.refined_story && (
                        <>
                          <h3 className="text-2xl font-bold text-center text-violet-300">
                            Refined for {platforms.find((p) => p.value === selectedPlatform)?.label}
                          </h3>
                          <Card className="bg-zinc-800/60 p-6 border border-white/[0.1]">
                            <p className="whitespace-pre-wrap text-lg leading-relaxed text-zinc-100">{results.refined_story}</p>
                          </Card>
                          <Button
                            onClick={() => navigator.clipboard.writeText(results.refined_story || "")}
                            className="w-full max-w-md mx-auto bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                          >
                            Copy & Share on Christmas 🎄
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  <Button onClick={handleAnalyzeAgain} variant="outline" className="w-full max-w-md mx-auto">
                    Start Over
                  </Button>
                </Card>
              </motion.div>
            </div>
          )}
        </motion.div>
      </main>
    </>
  )
}
