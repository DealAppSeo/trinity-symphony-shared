"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Loader2, Brain, Heart, Sparkles, CheckCircle, AlertCircle, MessageCircle } from "lucide-react"
import { QRCodeComponent } from "@/components/qr-code"

// Types for analysis results
interface ScoreResult {
  score: number
  confidence: number
  strengths: string[]
  growth_edges: string[]
  insight: string
}

interface AnalysisResult {
  iq: ScoreResult
  eq: ScoreResult
  sq: ScoreResult
  overall_reflection: string
  who_needs_to_hear_this: string
}

interface EngagementQuestion {
  question: string
  purpose: string
}

// Analysis states for UX
type AnalysisState = 
  | 'idle' 
  | 'thinking' 
  | 'engaging' 
  | 'analyzing' 
  | 'verifying' 
  | 'complete' 
  | 'error'

export default function Home() {
  // Input state
  const [text, setText] = useState("")
  const [storyMode, setStoryMode] = useState(false)
  
  // Analysis state
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle')
  const [engagement, setEngagement] = useState<EngagementQuestion | null>(null)
  const [engagementAnswer, setEngagementAnswer] = useState("")
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<any>(null)
  
  // Validation
  const charCount = text.length
  const minChars = 100
  const isValid = charCount >= minChars

  // Status messages for each state
  const statusMessages: Record<AnalysisState, string> = {
    idle: '',
    thinking: 'Reflecting on what you shared...',
    engaging: 'One moment...',
    analyzing: 'Looking deeper into your words...',
    verifying: 'Checking my analysis for accuracy...',
    complete: 'Your reflection is ready',
    error: 'Something went wrong'
  }

  const handleAnalyze = async () => {
    if (!isValid) return
    
    setAnalysisState('thinking')
    setResult(null)
    setError(null)
    setEngagement(null)
    
    try {
      // Simulate initial thinking (gives time for UI to respond)
      await new Promise(resolve => setTimeout(resolve, 800))
      
      setAnalysisState('analyzing')
      
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text, 
          mode: 'mirror',
          storyMode 
        })
      })
      
      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed')
      }
      
      // If there's an engagement question, show it
      if (data.engagement) {
        setEngagement(data.engagement)
        setAnalysisState('engaging')
        // Continue to show results after a moment
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
      
      // Show verifying state if confidence is being checked
      if (data.meta?.avgConfidence < 0.8) {
        setAnalysisState('verifying')
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      
      setResult(data.analysis)
      setMeta(data.meta)
      setAnalysisState('complete')
      
    } catch (err) {
      console.error('Analysis error:', err)
      setError(err instanceof Error ? err.message : 'Analysis failed')
      setAnalysisState('error')
    }
  }

  const handleExampleClick = (example: string) => {
    const examples: Record<string, string> = {
      LinkedIn: "Passionate software engineer with 10+ years of experience building scalable web applications. I thrive on solving complex problems and mentoring junior developers. My approach combines technical excellence with genuine care for the people I work with. Always learning, always growing, always looking for ways to help others succeed.",
      Dating: "I'm an adventurous soul who loves hiking on weekends and trying new coffee shops. I value deep conversations over small talk and believe in kindness above all else. Looking for someone who shares my curiosity about the world and isn't afraid to be vulnerable. Life's too short for surface-level connections.",
      Email: "Hi team, I wanted to follow up on the project timeline we discussed last week. I think we should prioritize the user authentication feature first, as it blocks several other tasks. I've been thinking about this a lot, and I believe if we focus our energy here, we'll unlock momentum for everything else. Let me know your thoughts - I'm open to other perspectives!",
    }
    setText(examples[example] || "")
  }

  const resetAnalysis = () => {
    setAnalysisState('idle')
    setResult(null)
    setError(null)
    setEngagement(null)
    setMeta(null)
  }

  // Render score card
  const renderScoreCard = (
    type: 'iq' | 'eq' | 'sq',
    data: ScoreResult,
    icon: React.ReactNode,
    color: string,
    label: string
  ) => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: type === 'iq' ? 0.1 : type === 'eq' ? 0.2 : 0.3 }}
    >
      <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${color} rounded-lg`}>
              {icon}
            </div>
            <h3 className="font-semibold text-lg">{label}</h3>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{data.score}</div>
            <div className="text-xs text-zinc-500">
              {Math.round(data.confidence * 100)}% confident
            </div>
          </div>
        </div>
        
        <p className="text-sm text-zinc-300">{data.insight}</p>
        
        {data.strengths.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-green-400 font-medium">Strengths</div>
            <div className="flex flex-wrap gap-2">
              {data.strengths.map((s, i) => (
                <span key={i} className="text-xs bg-green-500/10 text-green-400 px-2 py-1 rounded">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {data.growth_edges.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-amber-400 font-medium">Growth Edges</div>
            <div className="flex flex-wrap gap-2">
              {data.growth_edges.map((g, i) => (
                <span key={i} className="text-xs bg-amber-500/10 text-amber-400 px-2 py-1 rounded">
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>
    </motion.div>
  )

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-violet-500 focus:text-white focus:rounded-lg"
      >
        Skip to main content
      </a>

      <main
        id="main-content"
        className="min-h-screen bg-zinc-950 text-white px-4 py-8 lg:py-12 pb-safe"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-7xl mx-auto"
        >
          <div className="lg:grid lg:grid-cols-2 lg:gap-12 lg:items-start">
            {/* Left Column - Input or Results */}
            <div className="space-y-8">
              {/* Hero */}
              <div className="text-center lg:text-left space-y-6">
                <motion.div
                  className="text-7xl lg:text-8xl inline-block"
                  animate={{ 
                    scale: analysisState === 'idle' ? [1, 1.05, 1] : 1,
                    rotate: analysisState === 'analyzing' ? [0, 5, -5, 0] : 0
                  }}
                  transition={{ 
                    duration: 2, 
                    repeat: analysisState === 'idle' ? Infinity : 0,
                    repeatDelay: 3
                  }}
                >
                  🪞
                </motion.div>

                <div className="space-y-3">
                  <h1 className="font-heading text-4xl lg:text-5xl xl:text-6xl font-bold text-balance leading-tight">
                    {result ? 'Your Reflection' : 'What does AI see when you write?'}
                  </h1>
                  <p className="text-lg lg:text-xl text-zinc-400 text-pretty">
                    {result 
                      ? 'Here\'s what your words reveal about you'
                      : 'Paste any text. Discover your IQ, EQ, and SQ scores in seconds.'
                    }
                  </p>
                </div>
              </div>

              {/* Status indicator during analysis */}
              <AnimatePresence mode="wait">
                {analysisState !== 'idle' && analysisState !== 'complete' && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="flex items-center justify-center lg:justify-start gap-3 py-4"
                  >
                    {analysisState === 'error' ? (
                      <AlertCircle className="w-5 h-5 text-red-400" />
                    ) : (
                      <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                    )}
                    <span className={`text-lg ${analysisState === 'error' ? 'text-red-400' : 'text-violet-400'}`}>
                      {statusMessages[analysisState]}
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Engagement Question */}
              <AnimatePresence>
                {engagement && analysisState === 'engaging' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                  >
                    <Card className="bg-violet-500/10 border-violet-500/20 rounded-xl p-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <MessageCircle className="w-5 h-5 text-violet-400 mt-0.5" />
                        <div className="space-y-2">
                          <p className="text-violet-200">{engagement.question}</p>
                          <p className="text-xs text-violet-400">{engagement.purpose}</p>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Results Display */}
              <AnimatePresence mode="wait">
                {result && analysisState === 'complete' ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-6"
                  >
                    {/* Overall Reflection */}
                    <Card className="bg-gradient-to-br from-violet-500/10 to-blue-500/10 border-violet-500/20 rounded-xl p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        <span className="text-sm text-green-400">Analysis Complete</span>
                        {meta?.avgConfidence && (
                          <span className="text-xs text-zinc-500 ml-auto">
                            {Math.round(meta.avgConfidence * 100)}% confidence
                          </span>
                        )}
                      </div>
                      <p className="text-lg text-zinc-200 leading-relaxed">
                        {result.overall_reflection}
                      </p>
                      {result.who_needs_to_hear_this && (
                        <p className="text-sm text-violet-400 italic">
                          💡 {result.who_needs_to_hear_this}
                        </p>
                      )}
                    </Card>

                    {/* Score Cards */}
                    <div className="grid gap-4">
                      {renderScoreCard(
                        'iq',
                        result.iq,
                        <Brain className="w-5 h-5 text-green-400" />,
                        'bg-green-500/10',
                        'IQ Mirror'
                      )}
                      {renderScoreCard(
                        'eq',
                        result.eq,
                        <Heart className="w-5 h-5 text-amber-400" />,
                        'bg-amber-500/10',
                        'EQ Mirror'
                      )}
                      {renderScoreCard(
                        'sq',
                        result.sq,
                        <Sparkles className="w-5 h-5 text-blue-400" />,
                        'bg-blue-500/10',
                        'SQ Mirror'
                      )}
                    </div>

                    {/* Meta info */}
                    {meta && (
                      <div className="text-xs text-zinc-600 text-center space-x-4">
                        <span>Processed by {meta.processedBy}</span>
                        <span>•</span>
                        <span>{meta.latencyMs}ms</span>
                        <span>•</span>
                        <span>Provider: {meta.provider}</span>
                        {meta.fromCache && <span className="text-violet-500">• Cached</span>}
                      </div>
                    )}

                    {/* Try Again Button */}
                    <Button
                      onClick={resetAnalysis}
                      variant="outline"
                      className="w-full border-zinc-700 hover:bg-zinc-800"
                    >
                      Analyze Different Text
                    </Button>
                  </motion.div>
                ) : analysisState === 'idle' || analysisState === 'error' ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="space-y-6"
                  >
                    {/* Score Preview Badges */}
                    <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                      <div className="bg-green-500/10 border border-green-500/20 rounded-full px-4 py-2 flex items-center gap-2 min-h-[48px]">
                        <span className="text-xl">🧠</span>
                        <span className="text-sm font-medium text-green-400">IQ Score</span>
                      </div>
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2 flex items-center gap-2 min-h-[48px]">
                        <span className="text-xl">💛</span>
                        <span className="text-sm font-medium text-amber-400">EQ Score</span>
                      </div>
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-full px-4 py-2 flex items-center gap-2 min-h-[48px]">
                        <span className="text-xl">✨</span>
                        <span className="text-sm font-medium text-blue-400">SQ Score</span>
                      </div>
                    </div>

                    {/* Input Card */}
                    <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-4">
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Paste a tweet, LinkedIn bio, email, or any text you've written..."
                        className="w-full min-h-[160px] lg:min-h-[200px] bg-white/[0.02] border border-white/[0.08] rounded-xl px-4 py-3 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
                      />
                      
                      <div className={`text-sm ${isValid ? "text-green-400" : "text-zinc-500"}`}>
                        {charCount} / {minChars} minimum
                      </div>

                      <div className="flex items-center gap-2 text-sm text-zinc-400">
                        <span>🔒</span>
                        <span>Your text is analyzed but never stored</span>
                      </div>
                    </Card>

                    {/* Error Display */}
                    {error && (
                      <Card className="bg-red-500/10 border-red-500/20 rounded-xl p-4">
                        <div className="flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-red-400" />
                          <p className="text-red-400">{error}</p>
                        </div>
                      </Card>
                    )}

                    {/* Story Mode Toggle */}
                    <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-xl p-5">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <h3 className="font-semibold">Story Mode</h3>
                          <p className="text-sm text-zinc-400">Transform your text for metered sharing</p>
                        </div>
                        <button
                          onClick={() => setStoryMode(!storyMode)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            storyMode ? "bg-violet-500" : "bg-zinc-700"
                          }`}
                          role="switch"
                          aria-checked={storyMode}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              storyMode ? "translate-x-6" : "translate-x-1"
                            }`}
                          />
                        </button>
                      </div>
                    </Card>

                    {/* Primary CTA */}
                    <div className="sticky bottom-4 lg:static">
                      <Button
                        onClick={handleAnalyze}
                        disabled={!isValid || (analysisState !== 'idle' && analysisState !== 'error')}
                        className="w-full h-14 bg-gradient-to-r from-violet-500 to-violet-600 hover:from-violet-600 hover:to-violet-700 text-white font-semibold text-lg rounded-xl disabled:opacity-50 shadow-lg shadow-violet-500/25"
                      >
                        Reveal My Mirror →
                      </Button>
                    </div>

                    <p className="text-sm text-zinc-500 text-center lg:text-left">
                      Join 12,847+ people who've discovered their reflection
                    </p>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            {/* Right Column - Desktop Only */}
            <div className="hidden lg:block space-y-8 lg:sticky lg:top-12">
              <Card className="bg-white/[0.03] backdrop-blur-xl border-white/[0.08] rounded-2xl p-6 space-y-6">
                <h2 className="font-heading text-2xl font-bold">What You'll Discover</h2>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🧠</span>
                      <h3 className="font-semibold text-lg">IQ - Intellectual Quotient</h3>
                    </div>
                    <p className="text-sm text-zinc-400">
                      Measures your cognitive abilities, reasoning, and problem-solving reflected in your writing.
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
                      <h3 className="font-semibold text-lg">SQ - Spiritual Quotient</h3>
                    </div>
                    <p className="text-sm text-zinc-400">
                      Evaluates your sense of purpose, values alignment, and inspirational voice.
                    </p>
                  </div>
                </div>
              </Card>

              {/* Example Use Cases */}
              <div className="space-y-4">
                <h3 className="font-heading text-lg font-semibold">Try an example:</h3>
                <div className="flex flex-wrap gap-3">
                  {["LinkedIn", "Dating", "Email"].map((example) => (
                    <button
                      key={example}
                      onClick={() => handleExampleClick(example)}
                      className="bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] rounded-full px-4 py-2 text-sm font-medium transition-colors min-h-[48px]"
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
    </>
  )
}
