// Technical Analysis service — calculates key trading indicators from OHLCV data
const { RSI, MACD, EMA, SMA, BollingerBands, ADX, StochasticRSI, ATR, ROC, VWAP } = require('technicalindicators');

function calculateIndicators(ohlcv) {
  if (!ohlcv || ohlcv.length < 30) {
    return { error: 'Insufficient data for technical analysis (need at least 30 data points)' };
  }

  const closes = ohlcv.map(d => d.close);
  const highs = ohlcv.map(d => d.high);
  const lows = ohlcv.map(d => d.low);
  const volumes = ohlcv.map(d => d.volume);
  const currentPrice = closes[closes.length - 1];

  // RSI (14-period)
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const currentRSI = rsiValues.length > 0 ? round(rsiValues[rsiValues.length - 1]) : null;

  // MACD (12, 26, 9)
  const macdValues = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  const currentMACD = macdValues.length > 0 ? macdValues[macdValues.length - 1] : null;
  const prevMACD = macdValues.length > 1 ? macdValues[macdValues.length - 2] : null;

  // EMA (9, 21, 50, 200)
  const ema9 = EMA.calculate({ values: closes, period: 9 });
  const ema21 = EMA.calculate({ values: closes, period: 21 });
  const ema50 = EMA.calculate({ values: closes, period: 50 });
  const ema200 = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : [];

  // SMA (20, 50)
  const sma20 = SMA.calculate({ values: closes, period: 20 });
  const sma50 = SMA.calculate({ values: closes, period: 50 });

  // Bollinger Bands (20, 2)
  const bbValues = BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
  const currentBB = bbValues.length > 0 ? bbValues[bbValues.length - 1] : null;

  // ADX (14)
  const adxValues = ADX.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const currentADX = adxValues.length > 0 ? adxValues[adxValues.length - 1] : null;


  // Rate of Change (20)
  const rocValues = ROC.calculate({ values: closes, period: 20 });
  const currentROC = rocValues.length > 0 ? round(rocValues[rocValues.length - 1]) : null;

  // Stochastic RSI
  const stochRSIValues = StochasticRSI.calculate({
    values: closes, rsiPeriod: 14, stochasticPeriod: 14, kPeriod: 3, dPeriod: 3,
  });
  const currentStochRSI = stochRSIValues.length > 0 ? stochRSIValues[stochRSIValues.length - 1] : null;

  // ATR (14) — for volatility and stop-loss calculation
  const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });
  const currentATR = atrValues.length > 0 ? round(atrValues[atrValues.length - 1]) : null;

  // Volume Analysis
  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  const volumeRatio = round(currentVolume / avgVolume20);

  // 50 EMA slope (over last 5 trading days)
  const ema50Slope5 = ema50.length >= 6
    ? round(((last(ema50) - ema50[ema50.length - 6]) / ema50[ema50.length - 6]) * 100)
    : 0;

  // MACD Histogram Slope
  const macdHistSlope = macdValues.length >= 2 && currentMACD?.histogram != null && prevMACD?.histogram != null
    ? round(currentMACD.histogram - prevMACD.histogram)
    : 0;

  // Up/Down Volume Ratio (last 20 days)
  const recent20 = ohlcv.slice(-20);
  let upVol = 0, downVol = 0;
  for (const b of recent20) {
    if (b.close >= (b.open || b.close)) upVol += (b.volume || 0);
    else downVol += (b.volume || 0);
  }
  const upDownVolRatio = downVol > 0 ? round(upVol / downVol) : 1.2;

  // Support/Resistance (using recent pivot points)
  const supportResistance = calculateSupportResistance(ohlcv);

  // Generate signals
  const signals = generateSignals({
    currentPrice, currentRSI, currentMACD, prevMACD, currentBB,
    currentADX, currentStochRSI, volumeRatio,
    ema9: last(ema9), ema21: last(ema21), ema50: last(ema50), ema200: last(ema200),
  });

  const v2ScorePayload = {
    ema: { ema21: last(ema21), ema50: last(ema50), ema200: last(ema200) },
    ema50Slope5,
    adx: { pdi: currentADX?.pdi, mdi: currentADX?.mdi, adx: currentADX?.adx },
    rsi: { value: currentRSI },
    macd: { histogram: currentMACD?.histogram },
    macdHistSlope,
    roc: currentROC,
    volume: { ratio: volumeRatio, upDownVolRatio },
    bollingerBands: currentBB ? { bandwidth: (currentBB.upper - currentBB.lower) / currentBB.middle * 100 } : null,
    atr: { value: currentATR }
  };

  const v2ScoreData = calculateTechnicalScoreV2(
    v2ScorePayload,
    currentPrice,
    currentVolume,
    supportResistance
  );

  return {
    currentPrice: round(currentPrice),
    indicators: {
      rsi: {
        value: currentRSI,
        signal: currentRSI > 70 ? 'OVERBOUGHT' : currentRSI < 30 ? 'OVERSOLD' : 'NEUTRAL',
      },

      roc: currentROC,
      macd: {
        macd: currentMACD ? round(currentMACD.MACD) : null,
        signal: currentMACD ? round(currentMACD.signal) : null,
        histogram: currentMACD ? round(currentMACD.histogram) : null,
        crossover: detectMACDCrossover(currentMACD, prevMACD),
      },
      ema: {
        ema9: round(last(ema9)),
        ema21: round(last(ema21)),
        ema50: round(last(ema50)),
        ema200: ema200.length > 0 ? round(last(ema200)) : null,
        trend: detectEMATrend(currentPrice, last(ema9), last(ema21), last(ema50), last(ema200)),
        ema50Slope5,
      },
      bollingerBands: currentBB ? {
        upper: round(currentBB.upper),
        middle: round(currentBB.middle),
        lower: round(currentBB.lower),
        bandwidth: round((currentBB.upper - currentBB.lower) / currentBB.middle * 100),
        position: currentPrice > currentBB.upper ? 'ABOVE_UPPER' :
                  currentPrice < currentBB.lower ? 'BELOW_LOWER' : 'WITHIN',
      } : null,
      adx: currentADX ? {
        adx: round(currentADX.adx),
        pdi: round(currentADX.pdi),
        mdi: round(currentADX.mdi),
        trendStrength: currentADX.adx > 25 ? 'STRONG' : 'WEAK',
        trendDirection: currentADX.pdi > currentADX.mdi ? 'BULLISH' : 'BEARISH',
      } : null,
      stochasticRSI: currentStochRSI ? {
        k: round(currentStochRSI.k),
        d: round(currentStochRSI.d),
        signal: currentStochRSI.k > 80 ? 'OVERBOUGHT' : currentStochRSI.k < 20 ? 'OVERSOLD' : 'NEUTRAL',
      } : null,
      atr: {
        value: currentATR,
        suggestedStopLoss: round(currentPrice - (currentATR * 2)),
      },
      volume: {
        current: currentVolume,
        avg20: Math.round(avgVolume20),
        ratio: volumeRatio,
        upDownVolRatio,
        signal: volumeRatio > 2 ? 'HIGH_VOLUME_SPIKE' : volumeRatio > 1.5 ? 'ABOVE_AVERAGE' : volumeRatio < 0.5 ? 'LOW_VOLUME' : 'NORMAL',
      },
    },
    supportResistance,
    signals,
    overallTechnicalScore: v2ScoreData.score,
    v2ScoreData,
  };
}

