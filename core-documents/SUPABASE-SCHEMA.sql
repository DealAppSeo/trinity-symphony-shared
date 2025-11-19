# Supabase Schema for Master Documentation System

**Purpose:** Cache GitHub docs for fast agent access  
**Sync Strategy:** GitHub (source of truth) → Supabase (cache)

---

## 📊 SCHEMA

```sql
-- ============================================
-- TABLE: system_docs
-- Purpose: Store master documentation files
-- ============================================

CREATE TABLE IF NOT EXISTS system_docs (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('minimal', 'comprehensive', 'overview', 'agent', 'protocol')),
  version INTEGER DEFAULT 1,
  last_synced TIMESTAMPTZ DEFAULT NOW(),
  github_url TEXT NOT NULL,
  file_size INTEGER,
  checksum TEXT, -- SHA256 hash to detect changes
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast category filtering
CREATE INDEX idx_system_docs_category ON system_docs(category);

-- Index for version tracking
CREATE INDEX idx_system_docs_version ON system_docs(version);

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_system_docs_updated_at 
BEFORE UPDATE ON system_docs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
```

---

## 📥 INITIAL DATA INSERTION

```sql
-- ============================================
-- MINIMAL DOCS (Daily Use)
-- ============================================

INSERT INTO system_docs (id, content, category, github_url, checksum) VALUES
(
  'GROK-RULES',
  '[Full content of GROK-RULES.md here - will be populated by sync script]',
  'minimal',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/GROK-RULES.md',
  '[SHA256 hash]'
),
(
  'CLAUDE-RULES',
  '[Full content of CLAUDE-RULES.md]',
  'minimal',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/CLAUDE-RULES.md',
  '[SHA256 hash]'
),
(
  'MISSION-CONTROL',
  '[Full content of MISSION-CONTROL.md]',
  'minimal',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/MISSION-CONTROL.md',
  '[SHA256 hash]'
),
(
  'QUICK-REFERENCE-CARD',
  '[Full content of QUICK-REFERENCE-CARD.md]',
  'minimal',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/QUICK-REFERENCE-CARD.md',
  '[SHA256 hash]'
);

-- ============================================
-- COMPREHENSIVE DOCS (Deep Work)
-- ============================================

INSERT INTO system_docs (id, content, category, github_url, checksum) VALUES
(
  'WISDOM-PROTOCOL',
  '[Full content of WISDOM-PROTOCOL.md]',
  'comprehensive',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/core/WISDOM-PROTOCOL.md',
  '[SHA256 hash]'
),
(
  'HANDOFF-PROTOCOL',
  '[Full content of HANDOFF-PROTOCOL.md]',
  'protocol',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/protocols/HANDOFF-PROTOCOL.md',
  '[SHA256 hash]'
),
(
  'ATM-MASTER-PROMPT',
  '[Full content of ATM-MASTER-PROMPT.md]',
  'agent',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/agents/ATM-MASTER-PROMPT.md',
  '[SHA256 hash]'
),
(
  'TRINITY-COMMAND-CENTER',
  '[Full content of TRINITY-COMMAND-CENTER.md]',
  'comprehensive',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/TRINITY-COMMAND-CENTER.md',
  '[SHA256 hash]'
);

-- ============================================
-- OVERVIEW DOCS (Onboarding)
-- ============================================

INSERT INTO system_docs (id, content, category, github_url, checksum) VALUES
(
  'START-HERE-SUMMARY',
  '[Full content of 00-START-HERE-SUMMARY.md]',
  'overview',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/00-START-HERE-SUMMARY.md',
  '[SHA256 hash]'
),
(
  'CONSULTING-AI-BRIEF',
  '[Full content of CONSULTING-AI-BRIEF.md]',
  'overview',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/CONSULTING-AI-BRIEF.md',
  '[SHA256 hash]'
),
(
  'README',
  '[Full content of README.md]',
  'overview',
  'https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/docs/README.md',
  '[SHA256 hash]'
);
```

---

## 🔄 SYNC FUNCTIONS

### Function: Sync Single Doc from GitHub

