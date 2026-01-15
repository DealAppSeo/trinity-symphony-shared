require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-veritas'], { stdio: 'inherit', shell: true });
