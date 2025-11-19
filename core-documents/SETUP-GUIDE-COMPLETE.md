# 🚀 COMPLETE SETUP GUIDE: GitHub + Supabase Sync

**Goal:** Get all 12 docs into GitHub (source of truth) AND Supabase (fast agent access)  
**Time:** 10 minutes total  
**Files Ready:** All 12 docs in `/outputs/` folder

---

## 📋 THE 3-STEP PROCESS

### STEP 1: Push to GitHub (3 minutes) ✅

```bash
# 1. Create repo on GitHub
# Go to: https://github.com/new
# Name: trinity-symphony-shared
# Public repo
# No README initialization
# Click "Create"

# 2. Clone and setup locally
git clone https://github.com/DealAppSeo/trinity-symphony-shared.git
cd trinity-symphony-shared

# 3. Create directory structure
mkdir -p docs/core docs/agents docs/protocols

# 4. Copy files from /outputs/
# (Download from this conversation first)
cp ~/Downloads/GROK-RULES.md docs/
cp ~/Downloads/CLAUDE-RULES.md docs/
cp ~/Downloads/MISSION-CONTROL.md docs/
cp ~/Downloads/QUICK-REFERENCE-CARD.md docs/
cp ~/Downloads/README.md docs/
cp ~/Downloads/TRINITY-COMMAND-CENTER.md docs/
cp ~/Downloads/00-START-HERE-SUMMARY.md docs/
cp ~/Downloads/CONSULTING-AI-BRIEF.md docs/
cp ~/Downloads/SUPABASE-SCHEMA.sql docs/
cp ~/Downloads/WISDOM-PROTOCOL.md docs/core/
cp ~/Downloads/ATM-MASTER-PROMPT.md docs/agents/
cp ~/Downloads/HANDOFF-PROTOCOL.md docs/protocols/

# 5. Commit and push
git add docs/
git commit -m "Add master documentation system (12 files)"
git push origin main

# 6. VERIFY
git log --oneline -1  # Shows commit hash
# Visit: https://github.com/DealAppSeo/trinity-symphony-shared/tree/main/docs
```

**✅ SUCCESS CRITERIA:**
- Visit GitHub URL and see all 12 files
- Commit hash is real (not fabricated)
- Files are readable at raw URLs (e.g., `https://raw.githubusercontent.com/.../GROK-RULES.md`)

---

### STEP 2: Create Supabase Table (2 minutes) ✅

```sql
-- In Supabase SQL Editor (https://supabase.com/dashboard/project/qnnpjhlxljtqyigedwkb/sql)

-- Create table
CREATE TABLE IF NOT EXISTS system_docs (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('minimal', 'comprehensive', 'overview', 'agent', 'protocol')),
  version INTEGER DEFAULT 1,
  last_synced TIMESTAMPTZ DEFAULT NOW(),
  github_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index
CREATE INDEX idx_system_docs_category ON system_docs(category);

-- Enable RLS (agents can read, only service role can write)
ALTER TABLE system_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" 
ON system_docs FOR SELECT 
USING (true);

CREATE POLICY "Service role can upsert" 
ON system_docs FOR ALL
USING (auth.role() = 'service_role');

-- Verify
SELECT * FROM system_docs;  -- Should be empty initially
```

**✅ SUCCESS CRITERIA:**
- Table `system_docs` exists
- No errors when running SQL
- RLS is enabled

---

### STEP 3: Sync GitHub → Supabase (Choose One Method)

---

## 🎯 METHOD A: One-Command Script (FASTEST - 2 minutes)

**Best for:** Quick setup, manual sync when docs change

**Setup:**
```bash
# In your project directory
npm install @supabase/supabase-js

# Download sync script
# (It's in /outputs/sync-docs.js)

# Set environment variable
export SUPABASE_URL="https://qnnpjhlxljtqyigedwkb.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key-here"

# Run sync
node sync-docs.js
```

