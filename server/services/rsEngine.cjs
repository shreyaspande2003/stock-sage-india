// Relative Strength (RS) Engine — StockSage India Quant V2
// Compares individual stock performance against NIFTY 50 benchmark
const yahooFinance = require('./yahooFinance.cjs');
const cache = require('../utils/cache.cjs');

let cachedNiftyHistory = null;
let lastNiftyFetchTime = 0;

async function getNiftyHistory() {
  const now = Date.now();
  if (cachedNiftyHistory && (now - lastNiftyFetchTime < 3600000)) { // 1 hour TTL
    return cachedNiftyHistory;
  }
  try {
    const history = await yahooFinance.getHistorical('^NSEI', '6mo', '1d');
    if (history && history.length > 20) {
      cachedNiftyHistory = history;
      lastNiftyFetchTime = now;
      return history;
    }
  } catch (err) {
    console.warn('[RSEngine] Could not fetch Nifty benchmark history:', err.message);
  }
  return cachedNiftyHistory || [];
}

/**
 * Calculates Relative Strength score and metrics for a stock against NIFTY 50
 * @param {Array} stockOhlcv Array of { date, close } objects for the stock
 * @returns {Object} RS metrics: rsScore (0 to 1), rsRating (0 to 99), outperformance20d, outperformance60d, rsLineStatus
 */
async function calculateRelativeStrength(stockOhlcv) {
  if (!stockOhlcv || stockOhlcv.length < 20) {
    return {
      rsScore: 0.5,
      rsRating: 50,
      outperformance20d: 0,
      outperformance60d: 0,
      rsLineStatus: 'NEUTRAL'
    };
  }

  const niftyHistory = await getNiftyHistory();
  if (!niftyHistory || niftyHistory.length < 20) {
    return {
      rsScore: 0.5,
      rsRating: 50,
      outperformance20d: 0,
      outperformance60d: 0,
      rsLineStatus: 'BENCHMARK_UNAVAILABLE'
    };
  }

  // Map Nifty dates to close prices for fast lookup
  const niftyMap = new Map();
  for (const n of niftyHistory) {
    if (n.date && n.close) {
      niftyMap.set(n.date, n.close);
    }
  }

  // Create aligned series of [stockClose, niftyClose]
  const pairs = [];
  for (const bar of stockOhlcv) {
    if (bar.date && bar.close && niftyMap.has(bar.date)) {
      pairs.push({
        date: bar.date,
        stock: bar.close,
        nifty: niftyMap.get(bar.date)
      });
    }
  }

  if (pairs.length < 20) {
    // If exact date match failed, fallback to tail alignment
    const len = Math.min(stockOhlcv.length, niftyHistory.length);
    for (let i = 0; i < len; i++) {
      const s = stockOhlcv[stockOhlcv.length - len + i];
      const n = niftyHistory[niftyHistory.length - len + i];
      if (s?.close && n?.close) {
        pairs.push({ stock: s.close, nifty: n.close });
      }
    }
  }

  if (pairs.length < 20) {
    return {
      rsScore: 0.5,
      rsRating: 50,
      outperformance20d: 0,
      outperformance60d: 0,
      rsLineStatus: 'INSUFFICIENT_OVERLAP'
    };
  }

  const latest = pairs[pairs.length - 1];
  
  // 20-Day Performance Comparison
  const p20Idx = Math.max(0, pairs.length - 21);
  const p20 = pairs[p20Idx];
  const stockRet20 = ((latest.stock - p20.stock) / p20.stock) * 100;
  const niftyRet20 = ((latest.nifty - p20.nifty) / p20.nifty) * 100;
  const outperformance20d = Math.round((stockRet20 - niftyRet20) * 100) / 100;

  // 60-Day Performance Comparison (if available)
  const p60Idx = Math.max(0, pairs.length - 61);
  const p60 = pairs[p60Idx];
  const stockRet60 = ((latest.stock - p60.stock) / p60.stock) * 100;
  const niftyRet60 = ((latest.nifty - p60.nifty) / p60.nifty) * 100;
  const outperformance60d = Math.round((stockRet60 - niftyRet60) * 100) / 100;

  // Mansfield RS line calculation: RS_ratio = stock / nifty
  const rsRatios = pairs.map(p => p.stock / p.nifty);
  const smaPeriod = Math.min(50, Math.floor(rsRatios.length / 2));
  const recentRatios = rsRatios.slice(-smaPeriod);
  const smaRS = recentRatios.reduce((a, b) => a + b, 0) / recentRatios.length;
  const latestRS = rsRatios[rsRatios.length - 1];
  const mansfieldRS = smaRS > 0 ? ((latestRS / smaRS) - 1) * 100 : 0;

  // Normalize score between 0 and 1
  let rsScore = 0.5; // neutral baseline
  let rsLineStatus = 'NEUTRAL';

  if (mansfieldRS > 0) {
    rsLineStatus = 'OUTPERFORMING';
    rsScore += 0.2;
  } else {
    rsLineStatus = 'UNDERPERFORMING';
    rsScore -= 0.15;
  }

  if (outperformance20d > 4) rsScore += 0.2;
  else if (outperformance20d > 0) rsScore += 0.1;
  else if (outperformance20d < -4) rsScore -= 0.2;

  if (outperformance60d > 8) rsScore += 0.15;
  else if (outperformance60d > 0) rsScore += 0.05;
  else if (outperformance60d < -8) rsScore -= 0.15;

  rsScore = Math.max(0, Math.min(1, Math.round(rsScore * 100) / 100));

  // Percentile RS Rating (0-99 style)
  const rsRating = Math.round(rsScore * 99);

  return {
    rsScore,
    rsRating,
    outperformance20d,
    outperformance60d,
    mansfieldRS: Math.round(mansfieldRS * 100) / 100,
    rsLineStatus,
    summary: outperformance20d > 0
      ? `Beating NIFTY by +${outperformance20d}% over 20 days (${rsLineStatus})`
      : `Lagging NIFTY by ${outperformance20d}% over 20 days (${rsLineStatus})`
  };
}

module.exports = { calculateRelativeStrength, getNiftyHistory };
