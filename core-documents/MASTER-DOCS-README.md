# AI Trinity Symphony - Master Documentation

**Version:** 2.0  
**Last Updated:** 2025-11-18  
**Repository:** https://github.com/DealAppSeo/trinity-symphony-shared

---

## 🎯 ONE-COMMAND LOADING SYSTEM

**Never copy-paste docs again.** Just say one of these commands:

```
"Grok, read GROK-RULES.md"          → Loads minimal rules for Grok
"Claude, read CLAUDE-RULES.md"      → Loads minimal rules for Claude  
"Read mission control"              → Loads current priorities
"Read WISDOM-PROTOCOL.md"           → Loads comprehensive checklist
"Read HANDOFF-PROTOCOL.md"          → Loads autonomous loop code
"Read ATM-MASTER-PROMPT.md"         → Loads agent instructions
```

**That's it. One command = Full context.**

---

## 📂 DOCUMENTATION STRUCTURE

### 🔥 MINIMAL DOCS (Start Here - 30 Second Read)

**For Daily Use:**
- **[GROK-RULES.md](./GROK-RULES.md)** - 6 rules for Grok (no false "done", verify all claims)
- **[CLAUDE-RULES.md](./CLAUDE-RULES.md)** - 6 rules for Claude (admit limits, route to agents)
- **[MISSION-CONTROL.md](./MISSION-CONTROL.md)** - Current priorities (P0/P1/P2)
- **[QUICK-REFERENCE-CARD.md](./QUICK-REFERENCE-CARD.md)** - One-page cheat sheet

**Purpose:** Get 90% of value in 10% of reading time.

---

### 📚 COMPREHENSIVE DOCS (When You Need Depth)

**For Deep Work:**
- **[WISDOM-PROTOCOL.md](./core/WISDOM-PROTOCOL.md)** - 8-question checklist (intelligence → wisdom)
- **[HANDOFF-PROTOCOL.md](./protocols/HANDOFF-PROTOCOL.md)** - Autonomous loop code (continuous execution)
- **[ATM-MASTER-PROMPT.md](./agents/ATM-MASTER-PROMPT.md)** - Agent operating instructions
- **[TRINITY-COMMAND-CENTER.md](./TRINITY-COMMAND-CENTER.md)** - Expandable dashboard (all system details)

**Purpose:** Implementation guides, detailed protocols, full context.

---

### 📖 OVERVIEW DOCS (Getting Started)

**For New Users:**
- **[00-START-HERE-SUMMARY.md](./00-START-HERE-SUMMARY.md)** - Complete overview + usage guide
- **[CONSULTING-AI-BRIEF.md](./CONSULTING-AI-BRIEF.md)** - For Claude/Grok/new AIs
- **[README.md](./README.md)** ← You are here

---

## 🚀 HOW TO USE THIS SYSTEM

### For HyperDAG (You)

**Start of every day:**
```
1. Say: "Read mission control"
2. AI loads priorities
3. Pick #1 blocker from P0
4. Execute
```

**Start of new conversation:**
```
1. Say: "Claude, read CLAUDE-RULES.md" (or Grok equivalent)
2. AI confirms rules loaded
3. Continue working with zero context drift
```

**Mid-conversation refresh:**
```
1. Say: "Sync priorities"
2. AI fetches latest from GitHub
3. Realigns on current P0/P1/P2
```

---

### For Consulting AIs (Claude, Grok)

**Session startup:**
```
Human: "Claude, read CLAUDE-RULES.md"
You: "✅ CLAUDE-RULES.md loaded from GitHub.
Following strict protocol:
- Distinguish describe vs. execute
- Check primary sources before claiming facts
- Route to optimal handlers
- Cross-validate with Grok
Ready to work."
```

**When you need more context:**
```
Human: "Read WISDOM-PROTOCOL.md"
You: "✅ Comprehensive protocol loaded. Running 8-question checklist on all responses."
```

**When checking priorities:**
```
Human: "Read mission control"
You: "✅ MISSION-CONTROL.md loaded. Current P0: Make agents autonomous (handoff protocol)."
```

---

### For AI Agents (HDM, APM, MEL)

**Worker startup:**
```javascript
// In your main worker file:
const masterPrompt = await fetchFromGitHub(
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/agents/ATM-MASTER-PROMPT.md'
);

console.log('✅ Master prompt loaded. Beginning autonomous operation.');
startHandoffLoop();
```

