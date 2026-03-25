import * as fs from 'fs';

let content = fs.readFileSync('lib/ConstitutionalAgent.ts', 'utf8');

// Injection 1: LLM_PRIORITY array
const routerRegex = /\/\/ Sort available providers by Tier[\s\S]*?sortedProviders\.push\(\.\.\.this\.availableProviders\);\s*\}/;
const routerReplace = `const LLM_PRIORITY = [
                { provider: 'groq', key: process.env.GROQ_API_KEY, direct: true },
                { provider: 'cerebras', key: process.env.CEREBRAS_API_KEY, direct: true },
                { provider: 'deepseek', key: process.env.DEEPSEEK_API_KEY, direct: true },
                { provider: 'gemini', key: process.env.GEMINI_API_KEY, direct: true },
                { provider: 'openrouter', key: process.env.OPENROUTER_API_KEY, direct: true },
                { provider: 'together', key: process.env.TOGETHER_API_KEY, direct: true },
                { provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY, direct: true },
                { provider: 'openai', key: process.env.OPENAI_API_KEY, direct: true },
                { provider: 'litellm', key: process.env.LITELLM_URL, proxy: true }
            ];

            let sortedProviders = LLM_PRIORITY.filter(p => !!p.key).map(p => p.provider);
            if (sortedProviders.length === 0 && this.availableProviders.length > 0) {
                sortedProviders.push(...this.availableProviders);
            }`;

if (content.match(routerRegex)) {
    content = content.replace(routerRegex, routerReplace);
    console.log("INJECTION 1 SUCCESS: LLM Priority Array");
} else {
    console.log("INJECTION 1 FAILED: Could not find router logic.");
}

// Injection 1b: litellm specific provider mapping
const providerRegex = /if \(provider === 'openai'\) return this\.callOpenAI\(systemPrompt, prompt, tools\);/;
if (content.match(providerRegex) && !content.includes("provider === 'litellm'")) {
    content = content.replace(
        providerRegex,
        `if (provider === 'openai') return this.callOpenAI(systemPrompt, prompt, tools);\n        if (provider === 'litellm') return this.callOpenAICompatible((process.env.LITELLM_URL || 'https://trinity-litellm.railway.app') + '/v1/chat/completions', process.env.LITELLM_MASTER_KEY || 'sk-proxy', 'groq/llama-3.1-70b-versatile', systemPrompt, prompt, tools);`
    );
    console.log("INJECTION 1b SUCCESS: litellm provider loop");
}

// Injection 3: storage_location fallback
const storageRegex = /storage_location:\s*'supabase',/;
if (content.match(storageRegex)) {
    content = content.replace(storageRegex, 'storage_location: artifactUrl || `agent://${this.name}/${Date.now()}`,');
    console.log("INJECTION 3 SUCCESS: storage_location fallback");
} else {
    console.log("INJECTION 3 FAILED: Could not find 'supabase' storage.");
}

fs.writeFileSync('lib/ConstitutionalAgent.ts', content);
console.log("File saved.");
