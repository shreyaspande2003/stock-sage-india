// Swing radar — scores liquid NSE names with the quant engine (no LLM).
const yahooFinance = require('./yahooFinance.cjs');
const { calculateIndicators } = require('./technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('./swingEngine.cjs');
const { mapPool } = require('../utils/pool.cjs');
const cache = require('../utils/cache.cjs');

const { getTradableUniverse } = require('./universeFilter.cjs');

const MULTI_CAP_UNIVERSE = [
  // Large Caps (Stable Institutional Anchors)
  { symbol: 'RELIANCE', cap: 'LARGE_CAP', sector: 'Energy' },
  { symbol: 'TCS', cap: 'LARGE_CAP', sector: 'IT' },
  { symbol: 'HDFCBANK', cap: 'LARGE_CAP', sector: 'Banking' },
  { symbol: 'INFY', cap: 'LARGE_CAP', sector: 'IT' },
  { symbol: 'ICICIBANK', cap: 'LARGE_CAP', sector: 'Banking' },
  { symbol: 'BHARTIARTL', cap: 'LARGE_CAP', sector: 'Telecom' },
  { symbol: 'SBIN', cap: 'LARGE_CAP', sector: 'Banking' },
  { symbol: 'LT', cap: 'LARGE_CAP', sector: 'Infra' },
  { symbol: 'ITC', cap: 'LARGE_CAP', sector: 'FMCG' },
  { symbol: 'M&M', cap: 'LARGE_CAP', sector: 'Auto' },
  { symbol: 'SUNPHARMA', cap: 'LARGE_CAP', sector: 'Pharma' },
  { symbol: 'BAJFINANCE', cap: 'LARGE_CAP', sector: 'Finance' },
  { symbol: 'TITAN', cap: 'LARGE_CAP', sector: 'Consumer' },
  { symbol: 'TATASTEEL', cap: 'LARGE_CAP', sector: 'Metals' },
  { symbol: 'NTPC', cap: 'LARGE_CAP', sector: 'Power' },

  // Mid Caps (The 6-14% Alpha Swing Sweet Spot)
  { symbol: 'TRENT', cap: 'MID_CAP', sector: 'Retail' },
  { symbol: 'DIXON', cap: 'MID_CAP', sector: 'Electronics' },
  { symbol: 'POLYCAB', cap: 'MID_CAP', sector: 'Cables' },
  { symbol: 'HAL', cap: 'MID_CAP', sector: 'Defense' },
  { symbol: 'BEL', cap: 'MID_CAP', sector: 'Defense' },
  { symbol: 'PERSISTENT', cap: 'MID_CAP', sector: 'IT' },
  { symbol: 'COFORGE', cap: 'MID_CAP', sector: 'IT' },
  { symbol: 'KPITTECH', cap: 'MID_CAP', sector: 'Auto Tech' },
  { symbol: 'BHARATFORG', cap: 'MID_CAP', sector: 'Auto Ancillary' },
  { symbol: 'CUMMINSIND', cap: 'MID_CAP', sector: 'Capital Goods' },
  { symbol: 'VOLTAS', cap: 'MID_CAP', sector: 'Consumer' },
  { symbol: 'AUROPHARMA', cap: 'MID_CAP', sector: 'Pharma' },
  { symbol: 'LUPIN', cap: 'MID_CAP', sector: 'Pharma' },
  { symbol: 'ASHOKLEY', cap: 'MID_CAP', sector: 'Auto' },
  { symbol: 'FEDERALBNK', cap: 'MID_CAP', sector: 'Banking' },

  // Small / High-Beta Momentum (Fast Velocity & High Alpha)
  { symbol: 'IREDA', cap: 'SMALL_CAP', sector: 'Green Energy' },
  { symbol: 'IRFC', cap: 'SMALL_CAP', sector: 'Railways' },
  { symbol: 'RVNL', cap: 'SMALL_CAP', sector: 'Railways' },
  { symbol: 'SUZLON', cap: 'SMALL_CAP', sector: 'Wind Energy' },
  { symbol: 'CDSL', cap: 'SMALL_CAP', sector: 'Fintech' },
  { symbol: 'BSE', cap: 'SMALL_CAP', sector: 'Exchange' },
  { symbol: 'ANGELONE', cap: 'SMALL_CAP', sector: 'Brokerage' },
  { symbol: 'MAZDOCK', cap: 'SMALL_CAP', sector: 'Shipbuilding' },
  { symbol: 'COCHINSHIP', cap: 'SMALL_CAP', sector: 'Shipbuilding' },
  { symbol: 'HUDCO', cap: 'SMALL_CAP', sector: 'Housing Finance' },
  { symbol: 'NBCC', cap: 'SMALL_CAP', sector: 'Construction' },
  { symbol: 'KAYNES', cap: 'SMALL_CAP', sector: 'EMS Electronics' },
  { symbol: 'TEJASNET', cap: 'SMALL_CAP', sector: 'Telecom Gear' },
  { symbol: 'EXIDEIND', cap: 'SMALL_CAP', sector: 'EV Battery' },
  { symbol: 'RAILTEL', cap: 'SMALL_CAP', sector: 'Telecom/Rail' }
];

function getActiveUniverse() {
  return MULTI_CAP_UNIVERSE;
}

const { getMarketRegime } = require('./regimeEngine.cjs');
const { calculateRelativeStrength } = require('./rsEngine.cjs');

async function scoreSymbol(item, marketRegime = null) {
  const symbol = typeof item === 'string' ? item : item.symbol;
  const cap = typeof item === 'object' && item.cap ? item.cap : 'MID_CAP';
  const sectorTag = typeof item === 'object' && item.sector ? item.sector : null;

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
    cap,
    name: quote.name,
    price: quote.price,
    changePercent: round(quote.changePercent),
    sector: sectorTag || quote.sector || 'Equities',
    setup: playbook.setup,
    bias: playbook.bias,
    qualityScore: playbook.qualityScore,
    components: technicals.v2ScoreData?.components || {},
    rsRating: rs.rsRating,
    rsLineStatus: rs.rsLineStatus,
    tradeWorthy: playbook.tradeWorthy,
    riskRewardT1: playbook.riskRewardT1,
    expectedReturnT1Pct: playbook.expectedReturnT1Pct || 0,
    isHighVelocity: playbook.setup === 'HIGH_VELOCITY_BREAKOUT' || (playbook.expectedReturnT1Pct >= 9.5),
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
    highVelocity: ranked.filter(r => r.setup === 'HIGH_VELOCITY_BREAKOUT' || (r.expectedReturnT1Pct >= 9.5)),
    largeCap: ranked.filter(r => r.cap === 'LARGE_CAP'),
    midCap: ranked.filter(r => r.cap === 'MID_CAP'),
    smallCap: ranked.filter(r => r.cap === 'SMALL_CAP'),
    topLongs: ranked.filter(r => r.bias === 'LONG' && r.tradeWorthy).slice(0, 10),
    topShorts: ranked.filter(r => r.bias === 'SHORT' && r.tradeWorthy).slice(0, 5),
    waitlist: ranked.filter(r => !r.tradeWorthy).slice(0, 15),
  };

  cache.set(cacheKey, result, 900);
  return result;
}

module.exports = { scanSwingUniverse, getActiveUniverse };
