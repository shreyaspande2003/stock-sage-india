// Portfolio routes — CSV upload, analysis, recommendations
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { aggregateStockData } = require('../services/dataAggregator.cjs');
const { isInitialized, runExpertPipeline } = require('../services/aiEngine.cjs');
const yahooFinance = require('../services/yahooFinance.cjs');
const { UNIVERSE_200 } = require('../config/universe200.cjs');

// Configure multer for file upload
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB max

// Build quick lookup map for symbols to sectors and market caps
const SECTOR_MAP = {};
UNIVERSE_200.forEach(item => {
  SECTOR_MAP[item.symbol.toUpperCase()] = { sector: item.sector, name: item.name, cap: item.cap };
});

// Shared pipeline to enrich holdings with live quotes, sector mapping, and institutional quant badges
async function processEnrichedPortfolio(holdings) {
  const { mapPool } = require('../utils/pool.cjs');
  const enrichedHoldings = await mapPool(holdings, 4, async (holding) => {
    const sym = holding.symbol.toUpperCase();
    const meta = SECTOR_MAP[sym] || {};
    try {
      const quote = await yahooFinance.getQuote(sym);
      const currentPrice = quote.price || holding.buyPrice;
      const currentValue = currentPrice * holding.quantity;
      const investedValue = holding.buyPrice * holding.quantity;
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? ((pnl / investedValue) * 100) : 0;
      const roundedPnlPct = Math.round(pnlPercent * 100) / 100;

      // Institutional quant action & levels
      const targetPrice = Math.round(holding.buyPrice * 1.08 * 10) / 10;
      const stopLossPrice = Math.round(holding.buyPrice * 0.94 * 10) / 10;
      let quantAction = {
        badge: 'HOLD_IN_BASE',
        label: 'HOLD BASE',
        variant: 'cyan',
        detail: 'Position within normal noise tolerance (-3% to +6%). Hold base and let setup develop.',
      };

      if (roundedPnlPct >= 12) {
        quantAction = {
          badge: 'RIDE_RUNNER',
          label: 'RIDE RUNNER',
          variant: 'success',
          detail: `Up +${roundedPnlPct}%. Super-winner status. Trail stop up to 20-EMA / ₹${Math.round(currentPrice * 0.93)} to capture multi-week trend.`,
        };
      } else if (roundedPnlPct >= 7) {
        quantAction = {
          badge: 'BANK_PROFIT_T1',
          label: 'BOOK 50% (T1)',
          variant: 'emerald',
          detail: `Up +${roundedPnlPct}%. Swing Target 1 reached. Sell 50% shares at market to bank gains; move stop on remaining 50% to Breakeven (₹${holding.buyPrice}).`,
        };
      } else if (roundedPnlPct <= -5.5) {
        quantAction = {
          badge: 'CUT_LOSS',
          label: 'CUT LOSS',
          variant: 'danger',
          detail: `Down ${roundedPnlPct}%. Swing risk threshold (-5.5% to -6%) breached. Exit immediately to preserve trading equity.`,
        };
      }

      return {
        ...holding,
        name: quote.name || meta.name || sym,
        sector: meta.sector || quote.sector || 'Equities',
        cap: meta.cap || 'MID_CAP',
        currentPrice,
        currentValue,
        investedValue,
        pnl,
        pnlPercent: roundedPnlPct,
        dayChange: quote.changePercent || 0,
        targetPrice,
        stopLossPrice,
        quantAction,
      };
    } catch (err) {
      const investedValue = holding.buyPrice * holding.quantity;
      return {
        ...holding,
        name: meta.name || sym,
        sector: meta.sector || 'Equities',
        cap: meta.cap || 'MID_CAP',
        error: `Could not fetch live quote for ${sym}`,
        currentPrice: holding.buyPrice,
        currentValue: investedValue,
        investedValue,
        pnl: 0,
        pnlPercent: 0,
        dayChange: 0,
        targetPrice: Math.round(holding.buyPrice * 1.08),
        stopLossPrice: Math.round(holding.buyPrice * 0.94),
        quantAction: {
          badge: 'HOLD_IN_BASE',
          label: 'HOLD BASE',
          variant: 'cyan',
          detail: 'No live quote available; maintaining cost-basis stop and target.',
        },
      };
    }
  });

  const totalInvested = enrichedHoldings.reduce((sum, h) => sum + h.investedValue, 0);
  const totalCurrent = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? ((totalPnl / totalInvested) * 100) : 0;

  // Real sector breakdown
  const sectorSums = {};
  for (const h of enrichedHoldings) {
    const s = h.sector || 'Equities';
    sectorSums[s] = (sectorSums[s] || 0) + h.currentValue;
  }
  const sectorAllocation = Object.entries(sectorSums).map(([sector, val]) => ({
    sector,
    percentage: totalCurrent > 0 ? Math.round((val / totalCurrent) * 100) : 0,
  })).sort((a, b) => b.percentage - a.percentage);

  return {
    holdings: enrichedHoldings,
    summary: {
      totalHoldings: enrichedHoldings.length,
      totalInvested: Math.round(totalInvested),
      totalCurrentValue: Math.round(totalCurrent),
      totalPnl: Math.round(totalPnl),
      totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
      sectorAllocation,
      topGainer: enrichedHoldings.reduce((best, h) => h.pnlPercent > (best?.pnlPercent || -Infinity) ? h : best, null),
      topLoser: enrichedHoldings.reduce((worst, h) => h.pnlPercent < (worst?.pnlPercent || Infinity) ? h : worst, null),
    },
  };
}

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

    const result = await processEnrichedPortfolio(holdings);
    res.json(result);
  } catch (err) {
    console.error('[Portfolio] Upload error:', err.message);
    res.status(500).json({ error: 'Failed to parse portfolio CSV: ' + err.message });
  }
});

