const { computeContentHash } = require('../lib/wrapper-patterns');

describe('computeContentHash', () => {
  test('Two wrapper completions with same template produce same hash', () => {
    const text1 = "The task is complete. The save_artifact tool has been called.";
    const text2 = "the task is complete. the save_artifact tool has been called.";
    expect(computeContentHash(text1)).toBe(computeContentHash(text2));
  });
  
  test('Different text produces different hash', () => {
    const text1 = "The task is complete.";
    const text2 = "The work has been completed.";
    expect(computeContentHash(text1)).not.toBe(computeContentHash(text2));
  });
  
  test('Whitespace differences normalize to same hash', () => {
    const text1 = "the task   is   complete";
    const text2 = "the task is complete";
    expect(computeContentHash(text1)).toBe(computeContentHash(text2));
  });

  test('Empty or null input returns valid SHA-256 hex string', () => {
    const hash = computeContentHash('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('Hash is deterministic across calls', () => {
    const text = "Some result text";
    expect(computeContentHash(text)).toBe(computeContentHash(text));
  });
});
