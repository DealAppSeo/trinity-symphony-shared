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
    // Simulate analysis
    await new Promise((resolve) => setTimeout(resolve, 2000))
    setIsLoading(false)
  }

  const handleExampleClick = (example: string) => {
    const examples = {
      LinkedIn:
        "Passionate software engineer with 10+ years of experience building scalable web applications. I thrive on solving complex problems and mentoring junior developers. Always learning, always growing.",
      Dating:
        "I'm an adventurous soul who loves hiking on weekends and trying new coffee shops. I value deep conversations over small talk and believe in kindness above all else. Looking for someone who shares my curiosity about the world.",
      Email:
        "Hi team, I wanted to follow up on the project timeline we discussed last week. I think we should prioritize the user authentication feature first, as it blocks several other tasks. Let me know your thoughts!",
    }
    setText(examples[example as keyof typeof examples] || "")
  }

  return (
    <>
      {/* Skip to main content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-violet-500 focus:text-white focus:rounded-lg"
      >
        Skip to main content
      </a>

      <main
        id="main-content"
        className="min-h-screen bg-zinc-950 text-white px-4 py-8 lg:py-12 pb-safe"
        aria-label="AISocialMirror landing page"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-7xl mx-auto"
        >
          {/* Mobile-first single column, desktop two-column */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:items-start">
            {/* Left Column - Main Content */}
            <div className="space-y-8">
              {/* Hero Section */}
              <div className="text-center lg:text-left space-y-6">
                <motion.div
                  className="text-7xl lg:text-8xl animate-float animate-pulse-subtle inline-block"
                  aria-label="Mirror emoji"
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  transition={{
                    duration: 0.5,
                    type: "spring",
                    stiffness: 200,
                  }}
                >
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

              {/* Score Preview Badges */}
              <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="bg-green-500/10 border border-green-500/20 rounded-full px-4 py-2 flex items-center gap-2 min-h-[48px]"
                >
                  <span className="text-xl" aria-hidden="true">
                    🧠
                  </span>
                  <span className="text-sm font-medium text-green-400">IQ Score</span>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2 flex items-center gap-2 min-h-[48px]"
                >
                  <span className="text-xl" aria-hidden="true">
                    💛
                  </span>
                  <span className="text-sm font-medium text-amber-400">EQ Score</span>
                </motion.div>

                <motion.div
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.98 }}
                  className="bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-2 flex items-center gap-2 min-h-[48px]"
                >
                  <span className="text-xl" aria-hidden="true">
                    ✨
                  </span>
                  <span className="text-sm font-medium text-blue-400">SQ Score</span>
                </motion.div>
              </div>

              {/* Input Card with Glass Effect */}
              <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-4">
                <div className="space-y-2">
                  <label htmlFor="text-input" className="sr-only">
                    Enter your text for analysis
                  </label>
                  <textarea
                    id="text-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Paste a tweet, LinkedIn bio, email, or any text you've written..."
                    className="w-full min-h-[160px] lg:min-h-[200px] bg-white/[0.02] border border-white/[0.08] rounded-xl px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
                    aria-describedby="char-counter privacy-note"
                  />
                </div>

                {/* Character Counter */}
                <div
                  id="char-counter"
                  className={`text-sm ${isValid ? "text-green-400" : "text-zinc-500"}`}
                  aria-live="polite"
                >
                  {charCount} / {minChars} minimum
                </div>

                {/* Privacy Note */}
                <div id="privacy-note" className="flex items-center gap-2 text-sm text-zinc-400">
                  <span aria-hidden="true">🔒</span>
                  <span>Your text is analyzed but never stored</span>
                </div>
              </Card>

              {/* Primary CTA Button - Sticky on mobile */}
              <div className="sticky bottom-4 lg:static">
                <motion.div
                  whileTap={{ scale: isValid && !isLoading ? 0.98 : 1 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <Button
                    onClick={handleAnalyze}
                    disabled={!isValid || isLoading}
                    className="w-full h-14 min-h-[48px] bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white font-semibold text-lg rounded-xl disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/25 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                    aria-label={isLoading ? "Analyzing your text" : "Reveal my mirror"}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                        Analyzing...
                      </>
                    ) : (
                      <>Reveal My Mirror →</>
                    )}
                  </Button>
                </motion.div>
              </div>

              {/* Social Proof Footer */}
              <div className="text-center lg:text-left">
                <p className="text-sm text-zinc-500">Join 12,847+ people who've discovered their reflection</p>
              </div>
            </div>

            {/* Right Column - Desktop Only */}
            <div className="hidden lg:block space-y-8 lg:sticky lg:top-12">
              {/* What You'll Discover Section */}
              <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-6">
                <h2 className="font-heading text-2xl font-bold">What You'll Discover</h2>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" aria-hidden="true">
                        🧠
                      </span>
                      <h3 className="font-semibold text-lg">IQ - Intellectual Quotient</h3>
                    </div>
                    <p className="text-sm text-zinc-400 text-pretty">
                      Measures your cognitive abilities, reasoning, and problem-solving reflected in your writing style.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" aria-hidden="true">
                        💛
                      </span>
                      <h3 className="font-semibold text-lg">EQ - Emotional Quotient</h3>
                    </div>
                    <p className="text-sm text-zinc-400 text-pretty">
                      Analyzes your empathy, emotional awareness, and interpersonal communication patterns.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl" aria-hidden="true">
                        ✨
                      </span>
                      <h3 className="font-semibold text-lg">SQ - Social Quotient</h3>
                    </div>
                    <p className="text-sm text-zinc-400 text-pretty">
                      Evaluates your social intelligence, communication effectiveness, and relationship-building skills.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Example Use Cases */}
              <div className="space-y-4">
                <h3 className="font-heading text-lg font-semibold">Try an example:</h3>
                <div className="flex flex-wrap gap-3">
                  {["LinkedIn", "Dating", "Email"].map((example) => (
                    <motion.button
                      key={example}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleExampleClick(example)}
                      className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 min-h-[48px]"
                      aria-label={`Try ${example} example`}
                    >
                      {example}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* QR Code Component */}
              <QRCodeComponent />
            </div>
          </div>
        </motion.div>
      </main>
    </>
  )
}
