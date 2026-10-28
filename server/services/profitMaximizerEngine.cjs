// Profit Maximizer Engine — StockSage Advanced Quant Profit Strategies
// 100% Deterministic, zero LLM dependencies.
// Implements: Dynamic Position Sizing, Pyramiding, Multi-Timeframe Confluence,
// Sector Rotation, Conviction Multiplier, and Adaptive Trailing Stop System.

function round(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

// ────────────────────────────────────────────────────────────────
// 1. DYNAMIC POSITION SIZING — Volatility-Adjusted Kelly Criterion
//    Rather than fixed 15% slices, size positions based on edge + volatility
// ────────────────────────────────────────────────────────────────
function calculateDynamicPositionSize(params) {
  const {
    capital = 100000,
    entryPrice,
    stopLoss,
    winRate = 0.52,          // Empirical backtested edge
    avgWinLoss = 2.2,        // Win / loss ratio
    atr,
    quantScore = 50,
    regimeMultiplier = 1.0,
    maxPortfolioRisk = 0.06,  // Max 6% total portfolio heat
    existingRiskPct = 0,      // Already deployed risk
    openPositionsCount = 0,
    maxPositions = 8,
    sectorPositionsCount = 0,
    maxPerSector = 2,
    portfolioDrawdownPct = 0, // Peak-to-trough drawdown %
  } = params;

  if (!entryPrice || !stopLoss || entryPrice <= 0) {
    return { shares: 0, capitalDeployed: 0, riskAmount: 0, method: 'INSUFFICIENT_DATA', explanation: 'Missing entry price or stop loss.' };
  }

  // 1. Guardrail: Max open positions cap
  if (openPositionsCount >= maxPositions) {
    return { shares: 0, capitalDeployed: 0, riskAmount: 0, method: 'MAX_POSITIONS_REACHED', explanation: `Portfolio capacity full: ${openPositionsCount}/${maxPositions} open positions. No new entries permitted.` };
  }

  // 2. Guardrail: Sector concentration cap
  if (sectorPositionsCount >= maxPerSector) {
    return { shares: 0, capitalDeployed: 0, riskAmount: 0, method: 'SECTOR_CONCENTRATION_CAP', explanation: `Sector limit reached: ${sectorPositionsCount}/${maxPerSector} positions in this sector. Diversification rule active.` };
  }

  // 3. Guardrail: Drawdown Circuit Breaker
  let circuitBreakerMult = 1.0;
  let circuitBreakerState = 'NORMAL';
  if (portfolioDrawdownPct >= 10.0) {
    return {
      shares: 0, capitalDeployed: 0, riskAmount: 0,
      method: 'CIRCUIT_BREAKER_LEVEL_2',
      circuitBreakerState: 'LEVEL_2_FREEZE',
      explanation: `DRAWDOWN CIRCUIT BREAKER LEVEL 2 ACTIVE (${portfolioDrawdownPct}% >= 10%). All new trading paused until recovery.`
    };
  } else if (portfolioDrawdownPct >= 5.0) {
    circuitBreakerMult = 0.5;
    circuitBreakerState = 'LEVEL_1_REDUCED_50';
  }

  const riskPerShare = Math.abs(entryPrice - stopLoss);
  if (riskPerShare <= 0) {
    return { shares: 0, capitalDeployed: 0, riskAmount: 0, method: 'ZERO_RISK_PER_SHARE', explanation: 'Entry equals stop loss.' };
  }

  // Kelly Criterion: f* = (bp - q) / b
  const kellyFraction = Math.max(0, (avgWinLoss * winRate - (1 - winRate)) / avgWinLoss);
  const halfKelly = kellyFraction / 2;

  // Conviction multiplier based on quant score
  let convictionMult = 0.5;
  if (quantScore >= 85) convictionMult = 1.2;
  else if (quantScore >= 75) convictionMult = 1.0;
  else if (quantScore >= 65) convictionMult = 0.8;
  else if (quantScore >= 50) convictionMult = 0.6;
  else convictionMult = 0.35;

  // ATR volatility adjustment
  const atrPct = atr && entryPrice > 0 ? (atr / entryPrice) * 100 : 2.0;
  let volAdjust = 1.0;
  if (atrPct > 4.0) volAdjust = 0.5;
  else if (atrPct > 3.0) volAdjust = 0.7;
  else if (atrPct > 2.0) volAdjust = 0.85;
  else volAdjust = 1.0;

  // HARD RISK CEILING: Strictly 1.0% maximum risk of total equity per trade
  const HARD_MAX_RISK_PER_TRADE = 0.01;
  const availableHeat = Math.max(0, maxPortfolioRisk - existingRiskPct);

  // Calculate position risk percentage
  const rawRiskPct = Math.min(halfKelly, HARD_MAX_RISK_PER_TRADE);
  const adjustedRiskPct = rawRiskPct * convictionMult * volAdjust * regimeMultiplier * circuitBreakerMult;
  const effectiveRiskPct = Math.min(adjustedRiskPct, HARD_MAX_RISK_PER_TRADE, availableHeat);

  if (effectiveRiskPct <= 0) {
    return {
      shares: 0, capitalDeployed: 0, riskAmount: 0,
      method: 'PORTFOLIO_HEAT_EXHAUSTED',
      explanation: `Portfolio heat limit (6% max) fully exhausted. Current heat: ${round(existingRiskPct * 100, 1)}%. Cannot add risk.`
    };
  }

  const maxRiskCapital = capital * effectiveRiskPct;
  let shares = Math.floor(maxRiskCapital / riskPerShare);

  // Notional cap: Never exceed 15% of capital in a single position (20% for score >= 85)
  const maxNotionalPct = quantScore >= 85 ? 0.20 : 0.15;
  const maxByNotional = Math.floor((capital * maxNotionalPct) / entryPrice);
  shares = Math.min(shares, maxByNotional);
  shares = Math.max(0, shares);

  const capitalDeployed = round(shares * entryPrice);
  const riskAmount = round(shares * riskPerShare);
  const notionalPct = round((capitalDeployed / capital) * 100, 1);

  return {
    shares,
    capitalDeployed,
    riskAmount,
    notionalPct,
    effectiveRiskPct: round(effectiveRiskPct * 100, 2),
    hardCapPct: round(HARD_MAX_RISK_PER_TRADE * 100, 2),
    circuitBreakerState,
    kellyFraction: round(kellyFraction * 100, 1),
    halfKelly: round(halfKelly * 100, 1),
    convictionMult: round(convictionMult, 2),
    volAdjust: round(volAdjust, 2),
    circuitBreakerMult: round(circuitBreakerMult, 2),
    maxNotionalPct: round(maxNotionalPct * 100),
    method: 'HARD_CAPPED_KELLY_ATR',
    explanation: shares > 0
      ? `Hard risk cap: 1% max per trade. Sized at ${round(effectiveRiskPct * 100, 2)}% risk (₹${riskAmount}) → ${shares} shares (₹${capitalDeployed} notional, ${notionalPct}% of capital). Circuit breaker: ${circuitBreakerState}.`
      : 'Position size is zero — risk budget or sector constraints reached.'
  };
}

// ────────────────────────────────────────────────────────────────
// 2. PYRAMIDING — Averaging Up at Higher Pivots
//    Add shares only when the initial position is already profitable
// ────────────────────────────────────────────────────────────────
function calculatePyramidPlan(params) {
  const {
    entryPrice,
    currentPrice,
    stopLoss,
    target1,
    target2,
    atr,
    quantScore = 50,
    initialShares = 0,
  } = params;

  if (!entryPrice || !currentPrice || !atr || initialShares <= 0) {
    return { canPyramid: false, reason: 'Insufficient data for pyramiding plan.' };
  }

  const currentGainPct = round(((currentPrice - entryPrice) / entryPrice) * 100, 1);
  const isInProfit = currentGainPct >= 3; // At least +3% before pyramiding

  // Pyramid Level 1: When position is +5% above entry (add 30% more shares)
  const pyramidTrigger1 = round(entryPrice * 1.05);
  const pyramidSize1 = Math.floor(initialShares * 0.30);
  const pyramidStop1 = round(entryPrice * 1.01); // Stop above breakeven

  // Pyramid Level 2: When position is +10% above entry (add 20% more shares)
  const pyramidTrigger2 = round(entryPrice * 1.10);
  const pyramidSize2 = Math.floor(initialShares * 0.20);
  const pyramidStop2 = round(entryPrice * 1.05); // Lock in 5% profit

  // Pyramid Level 3 (RARE): +15% monster breakout (add 10%)
  const pyramidTrigger3 = round(entryPrice * 1.15);
  const pyramidSize3 = Math.floor(initialShares * 0.10);
  const pyramidStop3 = round(entryPrice * 1.10); // Lock in 10% profit

  const pyramidLevels = [
    {
      level: 1,
      triggerPrice: pyramidTrigger1,
      addShares: pyramidSize1,
      newStopLoss: pyramidStop1,
      requiredGain: '+5%',
      status: currentPrice >= pyramidTrigger1 ? 'TRIGGERED' : 'PENDING',
      note: 'Add 30% more shares. Move entire position stop to breakeven +1%.',
    },
    {
      level: 2,
      triggerPrice: pyramidTrigger2,
      addShares: pyramidSize2,
      newStopLoss: pyramidStop2,
      requiredGain: '+10%',
      status: currentPrice >= pyramidTrigger2 ? 'TRIGGERED' : 'PENDING',
      note: 'Add 20% more shares. Ratchet stop to lock +5% gain on full position.',
    },
    {
      level: 3,
      triggerPrice: pyramidTrigger3,
      addShares: pyramidSize3,
      newStopLoss: pyramidStop3,
      requiredGain: '+15%',
      status: currentPrice >= pyramidTrigger3 ? 'TRIGGERED' : 'PENDING',
      note: 'Final add: 10% more shares. This is a monster runner — ratchet stop to +10%.',
    }
  ];

  // Total potential shares with full pyramid execution
  const totalPyramidShares = pyramidSize1 + pyramidSize2 + pyramidSize3;
  const maxTotalShares = initialShares + totalPyramidShares;

  return {
    canPyramid: quantScore >= 65 && isInProfit,
    currentGainPct,
    isInProfit,
    totalPyramidShares,
    maxTotalShares,
    pyramidLevels,
    rationale: isInProfit
      ? `Position is +${currentGainPct}% in profit. Pyramiding is available to compound gains while ratcheting stops higher.`
      : `Position needs +3% profit before pyramiding is allowed. Current: ${currentGainPct}%.`,
  };
}

// ────────────────────────────────────────────────────────────────
// 3. MULTI-TIMEFRAME CONFLUENCE — Weekly Chart Alignment (Zero Repaint)
//    Requires weekly trend alignment before taking daily breakout triggers.
//    Strict Quant Rule: Uses ONLY completed weekly bars so mid-week fluctuations
//    cannot alter historical weekly EMAs or trigger lookahead repainting.
// ────────────────────────────────────────────────────────────────
function analyzeMultiTimeframe(dailyOhlcv = []) {
  if (!dailyOhlcv || dailyOhlcv.length < 50) {
    return {
      weeklyTrend: 'INSUFFICIENT_DATA',
      weeklyAligned: false,
      confluenceBonus: 0,
      summary: 'Need at least 50 daily bars for weekly analysis.',
    };
  }

  // Aggregate daily bars into weekly bars (Monday through Friday)
  const weeklyBars = [];
  let weekOpen = null, weekHigh = -Infinity, weekLow = Infinity, weekClose = 0, weekVol = 0;
  let currentWeekKey = null;

  for (const bar of dailyOhlcv) {
    const d = new Date(bar.date);
    // Standard ISO week grouping (Monday = 1 ... Sunday = 7)
    const day = d.getUTCDay() || 7;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - day + 1);
    const weekKey = monday.toISOString().split('T')[0];
    
    if (currentWeekKey !== weekKey) {
      if (currentWeekKey !== null) {
        weeklyBars.push({ weekStart: currentWeekKey, open: weekOpen, high: weekHigh, low: weekLow, close: weekClose, volume: weekVol, barCount: weekVol > 0 ? 1 : 0 });
      }
      currentWeekKey = weekKey;
      weekOpen = bar.open;
      weekHigh = bar.high;
      weekLow = bar.low;
      weekClose = bar.close;
      weekVol = bar.volume || 0;
    } else {
      weekHigh = Math.max(weekHigh, bar.high);
      weekLow = Math.min(weekLow, bar.low);
      weekClose = bar.close;
      weekVol += (bar.volume || 0);
    }
  }

  // To prevent repainting, we only use COMPLETED weekly bars for weekly indicators.
  // The current in-progress week is excluded from indicator calculation so mid-week
  // bars never alter historical weekly EMAs or RSI.
  const completedWeeklyBars = [...weeklyBars];

  if (completedWeeklyBars.length < 10) {
    return {
      weeklyTrend: 'INSUFFICIENT_WEEKLY',
      weeklyAligned: false,
      confluenceBonus: 0,
      summary: `Fewer than 10 completed weekly bars available (${completedWeeklyBars.length} found).`,
    };
  }

  const weeklyCloses = completedWeeklyBars.map(b => b.close);
  const latestDailyClose = dailyOhlcv[dailyOhlcv.length - 1].close;

  // Calculate weekly 10 and 30 period EMA equivalent strictly on completed bars
  const calcEMA = (values, period) => {
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  };

  const weeklyEma10 = calcEMA(weeklyCloses, 10);
  const weeklyEma30 = calcEMA(weeklyCloses, Math.min(30, weeklyCloses.length));

  // Weekly RSI (rough estimate using last 14 weeks)
  const last14 = weeklyCloses.slice(-15);
  let gains = 0, losses = 0, gCount = 0, lCount = 0;
  for (let i = 1; i < last14.length; i++) {
    const diff = last14[i] - last14[i - 1];
    if (diff > 0) { gains += diff; gCount++; }
    else { losses += Math.abs(diff); lCount++; }
  }
  const avgGain = gCount > 0 ? gains / 14 : 0;
  const avgLoss = lCount > 0 ? losses / 14 : 0.001;
  const weeklyRSI = round(100 - (100 / (1 + avgGain / avgLoss)));

  // Weekly trend determination
  let weeklyTrend = 'SIDEWAYS';
  let weeklyAligned = false;
  let confluenceBonus = 0;

  const priceAboveWeekly10 = latestDailyClose > weeklyEma10;
  const priceAboveWeekly30 = latestDailyClose > weeklyEma30;
  const ema10AboveEma30 = weeklyEma10 > weeklyEma30;

  if (priceAboveWeekly10 && priceAboveWeekly30 && ema10AboveEma30 && weeklyRSI >= 50) {
    weeklyTrend = 'STRONG_UPTREND';
    weeklyAligned = true;
    confluenceBonus = 10; // +10 point bonus to quant score
  } else if (priceAboveWeekly30 && weeklyRSI >= 45) {
    weeklyTrend = 'UPTREND';
    weeklyAligned = true;
    confluenceBonus = 5;
  } else if (!priceAboveWeekly30 && weeklyRSI < 45) {
    weeklyTrend = 'DOWNTREND';
    weeklyAligned = false;
    confluenceBonus = -8; // Penalty for counter-trend daily trades
  } else {
    weeklyTrend = 'SIDEWAYS';
    weeklyAligned = false;
    confluenceBonus = 0;
  }

  return {
    weeklyTrend,
    weeklyAligned,
    confluenceBonus,
    weeklyEma10: round(weeklyEma10),
    weeklyEma30: round(weeklyEma30),
    weeklyRSI,
    summary: weeklyAligned
      ? `Weekly chart confirms ${weeklyTrend}. EMA10 (₹${round(weeklyEma10)}) > EMA30 (₹${round(weeklyEma30)}). Weekly RSI: ${weeklyRSI}. Daily breakouts have higher follow-through probability.`
      : `Weekly chart is ${weeklyTrend}. Daily breakouts may face resistance from larger timeframe trend. Reduce position size or wait for weekly alignment.`,
  };
}

