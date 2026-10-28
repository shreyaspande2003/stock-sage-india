// Quant Consensus Engine — StockSage Institutional Quantitative Model
// 100% Deterministic, sub-10ms execution, zero LLM dependencies or API keys.
// Analyzes 5 quantitative pillars: Structural Trend, Momentum/RS, Volatility Squeeze (VCP), Institutional Volume, and Trade Geometry.

function round(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function calculateQuantConsensus(quote, technicals, historical = [], swingPlaybook = {}, marketRegime = {}) {
  const currentPrice = quote?.price || 0;
  const ind = technicals?.indicators || {};
  const ema20 = ind.movingAverages?.ema20 || null;
  const ema50 = ind.movingAverages?.ema50 || null;
  const ema200 = ind.movingAverages?.ema200 || null;
  const rsi = ind.rsi?.value || 50;
  const macd = ind.macd || {};
  const bb = ind.bollingerBands || {};
  const bbWidth = bb.bandwidth !== undefined ? bb.bandwidth : 25;
  const avgVol20 = ind.volume?.avg20 || quote?.avgVolume || 1;
  const currentVol = quote?.volume || 0;
  const volumePace = avgVol20 > 0 ? round(currentVol / avgVol20, 2) : 1.0;
  const rsRating = technicals?.v2ScoreData?.components?.rs ? Math.round(technicals.v2ScoreData.components.rs * 100) : 55;

  // ─────────────────────────────────────────────────────────────
  // PILLAR 1: Structural Trend & Moving Average Alignment (Max 25 pts)
  // ─────────────────────────────────────────────────────────────
  let p1Score = 0;
  let p1Status = 'NEUTRAL';
  let p1Summary = '';

  const hasFullMA = ema20 && ema50 && ema200;
  const isStage2 = hasFullMA ? (ema20 > ema50 && ema50 > ema200) : (ema20 && ema50 && ema20 > ema50);
  const isPriceAboveEma20 = ema20 ? currentPrice >= ema20 : true;
  const isPriceAboveEma50 = ema50 ? currentPrice >= ema50 : true;

  if (isStage2 && isPriceAboveEma20) {
    p1Score = 25;
    p1Status = 'BULLISH_STAGE_2';
    p1Summary = 'Confirmed Stage 2 uptrend. Price trading above rising 20, 50, and 200 EMA sequence.';
  } else if (isPriceAboveEma50 && isPriceAboveEma20) {
    p1Score = 20;
    p1Status = 'UPTREND';
    p1Summary = 'Short-term bull momentum above 20 & 50 EMA.';
  } else if (isPriceAboveEma50 && !isPriceAboveEma20) {
    p1Score = 14;
    p1Status = 'PULLBACK_SUPPORT';
    p1Summary = 'Healthy pullback testing key moving average support band.';
  } else if (!isPriceAboveEma50 && isPriceAboveEma20) {
    p1Score = 10;
    p1Status = 'COUNTER_TREND';
    p1Summary = 'Counter-trend bounce below major 50 DMA resistance.';
  } else {
    p1Score = 4;
    p1Status = 'BEARISH_STAGE_4';
    p1Summary = 'Downtrend structure. Price trading below declining 20 & 50 EMA.';
  }

  // ─────────────────────────────────────────────────────────────
  // PILLAR 2: Momentum & Relative Strength (Max 25 pts)
  // ─────────────────────────────────────────────────────────────
  let p2Score = 0;
  let p2Status = 'NEUTRAL';
  let p2Summary = '';

  const isRsiBullish = rsi >= 55 && rsi <= 72;
  const isRsiSupercharged = rsi > 72;
  const isMacdBullish = macd.histogram > 0 || macd.crossover === 'BULLISH_CROSS';

  if (isRsiBullish && isMacdBullish) {
    p2Score = 25;
    p2Status = 'POWER_EXPANSION';
    p2Summary = `RSI at ${rsi} in prime acceleration zone with expanding positive MACD momentum.`;
  } else if (isRsiSupercharged) {
    p2Score = 21;
    p2Status = 'HIGH_VELOCITY';
    p2Summary = `RSI at ${rsi} shows aggressive institutional demand. Strong momentum velocity.`;
  } else if (rsi >= 48 && isMacdBullish) {
    p2Score = 17;
    p2Status = 'TURNING_POSITIVE';
    p2Summary = `RSI at ${rsi} showing nascent bullish reversal with MACD turning green.`;
  } else if (rsi < 40) {
    p2Score = 6;
    p2Status = 'MOMENTUM_DRAIN';
    p2Summary = `RSI at ${rsi} indicates sustained selling pressure.`;
  } else {
    p2Score = 12;
    p2Status = 'CONSOLIDATING';
    p2Summary = `RSI at ${rsi} in neutral consolidation zone.`;
  }

  // Add Relative Strength bonus if outperforming
  if (rsRating >= 70) {
    p2Summary += ` Outperforming benchmark (RS: ${rsRating}/100).`;
  }

  // ─────────────────────────────────────────────────────────────
  // PILLAR 3: Volatility Compression (Minervini VCP) (Max 20 pts)
  // ─────────────────────────────────────────────────────────────
  let p3Score = 0;
  let p3Status = 'NORMAL';
  let p3Summary = '';

  if (bbWidth <= 14) {
    p3Score = 20;
    p3Status = 'EXTREME_COIL';
    p3Summary = `Extreme volatility squeeze (BB width ${bbWidth}%). Day T-1 Coiled Spring ready for explosive release.`;
  } else if (bbWidth <= 20) {
    p3Score = 16;
    p3Status = 'MODERATE_SQUEEZE';
    p3Summary = `Tight volatility contraction (BB width ${bbWidth}%). Consolidation base maturing.`;
  } else if (bbWidth <= 30) {
    p3Score = 11;
    p3Status = 'NORMAL_CONSOLIDATION';
    p3Summary = `Standard volatility band (${bbWidth}%). Healthy price action.`;
  } else {
    p3Score = 5;
    p3Status = 'WIDE_VOLATILITY';
    p3Summary = `Wide volatility swings (${bbWidth}%). High noise environment.`;
  }

  // ─────────────────────────────────────────────────────────────
  // PILLAR 4: Institutional Volume Run-Rate (Max 15 pts)
  // ─────────────────────────────────────────────────────────────
  let p4Score = 0;
  let p4Status = 'NORMAL';
  let p4Summary = '';

  if (volumePace >= 2.5) {
    p4Score = 15;
    p4Status = 'INSTITUTIONAL_IGNITION';
    p4Summary = `Massive volume ignition (${volumePace}x 20-DMA). Strong institutional accumulation.`;
  } else if (volumePace >= 1.4) {
    p4Score = 12;
    p4Status = 'ABOVE_AVERAGE';
    p4Summary = `Above-average turnover (${volumePace}x 20-DMA). Healthy market interest.`;
  } else if (volumePace >= 0.8) {
    p4Score = 8;
    p4Status = 'AVERAGE_TURNOVER';
    p4Summary = `Turnover tracking normal 20-day run rate (${volumePace}x).`;
  } else {
    p4Score = 4;
    p4Status = 'LIGHT_LIQUIDITY';
    p4Summary = `Light session volume (${volumePace}x). Institutional hands passive today.`;
  }

  // ─────────────────────────────────────────────────────────────
  // PILLAR 5: Trade Geometry & Risk/Reward Ratio (Max 15 pts)
  // ─────────────────────────────────────────────────────────────
  let p5Score = 0;
  let p5Status = 'BALANCED';
  let p5Summary = '';

  const rrRatio = parseFloat(swingPlaybook?.riskRewardT1) || 1.8;
  const entryPrice = swingPlaybook?.levels?.entry || currentPrice;
  const stopLoss = swingPlaybook?.levels?.stop || round(entryPrice * 0.965);
  const target1 = swingPlaybook?.levels?.t1 || round(entryPrice * 1.10);
  const target2 = swingPlaybook?.levels?.t2 || round(entryPrice * 1.18);
  const riskPct = entryPrice > 0 ? round(((entryPrice - stopLoss) / entryPrice) * 100, 1) : 3.5;
  const returnT1Pct = entryPrice > 0 ? round(((target1 - entryPrice) / entryPrice) * 100, 1) : 10.0;

  if (rrRatio >= 2.8) {
    p5Score = 15;
    p5Status = 'ASYMMETRIC_EDGE';
    p5Summary = `Exceptional ${rrRatio}:1 reward-to-risk ratio. Risking ${riskPct}% to capture +${returnT1Pct}%.`;
  } else if (rrRatio >= 2.0) {
    p5Score = 12;
    p5Status = 'FAVORABLE_EDGE';
    p5Summary = `Solid ${rrRatio}:1 reward-to-risk geometry with clear ATR invalidation point.`;
  } else if (rrRatio >= 1.4) {
    p5Score = 8;
    p5Status = 'STANDARD_EDGE';
    p5Summary = `Acceptable ${rrRatio}:1 geometry. Position sizing discipline required.`;
  } else {
    p5Score = 4;
    p5Status = 'TIGHT_EDGE';
    p5Summary = `Unfavorable ${rrRatio}:1 reward-to-risk. Risk outweighs immediate potential.`;
  }

  // ─────────────────────────────────────────────────────────────
  // COMPOSITE QUANT SCORE & MASTER VERDICT
  // ─────────────────────────────────────────────────────────────
  const totalScore = Math.min(100, Math.max(0, p1Score + p2Score + p3Score + p4Score + p5Score));

  let overallVerdict = 'HOLD';
  let verdictTitle = '⏳ HOLD — BASE BUILDING / CONSOLIDATION';
  let verdictGrade = 'B (NEUTRAL / ACCUMULATING)';
  let verdictBadgeClass = 'badge-hold';
  let verdictColor = 'var(--color-hold)';
  let actionSummary = '';
  let setupName = swingPlaybook?.setup || 'CONSOLIDATION_BASE';

  if (totalScore >= 80) {
    overallVerdict = 'STRONG_BUY';
    verdictTitle = '🚀 STRONG BUY — BREAKOUT IGNITION';
    verdictGrade = 'A+ (INSTITUTIONAL QUANT CONFLUENCE)';
    verdictBadgeClass = 'badge-strong-buy';
    verdictColor = 'var(--color-buy)';
    actionSummary = `Breakout setup confirmed by 5-factor mathematical confluence. Enter in primary Buy Zone ₹${entryPrice} – ₹${round(entryPrice * 1.025)}. Target 1: ₹${target1} (+${returnT1Pct}%). Invalidation Stop Loss: ₹${stopLoss} (-${riskPct}%).`;
  } else if (totalScore >= 65) {
    overallVerdict = 'BUY';
    verdictTitle = '✅ BUY — PULLBACK ACCUMULATION';
    verdictGrade = 'A (HIGH CONFLUENCE)';
    verdictBadgeClass = 'badge-buy';
    verdictColor = 'var(--color-buy)';
    actionSummary = `Strong uptrend geometry. Accumulate on dips near ₹${entryPrice}. Target 1: ₹${target1} (+${returnT1Pct}%). Keep hard stop at ₹${stopLoss}.`;
  } else if (totalScore >= 45) {
    overallVerdict = 'HOLD';
    verdictTitle = '⏳ HOLD — BASE BUILDING / COILING';
    verdictGrade = 'B (NEUTRAL / BASE FORMATION)';
    verdictBadgeClass = 'badge-hold';
    verdictColor = '#f59e0b';
    actionSummary = `Stock is coiling in a base (${bbWidth}% BB width). Do not chase. Set GTT trigger at ₹${round(entryPrice * 1.01)}. Buy only when volume surges >1.8x.`;
  } else {
    overallVerdict = 'AVOID';
    verdictTitle = '🛡️ DEFENSIVE AVOID — CAPITAL PRESERVATION';
    verdictGrade = 'C (POOR CONFLUENCE)';
    verdictBadgeClass = 'badge-sell';
    verdictColor = 'var(--color-sell)';
    actionSummary = `Lacks positive quantitative alignment. Trading below key moving averages with weak relative strength. Preserve capital and wait for structural trend reversal.`;
  }

  return {
    score: totalScore,
    grade: verdictGrade,
    overallVerdict,
    verdictTitle,
    verdictBadgeClass,
    verdictColor,
    actionSummary,
    setupName,
    executionLevels: {
      entryZone: `₹${entryPrice} – ₹${round(entryPrice * 1.025)}`,
      entryPrice,
      target1,
      target1Return: `+${returnT1Pct}%`,
      target2,
      stopLoss,
      riskPct: `-${riskPct}%`,
      riskRewardRatio: `${rrRatio}:1`,
      recommendedShares: swingPlaybook?.position?.shares || 0
    },
    pillars: [
      {
        id: 'trend',
        name: 'Structural Trend (Stage Analysis)',
        score: p1Score,
        maxScore: 25,
        status: p1Status,
        statusBadge: p1Score >= 20 ? 'BULLISH' : p1Score >= 12 ? 'TESTING' : 'BEARISH',
        summary: p1Summary,
      },
      {
        id: 'momentum',
        name: 'Momentum & Relative Strength',
        score: p2Score,
        maxScore: 25,
        status: p2Status,
        statusBadge: p2Score >= 20 ? 'EXPANDING' : p2Score >= 12 ? 'STEADY' : 'WEAK',
        summary: p2Summary,
      },
      {
        id: 'volatility',
        name: 'Minervini Volatility Squeeze (VCP)',
        score: p3Score,
        maxScore: 20,
        status: p3Status,
        statusBadge: p3Score >= 16 ? 'COILED SPRING' : p3Score >= 10 ? 'NORMAL' : 'WIDE',
        summary: p3Summary,
      },
      {
        id: 'volume',
        name: 'Institutional Volume Pacing',
        score: p4Score,
        maxScore: 15,
        status: p4Status,
        statusBadge: p4Score >= 12 ? 'ACCUMULATION' : p4Score >= 8 ? 'NORMAL' : 'LIGHT',
        summary: p4Summary,
      },
      {
        id: 'geometry',
        name: 'Asymmetric Risk/Reward Geometry',
        score: p5Score,
        maxScore: 15,
        status: p5Status,
        statusBadge: p5Score >= 12 ? 'ASYMMETRIC' : p5Score >= 8 ? 'BALANCED' : 'UNFAVORABLE',
        summary: p5Summary,
      }
    ]
  };
}

module.exports = {
  calculateQuantConsensus
};