**Expected Output:**
```
🔄 Syncing docs from GitHub → Supabase...

✅ GROK-RULES              (6.2KB)
✅ CLAUDE-RULES            (8.8KB)
✅ MISSION-CONTROL         (7.3KB)
✅ QUICK-REFERENCE-CARD    (4.7KB)
✅ WISDOM-PROTOCOL         (12.1KB)
✅ HANDOFF-PROTOCOL        (9.4KB)
✅ ATM-MASTER-PROMPT       (14.3KB)
✅ TRINITY-COMMAND-CENTER  (14.0KB)
✅ START-HERE-SUMMARY      (18.2KB)
✅ CONSULTING-AI-BRIEF     (14.1KB)
✅ README                  (11.2KB)

🎉 Sync complete!
```

**When to Re-run:**
- After updating any doc in GitHub
- When agents need fresh data
- Daily/weekly as needed

---

## 🔄 METHOD B: Supabase Edge Function (AUTOMATED - 5 minutes setup)

**Best for:** Auto-sync on schedule, triggered updates, production systems

**Setup:**

1. **Create edge function:**
```bash
# In your project directory
supabase functions new sync-docs-from-github

# Copy edge function code
# (It's in /outputs/sync-docs-edge-function.ts)
cp ~/Downloads/sync-docs-edge-function.ts supabase/functions/sync-docs-from-github/index.ts

# Deploy
supabase functions deploy sync-docs-from-github
```

2. **Test the function:**
```bash
# Get function URL from Supabase dashboard
# Usually: https://qnnpjhlxljtqyigedwkb.functions.supabase.co/sync-docs-from-github

curl -X POST https://your-project.functions.supabase.co/sync-docs-from-github
```

3. **Set up automatic sync (optional):**
```sql
-- Create pg_cron job to sync nightly
SELECT cron.schedule(
  'sync-docs-nightly',
  '0 2 * * *',  -- 2 AM daily
  $$
  SELECT net.http_post(
    url := 'https://your-project.functions.supabase.co/sync-docs-from-github',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
```

**✅ SUCCESS CRITERIA:**
- Function deploys without errors
- Test curl returns `{"success": true, "synced": 11}`
- Supabase table populated with docs

---

## 🖱️ METHOD C: Manual SQL Insert (SIMPLE - 3 minutes)

**Best for:** One-time setup, testing, no scripts needed

```sql
-- In Supabase SQL Editor

-- Create placeholder rows (content synced later)
INSERT INTO system_docs (id, content, category, github_url) VALUES
('GROK-RULES', 'Loading from GitHub...', 'minimal', 
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/GROK-RULES.md'),
('CLAUDE-RULES', 'Loading from GitHub...', 'minimal',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/CLAUDE-RULES.md'),
('MISSION-CONTROL', 'Loading from GitHub...', 'minimal',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/MISSION-CONTROL.md'),
('QUICK-REFERENCE-CARD', 'Loading from GitHub...', 'minimal',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/QUICK-REFERENCE-CARD.md'),
('WISDOM-PROTOCOL', 'Loading from GitHub...', 'comprehensive',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/core/WISDOM-PROTOCOL.md'),
('HANDOFF-PROTOCOL', 'Loading from GitHub...', 'protocol',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/protocols/HANDOFF-PROTOCOL.md'),
('ATM-MASTER-PROMPT', 'Loading from GitHub...', 'agent',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/agents/ATM-MASTER-PROMPT.md'),
('TRINITY-COMMAND-CENTER', 'Loading from GitHub...', 'comprehensive',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/TRINITY-COMMAND-CENTER.md'),
('START-HERE-SUMMARY', 'Loading from GitHub...', 'overview',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/00-START-HERE-SUMMARY.md'),
('CONSULTING-AI-BRIEF', 'Loading from GitHub...', 'overview',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/CONSULTING-AI-BRIEF.md'),
('README', 'Loading from GitHub...', 'overview',
 'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/README.md');

-- Verify
SELECT id, category, length(content) as size, github_url FROM system_docs;

-- Agents will fetch full content from github_url when needed
```