// ────────────────────────────────────────────────────────────────
// 4. SECTOR MOMENTUM ROTATION — NSE Sector RS Scoring
//    Automatically identifies leading sectors for capital allocation
// ────────────────────────────────────────────────────────────────
const NSE_SECTOR_TICKERS = {
  'IT':       '^CNXIT',
  'BANK':     '^CNXBANK',
  'PHARMA':   '^CNXPHARMA',
  'AUTO':     '^CNXAUTO',
  'FMCG':     '^CNXFMCG',
  'METAL':    '^CNXMETAL',
  'REALTY':   '^CNXREALTY',
  'ENERGY':   '^CNXENERGY',
  'INFRA':    '^CNXINFRA',
  'PSE':      '^CNXPSE',
};

// Maps common stock sectors to NSE sector indices
const SECTOR_MAPPING = {
  'Technology': 'IT',
  'Information Technology': 'IT',
  'Financial Services': 'BANK',
  'Banking': 'BANK',
  'Healthcare': 'PHARMA',
  'Pharmaceuticals': 'PHARMA',
  'Consumer Cyclical': 'AUTO',
  'Automobile': 'AUTO',
  'Consumer Defensive': 'FMCG',
  'FMCG': 'FMCG',
  'Basic Materials': 'METAL',
  'Metals': 'METAL',
  'Real Estate': 'REALTY',
  'Energy': 'ENERGY',
  'Utilities': 'ENERGY',
  'Industrials': 'INFRA',
  'Infrastructure': 'INFRA',
};

