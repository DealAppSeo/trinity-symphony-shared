require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-mel'], { stdio: 'inherit', shell: true });