function calculateSupportResistance(ohlcv) {
  const recent = ohlcv.slice(-60); // Last 60 days
  const highs = recent.map(d => d.high);
  const lows = recent.map(d => d.low);
  const closes = recent.map(d => d.close);
  const currentPrice = closes[closes.length - 1];

  // Simple pivot-based support/resistance
  const pivotPoints = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      pivotPoints.push({ type: 'resistance', price: round(highs[i]) });
    }
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      pivotPoints.push({ type: 'support', price: round(lows[i]) });
    }
  }

  const supports = pivotPoints.filter(p => p.type === 'support' && p.price < currentPrice)
    .sort((a, b) => b.price - a.price).slice(0, 3).map(p => p.price);
  const resistances = pivotPoints.filter(p => p.type === 'resistance' && p.price > currentPrice)
    .sort((a, b) => a.price - b.price).slice(0, 3).map(p => p.price);

  return { supports, resistances };
}

function detectMACDCrossover(current, prev) {
  if (!current || !prev) return 'NONE';
  if (prev.histogram < 0 && current.histogram >= 0) return 'BULLISH_CROSSOVER';
  if (prev.histogram > 0 && current.histogram <= 0) return 'BEARISH_CROSSOVER';
  return current.histogram > 0 ? 'BULLISH' : 'BEARISH';
}