function identifyStockSector(sectorName) {
  if (!sectorName) return null;
  return SECTOR_MAPPING[sectorName] || null;
}

function calculateSectorRotationBonus(stockSector, sectorRankings = []) {
  if (!stockSector || !sectorRankings.length) {
    return {
      inLeadingSector: false,
      sectorRank: null,
      rotationBonus: 0,
      note: 'Sector rotation data unavailable.',
    };
  }

  const rank = sectorRankings.findIndex(s => s.sector === stockSector);
  if (rank < 0) {
    return {
      inLeadingSector: false,
      sectorRank: null,
      rotationBonus: 0,
      note: `Stock sector (${stockSector}) not found in rotation rankings.`,
    };
  }

  const isTop3 = rank < 3;
  const isBottom3 = rank >= sectorRankings.length - 3;
  let rotationBonus = 0;

  if (rank === 0) rotationBonus = 8;
  else if (rank === 1) rotationBonus = 5;
  else if (rank === 2) rotationBonus = 3;
  else if (isBottom3) rotationBonus = -5;
  else rotationBonus = 0;

  return {
    inLeadingSector: isTop3,
    sectorRank: rank + 1,
    totalSectors: sectorRankings.length,
    rotationBonus,
    sectorName: stockSector,
    topSectors: sectorRankings.slice(0, 3).map(s => s.sector),
    note: isTop3
      ? `${stockSector} is a TOP ${rank + 1} leading sector! Capital should be concentrated here for maximum momentum capture.`
      : isBottom3
      ? `${stockSector} is a lagging sector (Rank ${rank + 1}/${sectorRankings.length}). Rotate capital toward ${sectorRankings[0].sector} / ${sectorRankings[1].sector}.`
      : `${stockSector} is mid-pack (Rank ${rank + 1}). Only take highest conviction setups here.`,
  };
}

