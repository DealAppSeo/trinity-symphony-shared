require('child_process').spawn('node', ['scripts/run-agent.js', 'ORCH'], { stdio: 'inherit', shell: true });
