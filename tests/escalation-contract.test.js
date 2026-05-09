const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

// Mock dependencies
process.env.ESCALATION_CONTRACT = 'true';
process.env.AGENT_NAME = 'trinity-veritas';
process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'secret';

const mockSupabase = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: null }),
    single: jest.fn().mockResolvedValue({ data: { reputation_score: 50, tasks_completed: 0 } })
};

jest.mock('@supabase/supabase-js', () => ({
    createClient: () => mockSupabase
}));

describe('ConstitutionalAgentV4 Escalation Contract', () => {
    let agent;

    beforeEach(() => {
        jest.clearAllMocks();
        agent = new ConstitutionalAgentV4();
    });

    test('Step 2: Understand Task - fails on missing success_criteria', async () => {
        const task = { id: 1, title: 'Test', description: 'Long enough description', success_criteria: '' };
        const result = await agent.understandTask(task);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('success_criteria_missing');
    });

    test('Step 3: Capability Check - fails on unknown task_type', async () => {
        const task = { id: 1, task_type: 'unknown_magic' };
        const result = await agent.checkCapability(task);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('unknown_task_type');
    });

    test('Step 6: Artifact Guard - triggers on missing artifact', async () => {
        agent.callLLM = jest.fn().mockResolvedValue({ output: 'Simulated work with no artifact' });
        agent.evaluateResult = jest.fn().mockResolvedValue({ score: 90 });
        agent.recordConfused = jest.fn().mockResolvedValue();
        
        const task = { id: 1, title: 'Test', description: 'Description', success_criteria: 'Criteria' };
        await agent.processTaskContract(task);
        
        expect(agent.recordConfused).toHaveBeenCalledWith(task, 'artifact_missing', expect.any(Object));
    });

    test('Backward Compatibility - runLoopLegacy called when flag is false', async () => {
        process.env.ESCALATION_CONTRACT = 'false';
        const agentCompat = new ConstitutionalAgentV4();
        agentCompat.runLoopLegacy = jest.fn().mockResolvedValue();
        
        await agentCompat.runLoop();
        expect(agentCompat.runLoopLegacy).toHaveBeenCalled();
        process.env.ESCALATION_CONTRACT = 'true'; // Restore
    });
});
