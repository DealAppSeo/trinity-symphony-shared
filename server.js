const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from core-documents
app.use('/docs', express.static(path.join(__dirname, 'core-documents')));

// Root endpoint - list available documents
app.get('/', (req, res) => {
  const docsPath = path.join(__dirname, 'core-documents');
  
  try {
    const files = fs.readdirSync(docsPath)
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        name: f,
        url: `/docs/${f}`
      }));
    
    res.json({
      status: 'Trinity Symphony Shared Documentation',
      version: '1.0.0',
      documents: files,
      health: 'OK'
    });
  } catch (err) {
    res.json({
      status: 'Trinity Symphony Shared Documentation',
      version: '1.0.0',
      error: 'core-documents directory not found',
      health: 'OK'
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Trinity Symphony Shared Docs running on port ${PORT}`);
});
