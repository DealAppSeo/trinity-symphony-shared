require('child_process').spawn('npx', ['ts-node', 'scripts/run-agent.ts', 'trinity-apm'], { stdio: 'inherit', shell: true });
