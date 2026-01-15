require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-nexus'], { stdio: 'inherit', shell: true });
