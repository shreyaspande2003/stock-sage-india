// Swing radar — scores liquid NSE names with the quant engine (no LLM).
const yahooFinance = require('./yahooFinance.cjs');
const { calculateIndicators } = require('./technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('./swingEngine.cjs');
const { mapPool } = require('../utils/pool.cjs');
const cache = require('../utils/cache.cjs');

const UNIVERSE = [
  // Large Caps (Stable)
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
  'BHARTIARTL', 'BAJFINANCE', 'LT', 'TATAMOTORS', 'M&M', 'SUNPHARMA',
  // High-Beta Mid/Small Caps (Quick Movers)
  'ZOMATO', 'IREDA', 'IRFC', 'JIOFIN', 'SUZLON', 'RVNL', 'HAL', 'BEL',
  'TRENT', 'DIXON', 'POLYCAB', 'KPITTECH', 'ANGELONE', 'BSE', 'CDSL'
];

async function scoreSymbol(symbol) {
  const [quote, historical] = await Promise.all([
    yahooFinance.getQuote(symbol),
    yahooFinance.getHistorical(symbol, '6mo', '1d'),
  ]);
  const technicals = calculateIndicators(historical);
  const playbook = buildSwingPlaybook(quote, technicals, historical);
  return {
    symbol,
    name: quote.name,
    price: quote.price,
    changePercent: round(quote.changePercent),
    sector: quote.sector,
    setup: playbook.setup,
    bias: playbook.bias,
    qualityScore: playbook.qualityScore,
    tradeWorthy: playbook.tradeWorthy,
    riskRewardT1: playbook.riskRewardT1,
    entry: playbook.levels?.entry,
    stop: playbook.levels?.stop,
    t1: playbook.levels?.t1,
    howToTrade: playbook.explain?.howToTrade,
    why: playbook.why?.slice(0, 3) || [],
  };
}

function round(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

async function scanSwingUniverse() {
  const cacheKey = 'scan:swing:universe';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const rows = await mapPool(UNIVERSE, 3, async (symbol) => {
    try {
      return await scoreSymbol(symbol);
    } catch (err) {
      return { symbol, error: err.message, qualityScore: 0, tradeWorthy: false };
    }
  });

  const ranked = rows
    .filter(r => r && !r.error && r.price)
    .sort((a, b) => {
      if (a.tradeWorthy !== b.tradeWorthy) return a.tradeWorthy ? -1 : 1;
      return (b.qualityScore || 0) - (a.qualityScore || 0);
    });

  const result = {
    scannedAt: new Date().toISOString(),
    count: ranked.length,
    setups: ranked,
    topLongs: ranked.filter(r => r.bias === 'LONG' && r.tradeWorthy).slice(0, 8),
    topShorts: ranked.filter(r => r.bias === 'SHORT' && r.tradeWorthy).slice(0, 5),
    waitlist: ranked.filter(r => !r.tradeWorthy).slice(0, 8),
  };

  cache.set(cacheKey, result, 900);
  return result;
}

module.exports = { scanSwingUniverse, UNIVERSE };