function detectEMATrend(price, ema9, ema21, ema50, ema200) {
  if (!ema9 || !ema21 || !ema50) return 'INSUFFICIENT_DATA';
  if (price > ema9 && ema9 > ema21 && ema21 > ema50) return 'STRONG_UPTREND';
  if (price < ema9 && ema9 < ema21 && ema21 < ema50) return 'STRONG_DOWNTREND';
  if (price > ema21 && price > ema50) return 'UPTREND';
  if (price < ema21 && price < ema50) return 'DOWNTREND';
  return 'SIDEWAYS';
}

function generateSignals({ currentPrice, currentRSI, currentMACD, prevMACD, currentBB, currentADX, currentStochRSI, volumeRatio, ema9, ema21, ema50, ema200 }) {
  const signals = [];

  // RSI signals
  if (currentRSI !== null) {
    if (currentRSI < 30) signals.push({ type: 'BULLISH', indicator: 'RSI', message: `RSI at ${currentRSI} — oversold territory, potential bounce` });
    else if (currentRSI > 70) signals.push({ type: 'BEARISH', indicator: 'RSI', message: `RSI at ${currentRSI} — overbought territory, potential pullback` });
    else if (currentRSI > 50 && currentRSI < 60) signals.push({ type: 'NEUTRAL', indicator: 'RSI', message: `RSI at ${currentRSI} — slightly bullish momentum` });
  }

  // MACD crossover
  const crossover = detectMACDCrossover(currentMACD, prevMACD);
  if (crossover === 'BULLISH_CROSSOVER') signals.push({ type: 'BULLISH', indicator: 'MACD', message: 'MACD bullish crossover detected — buy signal' });
  else if (crossover === 'BEARISH_CROSSOVER') signals.push({ type: 'BEARISH', indicator: 'MACD', message: 'MACD bearish crossover detected — sell signal' });

  // Bollinger Band breakout
  if (currentBB) {
    if (currentPrice > currentBB.upper) signals.push({ type: 'BEARISH', indicator: 'BB', message: 'Price above upper Bollinger Band — potential reversal' });
    else if (currentPrice < currentBB.lower) signals.push({ type: 'BULLISH', indicator: 'BB', message: 'Price below lower Bollinger Band — potential bounce' });
  }

  // EMA trend
  if (ema9 && ema21) {
    if (ema9 > ema21 && currentPrice > ema9) signals.push({ type: 'BULLISH', indicator: 'EMA', message: 'Price above EMA 9 & 21 — short-term uptrend intact' });
    if (ema200 && currentPrice > ema200) signals.push({ type: 'BULLISH', indicator: 'EMA', message: 'Price above 200 EMA — long-term trend bullish' });
    if (ema200 && currentPrice < ema200) signals.push({ type: 'BEARISH', indicator: 'EMA', message: 'Price below 200 EMA — long-term trend bearish' });
  }

  // Volume spike
  if (volumeRatio > 2) signals.push({ type: 'ALERT', indicator: 'VOLUME', message: `Volume spike detected (${volumeRatio}x average) — high interest` });

  // ADX trend strength
  if (currentADX && currentADX.adx > 25) {
    const dir = currentADX.pdi > currentADX.mdi ? 'BULLISH' : 'BEARISH';
    signals.push({ type: dir, indicator: 'ADX', message: `Strong ${dir.toLowerCase()} trend (ADX: ${round(currentADX.adx)})` });
  }

  return signals;
}


const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

function scoreTrend(f) {
  let s = 0;
  if (f.ema20 > f.ema50 && f.ema50 > f.ema200) s += 0.4;
  if (f.close > f.ema50) s += 0.2;
  if (f.ema50Slope5 > 0) s += 0.2;
  if (f.plusDI > f.minusDI && f.adx >= 20) s += 0.2;
  return clamp(s);
}

function scoreMomentum(f, regime) {
  let s = 0;
  if (regime === 'TREND') {
    s += f.rsi >= 50 && f.rsi <= 70 ? 0.5 : (f.rsi > 78 ? 0.1 : 0.25);
  } else {
    s += f.rsi < 35 ? 0.6 : (f.rsi > 70 ? 0 : 0.3);
  }
  if (f.macdHist > 0 && f.macdHistSlope > 0) s += 0.3;
  if (f.roc20 > 0) s += 0.2;
  return clamp(s);
}

