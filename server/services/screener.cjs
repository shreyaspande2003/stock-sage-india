// Swing radar — scores liquid NSE names with the quant engine (no LLM).
const yahooFinance = require('./yahooFinance.cjs');
const { calculateIndicators } = require('./technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('./swingEngine.cjs');
const { mapPool } = require('../utils/pool.cjs');
const cache = require('../utils/cache.cjs');

const { getTradableUniverse } = require('./universeFilter.cjs');

function getActiveUniverse() {
  try {
    const dbUniverse = getTradableUniverse();
    if (dbUniverse && dbUniverse.length >= 5) {
      return dbUniverse;
    }
  } catch (e) {}
  return [
    'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
    'BHARTIARTL', 'BAJFINANCE', 'LT', 'M&M', 'SUNPHARMA',
    'IREDA', 'IRFC', 'JIOFIN', 'SUZLON', 'RVNL', 'HAL', 'BEL',
    'TRENT', 'DIXON', 'POLYCAB', 'KPITTECH', 'ANGELONE', 'BSE', 'CDSL'
  ];
}

const { getMarketRegime } = require('./regimeEngine.cjs');
const { calculateRelativeStrength } = require('./rsEngine.cjs');

async function scoreSymbol(symbol, marketRegime = null) {
  const [quote, historical] = await Promise.all([
    yahooFinance.getQuote(symbol),
    yahooFinance.getHistorical(symbol, '6mo', '1d'),
  ]);

  const rs = await calculateRelativeStrength(historical).catch(() => ({ rsScore: 0.5, rsRating: 50 }));
  const technicals = calculateIndicators(historical);
  
  // If technicals was computed without RS, inject RS into v2ScoreData
  if (technicals.v2ScoreData?.components) {
    technicals.v2ScoreData.components.rs = rs.rsScore;
  }

  const playbook = buildSwingPlaybook(quote, technicals, historical, marketRegime?.regime);

  return {
    symbol,
    name: quote.name,
    price: quote.price,
    changePercent: round(quote.changePercent),
    sector: quote.sector,
    setup: playbook.setup,
    bias: playbook.bias,
    qualityScore: playbook.qualityScore,
    components: technicals.v2ScoreData?.components || {},
    rsRating: rs.rsRating,
    rsLineStatus: rs.rsLineStatus,
    tradeWorthy: playbook.tradeWorthy,
    riskRewardT1: playbook.riskRewardT1,
    entry: playbook.levels?.entry,
    stop: playbook.levels?.stop,
    t1: playbook.levels?.t1,
    t2: playbook.levels?.t2,
    shares: playbook.position?.shares,
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

  const marketRegime = await getMarketRegime();
  const universe = getActiveUniverse();
  const rows = await mapPool(universe, 3, async (symbol) => {
    try {
      return await scoreSymbol(symbol, marketRegime);
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
    marketRegime,
    count: ranked.length,
    setups: ranked,
    topLongs: ranked.filter(r => r.bias === 'LONG' && r.tradeWorthy).slice(0, 8),
    topShorts: ranked.filter(r => r.bias === 'SHORT' && r.tradeWorthy).slice(0, 5),
    waitlist: ranked.filter(r => !r.tradeWorthy).slice(0, 8),
  };

  cache.set(cacheKey, result, 900);
  return result;
}

module.exports = { scanSwingUniverse, getActiveUniverse };
