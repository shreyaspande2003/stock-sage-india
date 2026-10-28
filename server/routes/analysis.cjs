// Analysis routes — full expert pipeline analysis
const express = require('express');
const router = express.Router();
const { aggregateStockData } = require('../services/dataAggregator.cjs');
const { initializeAI, isInitialized, runExpertPipeline, setModels } = require('../services/aiEngine.cjs');
const { getMarketNews } = require('../services/newsService.cjs');
const cache = require('../utils/cache.cjs');

// Initialize AI with API key
router.post('/init', (req, res) => {
  try {
    const { apiKey, useProModel } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'OpenRouter API key is required' });
    }
    initializeAI(apiKey);
    if (useProModel !== undefined) {
      setModels(useProModel);
    }
    res.json({ success: true, message: 'AI engine initialized successfully' });
  } catch (err) {
    console.error('[Route] Init error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Check if AI is initialized
router.get('/status', (req, res) => {
  res.json({ initialized: isInitialized() });
});

// Fetch raw market data (stage 1)
router.post('/data', async (req, res) => {
  try {
    const { symbol, newsApiKey } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Stock symbol is required' });
    
    console.log(`[Analysis] Fetching market data for ${symbol}...`);
    const stockData = await aggregateStockData(symbol, { newsApiKey });
    
    res.json({
      symbol: symbol.toUpperCase(),
      quote: stockData.quote,
      marketRegime: stockData.marketRegime,
      relativeStrength: stockData.relativeStrength,
      technicals: stockData.technicals,
      swingPlaybook: stockData.swingPlaybook,
      quantConsensus: stockData.quantConsensus,
      profitMaximizer: stockData.profitMaximizer,
      news: stockData.news,
      reddit: stockData.reddit,
      chartData: stockData.chartData,
    });
  } catch (err) {
    console.error('[Route] Data error:', err.message);
    res.status(500).json({ error: err.message || 'Data fetch failed' });
  }
});

// Run full analysis on a stock (stage 2)
router.post('/analyze', async (req, res) => {
  try {
    const { symbol, newsApiKey } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Stock symbol is required' });
    }
    if (!isInitialized()) {
      return res.status(400).json({ error: 'AI engine not initialized. Set your OpenRouter API key in Settings.' });
    }

    // Check cache for full analysis
    const cacheKey = `fullAnalysis:${symbol.toUpperCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[Analysis] Serving cached analysis for ${symbol}`);
      return res.json(cached);
    }

    console.log(`[Analysis] Starting AI analysis for ${symbol}...`);
    
    // Step 1: Ensure data is aggregated (fast if already cached from /data)
    const stockData = await aggregateStockData(symbol, { newsApiKey });

    // Step 2: Run through expert pipeline
    const expertAnalysis = await runExpertPipeline(stockData);

    const result = {
      symbol: symbol.toUpperCase(),
      analyzedAt: new Date().toISOString(),
      quote: stockData.quote,
      marketRegime: stockData.marketRegime,
      relativeStrength: stockData.relativeStrength,
      technicals: stockData.technicals,
      swingPlaybook: stockData.swingPlaybook,
      quantConsensus: stockData.quantConsensus,
      profitMaximizer: stockData.profitMaximizer,
      news: stockData.news,
      reddit: stockData.reddit,
      chartData: stockData.chartData,
      expertAnalysis,
    };

    // Only cache if AI actually succeeded (chief strategist has a real verdict)
    const hasRealAnalysis = expertAnalysis?.chiefStrategist && !expertAnalysis.chiefStrategist.error;
    if (hasRealAnalysis) {
      cache.set(cacheKey, result, 1800); // 30-min cache
    }
    res.json(result);
  } catch (err) {
    console.error('[Route] Analysis error:', err.message);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

// Get market news
router.get('/market-news', async (req, res) => {
  try {
    const news = await getMarketNews();
    res.json({ news });
  } catch (err) {
    console.error('[Route] Market news error:', err.message);
    res.status(500).json({ error: 'Failed to fetch market news' });
  }
});

module.exports = router;
