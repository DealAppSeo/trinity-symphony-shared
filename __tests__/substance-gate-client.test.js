const { postSubstanceGateEvent } = require('../lib/substance-gate-client');
const fetch = require('node-fetch');

jest.mock('node-fetch');

describe('postSubstanceGateEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('handles successful requests', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, gateEventId: 'fake-uuid' })
    });

    const result = await postSubstanceGateEvent({ task: { id: 1 }, fastResult: { passed: true }, agentName: 'test', contentHash: 'abc' });
    expect(result.success).toBe(true);
    expect(result.gateEventId).toBe('fake-uuid');
  });

  it('handles gracefully degradation on timeout or error', async () => {
    const origError = console.error;
    console.error = jest.fn();

    fetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await postSubstanceGateEvent({ task: { id: 1 }, fastResult: { passed: true }, agentName: 'test', contentHash: 'abc' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Network failure');
    expect(console.error).toHaveBeenCalled();

    console.error = origError;
  });
});
