const fs = require('fs');

const files = [
    'apm/ConstitutionalAgentV4.js',
    'auto_updater.js',
    'constitutional-agent-base.js',
    'gcm/ConstitutionalAgentV4.js',
    'hdm/ConstitutionalAgentV4.js',
    'mel/ConstitutionalAgentV4.js',
    'skills',
    'lib/ConstitutionalAgent.ts',
    'sync-docs.js',
    'lib/ConstitutionalAgentV4.js',
    'lib/supabase.ts',
    'w3c.index.js'
];

files.forEach(file => {
    if (!fs.existsSync(file)) return;
    let content = fs.readFileSync(file, 'utf8');

    // For JS files, add const WebSocket = require('ws');
    if (file.endsWith('.js') || file === 'skills') {
        if (!content.includes("require('ws')") && !content.includes("require(\"ws\")")) {
            content = content.replace(/(const \{ createClient \} = require\('@supabase\/supabase-js'\);)/, "$1\nconst WebSocket = require('ws');");
        }
    }

    // For TS files, add import ws from 'ws'
    if (file.endsWith('.ts')) {
        if (!content.includes("import ws from 'ws'")) {
            content = content.replace(/(import \{ createClient[^\n]+;)/, "$1\nimport ws from 'ws';");
        }
    }

    // Replace createClient calls
    // Pattern 1: createClient(url, key)
    content = content.replace(/createClient\(([^,]+),\s*([^,\)]+)\)/g, (match, a, b) => {
        return "createClient(" + a + ", " + b + ", { realtime: { transport: " + (file.endsWith('.ts') ? "ws" : "WebSocket") + " } })";
    });

    // Pattern 2: createClient(url, key, { auth: { persistSession: false } })
    content = content.replace(/createClient\(([^,]+),\s*([^,]+),\s*\{\s*auth:\s*\{\s*persistSession:\s*false\s*\}\s*\}\)/g, (match, a, b) => {
        return "createClient(" + a + ", " + b + ", { auth: { persistSession: false }, realtime: { transport: " + (file.endsWith('.ts') ? "ws" : "WebSocket") + " } })";
    });
    
    // Add console.log smoke test after createClient
    // For `this.supabase = createClient(...)`
    content = content.replace(/(this\.supabase = createClient[^\n]+;)/g, "$1\n        console.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');");

    // For `export const supabase: SupabaseClient = createClient(...)`
    if (file === 'lib/supabase.ts') {
        if (!content.includes('console.log')) {
            content += "\nconsole.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');\n";
        }
    }
    // For generic `const supabase = ...` or `supabase = ...`
    content = content.replace(/^(\s*const\s+supabase\s*=\s*createClient[^\n]+;)/gm, "$1\n$1".replace(/const\s+supabase\s*=\s*createClient[^\n]+;/, "console.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');"));
    content = content.replace(/^(\s*)supabase\s*=\s*createClient([^\n]+;)/gm, "$1supabase = createClient$2\n$1console.log('[SUPABASE] ? Client initialized with ws transport (Node ' + process.version + ')');");

    fs.writeFileSync(file, content, 'utf8');
    console.log('Updated ' + file);
});
