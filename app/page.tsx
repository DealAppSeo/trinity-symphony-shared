'use client';

import { useState, useEffect } from 'react';

// ============================================
// AISOCIALMIRROR - PROGRESSIVE VULNERABILITY
// A healing journey, not a broadcast tool
// ============================================

// The Sharing Ladder - graduated progression
const SHARING_LEVELS = {
  reflect: {
    id: 'reflect',
    icon: '🪞',
    label: 'Reflect',
    description: 'Just for me',
    color: 'purple',
    placeholder: "Write freely. No one will see this but you. Be honest with yourself. What's really going on?",
    prompt: 'private_reflection'
  },
  understand: {
    id: 'understand',
    icon: '💭',
    label: 'Understand',
    description: 'Get AI insight',
    color: 'blue',
    placeholder: "Share what you're processing. I'll help you see patterns, understand your feelings, and reflect back what I notice...",
    prompt: 'ai_insight'
  },
  onepessoa: {
    id: 'one',
    icon: '💌',
    label: 'Share with One',
    description: 'A trusted person',
    color: 'teal',
    placeholder: "Who needs to hear this? A friend, family member, therapist? I'll help you find the right words...",
    prompt: 'share_one'
  },
  circle: {
    id: 'circle',
    icon: '🤝',
    label: 'Share with Circle',
    description: 'Close friends/family',
    color: 'green',
    placeholder: "Ready to share with people who care about you? I'll help you express this in a way that invites support...",
    prompt: 'share_circle'
  },
  public: {
    id: 'public',
    icon: '🌱',
    label: 'Share Publicly',
    description: 'When you\'re ready',
    color: 'amber',
    placeholder: "Sharing your story can help others who feel alone. When you're ready, I'll help you share in a way that protects you while connecting with others...",
    prompt: 'share_public'
  }
};

