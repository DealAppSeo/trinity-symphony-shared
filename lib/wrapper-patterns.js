const crypto = require('crypto');

// Phase 2.5 wrapper-completion patterns observed in CP2 audit tasks
// Update this list as new patterns emerge. Document each addition in comments.
const WRAPPER_REGEX = new RegExp(
  [
    // The classic "tool was called" wrapper
    String.raw`save_artifact\s+(tool\s+)?(has been|was|is)\s+(called|invoked|executed)`,
    
    // Generic "task complete" wrapper claiming completion without substance
    String.raw`(the\s+)?task\s+(is|has been|was)\s+complete[d]?(\.|$)`,
    
    // "Report saved" wrapper
    String.raw`(the\s+)?report\s+(has been|was|is)\s+(saved|generated|created)\s+as\s+(an?\s+)?artifact`,
    
    // "Work has been done" wrapper
    String.raw`(the\s+)?(work|task)\s+(has been|was)\s+(completed|finalized|finished)`,
    
    // Sophia's task 200438 pattern: incomplete + apology
    String.raw`content\s+of\s+the\s+report\s+is\s+incomplete\s+and\s+requires`,
    
    // Generic "I will/would" deferral without doing the work
    String.raw`^.{0,100}(I will|I would|I can)\s+(provide|create|generate|write|build).{0,500}$`
  ].join('|'),
  'i' // case-insensitive
);

function isWrapperResponse(text) {
  if (!text) return false;
  return WRAPPER_REGEX.test(text);
}

function computeContentHash(text) {
  if (!text) return '';
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Known lazy template hashes. 
// Seeded with hashes from CP2 audit tasks 200501, 200502, 200503
const NO_OP_HASH_SET = new Set([
  computeContentHash(`Please note that the content of the report is incomplete and requires`),
  computeContentHash(`The task is complete. The 'save_artifact' tool has been called`),
  computeContentHash(`The task has been completed, and the report has been saved`)
]);

module.exports = {
  WRAPPER_REGEX,
  isWrapperResponse,
  computeContentHash,
  NO_OP_HASH_SET
};
