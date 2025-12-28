"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { ArrowLeft, Share2, Twitter, Linkedin, MessageCircle, Copy, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Toaster } from "@/components/ui/toaster"

// Default fallback data
const defaultResults = {
  archetype: {
    emoji: "💜",
    name: "Reflective Soul",
    match: 75,
    description: "Your analysis is being processed...",
  },
  scores: {
    iq: { value: 70, label: "Analytical Intelligence", color: "green" },
    eq: { value: 70, label: "Emotional Intelligence", color: "amber" },
    sq: { value: 70, label: "Spiritual Intelligence", color: "blue" },
  },
  blindSpot: {
    trait: "Still Discovering",
    insight: "Your reflection is being prepared with care...",
    evidence: "",
  },
  habit: {
    trigger: "notice something about yourself",
    action: "take a moment to reflect on it",
  },
}

export default function ResultsPage() {
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [results, setResults] = useState(defaultResults)
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    // Read analysis results from sessionStorage
    if (typeof window !== "undefined") {
      const stored = sessionStorage.getItem("analysisResults")
      if (stored) {
        try {
          const data = JSON.parse(stored)
          
          // Map API response to display format
          const mappedResults = {
            archetype: {
              emoji: data.mirrorType?.emoji || "💜",
              name: data.mirrorType?.name || "Thoughtful Mind",
              match: Math.round((data.iq?.score + data.eq?.score + data.sq?.score) / 3) || 75,
              description: data.mirrorType?.description || data.summary || "A unique blend of qualities.",
            },
            scores: {
              iq: { 
                value: data.iq?.score || 70, 
                label: "Analytical Intelligence", 
                color: "green" as const 
              },
              eq: { 
                value: data.eq?.score || 70, 
                label: "Emotional Intelligence", 
                color: "amber" as const 
              },
              sq: { 
                value: data.sq?.score || 70, 
                label: "Spiritual Intelligence", 
                color: "blue" as const 
              },
            },
            blindSpot: {
              trait: data.quickInsights?.quickInsights?.[0] || data.insight || "Hidden Depth",
              insight: data.analysis || data.insight || "There's more beneath the surface worth exploring.",
              evidence: data.engagementQuestion || "",
            },
            habit: {
              trigger: "reflect on your writing",
              action: data.closing || "consider what it reveals about your growth",
            },
          }
          
          setResults(mappedResults)
        } catch (e) {
          console.error("Failed to parse results:", e)
        }
      }
      setIsLoading(false)
    }
  }, [])

  const handleShare = () => {
    setShareModalOpen(true)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href)
    toast({
      title: "Link copied!",
      description: "Share link copied to clipboard",
    })
  }

  const handleSharePlatform = (platform: string) => {
    const text = `I just discovered my AI personality: ${results.archetype.name}! 💫`
    const url = window.location.href

    const urls: Record<string, string> = {
      twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
      whatsapp: `https://wa.me/?text=${encodeURIComponent(text + " " + url)}`,
    }

    if (urls[platform]) {
      window.open(urls[platform], "_blank")
    }
  }

  const handleBack = () => {
    window.location.href = "/"
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-6xl animate-pulse">🪞</div>
          <p className="text-zinc-400">Preparing your reflection...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <Toaster />

      {/* Header */}
      <motion.header
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-4 bg-zinc-950/80 backdrop-blur-xl border-b border-white/[0.08]"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={handleShare}>
          <Share2 className="h-4 w-4" />
        </Button>
      </motion.header>

      {/* Main Content */}
      <main className="px-4 pt-20 pb-32 max-w-7xl mx-auto">
        <div className="lg:grid lg:grid-cols-2 lg:gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Archetype Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <p className="text-zinc-400 text-sm mb-4">You have the energy of a...</p>
              <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 space-y-4">
                <div className="text-6xl text-center">{results.archetype.emoji}</div>
                <div className="text-center space-y-2">
                  <h1 className="text-2xl font-bold">{results.archetype.name}</h1>
                  <p className="text-violet-400 font-medium">{results.archetype.match}% match</p>
                </div>
                <p className="text-zinc-300 text-center leading-relaxed">{results.archetype.description}</p>
              </div>
            </motion.div>

            {/* Scores Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              <h2 className="text-sm font-semibold text-zinc-400 mb-4 tracking-wider">YOUR QUOTIENTS</h2>
              <div className="space-y-4">
                <ScoreBar
                  icon="🧠"
                  label={results.scores.iq.label}
                  value={results.scores.iq.value}
                  color="green"
                  delay={0}
                />
                <ScoreBar
                  icon="💝"
                  label={results.scores.eq.label}
                  value={results.scores.eq.value}
                  color="amber"
                  delay={0.2}
                />
                <ScoreBar
                  icon="🤝"
                  label={results.scores.sq.label}
                  value={results.scores.sq.value}
                  color="blue"
                  delay={0.4}
                />
              </div>
            </motion.div>
          </div>

          {/* Right Column */}
          <div className="space-y-6 mt-6 lg:mt-0">
            {/* Blind Spot Card */}
            <motion.div
              className="bg-white/[0.03] backdrop-blur-xl border-l-2 border-l-rose-500/50 border-r border-r-white/[0.08] border-t border-t-white/[0.08] border-b border-b-white/[0.08] rounded-2xl p-6 space-y-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <span>👁️</span>
                <span>WHAT YOU MIGHT NOT SEE</span>
              </div>
              <h3 className="text-xl font-bold">{results.blindSpot.trait}</h3>
              <p className="text-zinc-300 leading-relaxed">{results.blindSpot.insight}</p>
              {results.blindSpot.evidence && (
                <p className="text-zinc-400 italic text-sm">"{results.blindSpot.evidence}"</p>
              )}
            </motion.div>

            {/* Tiny Habits Card */}
            <motion.div
              className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 space-y-4"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.8 }}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
                <span>🌱</span>
                <span>ONE TINY SHIFT</span>
              </div>
              <p className="text-zinc-300 leading-relaxed">
                After I <span className="text-violet-400 font-medium">{results.habit.trigger}</span>, I will{" "}
                <span className="text-violet-400 font-medium">{results.habit.action}</span>.
              </p>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  className="w-5 h-5 rounded border-2 border-white/20 bg-transparent checked:bg-violet-500 checked:border-violet-500 transition-all cursor-pointer"
                />
                <span className="text-sm text-zinc-400 group-hover:text-zinc-300 transition-colors">
                  I'll try this today
                </span>
              </label>
            </motion.div>
          </div>
        </div>
      </main>

      {/* Sticky Bottom Bar */}
      <motion.div
        className="fixed bottom-0 left-0 right-0 p-4 bg-zinc-950/90 backdrop-blur-xl border-t border-white/[0.08]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1 }}
      >
        <div className="max-w-7xl mx-auto flex gap-3">
          <Button className="flex-1 bg-violet-500 hover:bg-violet-600 text-white font-medium">
            Do friends agree? 🤔
          </Button>
          <Button
            variant="outline"
            className="flex-1 bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08] text-white font-medium"
            onClick={handleShare}
          >
            Share Results 📤
          </Button>
        </div>
      </motion.div>

      {/* Share Modal */}
      <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
        <DialogContent className="bg-zinc-900 border-white/[0.08] text-white max-w-md">
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Share Your Results</h2>

            <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 space-y-4">
              <div className="text-center space-y-2">
                <div className="text-4xl">{results.archetype.emoji}</div>
                <h3 className="text-lg font-bold">{results.archetype.name}</h3>
                <p className="text-violet-400 text-sm">{results.archetype.match}% match</p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">IQ</span>
                  <span className="text-green-500 font-medium">{results.scores.iq.value}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">EQ</span>
                  <span className="text-amber-500 font-medium">{results.scores.eq.value}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">SQ</span>
                  <span className="text-blue-500 font-medium">{results.scores.sq.value}%</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08]"
                onClick={() => handleSharePlatform("twitter")}
              >
                <Twitter className="mr-2 h-4 w-4" />
                Twitter
              </Button>
              <Button
                variant="outline"
                className="bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08]"
                onClick={() => handleSharePlatform("linkedin")}
              >
                <Linkedin className="mr-2 h-4 w-4" />
                LinkedIn
              </Button>
              <Button
                variant="outline"
                className="bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08]"
                onClick={() => handleSharePlatform("whatsapp")}
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                WhatsApp
              </Button>
              <Button
                variant="outline"
                className="bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.08]"
                onClick={handleCopyLink}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Link
              </Button>
            </div>

            <Button className="w-full bg-violet-500 hover:bg-violet-600">
              <Download className="mr-2 h-4 w-4" />
              Download Image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ScoreBar({
  icon,
  label,
  value,
  color,
  delay,
}: {
  icon: string
  label: string
  value: number
  color: "green" | "amber" | "blue"
  delay: number
}) {
  const colorClasses = {
    green: "from-green-500 to-emerald-500",
    amber: "from-amber-500 to-orange-500",
    blue: "from-blue-500 to-cyan-500",
  }

  const textColorClasses = {
    green: "text-green-500",
    amber: "text-amber-500",
    blue: "text-blue-500",
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="text-zinc-300">{label}</span>
        </div>
        <motion.span
          className={`font-bold ${textColorClasses[color]}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: delay + 1 }}
        >
          {value}%
        </motion.span>
      </div>
      <div className="h-2 bg-white/[0.05] rounded-full overflow-hidden">
        <motion.div
          className={`h-full bg-gradient-to-r ${colorClasses[color]} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{
            duration: 1.5,
            delay: delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      </div>
    </div>
  )
}
