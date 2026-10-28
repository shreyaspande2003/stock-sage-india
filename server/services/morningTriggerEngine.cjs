// Morning Breakout & Coiled Spring Engine — StockSage Quant Edge
// Detects Day T-1 Volatility Compression (VCP / Squeeze) and monitors intraday live triggers for 10%+ velocity moves.

const yahooFinance = require('./yahooFinance.cjs');
const { calculateIndicators } = require('./technicalAnalysis.cjs');
const { getActiveUniverse } = require('./screener.cjs');
const { mapPool } = require('../utils/pool.cjs');
const cache = require('../utils/cache.cjs');

function round(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

// Check Indian Market Session (09:15 to 15:30 IST)
function getMarketSessionInfo() {
  const now = new Date();
  // IST offset: UTC + 5:30
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const istTime = new Date(utcMs + 5.5 * 3600000);
  
  const dayOfWeek = istTime.getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  
  const hours = istTime.getHours();
  const minutes = istTime.getMinutes();
  const currentMinuteOfDay = hours * 60 + minutes;
  
  const marketOpenMinute = 9 * 60 + 15;  // 09:15 IST (555)
  const marketCloseMinute = 15 * 60 + 30; // 15:30 IST (930)
  const totalTradingMinutes = marketCloseMinute - marketOpenMinute; // 375 mins
  
  const isMarketOpen = !isWeekend && currentMinuteOfDay >= marketOpenMinute && currentMinuteOfDay <= marketCloseMinute;
  const minutesElapsed = isMarketOpen ? Math.max(15, currentMinuteOfDay - marketOpenMinute) : 375;
  const sessionProgressPct = round((minutesElapsed / totalTradingMinutes) * 100, 1);
  
  return {
    isMarketOpen,
    isWeekend,
    istTimeString: istTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    istDateString: istTime.toLocaleDateString('en-IN'),
    minutesElapsed,
    sessionProgressPct,
    isMorningHour: isMarketOpen && minutesElapsed <= 75 // 9:15 AM to 10:30 AM prime breakout window
  };
}

async function analyzeStockTrigger(item, sessionInfo) {
  const symbol = typeof item === 'string' ? item : item.symbol;
  const cap = typeof item === 'object' && item.cap ? item.cap : 'MID_CAP';
  const sector = typeof item === 'object' && item.sector ? item.sector : 'Equities';

  const [quote, historical] = await Promise.all([
    yahooFinance.getQuote(symbol),
    yahooFinance.getHistorical(symbol, '6mo', '1d'),
  ]);

  if (!historical || historical.length < 25 || !quote || !quote.price) {
    return null;
  }

  // Baseline T-1: Slice out today's forming bar to see what was known yesterday EOD
  const prevHist = historical.slice(0, -1);
  const prevTechnicals = calculateIndicators(prevHist);
  const prevBar = prevHist[prevHist.length - 1];

  const ind = prevTechnicals.indicators || {};
  const bb = ind.bollingerBands;
  const bbWidth = bb ? bb.bandwidth : 35; // Volatility compression metric
  const avgVol20 = ind.volume?.avg20 || 1;
  const atr = ind.atr?.value || round(quote.price * 0.025);

  // Highest high of last 15 sessions or nearest structural resistance
  const recentHigh15 = Math.max(...prevHist.slice(-15).map(c => c.high));
  const srResistances = prevTechnicals.supportResistance?.resistances || [];
  const pivot = round(srResistances[0] || recentHigh15 || prevBar.high);

  // Invalidation level / Stop loss
  const srSupports = prevTechnicals.supportResistance?.supports || [];
  const stop = round(srSupports[0] || (pivot - atr * 2.2));

  // Current Live Metrics
  const currentPrice = round(quote.price);
  const currentVolume = quote.volume || 0;
  const changePercent = round(quote.changePercent || 0);

  // Calculate volume run-rate (pacing)
  let volPaceRatio = 1.0;
  if (sessionInfo.isMarketOpen) {
    const expectedVol = Math.max(1000, avgVol20 * (sessionInfo.minutesElapsed / 375));
    volPaceRatio = round(currentVolume / expectedVol);
  } else {
    volPaceRatio = round(currentVolume / avgVol20);
  }
  const rawVolRatio = round(currentVolume / avgVol20);

  // Distance from Breakout Pivot
  const distFromPivotPct = round(((currentPrice - pivot) / pivot) * 100);
  const riskPct = round(((pivot - stop) / pivot) * 100);
  const target1 = round(pivot * 1.10); // +10% fast swing target
  const target2 = round(pivot * 1.18); // +18% secondary runner target
  const rewardRisk = round(10 / Math.max(1.8, riskPct));

  // Status Classifier
  let status = 'WATCH';
  let statusLabel = 'WATCHLIST';
  let badgeClass = 'badge-neutral';
  let actionText = '';
  let priority = 4;

  const isCompressed = bbWidth <= 18; // Strict squeeze
  const isModerateCoil = bbWidth <= 24;
  const isGapIgnition = (changePercent >= 4.5 || ((currentPrice - prevBar.close) / prevBar.close) * 100 >= 3.5) && (volPaceRatio >= 2.0 || rawVolRatio >= 2.0);

  // 0. EPISODIC PIVOT (EP): Qullamaggie super runner (High gap + institutional volume explosion)
  if (isGapIgnition) {
    status = 'EPISODIC_PIVOT';
    statusLabel = '💥 EPISODIC PIVOT (SUPER RUNNER)';
    badgeClass = 'badge-strong-buy';
    priority = 0;
    actionText = `Episodic Pivot active! Massive ${volPaceRatio}x volume explosion. Qullamaggie rule: Invalidation stop at Day Low ₹${round(quote.dayLow || currentPrice * 0.975)}. Sell 1/2 at Target ₹${target1} (+10%), trail rest on 10 EMA!`;
  }
  // 1. FIRED: Price breached pivot, within +4.5% buy zone, volume expanding
  else if (currentPrice >= pivot && distFromPivotPct <= 4.5 && (volPaceRatio >= 1.6 || rawVolRatio >= 1.6)) {
    status = 'FIRED';
    statusLabel = '🚀 FIRED (IN BUY ZONE)';
    badgeClass = 'badge-strong-buy';
    priority = 1;
    actionText = `Breakout active! Breached ₹${pivot} with ${volPaceRatio}x volume pace. Entry Zone: ₹${pivot} - ₹${round(pivot * 1.025)}. Target: ₹${target1} (+10%).`;
  }
  // 2. EXTENDED: Up > 4.5% from pivot
  else if (currentPrice >= pivot && distFromPivotPct > 4.5) {
    status = 'EXTENDED';
    statusLabel = '⚡ EXTENDED (+10% HIT)';
    badgeClass = 'badge-hold';
    priority = 3;
    actionText = `Breakout already exploded +${distFromPivotPct}% from pivot ₹${pivot}. Do NOT chase. Wait for 20 EMA pullback test.`;
  }
  // 3. ARMED: Coiled Spring resting right below pivot (within -3.5%)
  else if (distFromPivotPct >= -3.5 && distFromPivotPct < 0 && isModerateCoil) {
    status = 'ARMED';
    statusLabel = '⏳ ARMED (COILED SPRING)';
    badgeClass = 'badge-buy';
    priority = 2;
    actionText = `Extreme compression (BB width ${bbWidth}%). Set GTT trigger at ₹${round(pivot + 0.1)}. Buy when morning volume paces >2x.`;
  }
  // 4. WATCH: Compression base developing
  else if (isCompressed && distFromPivotPct >= -8.0 && distFromPivotPct < -3.5) {
    status = 'WATCH';
    statusLabel = '👁️ BASE BUILDING';
    badgeClass = 'badge-neutral';
    priority = 4;
    actionText = `Volatility coiling (BB width ${bbWidth}%). Stock is ${Math.abs(distFromPivotPct)}% below breakout roof ₹${pivot}.`;
  }

  return {
    symbol,
    name: quote.name,
    cap,
    sector,
    currentPrice,
    changePercent,
    pivot,
    stop,
    target1,
    target2,
    distFromPivotPct,
    riskPct,
    rewardRisk,
    bbWidth,
    currentVolume,
    avgVol20,
    volPaceRatio,
    rawVolRatio,
    status,
    statusLabel,
    badgeClass,
    priority,
    actionText,
    isCoiled: isCompressed || isModerateCoil
  };
}

async function getMorningBreakoutTriggers(tier = 'PRO') {
  const cacheKey = `morning:breakout:triggers:${tier}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const sessionInfo = getMarketSessionInfo();
  const universe = getActiveUniverse(tier);

  const results = await mapPool(universe, 6, async (item) => {
    try {
      return await analyzeStockTrigger(item, sessionInfo);
    } catch (err) {
      return null;
    }
  });

  const valid = results.filter(Boolean);

  // Group by status
  const ep = valid.filter(r => r.status === 'EPISODIC_PIVOT').sort((a, b) => b.volPaceRatio - a.volPaceRatio);
  const fired = valid.filter(r => r.status === 'FIRED').sort((a, b) => b.volPaceRatio - a.volPaceRatio);
  const armed = valid.filter(r => r.status === 'ARMED').sort((a, b) => a.bbWidth - b.bbWidth);
  const extended = valid.filter(r => r.status === 'EXTENDED').sort((a, b) => b.distFromPivotPct - a.distFromPivotPct);
  const watching = valid.filter(r => r.status === 'WATCH').sort((a, b) => a.bbWidth - b.bbWidth);

  // All prioritized items (Episodic Pivots first!)
  const allPrioritized = [...ep, ...fired, ...armed, ...extended, ...watching];

  const payload = {
    updatedAt: new Date().toISOString(),
    sessionInfo,
    counts: {
      totalScanned: universe.length,
      ep: ep.length,
      fired: fired.length,
      armed: armed.length,
      extended: extended.length,
      watching: watching.length
    },
    ep,
    fired,
    armed,
    extended,
    watching,
    allPrioritized
  };

  // Cache for 90 seconds during market hours, 5 minutes after hours
  const ttl = sessionInfo.isMarketOpen ? 90 : 300;
  cache.set(cacheKey, payload, ttl);

  return payload;
}

module.exports = {
  getMorningBreakoutTriggers,
  getMarketSessionInfo
};
