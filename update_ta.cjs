const fs = require('fs');
const path = require('path');

const taPath = path.join(__dirname, 'server', 'services', 'technicalAnalysis.cjs');
let taCode = fs.readFileSync(taPath, 'utf8');

// Add ROC to technicalindicators import
taCode = taCode.replace(
  "const { RSI, MACD, EMA, SMA, BollingerBands, ADX, StochasticRSI, ATR, VWAP } = require('technicalindicators');",
  "const { RSI, MACD, EMA, SMA, BollingerBands, ADX, StochasticRSI, ATR, ROC, VWAP } = require('technicalindicators');"
);

// Add ROC calculation inside calculateIndicators
const rocCalc = `
  // Rate of Change (20)
  const rocValues = ROC.calculate({ values: closes, period: 20 });
  const currentROC = rocValues.length > 0 ? round(rocValues[rocValues.length - 1]) : null;
`;

taCode = taCode.replace(
  "  // Stochastic RSI",
  rocCalc + "\n  // Stochastic RSI"
);

// Update calculateTechnicalScore to the v2 logic
const newScoreLogic = `
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
  s += clamp((f.volRatio - 1) / 1.0) * 0.4;
  s += clamp((f.upDownVolRatio - 1) / 0.5) * 0.3;
  // Mock delivery pct for now
  s += 0.2; 
  return clamp(s);
}

function scoreStructure(f) {
  let s = 0;
  if (f.distToResistance > 0.02) s += 0.4;
  if (f.distToSupport < 0.02) s += 0.4;
  if (f.close < f.ema20 * 1.05) s += 0.2;
  return clamp(s);
}

function scoreContraction(f) {
  let s = 0;
  if (f.bbWidthPct < 40) s += 0.6;
  if (f.atrPct < 5) s += 0.4;
  return clamp(s);
}

function scoreRS(f) {
  return 0.5; // Mock for single-stock API path
}

function calculateTechnicalScoreV2(indicators, currentPrice, currentVolume, supportResistance) {
  const f = {
    close: currentPrice,
    ema20: indicators.ema?.ema21 || 0,
    ema50: indicators.ema?.ema50 || 0,
    ema200: indicators.ema?.ema200 || 0,
    ema50Slope5: 1, // Mocked slope
    plusDI: indicators.adx?.pdi || 0,
    minusDI: indicators.adx?.mdi || 0,
    adx: indicators.adx?.adx || 0,
    rsi: indicators.rsi?.value || 50,
    macdHist: indicators.macd?.histogram || 0,
    macdHistSlope: 1, // Mocked
    roc20: indicators.roc || 0,
    volRatio: indicators.volume?.ratio || 1,
    upDownVolRatio: 1, // Mocked
    distToResistance: supportResistance.resistances.length > 0 ? (supportResistance.resistances[0] - currentPrice) / currentPrice : 0.05,
    distToSupport: supportResistance.supports.length > 0 ? (currentPrice - supportResistance.supports[0]) / currentPrice : 0.05,
    bbWidthPct: indicators.bollingerBands?.bandwidth || 50,
    atrPct: (indicators.atr?.value || 0) / currentPrice * 100
  };

  const stockRegime = (f.adx >= 20 && f.ema20 > f.ema50) ? 'TREND' : 'RANGE';
  
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
  return { score: Math.round(raw), components: c, stockRegime, featureVector: f };
}
`;

taCode = taCode.replace(
  "function calculateTechnicalScore(signals) {",
  newScoreLogic + "\nfunction calculateTechnicalScore(signals) {"
);

// We need to inject indicators.roc into the returned indicators object.
const rocReturn = `
      roc: currentROC,
`;
taCode = taCode.replace(
  "      macd: {",
  rocReturn + "      macd: {"
);

// Replace the return of calculateIndicators to use calculateTechnicalScoreV2
const oldReturn = `    overallTechnicalScore: calculateTechnicalScore(signals),`;
const newReturn = `    overallTechnicalScore: calculateTechnicalScoreV2(
      {
        ema: { ema21: last(ema21), ema50: last(ema50), ema200: last(ema200) },
        adx: { pdi: currentADX?.pdi, mdi: currentADX?.mdi, adx: currentADX?.adx },
        rsi: { value: currentRSI },
        macd: { histogram: currentMACD?.histogram },
        roc: currentROC,
        volume: { ratio: volumeRatio },
        bollingerBands: currentBB ? { bandwidth: (currentBB.upper - currentBB.lower) / currentBB.middle * 100 } : null,
        atr: { value: currentATR }
      },
      currentPrice,
      currentVolume,
      supportResistance
    ).score, // Keep it as a number for backward compatibility
    v2ScoreData: calculateTechnicalScoreV2(
      {
        ema: { ema21: last(ema21), ema50: last(ema50), ema200: last(ema200) },
        adx: { pdi: currentADX?.pdi, mdi: currentADX?.mdi, adx: currentADX?.adx },
        rsi: { value: currentRSI },
        macd: { histogram: currentMACD?.histogram },
        roc: currentROC,
        volume: { ratio: volumeRatio },
        bollingerBands: currentBB ? { bandwidth: (currentBB.upper - currentBB.lower) / currentBB.middle * 100 } : null,
        atr: { value: currentATR }
      },
      currentPrice,
      currentVolume,
      supportResistance
    ),
`;
taCode = taCode.replace(oldReturn, newReturn);

fs.writeFileSync(taPath, taCode);
console.log('technicalAnalysis.cjs updated');