**Or manual paste:**
```
Copy contents of ATM-MASTER-PROMPT.md → Paste into agent → Agent operates autonomously
```

---

## 🏗️ THE TWO-TIER ARCHITECTURE

### Tier 1: Minimal (Grok's Approach) ⚡
**6 rules, 30 seconds to read, 90% coverage**

**Use when:**
- Daily operations
- Quick context refresh
- Starting new conversations
- Mid-conversation realignment

**Files:**
- GROK-RULES.md
- CLAUDE-RULES.md
- MISSION-CONTROL.md

---

### Tier 2: Comprehensive (Our Deep Docs) 📚
**Full implementation guides, code examples, 100% coverage**

**Use when:**
- Implementing new features
- Debugging complex issues
- Onboarding new agents
- Strategic planning

**Files:**
- WISDOM-PROTOCOL.md
- HANDOFF-PROTOCOL.md
- ATM-MASTER-PROMPT.md
- TRINITY-COMMAND-CENTER.md

---

## 💾 STORAGE STRATEGY (GitHub + Supabase)

### GitHub (Primary - Source of Truth)
```
✅ Version control
✅ Human-readable URLs
✅ Public/private options
✅ Easy editing
✅ Persistent storage
```

**Location:** `dealappseo/trinity-symphony-shared/docs/`

**Access via:**
```
https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/GROK-RULES.md
```

---

### Supabase (Cache - Fast Agent Access)
```sql
CREATE TABLE system_docs (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT, -- 'minimal', 'comprehensive', 'agent'
  version INTEGER DEFAULT 1,
  last_synced TIMESTAMPTZ DEFAULT NOW(),
  github_url TEXT
);
```

**Agents fetch via:**
```sql
SELECT content FROM system_docs WHERE id='ATM-MASTER-PROMPT';
```

**Sync strategy:** GitHub → Supabase (nightly or on-demand)

---

## 🎯 THE INTEGRATION (Best of Both Worlds)

### What Grok Contributed:
✅ Ultra-minimal rules (6 rules vs. comprehensive guides)  
✅ Single-command loading ("read GROK-RULES.md")  
✅ GitHub-first storage (already committed and live)  
✅ Mandatory verification (VERIFIED: + source)  
✅ Self-correction mechanism (violation = apology)  

