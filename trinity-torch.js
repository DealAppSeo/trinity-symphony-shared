require('child_process').spawn('node', ['scripts/run-agent.js', 'TORCH'], { stdio: 'inherit', shell: true });
