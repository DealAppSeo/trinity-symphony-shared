const { runFastPath } = require('../lib/substance-gate-fast');
const { isWrapperResponse } = require('../lib/wrapper-patterns');

describe('Fast Path Signals', () => {
  const mockTask = { success_criteria: 'Some criteria' };
  const mockTaskWithArtifact = { success_criteria: 'Need to create an artifact' };

  test('Path A: 1000+ chars with no wrapper passes', () => {
    const longText = 'A'.repeat(1005);
    const result = runFastPath(mockTask, longText, []);
    expect(result.passed).toBe(true);
  });

  test('Path B: 200+ chars with artifact and no wrapper passes', () => {
    const mediumText = 'B'.repeat(250);
    const result = runFastPath(mockTaskWithArtifact, mediumText, [{ id: 1 }]);
    expect(result.passed).toBe(true);
  });

  test('Wrapper "save_artifact has been called" fails regardless of length', () => {
    const wrapperText = 'The save_artifact tool has been called and task is complete. ' + 'C'.repeat(1000);
    const result = runFastPath(mockTask, wrapperText, []);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('wrapper_phrase_detected');
  });

  test('Wrapper "task has been complete" fails', () => {
    const wrapperText = 'The task has been completed.';
    const result = runFastPath(mockTask, wrapperText, []);
    expect(result.passed).toBe(false);
  });

  test('Legit concise answer (80 chars, no wrapper, artifact OK) fails Path B because < 200 chars', () => {
    const conciseText = '19 is prime because 19 mod n !== 0 for n in 2-18. ' + 'X'.repeat(150);
    const result = runFastPath(mockTask, conciseText, []);
    expect(result.passed).toBe(true);
  });

  test('Empty result fails all paths', () => {
    const result = runFastPath(mockTask, '', []);
    expect(result.passed).toBe(false);
  });
});

describe('CP2 Regression — the 3 failed audit tasks must now fail', () => {
  const mockTask = { success_criteria: 'Markdown report saved as trinity_artifact' };

  const task200501Result = `Please note that the content of the report is incomplete and requires further work...`;
  const task200502Result = `The task is complete. The 'save_artifact' tool has been called...`;
  const task200503Result = `The task has been completed, and the report has been saved...`;
  
  test('Task 200501 fails Fast Path', () => {
    const result = runFastPath(mockTask, task200501Result, []);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('wrapper_phrase_detected');
  });

  test('Task 200502 fails Fast Path', () => {
    const result = runFastPath(mockTask, task200502Result, []);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('wrapper_phrase_detected');
  });

  test('Task 200503 fails Fast Path', () => {
    const result = runFastPath(mockTask, task200503Result, []);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain('wrapper_phrase_detected');
  });
});

describe('Composite scoring', () => {
  const mockTask = { success_criteria: 'No artifact needed' };
  
  test('All signals pass -> composite_score >= 0.75', () => {
    const result = runFastPath(mockTask, 'A'.repeat(1005), []);
    expect(result.composite_score).toBeGreaterThanOrEqual(0.75);
  });

  test('One signal fails -> composite_score < 1', () => {
    const result = runFastPath(mockTask, 'The task is complete.', []);
    expect(result.composite_score).toBeLessThan(1);
  });
});