// ────────────────────────────────────────────────────────────────
// 5. ADAPTIVE TRAILING STOP SYSTEM — Chandelier / ATR / EMA Hybrid
//    Switches between trailing methods based on how far the trade has run
// ────────────────────────────────────────────────────────────────
function calculateAdaptiveTrailingStop(params) {
  const {
    entryPrice,
    currentPrice,
    highSinceEntry,
    atr,
    ema10,
    ema20,
    ema50,
  } = params;

  if (!entryPrice || !currentPrice || !atr) {
    return { trailingStop: null, method: 'INSUFFICIENT_DATA' };
  }

  const gainPct = ((currentPrice - entryPrice) / entryPrice) * 100;
  const peakGain = highSinceEntry
    ? ((highSinceEntry - entryPrice) / entryPrice) * 100
    : gainPct;
  const peak = highSinceEntry || currentPrice;

  let trailingStop, method, explanation;

  if (peakGain < 5) {
    // Phase 1: Hard ATR stop (early trade protection)
    trailingStop = round(entryPrice - 1.5 * atr);
    method = 'HARD_ATR_STOP';
    explanation = `Trade is early (+${round(gainPct, 1)}%). Using hard 1.5x ATR stop at ₹${trailingStop}. No trailing yet.`;
  } else if (peakGain < 10) {
    // Phase 2: Chandelier stop from peak (2x ATR)
    trailingStop = round(peak - 2.0 * atr);
    // Floor at breakeven
    trailingStop = Math.max(trailingStop, entryPrice);
    method = 'CHANDELIER_2ATR';
    explanation = `Trade running +${round(gainPct, 1)}%. Chandelier trailing from peak ₹${round(peak)} minus 2 ATR. Stop at ₹${trailingStop} (breakeven floor active).`;
  } else if (peakGain < 20) {
    // Phase 3: 10 EMA trail
    const emaStop = ema10 || round(currentPrice * 0.97);
    trailingStop = round(Math.max(emaStop, entryPrice * 1.05)); // Floor at +5%
    method = '10_EMA_TRAIL';
    explanation = `Solid runner +${round(gainPct, 1)}%. Trailing on 10 EMA at ₹${trailingStop}. Locked in at least +5% profit.`;
  } else if (peakGain < 40) {
    // Phase 4: 20 EMA trail (wider for monster moves)
    const emaStop = ema20 || round(currentPrice * 0.95);
    trailingStop = round(Math.max(emaStop, entryPrice * 1.10)); // Floor at +10%
    method = '20_EMA_TRAIL';
    explanation = `Monster runner +${round(gainPct, 1)}%! Trailing on 20 EMA at ₹${trailingStop}. Locked in at least +10% profit.`;
  } else {
    // Phase 5: 50 EMA trail (multi-month runners)
    const emaStop = ema50 || round(currentPrice * 0.92);
    trailingStop = round(Math.max(emaStop, entryPrice * 1.20)); // Floor at +20%
    method = '50_EMA_TRAIL';
    explanation = `Legendary runner +${round(gainPct, 1)}%! Trailing on 50 EMA at ₹${trailingStop}. Locked in at least +20% profit.`;
  }

  return {
    trailingStop,
    method,
    gainPct: round(gainPct, 1),
    peakGain: round(peakGain, 1),
    explanation,
    phases: [
      { range: '0-5%', method: 'Hard ATR Stop', active: peakGain < 5 },
      { range: '5-10%', method: 'Chandelier 2 ATR', active: peakGain >= 5 && peakGain < 10 },
      { range: '10-20%', method: '10 EMA Trail', active: peakGain >= 10 && peakGain < 20 },
      { range: '20-40%', method: '20 EMA Trail', active: peakGain >= 20 && peakGain < 40 },
      { range: '40%+', method: '50 EMA Trail', active: peakGain >= 40 },
    ],
  };
}

