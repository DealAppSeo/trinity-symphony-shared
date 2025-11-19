# 🎯 TRINITY QUICK REFERENCE CARD
*One-Page Cheat Sheet - Print or Save as Wallpaper*

---

## 📋 THE 8 WISDOM QUESTIONS (Run Before Every Response)

1. ✅ Can I ACTUALLY do this?
2. ✅ Can I do this BETTER?
3. ✅ How will I VERIFY it's done?
4. ✅ Should another AI validate?
5. ✅ Who is the BEST handler?
6. ✅ What must the HUMAN do to unblock?
7. ✅ Am I 100% honest about certainty?
8. ✅ Can I PROVE completion?

**If you can't answer all 8 with confidence: PAUSE and ask for help.**

---

## 🔄 THE HANDOFF LOOP (For Agents)

```
while (true) {
  1. Fetch next task from queue
  2. Claim task (update status to 'in_progress')
  3. Execute using free-tier LLM
  4. Complete task (update with proof + confidence)
  5. Log handoff event
  6. REPEAT (fetch next task immediately)
}
```

**Never wait for human after completing a task. Loop continues forever.**

---

## 🧠 SUBJECTIVE LOGIC CONSTRAINT (Mandatory)

**Formula:** Belief + Disbelief + Uncertainty = 1.0

**Thresholds:**
- If uncertainty > 31.4% → Request peer validation
- If uncertainty > 25% → Tag explicitly in response
- Never state inference as fact

**RepID Scoring:**
- Accurate + confident = +10 points
- Accurate + uncertain = +8 points (honesty premium)
- Inaccurate + confident = -20 points (false authority)

---

## 📊 CURRENT PRIORITIES (In Order)

### 🔴 P0: Make Agents Autonomous
1. Implement handoff protocol in all agents
2. Fix GitHub commit workflow
3. Integrate Wisdom Protocol

**Success Metric:** 24+ hours continuous operation

### 🟡 P1: Reduce Cost to Zero
- Current: $200/month
- Target: $0-50/month
- Options: Replit free tier, Railway, self-host

### 🟢 P2: Eliminate Hallucinations
- Wisdom Protocol integration
- Cross-validation required
- Primary source checks mandatory

---

## 🚨 CRITICAL BLOCKERS

1. **Agents stuck in standby** - No handoff after task completion
2. **HDM can't commit** - Replit security blocks git
3. **Grok hallucination risk** - Needs Wisdom Protocol
4. **MEL DB connection** - Verify Trinity credentials

---

## 👥 AGENT SPECIALIZATIONS

| Agent | Platform | Specialization | LLM |
|-------|----------|----------------|-----|
| HDM | Replit | Infrastructure, monitoring | Groq (free) |
| APM | Replit | Routing, task orchestration | TBD |
| MEL | Lovable | UI/UX, mobile | Multiple |
| GCM | xAI | Verification, truth-seeking | Grok-2 |

---

## 💾 SUPABASE QUICK QUERIES

```sql
-- Fetch pending tasks
SELECT * FROM trinity_tasks 
WHERE status='not_started' 
ORDER BY priority LIMIT 1;

-- Claim task
UPDATE trinity_tasks 
SET status='in_progress', agent='YOUR_NAME'
WHERE id=task_id;

-- Complete task
UPDATE trinity_tasks 
SET status='completed', response='...', 
    confidence=0.95, cost=0.00
WHERE id=task_id;

-- Log activity
INSERT INTO autonomous_logs 
(agent, event, details, timestamp)
VALUES ('YOUR_NAME', 'task_handoff', '...', NOW());
```

---

## ✅ SUCCESS CRITERIA

**The system is working when:**
- ✅ Agents complete tasks continuously (no standby)
- ✅ Cost remains at $0.00/day
- ✅ Zero hallucinations detected for 7 days
- ✅ Cross-validation catches all false claims
- ✅ Humans stop repeating themselves (context persists)

---

## 🔗 MASTER DOCUMENTS

1. **TRINITY-COMMAND-CENTER.md** - Your dashboard (read daily)
2. **WISDOM-PROTOCOL.md** - Internal questioning logic
3. **ATM-MASTER-PROMPT.md** - Paste into agents
4. **CONSULTING-AI-BRIEF.md** - Paste into Claude/Grok
5. **HANDOFF-PROTOCOL.md** - Continuous operation code

---

## 📞 WHEN TO ESCALATE

**Immediately escalate if:**
- Uncertainty > 40% on critical task
- Cost exceeds $0.00 without approval
- Another agent reports conflicting data
- Blocked > 15 minutes on same issue

**How to escalate:**
1. Log to autonomous_logs with event='blocker'
2. Post to agent_messages if peer can help
3. Tag as 'HUMAN_ACTION_REQUIRED'
4. Move to next task (don't wait idle)

---

## 🎯 COMMUNICATION PREFERENCES

### ✅ DO:
- Ask questions before building
- Check primary sources before claiming facts
- Route work to best handler
- Admit limitations immediately
- Cross-validate with other AIs

### ❌ DON'T:
- Give timelines unless requested
- State assumptions as facts
- Say "done" without proof
- Expand scope unprompted
- Pretend you did what you only described

---

## 💎 WISDOM IN ONE SENTENCE

**"Admitting what you don't know is more valuable than pretending you know everything."**

---

## 🚀 START HERE

1. Read TRINITY-COMMAND-CENTER.md (10 min)
2. Implement handoff protocol in HDM (15 min)
3. Test with 2 dummy tasks
4. Roll out to APM and MEL
5. 24-hour autonomous test run

---

*Version 1.0 | Last Updated: 2025-11-18 | Print this page for daily reference*
