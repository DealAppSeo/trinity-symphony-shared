require('child_process').spawn('node', ['scripts/run-agent.js', 'NEXUS'], { stdio: 'inherit', shell: true });