// ────────────────────────────────────────────────────────────────
// 6. MASTER PROFIT MAXIMIZER — Aggregates all strategies into one packet
// ────────────────────────────────────────────────────────────────
function generateProfitMaximizerPacket(params) {
  const {
    quote = {},
    technicals = {},
    historical = [],
    swingPlaybook = {},
    quantScore = 50,
    marketRegime = {},
    capital = 100000,
  } = params;

  const currentPrice = quote?.price || 0;
  const atr = technicals?.indicators?.atr?.value || (currentPrice * 0.02);
  const entryPrice = swingPlaybook?.levels?.entry || currentPrice;
  const stopLoss = swingPlaybook?.levels?.stop || round(entryPrice - 1.5 * atr);
  const target1 = swingPlaybook?.levels?.t1 || round(entryPrice * 1.10);
  const target2 = swingPlaybook?.levels?.t2 || round(entryPrice * 1.18);
  const ema10 = technicals?.indicators?.ema?.ema9 || round(currentPrice * 0.98);
  const ema20 = technicals?.indicators?.movingAverages?.ema20 || round(currentPrice * 0.96);
  const ema50 = technicals?.indicators?.movingAverages?.ema50 || round(currentPrice * 0.92);
  const regimeMult = marketRegime?.regimeMultiplier || 0.5;

  // 1. Dynamic Position Sizing
  const dynamicPosition = calculateDynamicPositionSize({
    capital,
    entryPrice,
    stopLoss,
    atr,
    quantScore,
    regimeMultiplier: regimeMult,
  });

  // 2. Pyramiding Plan
  const pyramidPlan = calculatePyramidPlan({
    entryPrice,
    currentPrice,
    stopLoss,
    target1,
    target2,
    atr,
    quantScore,
    initialShares: dynamicPosition.shares,
  });

  // 3. Multi-Timeframe Confluence
  const mtfConfluence = analyzeMultiTimeframe(historical);

  // 4. Sector Rotation (lightweight — just identify sector context)
  const stockSector = identifyStockSector(quote?.sector);
  const sectorContext = {
    identifiedSector: stockSector,
    note: stockSector
      ? `Stock maps to NSE ${stockSector} sector. Use sector rotation data on dashboard for capital weighting.`
      : 'Sector not mapped. Use individual stock conviction scoring only.',
  };

  // 5. Adaptive Trailing Stop
  const adaptiveTrail = calculateAdaptiveTrailingStop({
    entryPrice,
    currentPrice,
    highSinceEntry: quote?.fiftyTwoWeekHigh || currentPrice,
    atr,
    ema10,
    ema20,
    ema50,
  });

  // 6. Conviction Score Enhancement
  // Combine quant score with multi-timeframe bonus
  const baseScore = quantScore;
  const mtfBonus = mtfConfluence.confluenceBonus;
  const enhancedScore = Math.min(100, Math.max(0, baseScore + mtfBonus));

  // Overall Profit Maximizer Grade
  let profitGrade = 'C';
  let profitLabel = 'LOW EDGE';
  if (enhancedScore >= 85 && mtfConfluence.weeklyAligned) {
    profitGrade = 'S';
    profitLabel = '🔥 MAXIMUM CONVICTION — FULL DEPLOYMENT';
  } else if (enhancedScore >= 75) {
    profitGrade = 'A';
    profitLabel = '💎 HIGH CONVICTION — STANDARD DEPLOYMENT';
  } else if (enhancedScore >= 60) {
    profitGrade = 'B';
    profitLabel = '📊 MODERATE — REDUCED SIZE';
  } else if (enhancedScore >= 45) {
    profitGrade = 'C';
    profitLabel = '⏳ LOW EDGE — MINIMAL EXPOSURE';
  } else {
    profitGrade = 'D';
    profitLabel = '🚫 NO EDGE — STAY IN CASH';
  }

  // Expected Value calculation
  const winRate = 0.52 + (enhancedScore >= 75 ? 0.08 : enhancedScore >= 60 ? 0.04 : 0);
  const avgWin = target1 > entryPrice ? ((target1 - entryPrice) / entryPrice) * 100 : 10;
  const avgLoss = stopLoss < entryPrice ? ((entryPrice - stopLoss) / entryPrice) * 100 : 3.5;
  const expectedValue = round(winRate * avgWin - (1 - winRate) * avgLoss, 2);

  return {
    profitGrade,
    profitLabel,
    enhancedQuantScore: enhancedScore,
    baseQuantScore: baseScore,
    mtfBonus,
    expectedValue,
    expectedValueNote: `EV = ${round(winRate * 100)}% × +${round(avgWin, 1)}% − ${round((1 - winRate) * 100)}% × −${round(avgLoss, 1)}% = ${expectedValue > 0 ? '+' : ''}${expectedValue}% per trade`,
    dynamicPosition,
    pyramidPlan,
    mtfConfluence,
    sectorContext,
    adaptiveTrail,
    profitTips: generateProfitTips(enhancedScore, mtfConfluence, dynamicPosition, pyramidPlan),
  };
}

