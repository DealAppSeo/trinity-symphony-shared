require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-torch'], { stdio: 'inherit', shell: true });
