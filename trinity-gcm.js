require('child_process').spawn('node', ['scripts/run-agent.js', 'GCM'], { stdio: 'inherit', shell: true });
