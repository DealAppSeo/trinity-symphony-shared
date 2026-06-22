/**
 * tool_call_log writer for the swarm agents (S-QUORUM Phase 4).
 *
 * Mirrors repid-engine's src/utils/tool-call-logger.ts: appends a row to the hash-chained
 * `tool_call_log` (a BEFORE-INSERT trigger stamps previous_entry_hash). OFF by default — set
 * TOOL_CALL_LOGGING=true to enable. Never throws: a logging failure must not break an agent.
 *
 * Uses the same direct-pg pooler the agent hot paths use. tool_input is stored as jsonb;
 * tool_output is hashed (sha256), never stored raw.
 */
const crypto = require('crypto');
const { pgQuery } = require('./direct-pg');

function isToolCallLoggingEnabled() {
  return process.env.TOOL_CALL_LOGGING === 'true';
}

/**
 * Append a row to tool_call_log. No-op unless TOOL_CALL_LOGGING=true. Never throws.
 * @param {object} p
 * @param {string} p.agentName
 * @param {string} p.toolName
 * @param {*} p.toolInput            stored as jsonb (truncated defensively)
 * @param {*} p.toolOutput           hashed, not stored
 * @param {number} [p.repidAtCall]
 * @param {number} [p.confidenceAtCall]  0..1
 * @param {string} [p.autonomyTier]  'just_do_it' | 'do_then_tell' | 'ask_first'
 * @param {boolean} [p.hitlRequired]
 * @param {string|null} [p.hitlDecision]
 */
async function logToolCall(p) {
  if (!isToolCallLoggingEnabled()) return;
  try {
    const outputHash = crypto.createHash('sha256')
      .update(JSON.stringify(p.toolOutput ?? null))
      .digest('hex');

    let inputJson;
    try {
      inputJson = JSON.stringify(p.toolInput ?? null).slice(0, 10000);
    } catch {
      inputJson = JSON.stringify({ note: 'unserializable tool_input' });
    }

    const confidence = Number.isFinite(p.confidenceAtCall)
      ? Math.max(0, Math.min(1, p.confidenceAtCall))
      : null;
    const repid = Number.isFinite(p.repidAtCall) ? Math.round(p.repidAtCall) : null;

    await pgQuery(
      `INSERT INTO tool_call_log
         (agent_name, tool_name, tool_input, tool_output_hash, repid_at_call,
          confidence_at_call, autonomy_tier, hitl_required, hitl_decision)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)`,
      [
        p.agentName,
        p.toolName,
        inputJson,
        outputHash,
        repid,
        confidence,
        p.autonomyTier ?? null,
        p.hitlRequired ?? false,
        p.hitlDecision ?? null,
      ],
      { retries: 1, timeoutMs: 8000, label: 'tool_call_log.insert' }
    );
  } catch (err) {
    // Never crash an agent over an audit-log write.
    console.error('[tool-call-log] failed:', err && err.message ? err.message : err);
  }
}

module.exports = { logToolCall, isToolCallLoggingEnabled };
