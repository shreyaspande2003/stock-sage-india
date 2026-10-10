// Express Server — StockSage India Backend
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const stockRoutes = require('./routes/stocks.cjs');
const analysisRoutes = require('./routes/analysis.cjs');
const portfolioRoutes = require('./routes/portfolio.cjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API Routes
app.use('/api/stocks', stockRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/portfolio', portfolioRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n🚀 StockSage India API running on http://localhost:${PORT}`);
  console.log(`📊 Ready to analyze Indian stocks!\n`);
});

module.exports = app;
