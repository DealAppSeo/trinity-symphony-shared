require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-w3c'], { stdio: 'inherit', shell: true });
