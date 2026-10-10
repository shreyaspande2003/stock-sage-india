// Portfolio routes — CSV upload, analysis, recommendations
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { aggregateStockData } = require('../services/dataAggregator.cjs');
const { isInitialized, runExpertPipeline } = require('../services/aiEngine.cjs');
const yahooFinance = require('../services/yahooFinance.cjs');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// Upload and parse portfolio CSV
router.post('/upload', upload.single('portfolio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const csvContent = req.file.buffer.toString('utf-8');
    
    // Parse CSV with flexible column detection
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    // Detect column names (flexible mapping)
    const columnMap = detectColumns(Object.keys(records[0]));
    
    const holdings = records.map(row => ({
      symbol: (row[columnMap.symbol] || '').toUpperCase().trim(),
      quantity: parseFloat(row[columnMap.quantity]) || 0,
      buyPrice: parseFloat(row[columnMap.buyPrice]) || 0,
      buyDate: row[columnMap.buyDate] || '',
    })).filter(h => h.symbol && h.quantity > 0);

    if (holdings.length === 0) {
      return res.status(400).json({ 
        error: 'No valid holdings found. Expected columns: Symbol, Quantity, BuyPrice, BuyDate',
        detectedColumns: Object.keys(records[0]),
      });
    }

    const { mapPool } = require('../utils/pool.cjs');
    const enrichedHoldings = await mapPool(holdings, 4, async (holding) => {
      try {
        const quote = await yahooFinance.getQuote(holding.symbol);
        const currentValue = quote.price * holding.quantity;
        const investedValue = holding.buyPrice * holding.quantity;
        const pnl = currentValue - investedValue;
        const pnlPercent = investedValue > 0 ? ((pnl / investedValue) * 100) : 0;

        return {
          ...holding,
          name: quote.name,
          currentPrice: quote.price,
          currentValue,
          investedValue,
          pnl,
          pnlPercent: Math.round(pnlPercent * 100) / 100,
          dayChange: quote.changePercent,
        };
      } catch (err) {
        return {
          ...holding,
          error: `Could not fetch data for ${holding.symbol}`,
          currentPrice: 0,
          currentValue: 0,
          investedValue: holding.buyPrice * holding.quantity,
          pnl: 0,
          pnlPercent: 0,
        };
      }
    });

    // Portfolio summary
    const totalInvested = enrichedHoldings.reduce((sum, h) => sum + h.investedValue, 0);
    const totalCurrent = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPercent = totalInvested > 0 ? ((totalPnl / totalInvested) * 100) : 0;

    res.json({
      holdings: enrichedHoldings,
      summary: {
        totalHoldings: enrichedHoldings.length,
        totalInvested: Math.round(totalInvested),
        totalCurrentValue: Math.round(totalCurrent),
        totalPnl: Math.round(totalPnl),
        totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
        topGainer: enrichedHoldings.reduce((best, h) => h.pnlPercent > (best?.pnlPercent || -Infinity) ? h : best, null),
        topLoser: enrichedHoldings.reduce((worst, h) => h.pnlPercent < (worst?.pnlPercent || Infinity) ? h : worst, null),
      },
    });
  } catch (err) {
    console.error('[Portfolio] Upload error:', err.message);
    res.status(500).json({ error: 'Failed to parse portfolio CSV: ' + err.message });
  }
});

