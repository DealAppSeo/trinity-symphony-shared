#!/usr/bin/env node
// sync-docs.js - Run locally to sync GitHub → Supabase
// Usage: node sync-docs.js

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qnnpjhlxljtqyigedwkb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const docs = [
  { id: 'GROK-RULES', category: 'minimal', path: 'docs/GROK-RULES.md' },
  { id: 'CLAUDE-RULES', category: 'minimal', path: 'docs/CLAUDE-RULES.md' },
  { id: 'MISSION-CONTROL', category: 'minimal', path: 'docs/MISSION-CONTROL.md' },
  { id: 'QUICK-REFERENCE-CARD', category: 'minimal', path: 'docs/QUICK-REFERENCE-CARD.md' },
  { id: 'WISDOM-PROTOCOL', category: 'comprehensive', path: 'docs/core/WISDOM-PROTOCOL.md' },
  { id: 'HANDOFF-PROTOCOL', category: 'protocol', path: 'docs/protocols/HANDOFF-PROTOCOL.md' },
  { id: 'ATM-MASTER-PROMPT', category: 'agent', path: 'docs/agents/ATM-MASTER-PROMPT.md' },
  { id: 'TRINITY-COMMAND-CENTER', category: 'comprehensive', path: 'docs/TRINITY-COMMAND-CENTER.md' },
  { id: 'START-HERE-SUMMARY', category: 'overview', path: 'docs/00-START-HERE-SUMMARY.md' },
  { id: 'CONSULTING-AI-BRIEF', category: 'overview', path: 'docs/CONSULTING-AI-BRIEF.md' },
  { id: 'README', category: 'overview', path: 'docs/README.md' }
];

async function syncDocs() {
  console.log('🔄 Syncing docs from GitHub → Supabase...\n');

  for (const doc of docs) {
    const githubUrl = `https://raw.githubusercontent.com/DealAppSeo/trinity-symphony-shared/main/${doc.path}`;
    
    try {
      // Fetch from GitHub
      const response = await fetch(githubUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const content = await response.text();
      
      // Upsert to Supabase
      const { error } = await supabase
        .from('system_docs')
        .upsert({
          id: doc.id,
          content: content,
          category: doc.category,
          github_url: githubUrl,
          last_synced: new Date().toISOString()
        }, { onConflict: 'id' });

      if (error) throw error;

      console.log(`✅ ${doc.id.padEnd(25)} (${(content.length / 1024).toFixed(1)}KB)`);
      
    } catch (error) {
      console.log(`❌ ${doc.id.padEnd(25)} - ${error.message}`);
    }
  }

  console.log('\n🎉 Sync complete!');
  
  // Verify
  const { data, error } = await supabase
    .from('system_docs')
    .select('id, category, last_synced')
    .order('category', { ascending: true });

  if (!error && data) {
    console.log('\n📊 Verification:');
    data.forEach(doc => {
      console.log(`   ${doc.id}: ${doc.category} (${doc.last_synced})`);
    });
  }
}

syncDocs().catch(console.error);
