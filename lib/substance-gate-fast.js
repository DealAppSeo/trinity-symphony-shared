const { isWrapperResponse, computeContentHash, NO_OP_HASH_SET } = require('./wrapper-patterns');

function runFastPath(task, resultText, artifacts) {
  // Read env config with fallbacks
  const minCharsLong = parseInt(process.env.SUBSTANCE_GATE_MIN_CHARS_LONG || '1000', 10);
  const minCharsShort = parseInt(process.env.SUBSTANCE_GATE_MIN_CHARS_SHORT || '200', 10);
  
  const charCount = resultText ? resultText.length : 0;
  
  // Signal 1: Chars
  const charsPassed = charCount >= minCharsShort;
  
  // Signal 2: Wrapper regex
  const wrapperPassed = !isWrapperResponse(resultText);
  
  // Signal 3: Artifact count
  // Require artifact > 0 if success_criteria mentions artifact
  const successCriteria = (task && task.success_criteria) ? task.success_criteria.toLowerCase() : '';
  const requiresArtifact = successCriteria.includes('artifact');
  const artifactCount = Array.isArray(artifacts) ? artifacts.length : 0;
  const artifactPassed = requiresArtifact ? artifactCount > 0 : true;
  
  // Signal 4: No-op content hash
  const contentHash = computeContentHash(resultText);
  const noopPassed = !NO_OP_HASH_SET.has(contentHash);
  
  const signals = {
    chars: { passed: charsPassed, value: charCount },
    wrapper: { passed: wrapperPassed },
    artifact: { passed: artifactPassed },
    noop: { passed: noopPassed }
  };
  
  // Composite Rule
  let passed = false;
  
  // Path A: Long enough to be substantive, no wrapper, no no-op
  if (charCount >= minCharsLong && wrapperPassed && noopPassed) {
    passed = true;
  }
  // Path B: Shorter but ALL other signals clean AND artifact present if required
  else if (charCount >= minCharsShort && wrapperPassed && noopPassed && artifactPassed) {
    passed = true;
  }
  
  const failures = getFailureReasons(signals);
  
  // Composite score: simple ratio of passed signals (0 to 1)
  const score = [
    charCount >= minCharsLong || charsPassed, 
    wrapperPassed, 
    artifactPassed, 
    noopPassed
  ].filter(Boolean).length / 4;
  
  return {
    passed,
    failures,
    composite_score: score,
    signals
  };
}

function getFailureReasons(signals) {
  const reasons = [];
  if (!signals.chars.passed) reasons.push('output_too_short');
  if (!signals.wrapper.passed) reasons.push('wrapper_phrase_detected');
  if (!signals.artifact.passed) reasons.push('artifact_missing');
  if (!signals.noop.passed) reasons.push('known_noop_pattern');
  return reasons;
}

module.exports = {
  runFastPath
};
