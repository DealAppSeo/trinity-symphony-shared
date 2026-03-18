const { ConstitutionalAgent, AGENT_WISDOM } = require('./constitutional-agent-base');
const dotenv = require('dotenv');

dotenv.config({ path: 'c:/Users/Cash4/OneDrive/Desktop/trinity-ecosystem/trinity-ecosystem/.env.local' });

process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function testReflection() {
    console.log("🧪 Testing v8.2.0 reflectOnResult...");

    // Debug: check AGENT_WISDOM availability
    console.log("🔍 AGENT_WISDOM keys available to test:", Object.keys(AGENT_WISDOM));

    const agent = new ConstitutionalAgent({
        name: 'ORCH'
    });

    console.log("🔍 Agent name after init:", agent.name);
    console.log("🔍 Agent wisdom after init:", JSON.stringify(agent.wisdom, null, 2));

    const mockTask = {
        id: 999999999,
        title: 'Test Reflection Connectivity',
        description: 'Verify the reflectOnResult method can call the LLM and write to sprint_updates.'
    };

    const mockResult = {
        output: 'The test was a success. The systems are aligned and the Merkle DAG is ready for ingestion.'
    };

    try {
        const reflection = await agent.reflectOnResult(mockTask, mockResult);
        console.log("✅ Reflection produced:", reflection);
        console.log("🚀 Test complete. Check Supabase 'sprint_updates' for the reflection row.");
    } catch (error) {
        console.error("❌ Test failed:", error.message);
    }
}

testReflection();