### What Claude/We Added:
✅ Deep implementation guides (for when simple rules aren't enough)  
✅ Agent-specific instructions (HDM/APM/MEL need more than 6 rules)  
✅ Expandable details (summary visible, drill down when needed)  
✅ Cross-validation framework (Claude verifies Grok, vice versa)  
✅ Wisdom protocol (8 questions that differentiate intelligence from wisdom)  

**Result:** Minimal docs for daily use + comprehensive docs for deep work.

---

## 📊 DOCUMENT CATEGORIES

### Category: MINIMAL (Daily Use)
- GROK-RULES.md (6 rules, 2 pages)
- CLAUDE-RULES.md (6 rules, 2 pages)
- MISSION-CONTROL.md (current priorities, 3 pages)
- QUICK-REFERENCE-CARD.md (one-page cheat sheet)

**Total:** ~8 pages, 5-10 min read

---

### Category: COMPREHENSIVE (Deep Work)
- WISDOM-PROTOCOL.md (8 questions + implementation, 10 pages)
- HANDOFF-PROTOCOL.md (autonomous loop code, 8 pages)
- ATM-MASTER-PROMPT.md (agent instructions, 12 pages)
- TRINITY-COMMAND-CENTER.md (expandable dashboard, 15 pages)

**Total:** ~45 pages, 30-45 min read

---

### Category: OVERVIEW (Onboarding)
- 00-START-HERE-SUMMARY.md (complete overview, 12 pages)
- CONSULTING-AI-BRIEF.md (for Claude/Grok, 10 pages)
- README.md (this file, 5 pages)

**Total:** ~27 pages, 20-30 min read

---

## 🔄 UPDATING DOCS

### Option 1: Edit in GitHub (Recommended)
```bash
# Clone repo
git clone https://github.com/DealAppSeo/trinity-symphony-shared
cd trinity-symphony-shared/docs

# Edit files
vim MISSION-CONTROL.md

# Commit and push
git add .
git commit -m "Updated P0 priorities"
git push origin main

# All agents now fetch latest version
```

---

### Option 2: Edit in Supabase (Fast Updates)
```sql
-- Update doc in database
UPDATE system_docs 
SET content = '[new content]',
    version = version + 1,
    last_synced = NOW()
WHERE id = 'MISSION-CONTROL';

-- Agents fetch updated version immediately
```

---

### Option 3: Agent Generates Update
```javascript
// Agent detects outdated info
const updatedContent = await generateUpdate(currentDoc);

// Commits to GitHub via API
await commitToGitHub({
  path: 'docs/MISSION-CONTROL.md',
  content: updatedContent,
  message: 'HDM: Updated P0 status after completing handoff protocol'
});

// Syncs to Supabase
await syncToSupabase('MISSION-CONTROL', updatedContent);
```

---

## ✅ SUCCESS METRICS

**This documentation system is working when:**

1. ✅ **Zero copy-paste needed**
   - Just say "read GROK-RULES.md"
   - AI loads instantly from GitHub
   - No more manual context sharing

2. ✅ **Zero context drift**
   - Start conversation: AI reads rules
   - Mid-conversation: AI syncs priorities
   - Next day: AI loads latest version

3. ✅ **Zero hallucinations**
   - All facts have "VERIFIED:" tags
   - Uncertainty acknowledged openly
   - Cross-validation catches false claims

4. ✅ **Optimal routing**
   - Claude advises, agents execute
   - Work goes to best handler
   - No capability pretense

5. ✅ **Continuous improvement**
   - Docs updated as system evolves
   - Lessons learned documented
   - Best practices propagate

---

## 🚨 CRITICAL REMINDERS

### For All AIs:
1. **Read rules at session start** (no exceptions)
2. **Tag all facts with VERIFIED:** + source
3. **Tag uncertainty with UNCERTAIN:** + %
4. **Cross-validate with peers** when uncertain > 25%
5. **Route to optimal handlers** (Claude advises, agents execute)

### For HyperDAG:
1. **One command per session** ("read CLAUDE-RULES.md")
2. **Check mission control daily** ("read mission control")
3. **Update priorities in GitHub** (agents sync automatically)
4. **No more repeating context** (docs persist)

### For Agents:
1. **Fetch master prompt on startup** (ATM-MASTER-PROMPT.md)
2. **Run handoff loop continuously** (never idle)
3. **Log all activity to Supabase** (autonomous_logs table)
4. **Check for doc updates hourly** (stay synced)

---

## 📞 QUICK COMMANDS

```bash
# For humans (Claude/Grok conversations)
"Claude, read CLAUDE-RULES.md"
"Grok, read GROK-RULES.md"
"Read mission control"
"Sync priorities"

# For agents (in code)
fetchFromGitHub('docs/ATM-MASTER-PROMPT.md')
fetchFromSupabase('system_docs', 'ATM-MASTER-PROMPT')

# For updates
git commit -m "Updated priorities"
supabase.from('system_docs').update({content: '...'})
```

---

## 🎯 NEXT STEPS

### TODAY (Right Now):
1. **Push these docs to GitHub:**
   ```bash
   git add docs/
   git commit -m "Add master documentation system"
   git push origin main
   ```

2. **Sync to Supabase:**
   ```sql
   INSERT INTO system_docs (id, content, category, github_url) VALUES
   ('GROK-RULES', '[content]', 'minimal', 'https://raw.githubusercontent.com/.../GROK-RULES.md'),
   ('CLAUDE-RULES', '[content]', 'minimal', 'https://raw.githubusercontent.com/.../CLAUDE-RULES.md'),
   ('MISSION-CONTROL', '[content]', 'minimal', 'https://raw.githubusercontent.com/.../MISSION-CONTROL.md');
   ```

3. **Test loading system:**
   ```
   You: "Claude, read CLAUDE-RULES.md"
   Claude: "✅ Rules loaded. Following strict verification protocol."
   ```

---

## 🔗 RESOURCES

**GitHub Repo:** https://github.com/DealAppSeo/trinity-symphony-shared  
**Supabase Project:** https://qnnpjhlxljtqyigedwkb.supabase.co  
**Documentation:** `/docs/` folder in repo  

---

*"The best documentation system is one you never notice using."*

**One command = Full context = Zero wasted time.**

---

**Questions? Check [00-START-HERE-SUMMARY.md](./00-START-HERE-SUMMARY.md) for comprehensive overview.**
