'use strict';
/**
 * Success-path log so Railway deploy logs show which model actually ran.
 * Format must be greppable: [LLM] provider= model= task=
 * Run: node tests/llm-success-log.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatLlmSuccessLine, GROQ_MODEL } = require('../lib/ConstitutionalAgentV4');

const line = formatLlmSuccessLine('groq', GROQ_MODEL, '435124');
assert.equal(line, '[LLM] provider=groq model=openai/gpt-oss-20b task=435124');
assert.ok(!line.includes('llama-3.3-70b-versatile'));

const src = fs.readFileSync(path.join(__dirname, '../lib/ConstitutionalAgentV4.js'), 'utf8');
assert.match(src, /console\.log\(formatLlmSuccessLine\(/);
assert.doesNotMatch(
  src.split('throw new Error(\'All LLMs failed\')')[0],
  /console\.log\(formatLlmSuccessLine[\s\S]*llama-3\.3-70b-versatile/,
);

console.log('llm-success-log.test.js: PASS');