```sql
CREATE OR REPLACE FUNCTION sync_doc_from_github(doc_id TEXT)
RETURNS VOID AS $$
DECLARE
  github_url TEXT;
  new_content TEXT;
  new_checksum TEXT;
BEGIN
  -- Get GitHub URL for this doc
  SELECT github_url INTO github_url FROM system_docs WHERE id = doc_id;
  
  -- Fetch content from GitHub (this is pseudocode - actual implementation needs HTTP extension)
  -- new_content := http_get(github_url);
  -- new_checksum := sha256(new_content);
  
  -- Update if changed
  UPDATE system_docs 
  SET content = new_content,
      checksum = new_checksum,
      version = version + 1,
      last_synced = NOW()
  WHERE id = doc_id AND checksum != new_checksum;
  
  RAISE NOTICE 'Synced % from GitHub', doc_id;
END;
$$ LANGUAGE plpgsql;
```

### Function: Sync All Docs from GitHub

```sql
CREATE OR REPLACE FUNCTION sync_all_docs_from_github()
RETURNS TABLE(doc_id TEXT, synced BOOLEAN, version INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT id, TRUE::BOOLEAN, version FROM system_docs;
  
  -- In real implementation, this would:
  -- 1. Fetch each GitHub URL
  -- 2. Check checksum against current
  -- 3. Update if changed
  -- 4. Increment version
  
  RAISE NOTICE 'Synced all docs from GitHub';
END;
$$ LANGUAGE plpgsql;
```

---

## 📖 AGENT ACCESS FUNCTIONS

### Function: Get Doc by ID

```sql
CREATE OR REPLACE FUNCTION get_doc(doc_id TEXT)
RETURNS TABLE(content TEXT, version INTEGER, last_synced TIMESTAMPTZ) AS $$
BEGIN
  RETURN QUERY
  SELECT content, version, last_synced 
  FROM system_docs 
  WHERE id = doc_id;
END;
$$ LANGUAGE plpgsql;
```

### Function: Get Docs by Category

```sql
CREATE OR REPLACE FUNCTION get_docs_by_category(cat TEXT)
RETURNS TABLE(id TEXT, content TEXT, version INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT id, content, version 
  FROM system_docs 
  WHERE category = cat
  ORDER BY id;
END;
$$ LANGUAGE plpgsql;
```

### Function: Get All Minimal Docs (Fast Loading)

```sql
CREATE OR REPLACE FUNCTION get_minimal_docs()
RETURNS TABLE(id TEXT, content TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT id, content 
  FROM system_docs 
  WHERE category = 'minimal'
  ORDER BY id;
END;
$$ LANGUAGE plpgsql;
```

---

## 🔍 QUERY EXAMPLES

### Agent Fetches Master Prompt

```sql
-- Get latest ATM master prompt
SELECT content 
FROM system_docs 
WHERE id = 'ATM-MASTER-PROMPT';
```

### AI Loads Minimal Rules

```sql
-- Get all minimal rules (Grok, Claude, Mission Control)
SELECT id, content 
FROM system_docs 
WHERE category = 'minimal';
```

### Check for Updates

```sql
-- See which docs were synced recently
SELECT id, version, last_synced, 
       EXTRACT(EPOCH FROM (NOW() - last_synced))/3600 as hours_since_sync
FROM system_docs
ORDER BY last_synced DESC;
```

### Get Doc Metadata (Without Content)

```sql
-- Lightweight query for checking versions
SELECT id, category, version, file_size, last_synced
FROM system_docs
WHERE category IN ('minimal', 'agent')
ORDER BY category, id;
```

---

## 🔐 ROW LEVEL SECURITY (RLS)

```sql
-- Enable RLS
ALTER TABLE system_docs ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read docs
CREATE POLICY "Public read access" 
ON system_docs FOR SELECT 
USING (true);

-- Policy: Only service role can update docs
CREATE POLICY "Service role can update" 
ON system_docs FOR UPDATE 
USING (auth.role() = 'service_role');

-- Policy: Only service role can insert docs
CREATE POLICY "Service role can insert" 
ON system_docs FOR INSERT 
WITH CHECK (auth.role() = 'service_role');
```