// Manual portfolio submission or real-time refresh
router.post('/manual', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'Holdings array is required' });
    }
    const cleanHoldings = holdings.map(h => ({
      symbol: (h.symbol || '').toUpperCase().trim(),
      quantity: parseFloat(h.quantity) || 0,
      buyPrice: parseFloat(h.buyPrice) || 0,
      buyDate: h.buyDate || new Date().toISOString().split('T')[0],
    })).filter(h => h.symbol && h.quantity > 0);

    if (cleanHoldings.length === 0) {
      return res.status(400).json({ error: 'No valid holdings provided with quantity > 0' });
    }

    const result = await processEnrichedPortfolio(cleanHoldings);
    res.json(result);
  } catch (err) {
    console.error('[Portfolio] Manual entry error:', err.message);
    res.status(500).json({ error: 'Failed to process portfolio: ' + err.message });
  }
});

// Analyze a specific portfolio holding
router.post('/analyze-holding', async (req, res) => {
  try {
    const { symbol, quantity, buyPrice } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
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
      marketRegime: stockData.marketRegime,
      relativeStrength: stockData.relativeStrength,
      technicals: stockData.technicals,
      swingPlaybook: stockData.swingPlaybook,
      quantConsensus: stockData.quantConsensus,
      profitMaximizer: stockData.profitMaximizer,
      expertAnalysis,
      chartData: stockData.chartData,
    });
  } catch (err) {
    console.error('[Portfolio] Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper for deterministic portfolio synthesis
function generateDeterministicPortfolioAnalysis(holdings, totalInvested, totalCurrent, totalPnl) {
  const pnlPct = totalInvested > 0 ? ((totalPnl / totalInvested) * 100) : 0;
  const winners = holdings.filter(h => (h.pnl || (h.currentPrice - h.buyPrice) * h.quantity) > 0);
  const losers = holdings.filter(h => (h.pnl || (h.currentPrice - h.buyPrice) * h.quantity) < 0);
  const healthScore = Math.min(95, Math.max(35, Math.round(55 + (pnlPct * 1.2) + (winners.length >= losers.length ? 10 : -10))));

  // Dynamic real sector allocation calculation
  const sectorSums = {};
  for (const h of holdings) {
    const s = h.sector || SECTOR_MAP[h.symbol?.toUpperCase()]?.sector || 'Equities';
    const val = h.currentValue || (h.currentPrice * h.quantity) || 0;
    sectorSums[s] = (sectorSums[s] || 0) + val;
  }
  const sectorAllocation = Object.entries(sectorSums).map(([sector, val]) => ({
    sector,
    percentage: totalCurrent > 0 ? Math.round((val / totalCurrent) * 100) : 0,
  })).sort((a, b) => b.percentage - a.percentage);

  const topSector = sectorAllocation[0];
  const sectorConcentration = topSector && topSector.percentage >= 35
    ? `High single-sector risk: ${topSector.sector} accounts for ${topSector.percentage}% of total portfolio value. Limit any one sector to <= 25-30%.`
    : holdings.length < 4
    ? 'Under-diversified (< 4 stocks). Vulnerable to idiosyncratic stock gaps. Target 6-8 positions across distinct sectors.'
    : `Well balanced. Top sector (${topSector ? topSector.sector : 'General'}) represents ${topSector ? topSector.percentage : 0}% of portfolio.`;

  const profitBooking = winners.filter(w => (w.pnlPercent || 0) >= 7).map(w => ({
    symbol: w.symbol,
    action: (w.pnlPercent || 0) >= 12 ? 'TRAIL_STOP_20EMA' : 'SCALE_OUT_50_PCT',
    targetPrice: Math.round(w.currentPrice * 1.05),
    quantity: (w.pnlPercent || 0) >= 12 ? 'Keep 100% with trailing stop' : 'Sell 50% shares',
    reasoning: (w.pnlPercent || 0) >= 12
      ? `Runner position up +${(w.pnlPercent || 0).toFixed(1)}%. Trail stop to 20-DMA (₹${Math.round(w.currentPrice * 0.93)}) to milk trend without capping upside.`
      : `Swing Target 1 reached (+${(w.pnlPercent || 0).toFixed(1)}%). Bank half gains to secure positive expectancy, move stop on rest to breakeven.`
  }));

  const lossCutting = losers.filter(l => (l.pnlPercent || 0) <= -5.5).map(l => ({
    symbol: l.symbol,
    action: 'CUT_LOSS_IMMEDIATELY',
    reasoning: `Position down ${(l.pnlPercent || 0).toFixed(1)}%. Violates strict -5.5% swing stop rule. Cut now to prevent single-stock ruin.`
  }));

  const rebalance = holdings.map(h => {
    const val = h.currentValue || (h.currentPrice * h.quantity);
    const alloc = totalCurrent > 0 ? (val / totalCurrent) * 100 : 0;
    let direction = 'HOLD';
    let targetAllocation = `${Math.round(alloc)}%`;
    let reasoning = 'Allocation healthy within risk boundaries.';

    if (alloc > 25) {
      direction = 'DECREASE';
      targetAllocation = 'Trim to 15-20%';
      reasoning = `Overweight: Single stock represents ${Math.round(alloc)}% of equity (institutional limit is 20%).`;
    } else if ((h.pnlPercent || 0) <= -5.5) {
      direction = 'EXIT';
      targetAllocation = '0%';
      reasoning = 'Stop loss breached. Exit position to preserve cash.';
    } else if ((h.pnlPercent || 0) >= 8) {
      direction = 'TRIM_TO_LOCK';
      targetAllocation = `${Math.max(5, Math.round(alloc * 0.5))}%`;
      reasoning = 'Bank 50% partial profit and let remaining ride.';
    }

    return {
      symbol: h.symbol,
      direction,
      targetAllocation,
      reasoning
    };
  });

  // Suggest complementary stocks from underrepresented sectors
  const existingSectors = new Set(sectorAllocation.map(s => s.sector.toLowerCase()));
  const suggestedNewStocks = [];
  if (!existingSectors.has('it')) {
    suggestedNewStocks.push({ symbol: 'INFY', reasoning: 'Add IT sector exposure with solid relative strength and healthy dividend yield.', suggestedEntry: 'On breakout above 20-EMA' });
  }
  if (!existingSectors.has('banking')) {
    suggestedNewStocks.push({ symbol: 'HDFCBANK', reasoning: 'Nifty heavy-weight private banking anchor with low volatility.', suggestedEntry: 'Near 50-DMA support' });
  }
  if (!existingSectors.has('telecom') && !existingSectors.has('infra')) {
    suggestedNewStocks.push({ symbol: 'BHARTIARTL', reasoning: 'Top momentum leader with defensive pricing power in telecom.', suggestedEntry: 'Dip to 20-EMA' });
  }
  if (suggestedNewStocks.length === 0) {
    suggestedNewStocks.push(
      { symbol: 'LT', reasoning: 'Capital goods & infra flagship benefiting from Indian capex cycle.', suggestedEntry: 'On fresh swing consolidation breakout' },
      { symbol: 'SUNPHARMA', reasoning: 'Pharma defensive hedge providing decorrelation from broad market swings.', suggestedEntry: 'Retest of previous resistance' }
    );
  }

  return {
    portfolioHealthScore: healthScore,
    overallAssessment: `Portfolio valuation: ₹${Math.round(totalCurrent).toLocaleString('en-IN')} with net P&L of ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%. ${winners.length} winning positions, ${losers.length} losing positions across ${holdings.length} holdings.`,
    sectorConcentration,
    sectorAllocation,
    profitBookingActions: profitBooking,
    lossCuttingActions: lossCutting,
    rebalanceActions: rebalance,
    suggestedNewStocks,
    overallStrategy: `Maintain asymmetric risk/reward: Cut any holding that hits -5.5% to -6% without hesitation. On winners above +7%, sell 50% shares to lock in gains and ratchet stop on remainder to breakeven. Cap single-stock exposure at 20% of total capital.`,
    riskWarnings: [
      `Overall portfolio P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
      pnlPct < -5 ? 'Drawdown alert: Multiple positions are in drawdown. Halt new buys until market regime stabilizes.' : 'Capital preservation rules active: stops strictly enforced.',
      topSector && topSector.percentage >= 35 ? `Concentration alert: ${topSector.sector} sector is ${topSector.percentage}% of your capital.` : 'Sector spread is within standard guidelines.'
    ]
  };
}

// Holistic portfolio-level analysis
router.post('/analyze-all', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || !holdings.length) {
      return res.status(400).json({ error: 'Holdings data is required' });
    }

    const totalInvested = holdings.reduce((s, h) => s + (h.investedValue || h.buyPrice * h.quantity), 0);
    const totalCurrent = holdings.reduce((s, h) => s + (h.currentValue || h.currentPrice * h.quantity), 0);
    const totalPnl = totalCurrent - totalInvested;

    // Zero-config deterministic fallback if AI not initialized
    if (!isInitialized()) {
      return res.json(generateDeterministicPortfolioAnalysis(holdings, totalInvested, totalCurrent, totalPnl));
    }

    const { analyzeWithAgent } = require('../services/aiEngine.cjs');
    const cache = require('../utils/cache.cjs');
    
    const cacheKey = `portfolioAnalysis:${holdings.map(h => h.symbol).sort().join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Build condensed portfolio summary for AI
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