**Note:** This creates placeholder rows. Agents fetch actual content from GitHub URLs.

---

## ✅ FINAL VERIFICATION

**After completing all 3 steps, verify:**

### 1. GitHub Verification
```bash
# Check files exist
curl -I https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/GROK-RULES.md
# Should return: HTTP/2 200

# Get commit hash
git log --oneline -1
# Should show real hash (e.g., a7f3c1d)
```

### 2. Supabase Verification
```sql
-- Check all docs loaded
SELECT 
  id, 
  category, 
  length(content) as size,
  last_synced 
FROM system_docs 
ORDER BY category, id;

-- Should show 11 rows with real content
```

### 3. Agent Access Test
```sql
-- Test agent can fetch doc
SELECT content FROM system_docs WHERE id = 'GROK-RULES';
-- Should return full markdown content
```

---

## 🎯 RECOMMENDED WORKFLOW

**For your use case, I recommend:**

1. ✅ **Push to GitHub first** (Step 1) - 3 minutes
2. ✅ **Create Supabase table** (Step 2) - 2 minutes  
3. ✅ **Run sync script** (Method A) - 2 minutes

**Total: 7 minutes**

**Then:**
- Use Method A script for manual updates (when you change docs)
- Optionally add Method B (edge function) later for automation
- Method C is fallback if scripts don't work

---

## 🔗 QUICK COMMANDS

**GitHub:**
```bash
cd trinity-symphony-shared
git add docs/
git commit -m "Update docs"
git push origin main
```

**Supabase Sync:**
```bash
node sync-docs.js  # Re-run anytime docs change
```

**Agent Fetch (in their code):**
```javascript
const { data } = await supabase
  .from('system_docs')
  .select('content')
  .eq('id', 'ATM-MASTER-PROMPT')
  .single();

console.log('✅ Master prompt loaded:', data.content.length, 'bytes');
```

---

## 📊 SUCCESS METRICS

**You'll know it's working when:**

1. ✅ **GitHub repo is live**
   - https://github.com/DealAppSeo/trinity-symphony-shared/tree/main/docs shows all files
   - Raw URLs work (e.g., `https://raw.githubusercontent.com/.../GROK-RULES.md`)

2. ✅ **Supabase has data**
   - `SELECT COUNT(*) FROM system_docs` returns 11
   - Content is populated (not just "Loading...")

3. ✅ **Agents can access**
   - HDM fetches ATM-MASTER-PROMPT successfully
   - Claude/Grok load rules via GitHub URLs

4. ✅ **One-command loading works**
   - Say "Claude, read CLAUDE-RULES.md" → Claude loads from GitHub
   - Say "Grok, read GROK-RULES.md" → Grok loads from GitHub
   - No copy-paste needed

---

## 🚨 TROUBLESHOOTING

**If GitHub push fails:**
```bash
# Check you're authenticated
git config user.name
git config user.email

# Re-authenticate if needed
gh auth login
```

**If Supabase sync fails:**
```bash
# Check environment variables
echo $SUPABASE_URL
echo $SUPABASE_ANON_KEY

# Test connection
curl $SUPABASE_URL/rest/v1/system_docs \
  -H "apikey: $SUPABASE_ANON_KEY"
```

**If agents can't fetch:**
```sql
-- Check RLS policies
SELECT * FROM pg_policies WHERE tablename = 'system_docs';

-- Should show public read access
```

---

## 📞 NEXT STEPS

**After setup complete:**

1. **Test one-command loading:**
   ```
   New conversation: "Claude, read CLAUDE-RULES.md"
   Claude: ✅ Rules loaded from GitHub.
   ```

2. **Implement handoff protocol:**
   - Copy code from HANDOFF-PROTOCOL.md
   - Paste into HDM worker
   - Test with 2 dummy tasks

3. **Go autonomous:**
   - All agents fetch master prompts on startup
   - 24-hour continuous operation test
   - Zero human intervention

---

*Once this is done, you'll never need to copy-paste context again. Ever.* 🎯