function scoreVolume(f) {
  let s = 0;
  if (f.volRatio >= 1.5) s += 0.4;
  else if (f.volRatio >= 1.1) s += 0.2;

  if (f.upDownVolRatio >= 1.3) s += 0.4;
  else if (f.upDownVolRatio >= 1.0) s += 0.2;

  if (f.close > f.ema20) s += 0.2; // Institutional accumulation bias
  return clamp(s);
}

function scoreStructure(f) {
  // Overextension guard: If price > 12% above EMA 50, strictly penalize
  if (f.ema50 > 0 && f.close > f.ema50 * 1.12) {
    return 0; // Overextended, reject chasing
  }
  let s = 0;
  if (f.distToResistance > 0.02) s += 0.4;
  if (f.distToSupport < 0.03) s += 0.4;
  if (f.close >= f.ema20 * 0.98 && f.close <= f.ema20 * 1.05) s += 0.2;
  return clamp(s);
}

function scoreContraction(f) {
  let s = 0;
  if (f.bbWidthPct < 35) s += 0.6;
  else if (f.bbWidthPct < 45) s += 0.3;
  
  if (f.atrPct < 4.0) s += 0.4;
  else if (f.atrPct < 6.0) s += 0.2;
  return clamp(s);
}

function scoreRS(f) {
  return clamp(f.rsScore !== undefined ? f.rsScore : 0.5);
}

function calculateTechnicalScoreV2(indicators, currentPrice, currentVolume, supportResistance) {
  const f = {
    close: currentPrice,
    ema20: indicators.ema?.ema21 || 0,
    ema50: indicators.ema?.ema50 || 0,
    ema200: indicators.ema?.ema200 || 0,
    ema50Slope5: indicators.ema50Slope5 || 0,
    plusDI: indicators.adx?.pdi || 0,
    minusDI: indicators.adx?.mdi || 0,
    adx: indicators.adx?.adx || 0,
    rsi: indicators.rsi?.value || 50,
    macdHist: indicators.macd?.histogram || 0,
    macdHistSlope: indicators.macdHistSlope || 0,
    roc20: indicators.roc || 0,
    volRatio: indicators.volume?.ratio || 1,
    upDownVolRatio: indicators.volume?.upDownVolRatio || 1.2,
    rsScore: indicators.rsScore !== undefined ? indicators.rsScore : 0.5,
    distToResistance: supportResistance.resistances.length > 0 ? (supportResistance.resistances[0] - currentPrice) / currentPrice : 0.05,
    distToSupport: supportResistance.supports.length > 0 ? (currentPrice - supportResistance.supports[0]) / currentPrice : 0.05,
    bbWidthPct: indicators.bollingerBands?.bandwidth || 50,
    atrPct: (indicators.atr?.value || 0) / currentPrice * 100
  };

  const stockRegime = (f.adx >= 20 && f.ema20 > f.ema50) ? 'TREND' : 'RANGE';
  const isOverextended = f.ema50 > 0 && f.close > f.ema50 * 1.12;

  const w = { trend: 25, rs: 20, mom: 15, vol: 15, struct: 15, vc: 10 };
  const c = {
    trend: scoreTrend(f),
    rs: scoreRS(f),
    mom: scoreMomentum(f, stockRegime),
    vol: scoreVolume(f),
    struct: scoreStructure(f),
    vc: scoreContraction(f),
  };
  
  let raw = 0;
  for (const k of Object.keys(w)) raw += w[k] * c[k];
  return { 
    score: Math.round(raw), 
    components: c, 
    stockRegime, 
    isOverextended,
    featureVector: f 
  };
}

function calculateTechnicalScore(signals) {
  let score = 50; // Start neutral
  signals.forEach(s => {
    if (s.type === 'BULLISH') score += 8;
    else if (s.type === 'BEARISH') score -= 8;
  });
  return Math.max(0, Math.min(100, score));
}

function round(val) {
  return val !== null && val !== undefined ? Math.round(val * 100) / 100 : null;
}

function last(arr) {
  return arr && arr.length > 0 ? arr[arr.length - 1] : null;
}

module.exports = { 
  calculateIndicators, 
  calculateTechnicalScoreV2, 
  analyzeTechnicals: calculateIndicators 
};
