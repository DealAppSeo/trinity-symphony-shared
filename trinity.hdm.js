const http = require('http');
const PORT = process.env.PORT || 10000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('HDM running');
}).listen(PORT);

setInterval(pollAndExecute, 60000); // 60s
pollAndExecute(); // Initial run
