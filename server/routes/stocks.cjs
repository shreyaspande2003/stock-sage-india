// Stock routes — search, quotes, historical data
const express = require('express');
const router = express.Router();
const yahooFinance = require('../services/yahooFinance.cjs');
const { scanSwingUniverse } = require('../services/screener.cjs');

// Search stocks
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 1) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const results = await yahooFinance.searchStocks(q);
    res.json({ results });
  } catch (err) {
    console.error('[Route] Search error:', err.message);
    res.status(500).json({ error: 'Failed to search stocks' });
  }
});

// Get stock quote
router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const quote = await yahooFinance.getQuote(symbol);
    res.json({ quote });
  } catch (err) {
    console.error('[Route] Quote error:', err.message);
    res.status(500).json({ error: `Failed to fetch quote for ${req.params.symbol}` });
  }
});

// Get historical data
router.get('/historical/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { range = '6mo', interval = '1d' } = req.query;
    const data = await yahooFinance.getHistorical(symbol, range, interval);
    res.json({ data });
  } catch (err) {
    console.error('[Route] Historical error:', err.message);
    res.status(500).json({ error: `Failed to fetch historical data for ${req.params.symbol}` });
  }
});

router.get('/scan', async (req, res) => {
  try {
    const tier = req.query.tier || 'PRO';
    const scan = await scanSwingUniverse(tier);
    res.json(scan);
  } catch (err) {
    console.error('[Route] Scan error:', err.message);
    res.status(500).json({ error: 'Failed to scan swing universe' });
  }
});

// Morning Breakout & Coiled Spring Live Trigger Radar
const { getMorningBreakoutTriggers } = require('../services/morningTriggerEngine.cjs');
router.get('/morning-triggers', async (req, res) => {
  try {
    const tier = req.query.tier || 'PRO';
    const data = await getMorningBreakoutTriggers(tier);
    res.json(data);
  } catch (err) {
    console.error('[Route] Morning triggers error:', err.message);
    res.status(500).json({ error: 'Failed to fetch morning breakout triggers' });
  }
});

// Get current market regime
const { getMarketRegime } = require('../services/regimeEngine.cjs');
router.get('/regime', async (req, res) => {
  try {
    const regime = await getMarketRegime();
    res.json(regime);
  } catch (err) {
    console.error('[Route] Regime error:', err.message);
    res.status(500).json({ error: 'Failed to fetch market regime' });
  }
});

// Run or fetch portfolio backtest results
const { PortfolioBacktest } = require('../backtest/portfolio_backtest.cjs');
const cache = require('../utils/cache.cjs');
router.get('/backtest', async (req, res) => {
  try {
    const cacheKey = 'backtest:portfolio:results';
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const bt = new PortfolioBacktest(500000);
    const results = await bt.run(1.5);
    cache.set(cacheKey, results, 3600); // 1 hour cache
    res.json(results);
  } catch (err) {
    console.error('[Route] Backtest error:', err.message);
    res.status(500).json({ error: 'Failed to run backtest' });
  }
});

module.exports = router;
