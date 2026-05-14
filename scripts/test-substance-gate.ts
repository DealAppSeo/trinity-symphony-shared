const ConstitutionalAgentV4 = require('../lib/ConstitutionalAgentV4');

async function testGate() {
  const agent = new ConstitutionalAgentV4({ name: 'trinity-tester' });
  
  // Mock supabase to return missing artifact
  agent.supabase = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null })
            })
          })
        })
      })
    })
  } as any;

  console.log("Testing placeholder...");
  const result1 = await agent.validateSubstance('Here is the [insert data]', { id: 'test-123' } as any, null);
  console.log('Result 1:', result1);

  console.log("Testing short length...");
  const result2 = await agent.validateSubstance('Too short', { id: 'test-123' } as any, null);
  console.log('Result 2:', result2);

  console.log("Testing success criteria missing overlap...");
  const output = "This is a long enough output that meets the two hundred character minimum length requirement to pass the length check. " + "A".repeat(150);
  agent.log = async () => {};
  const result3 = await agent.validateSubstance(output, { 
    id: 'test-123', 
    success_criteria: 'You must include the precise words spectral classification algorithm'
  } as any, null);
  console.log('Result 3:', result3);

  console.log("Testing missing artifact...");
  const result4 = await agent.validateSubstance(output + " spectral classification algorithm", { 
    id: 'test-123',
    task_type: 'report'
  } as any, null);
  console.log('Result 4:', result4);
}

testGate().catch(console.error);
