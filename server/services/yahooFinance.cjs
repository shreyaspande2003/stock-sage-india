// Yahoo Finance service — fetches stock data for Indian (NSE/BSE) stocks using yahoo-finance2 to bypass crumb issues
const cache = require('../utils/cache.cjs');
const { limiters } = require('../utils/rateLimiter.cjs');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Suppress unhandled notices from yahoo-finance2 (removed)

// Convert NSE symbol to Yahoo Finance format
function toYahooSymbol(symbol) {
  const s = symbol.toUpperCase().trim();
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s;
  return `${s}.NS`; // Default to NSE
}

// Get real-time quote for a stock
async function getQuote(symbol) {
  const ySymbol = toYahooSymbol(symbol);
  const cacheKey = `quote:${ySymbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    await limiters.yahooFinance.acquire();
    const q = await yahooFinance.quote(ySymbol);
    
    if (!q) {
      throw new Error(`No data found for ${symbol}`);
    }

    const result = {
      symbol: symbol.toUpperCase(),
      yahooSymbol: ySymbol,
      name: q.longName || q.shortName || symbol,
      price: q.regularMarketPrice || 0,
      previousClose: q.regularMarketPreviousClose || 0,
      open: q.regularMarketOpen || 0,
      dayHigh: q.regularMarketDayHigh || 0,
      dayLow: q.regularMarketDayLow || 0,
      volume: q.regularMarketVolume || 0,
      avgVolume: q.averageDailyVolume10Day || q.averageDailyVolume3Month || 0,
      change: q.regularMarketChange || 0,
      changePercent: q.regularMarketChangePercent || 0,
      marketCap: q.marketCap || 0,
      pe: q.trailingPE || null,
      eps: q.epsTrailingTwelveMonths || null,
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh || 0,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow || 0,
      fiftyDayAvg: q.fiftyDayAverage || 0,
      twoHundredDayAvg: q.twoHundredDayAverage || 0,
      dividendYield: q.dividendYield || null,
      sector: 'N/A', // Basic quote doesn't include sector/industry, but it's acceptable for technicals
      industry: 'N/A',
      exchange: q.exchange || 'NSE',
      currency: q.currency || 'INR',
    };

    cache.set(cacheKey, result, 300); // 5-min cache
    return result;
  } catch (err) {
    console.error(`[YahooFinance] Quote error for ${symbol}:`, err.message);
    throw err;
  }
}

// Get historical OHLCV data
async function getHistorical(symbol, range = '6mo', interval = '1d') {
  const ySymbol = toYahooSymbol(symbol);
  const cacheKey = `historical:${ySymbol}:${range}:${interval}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    await limiters.yahooFinance.acquire();
    
    // Calculate dates
    const now = new Date();
    let period1 = new Date();
    if (range === '6mo') period1.setMonth(now.getMonth() - 6);
    else if (range === '1y') period1.setFullYear(now.getFullYear() - 1);
    else period1.setMonth(now.getMonth() - 1); // fallback 1 month

    const result = await yahooFinance.historical(ySymbol, {
      period1,
      period2: now,
      interval: interval
    });

    if (!result || !result.length) {
      throw new Error(`No historical data for ${symbol}`);
    }

    const ohlcv = result.map(d => ({
      date: d.date.toISOString().split('T')[0],
      timestamp: Math.floor(d.date.getTime() / 1000),
      open: d.open || 0,
      high: d.high || 0,
      low: d.low || 0,
      close: d.close || 0,
      volume: d.volume || 0,
    })).filter(d => d.close > 0);

    cache.set(cacheKey, ohlcv, 3600); // 1-hour cache
    return ohlcv;
  } catch (err) {
    console.error(`[YahooFinance] Historical error for ${symbol}:`, err.message);
    throw err;
  }
}

// Search for stocks by name/symbol
async function searchStocks(query) {
  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    await limiters.yahooFinance.acquire();
    const data = await yahooFinance.search(query);
    
    const results = (data?.quotes || [])
      .filter(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchDisp === 'NSE' || q.exchDisp === 'BSE' || (q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO'))))
      .map(q => ({
        symbol: q.symbol.replace('.NS', '').replace('.BO', ''),
        yahooSymbol: q.symbol,
        name: q.longname || q.shortname || q.symbol,
        exchange: q.exchDisp || q.exchange,
        type: q.typeDisp || q.quoteType,
      }));

    // Deduplicate by symbol
    const unique = [];
    const seen = new Set();
    for (const r of results) {
      if (!seen.has(r.symbol)) {
        seen.add(r.symbol);
        unique.push(r);
      }
    }

    cache.set(cacheKey, unique, 86400); // 24-hour cache for search
    return unique.slice(0, 10);
  } catch (err) {
    console.error(`[YahooFinance] Search error:`, err.message);
    return [];
  }
}

module.exports = { getQuote, getHistorical, searchStocks, toYahooSymbol };