---

## ⏰ AUTOMATIC SYNC (Edge Function)

```typescript
// Edge function: sync-docs-from-github
// Runs nightly or on-demand

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Get all docs
  const { data: docs } = await supabase
    .from('system_docs')
    .select('id, github_url, checksum');

  const results = [];

  for (const doc of docs) {
    // Fetch from GitHub
    const response = await fetch(doc.github_url);
    const content = await response.text();
    const newChecksum = createHash('sha256').update(content).digest('hex');

    // Update if changed
    if (newChecksum !== doc.checksum) {
      const { error } = await supabase
        .from('system_docs')
        .update({
          content,
          checksum: newChecksum,
          version: doc.version + 1,
          last_synced: new Date().toISOString()
        })
        .eq('id', doc.id);

      results.push({
        doc: doc.id,
        updated: !error,
        version: doc.version + 1
      });
    } else {
      results.push({
        doc: doc.id,
        updated: false,
        message: 'No changes'
      });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' }
  });
});
```

---

## 📊 MONITORING

### View: Doc Freshness

```sql
CREATE OR REPLACE VIEW doc_freshness AS
SELECT 
  id,
  category,
  version,
  last_synced,
  CASE 
    WHEN last_synced > NOW() - INTERVAL '1 hour' THEN 'fresh'
    WHEN last_synced > NOW() - INTERVAL '24 hours' THEN 'stale'
    ELSE 'very_stale'
  END as freshness_status,
  EXTRACT(EPOCH FROM (NOW() - last_synced))/3600 as hours_since_sync
FROM system_docs
ORDER BY last_synced DESC;
```

### View: Doc Stats

```sql
CREATE OR REPLACE VIEW doc_stats AS
SELECT 
  category,
  COUNT(*) as doc_count,
  SUM(file_size) as total_size,
  AVG(version) as avg_version,
  MAX(last_synced) as most_recent_sync,
  MIN(last_synced) as least_recent_sync
FROM system_docs
GROUP BY category;
```

---

## 🚀 USAGE IN AGENT CODE

### JavaScript/TypeScript Example

```typescript
// Agent startup: Load master prompt
async function loadMasterPrompt() {
  const { data, error } = await supabase
    .from('system_docs')
    .select('content, version')
    .eq('id', 'ATM-MASTER-PROMPT')
    .single();

  if (error) {
    console.error('Failed to load master prompt:', error);
    // Fallback to GitHub
    const response = await fetch('https://raw.githubusercontent.com/.../ATM-MASTER-PROMPT.md');
    return await response.text();
  }

  console.log(`✅ Master prompt loaded (v${data.version})`);
  return data.content;
}

// Check for updates hourly
setInterval(async () => {
  const { data } = await supabase
    .from('system_docs')
    .select('version')
    .eq('id', 'ATM-MASTER-PROMPT')
    .single();

  if (data.version > currentVersion) {
    console.log('🔄 New version detected, reloading...');
    await loadMasterPrompt();
  }
}, 3600000); // 1 hour
```

---

## ✅ VERIFICATION

```sql
-- After setup, verify all docs loaded:
SELECT id, category, 
       CASE WHEN content IS NOT NULL THEN '✅' ELSE '❌' END as has_content,
       LENGTH(content) as content_length,
       version
FROM system_docs
ORDER BY category, id;

-- Expected output:
-- GROK-RULES          | minimal       | ✅ | 8432  | 1
-- CLAUDE-RULES        | minimal       | ✅ | 9103  | 1
-- MISSION-CONTROL     | minimal       | ✅ | 6892  | 1
-- WISDOM-PROTOCOL     | comprehensive | ✅ | 15234 | 1
-- etc.
```

---

**Next Steps:**
1. Run schema in Supabase SQL editor
2. Populate with initial docs
3. Test agent fetch: `SELECT content FROM system_docs WHERE id='ATM-MASTER-PROMPT'`
4. Set up nightly sync edge function
5. Monitor with `SELECT * FROM doc_freshness`