// Generate contextual profit-maximizing tips
function generateProfitTips(score, mtf, position, pyramid) {
  const tips = [];

  if (score >= 80 && mtf.weeklyAligned) {
    tips.push({
      icon: '🎯',
      title: 'Maximum Firepower',
      tip: 'Weekly + Daily alignment confirmed. This is the highest-probability setup. Deploy full position size and activate pyramid plan.'
    });
  }

  if (!mtf.weeklyAligned && score >= 65) {
    tips.push({
      icon: '⚠️',
      title: 'Weekly Headwind',
      tip: 'Daily setup looks good but weekly chart is not aligned. Cut position size by 40% and skip pyramiding.'
    });
  }

  if (pyramid.canPyramid) {
    tips.push({
      icon: '📈',
      title: 'Pyramid Activated',
      tip: `Position is +${pyramid.currentGainPct}% in profit. Add shares at next pyramid trigger to compound returns while ratcheting stops higher.`
    });
  }

  if (position.shares > 0 && position.effectiveRiskPct < 1.0) {
    tips.push({
      icon: '🛡️',
      title: 'Capital Efficient',
      tip: `Only risking ${position.effectiveRiskPct}% of capital on this trade (₹${position.riskAmount}). Room to add more positions.`
    });
  }

  if (score < 50) {
    tips.push({
      icon: '💰',
      title: 'Cash is King',
      tip: 'No high-conviction edge detected. Sitting in cash and waiting for an A+ setup will outperform forcing marginal trades over time.'
    });
  }

  tips.push({
    icon: '⚡',
    title: 'Edge Compounding',
    tip: 'The key to profit maximization: Take every A+ setup at full size, pyramid winners, cut losers instantly, and let runners trail on EMA.'
  });

  return tips;
}

module.exports = {
  calculateDynamicPositionSize,
  calculatePyramidPlan,
  analyzeMultiTimeframe,
  calculateSectorRotationBonus,
  calculateAdaptiveTrailingStop,
  generateProfitMaximizerPacket,
  identifyStockSector,
  NSE_SECTOR_TICKERS,
};
