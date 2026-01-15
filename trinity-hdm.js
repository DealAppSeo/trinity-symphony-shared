require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-hdm'], { stdio: 'inherit', shell: true });
