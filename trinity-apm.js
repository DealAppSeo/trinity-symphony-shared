require('child_process').spawn('node', ['scripts/run-agent.js', 'APM'], { stdio: 'inherit', shell: true });
