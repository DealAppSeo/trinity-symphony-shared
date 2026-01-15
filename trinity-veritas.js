require('child_process').spawn('node', ['scripts/run-agent.js', 'VERITAS'], { stdio: 'inherit', shell: true });