// Analyze a specific portfolio holding
router.post('/analyze-holding', async (req, res) => {
  try {
    const { symbol, quantity, buyPrice } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    if (!isInitialized()) {
      return res.status(400).json({ error: 'AI engine not initialized. Set your OpenRouter API key.' });
    }

    const stockData = await aggregateStockData(symbol);
    const expertAnalysis = await runExpertPipeline(stockData);

    // Add portfolio-specific context to the analysis
    const currentPrice = stockData.quote.price;
    const portfolioContext = {
      holdingQuantity: quantity,
      buyPrice,
      currentPrice,
      pnl: quantity ? (currentPrice - buyPrice) * quantity : 0,
      pnlPercent: buyPrice ? ((currentPrice - buyPrice) / buyPrice * 100) : 0,
    };

    res.json({
      symbol: symbol.toUpperCase(),
      analyzedAt: new Date().toISOString(),
      portfolioContext,
      quote: stockData.quote,
      technicals: stockData.technicals,
      swingPlaybook: stockData.swingPlaybook,
      expertAnalysis,
      chartData: stockData.chartData,
    });
  } catch (err) {
    console.error('[Portfolio] Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Holistic portfolio-level AI analysis — one call for the entire portfolio
router.post('/analyze-all', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || !holdings.length) {
      return res.status(400).json({ error: 'Holdings data is required' });
    }
    if (!isInitialized()) {
      return res.status(400).json({ error: 'AI engine not initialized. Set your OpenRouter API key first.' });
    }

    const { analyzeWithAgent } = require('../services/aiEngine.cjs');
    const cache = require('../utils/cache.cjs');
    
    const cacheKey = `portfolioAnalysis:${holdings.map(h => h.symbol).sort().join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Build condensed portfolio summary for AI
    const totalInvested = holdings.reduce((s, h) => s + (h.investedValue || h.buyPrice * h.quantity), 0);
    const totalCurrent = holdings.reduce((s, h) => s + (h.currentValue || h.currentPrice * h.quantity), 0);
    const totalPnl = totalCurrent - totalInvested;

    const portfolioContext = {
      symbol: 'PORTFOLIO',
      quote: {
        name: 'Full Portfolio Analysis',
        price: totalCurrent,
        sector: 'Diversified',
        industry: 'Multi-sector',
      },
      technicals: { error: 'N/A — portfolio-level analysis' },
      news: [],
      reddit: { posts: [], summary: {} },
    };

    const holdingsSummary = holdings.map(h => ({
      symbol: h.symbol,
      qty: h.quantity,
      buyPrice: h.buyPrice,
      currentPrice: h.currentPrice,
      pnl: h.pnl,
      pnlPercent: h.pnlPercent,
      allocation: totalCurrent > 0 ? ((h.currentValue || h.currentPrice * h.quantity) / totalCurrent * 100).toFixed(1) : 0,
    }));

    const agentConfig = {
      name: 'Portfolio Strategist',
      useProModel: false,
      systemPrompt: `You are a Portfolio Strategist for an Indian retail investor. Analyze their ENTIRE portfolio holistically.

Portfolio Overview:
- Total Invested: ₹${totalInvested.toFixed(0)}
- Current Value: ₹${totalCurrent.toFixed(0)}
- Total P&L: ₹${totalPnl.toFixed(0)} (${totalInvested > 0 ? ((totalPnl / totalInvested) * 100).toFixed(2) : 0}%)

Holdings:
${holdingsSummary.map(h => `  ${h.symbol}: ${h.qty} shares @ ₹${h.buyPrice} → ₹${h.currentPrice} (${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent}%, ${h.allocation}% allocation)`).join('\n')}

Analyze for:
1. Portfolio health — sector concentration risk, over/under allocation
2. Profit booking — which winners to partially exit and at what price
3. Loss cutting — which losers to exit or average down
4. Rebalancing — which stocks to increase/decrease allocation
5. New opportunities — based on current holdings, what complementary stocks could improve risk-adjusted returns
6. Overall strategy — swing/mid-term/long-term optimization for maximum profit

Be specific with prices and quantities. Think like a profitable trader helping a friend maximize returns while managing risk.`,
      outputSchema: {
        type: 'OBJECT',
        properties: {
          portfolioHealthScore: { type: 'INTEGER', description: '1-100 portfolio health score' },
          overallAssessment: { type: 'STRING', description: '2-3 sentence portfolio assessment' },
          sectorConcentration: { type: 'STRING', description: 'Assessment of sector diversification' },
          sectorAllocation: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { sector: { type: 'STRING' }, percentage: { type: 'INTEGER' } } },
            description: 'Estimated breakdown of portfolio by sector'
          },
          profitBookingActions: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, action: { type: 'STRING' },
              targetPrice: { type: 'NUMBER' }, quantity: { type: 'STRING' },
              reasoning: { type: 'STRING' },
            }},
          },
          lossCuttingActions: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, action: { type: 'STRING' },
              reasoning: { type: 'STRING' },
            }},
          },
          rebalanceActions: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, direction: { type: 'STRING', description: 'INCREASE, DECREASE, HOLD, EXIT' },
              targetAllocation: { type: 'STRING' }, reasoning: { type: 'STRING' },
            }},
          },
          suggestedNewStocks: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, reasoning: { type: 'STRING' },
              suggestedEntry: { type: 'STRING' },
            }},
          },
          overallStrategy: { type: 'STRING', description: 'Actionable paragraph — what to do this week for maximum profit' },
          riskWarnings: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['portfolioHealthScore', 'overallAssessment', 'sectorAllocation', 'profitBookingActions', 'rebalanceActions', 'overallStrategy'],
      },
    };

    const analysis = await analyzeWithAgent(agentConfig, portfolioContext);

    const result = {
      analyzedAt: new Date().toISOString(),
      holdingsCount: holdings.length,
      totalInvested,
      totalCurrent,
      totalPnl,
      analysis,
    };

    cache.set(cacheKey, result, 1800);
    res.json(result);
  } catch (err) {
    console.error('[Portfolio] Full analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Detect column names from CSV headers (flexible)
function detectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  
  const findCol = (candidates) => {
    for (const c of candidates) {
      const idx = lower.findIndex(h => h.includes(c));
      if (idx !== -1) return headers[idx];
    }
    return headers[0]; // fallback
  };

  return {
    symbol: findCol(['symbol', 'ticker', 'stock', 'scrip', 'name']),
    quantity: findCol(['quantity', 'qty', 'shares', 'units', 'count']),
    buyPrice: findCol(['buyprice', 'avgprice', 'price', 'cost', 'avg', 'purchase']),
    buyDate: findCol(['buydate', 'date', 'purchasedate', 'bought']),
  };
}

module.exports = router;