export default function AISocialMirror() {
  const [text, setText] = useState('');
  const [sharingLevel, setSharingLevel] = useState('reflect');
  const [results, setResults] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [savedDraft, setSavedDraft] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [showLevelInfo, setShowLevelInfo] = useState(false);

  const currentLevel = SHARING_LEVELS[sharingLevel];

  // Auto-save to localStorage
  useEffect(() => {
    if (!text || text.length < 10) return;
    
    const timeoutId = setTimeout(() => {
      localStorage.setItem('asm_draft', JSON.stringify({
        text,
        sharingLevel,
        savedAt: new Date().toISOString()
      }));
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [text, sharingLevel]);

  // Check for saved draft on mount
  useEffect(() => {
    const saved = localStorage.getItem('asm_draft');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.text && data.text.length > 10) {
          setSavedDraft(data);
          setShowRestoreModal(true);
        }
      } catch (e) {}
    }
  }, []);

  const restoreDraft = () => {
    if (savedDraft) {
      setText(savedDraft.text);
      setSharingLevel(savedDraft.sharingLevel || 'reflect');
    }
    setShowRestoreModal(false);
  };

  const analyze = async () => {
    if (text.length < 100) return;
    
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text, 
          mode: currentLevel.prompt,
          sharingLevel: sharingLevel 
        })
      });
      const data = await res.json();
      setResults(data);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyToClipboard = async (content, label) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(''), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const getTimeAgo = (dateString) => {
    const seconds = Math.floor((new Date() - new Date(dateString)) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };

  const getLevelColor = (level) => {
    const colors = {
      purple: 'bg-purple-600',
      blue: 'bg-blue-600',
      teal: 'bg-teal-600',
      green: 'bg-green-600',
      amber: 'bg-amber-600'
    };
    return colors[SHARING_LEVELS[level].color];
  };

  const getLevelBorderColor = (level) => {
    const colors = {
      purple: 'border-purple-500',
      blue: 'border-blue-500',
      teal: 'border-teal-500',
      green: 'border-green-500',
      amber: 'border-amber-500'
    };
    return colors[SHARING_LEVELS[level].color];
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Restore Draft Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full border border-gray-700">
            <h3 className="text-xl font-semibold mb-2">Welcome back 💜</h3>
            <p className="text-gray-400 mb-4">
              You were working on something {savedDraft && getTimeAgo(savedDraft.savedAt)}.
              Your words are safe here.
            </p>
            <div className="bg-gray-800 rounded-lg p-3 mb-4 max-h-32 overflow-hidden">
              <p className="text-gray-300 text-sm line-clamp-3">
                {savedDraft?.text?.substring(0, 200)}...
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={restoreDraft}
                className="flex-1 bg-purple-600 hover:bg-purple-500 px-4 py-2 rounded-lg transition-colors"
              >
                Continue Where I Left Off
              </button>
              <button
                onClick={() => { localStorage.removeItem('asm_draft'); setShowRestoreModal(false); }}
                className="flex-1 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
              >
                Start Fresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-gray-800 p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-600 rounded-lg flex items-center justify-center">
              <span className="text-xl">🪞</span>
            </div>
            <div>
              <h1 className="text-xl font-bold">AISocialMirror</h1>
              <p className="text-sm text-gray-400">Reflect. Understand. Heal. Share when ready.</p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto p-4">
        
        {/* Sharing Level Selector - The Progression */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">Your sharing journey:</span>
            <button 
              onClick={() => setShowLevelInfo(!showLevelInfo)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              {showLevelInfo ? 'Hide guide' : 'What is this?'}
            </button>
          </div>
          
          {showLevelInfo && (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 mb-4 text-sm">
              <p className="text-gray-300 mb-3">
                <strong>Healing happens in stages.</strong> You don't have to share everything with everyone. 
                Start where you're comfortable and progress naturally.
              </p>
              <ul className="space-y-2 text-gray-400">
                <li>🪞 <strong>Reflect</strong> — Write just for yourself. Process privately.</li>
                <li>💭 <strong>Understand</strong> — Get AI insight. See patterns you might miss.</li>
                <li>💌 <strong>Share with One</strong> — Find words for someone you trust.</li>
                <li>🤝 <strong>Share with Circle</strong> — Open up to close friends or family.</li>
                <li>🌱 <strong>Share Publicly</strong> — When ready, your story might help others.</li>
              </ul>
              <p className="text-gray-500 mt-3 italic">
                There's no rush. Some things stay private forever. That's okay too.
              </p>
            </div>
          )}
          
          {/* Level Pills */}
          <div className="flex flex-wrap gap-2">
            {Object.values(SHARING_LEVELS).map((level) => (
              <button
                key={level.id}
                onClick={() => setSharingLevel(level.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  sharingLevel === level.id
                    ? `${getLevelColor(level.id)} text-white shadow-lg`
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <span className="mr-1">{level.icon}</span>
                {level.label}
              </button>
            ))}
          </div>
          
          {/* Current Level Description */}
          <p className="text-sm text-gray-500 mt-2 ml-1">
            {currentLevel.icon} {currentLevel.description}
          </p>
        </div>

        {/* Split View Container */}
        <div className={`grid gap-6 ${results ? 'lg:grid-cols-5' : 'lg:grid-cols-1 max-w-2xl mx-auto'}`}>
          
          {/* LEFT: Text Input (ALWAYS VISIBLE) */}
          <div className={results ? 'lg:col-span-2' : ''}>
            <div className={`bg-gray-900 rounded-xl border ${getLevelBorderColor(sharingLevel)} p-4`}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={currentLevel.placeholder}
                className="w-full h-64 bg-gray-800 border border-gray-700 rounded-lg p-4 text-gray-100 placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50"
              />
              
              <div className="flex justify-between items-center mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">
                    {text.length} chars
                  </span>
                  {text.length > 10 && (
                    <span className="text-xs text-green-500">✓ Saved</span>
                  )}
                </div>
                
                <div className="flex gap-2">
                  {text.length > 0 && (
                    <button
                      onClick={() => copyToClipboard(text, 'text')}
                      className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                    >
                      {copyFeedback === 'text' ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  )}
                  
                  {!results && (
                    <button
                      onClick={analyze}
                      disabled={text.length < 100 || isAnalyzing}
                      className={`px-5 py-2 rounded-lg font-medium transition-colors ${
                        text.length < 100 || isAnalyzing
                          ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                          : `${getLevelColor(sharingLevel)} hover:opacity-90 text-white`
                      }`}
                    >
                      {isAnalyzing ? (
                        <span className="flex items-center gap-2">
                          <span className="animate-pulse">🪞</span>
                          Reflecting...
                        </span>
                      ) : text.length < 100 ? (
                        `${100 - text.length} more to go`
                      ) : (
                        `${currentLevel.icon} See My Reflection`
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
            
            {/* Action buttons when results showing */}
            {results && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={analyze}
                  disabled={isAnalyzing}
                  className={`flex-1 px-4 py-2 ${getLevelColor(sharingLevel)} hover:opacity-90 rounded-lg text-sm font-medium transition-colors`}
                >
                  {isAnalyzing ? '🪞 Reflecting...' : '🔄 Reflect Again'}
                </button>
                <button
                  onClick={() => { setText(''); setResults(null); localStorage.removeItem('asm_draft'); }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
                >
                  ✨ New
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: Results */}
          {results && (
            <div className="lg:col-span-3 space-y-4">
              {/* Reflection Summary */}
              <div className={`bg-gray-900 rounded-xl border ${getLevelBorderColor(sharingLevel)} p-5`}>
                <div className="flex items-center gap-2 mb-3 text-gray-400">
                  <span>{currentLevel.icon}</span>
                  <span>Your Reflection</span>
                </div>
                <p className="text-gray-200 mb-3">
                  {results.summary || results.analysis || "I see someone processing something meaningful. Your words carry weight."}
                </p>
                {results.insight && (
                  <p className="text-sm text-purple-300/80 italic flex items-center gap-2">
                    <span>💜</span> {results.insight}
                  </p>
                )}
              </div>

              {/* Score Cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                {/* IQ Card */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400 text-sm">🧠 Clarity</span>
                    <span className="text-xl font-bold">{results.iq?.score || 70}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {results.iq?.description || "Your thoughts come through."}
                  </p>
                </div>

                {/* EQ Card */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400 text-sm">💚 Feeling</span>
                    <span className="text-xl font-bold">{results.eq?.score || 70}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {results.eq?.description || "There's genuine emotion here."}
                  </p>
                </div>

                {/* SQ Card */}
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-400 text-sm">✨ Meaning</span>
                    <span className="text-xl font-bold">{results.sq?.score || 70}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {results.sq?.description || "Purpose shines through."}
                  </p>
                </div>
              </div>

              {/* Next Step Suggestion based on level */}
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700">
                <p className="text-sm text-gray-400 mb-3">
                  {sharingLevel === 'reflect' && (
                    <>💭 <strong>When you're ready:</strong> Get AI insight to understand your patterns better.</>
                  )}
                  {sharingLevel === 'understand' && (
                    <>💌 <strong>Consider:</strong> Is there one person who might understand? A friend, family member, or therapist?</>
                  )}
                  {sharingLevel === 'one' && (
                    <>🤝 <strong>If it felt safe:</strong> Others who care about you might want to support you too.</>
                  )}
                  {sharingLevel === 'circle' && (
                    <>🌱 <strong>Your story matters:</strong> When ready, sharing publicly can help others who feel alone.</>
                  )}
                  {sharingLevel === 'public' && (
                    <>💜 <strong>You're ready:</strong> Your vulnerability is a gift. Share when it feels right.</>
                  )}
                </p>
                
                {/* Copy for sharing */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => copyToClipboard(text, 'text')}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                  >
                    {copyFeedback === 'text' ? '✓' : '📋'} Copy my words
                  </button>
                  <button
                    onClick={() => {
                      const formatted = `${text}\n\n---\nReflected with AISocialMirror.com`;
                      copyToClipboard(formatted, 'share');
                    }}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                  >
                    {copyFeedback === 'share' ? '✓' : '📤'} Copy to share
                  </button>
                </div>
              </div>
              
              {/* Sharing suggestions based on level */}
              {(sharingLevel === 'one' || sharingLevel === 'circle' || sharingLevel === 'public') && (
                <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                  <p className="text-sm text-gray-400 mb-3">Share to:</p>
                  <div className="flex flex-wrap gap-2">
                    {sharingLevel === 'one' && (
                      <>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          📱 Text Message
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          ✉️ Email
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          💬 DM
                        </button>
                      </>
                    )}
                    {sharingLevel === 'circle' && (
                      <>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          👥 Group Text
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          🔒 Close Friends Story
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          👨‍👩‍👧‍👦 Family Group
                        </button>
                      </>
                    )}
                    {sharingLevel === 'public' && (
                      <>
                        <button className="px-3 py-1.5 text-xs bg-blue-900/50 hover:bg-blue-800/50 text-blue-300 rounded transition-colors">
                          💼 LinkedIn
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          𝕏 Twitter/X
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-orange-900/50 hover:bg-orange-800/50 text-orange-300 rounded transition-colors">
                          📖 Medium
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
                          💬 Reddit
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-blue-900/50 hover:bg-blue-800/50 text-blue-300 rounded transition-colors">
                          📘 Facebook
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 mt-12 p-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-gray-500 text-sm mb-2">
            Your words are auto-saved on your device. We don't store your private reflections.
          </p>
          <p className="text-gray-600 text-xs italic">
            "Healing happens when we're witnessed — first by ourselves, then by those we trust."
          </p>
        </div>
      </footer>
    </div>
  );
}
