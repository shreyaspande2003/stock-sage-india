// Deterministic swing playbook — ATR, structure, volume, confluence. V2
// This layer does not use an LLM. Prices come from math so the desk has a floor.

function round(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

function pct(from, to) {
  if (!from || !to) return null;
  return round(((to - from) / from) * 100, 2);
}

function buildSwingPlaybook(quote, technicals, ohlcv = [], marketRegime = null) {
  const price = quote?.price || technicals?.currentPrice;
  if (!price || !technicals || technicals.error) {
    return {
      setup: 'INSUFFICIENT_DATA',
      bias: 'NONE',
      qualityScore: 0,
      tradeWorthy: false,
      why: ['Not enough price history to score a swing setup.'],
    };
  }

  const ind = technicals.indicators || {};
  const atr = ind.atr?.value || round(price * 0.02);
  const rsi = ind.rsi?.value || 50;
  const ema = ind.ema || {};
  const adx = ind.adx || {};
  const bb = ind.bollingerBands;
  const vol = ind.volume || {};
  const sr = technicals.supportResistance || { supports: [], resistances: [] };

  const nearestSupport = sr.supports?.[0] || round(price - atr * 2);
  const nearestResistance = sr.resistances?.[0] || round(price + atr * 2.5);
  const strongSupport = sr.supports?.[1] || round(price - atr * 3);
  const strongResistance = sr.resistances?.[1] || nearestResistance;

  const volRatio = vol.ratio || 1;
  const bbWidthPct = bb ? bb.bandwidth : 50;
  const bbPosition = bb?.position || 'WITHIN';

  const distToRes = nearestResistance ? ((nearestResistance - price) / price) * 100 : 99;
  const distToSup = nearestSupport ? ((price - nearestSupport) / price) * 100 : 99;

  // Use the new v2 score data if available, otherwise fallback
  let score = technicals.overallTechnicalScore || 50;
  const v2Data = technicals.v2ScoreData || {};
  const stockRegime = v2Data.stockRegime || (adx.adx >= 20 ? 'TREND' : 'RANGE');

  let setup = 'WAIT';
  let bias = 'NEUTRAL';
  const confluence = [];

  // V2 Setup Classifier
  if (stockRegime === 'TREND' && distToRes < 1.0 && volRatio >= 1.5 && bbWidthPct < 40 && rsi < 78) {
    setup = 'BREAKOUT';
    bias = 'LONG';
    confluence.push('Breakout setup: Tightly coiled under resistance with volume spike.');
  } else if (stockRegime === 'TREND' && rsi >= 40 && rsi <= 58 && distToRes > 2.0 && price >= ema.ema21 - atr * 0.5 && price <= ema.ema21 + atr * 0.5) {
    setup = 'TREND_PULLBACK';
    bias = 'LONG';
    confluence.push('Trend Pullback: Pulled back to EMA 20 with room to run.');
  } else if (stockRegime === 'TREND' && distToRes > 1.5 && price > ema.ema50 * 1.02 && price < ema.ema50 * 1.12) {
    setup = 'TREND_CONTINUATION';
    bias = 'LONG';
    confluence.push('Trend Continuation: Healthy uptrend with upside room.');
  } else if (stockRegime === 'RANGE' && bbPosition === 'BELOW_LOWER' && rsi < 32 && price > ema.ema200) {
    setup = 'MEAN_REVERSION';
    bias = 'LONG';
    confluence.push('Mean Reversion: Deeply oversold stretch in a range, targeting mid-band.');
  } else {
    setup = 'WAIT';
    bias = 'NEUTRAL';
    if (stockRegime === 'RANGE') confluence.push('Choppy range regime, wait for a trend or oversold setup.');
    else confluence.push('No edge setup detected in current trend.');
  }

  // Overextension veto
  if (v2Data.isOverextended) {
    confluence.push('Veto: Price is extended >12% over 50 EMA. Chasing not allowed.');
  }

  // Calculate Stops according to v2 doc
  let entry = price;
  let stop;
  let atrMult = 1.8;
  
  if (setup === 'BREAKOUT') atrMult = 1.6;
  else if (setup === 'MEAN_REVERSION') atrMult = 1.4;

  if (bias === 'LONG') {
    if (setup === 'BREAKOUT') entry = round(Math.max(price, nearestResistance * 0.998));
    
    const atrStop = entry - atrMult * atr;
    const structStop = nearestSupport - 0.25 * atr;
    stop = round(Math.max(atrStop, structStop)); // Tighter of the two
    
    const minRisk = 0.8 * atr;
    if (entry - stop < minRisk) stop = round(entry - minRisk); // Floor
  } else if (bias === 'SHORT') {
    entry = price;
    stop = round(entry + atrMult * atr);
  } else {
    stop = round(price - atr * 2);
  }

  const riskPts = bias === 'SHORT' ? (stop - entry) : (entry - stop);
  
  // Trade worthiness checks
  let tradeWorthy = setup !== 'WAIT' && setup !== 'INSUFFICIENT_DATA' && !v2Data.isOverextended;

  // Stop width check
  if (tradeWorthy && (riskPts > 2.5 * atr || riskPts > 0.08 * entry)) {
    tradeWorthy = false;
    confluence.push('Trade rejected: Risk (stop loss) is too wide (> 2.5 ATR or > 8%).');
  }

  // Targets
  let t1 = nearestResistance;
  let t2 = strongResistance;
  
  if (tradeWorthy && bias === 'LONG') {
    const minT1 = entry + riskPts * 1.5;
    t1 = Math.min(nearestResistance, minT1);
    if (t1 <= entry) t1 = minT1; // fallback
    
    t2 = Math.max(strongResistance, entry + riskPts * 2.5);
  }

  const rewardPts = bias === 'SHORT' ? (entry - t1) : (t1 - entry);
  const rr = riskPts > 0 ? round(rewardPts / riskPts, 2) : 0;
  
  if (rr < 1.5 && tradeWorthy) {
    tradeWorthy = false;
    confluence.push(`Trade rejected: R:R is ${rr}, which is below minimum 1.5.`);
  }

  // Market Regime Veto
  if (marketRegime === 'RISK_OFF' && tradeWorthy) {
    tradeWorthy = false;
    confluence.push('Market Regime Veto: Broader market is in RISK_OFF. Cash preservation active — no new long entries.');
  }

  const capital = 100000;
  // Position sizing using regime multiplier
  const effectiveRegime = marketRegime || (stockRegime === 'TREND' ? 'RISK_ON' : 'NEUTRAL');
  const regimeMult = effectiveRegime === 'RISK_ON' ? 1.0 : effectiveRegime === 'RISK_OFF' ? 0.25 : 0.5;
  const riskPct = 0.01; // 1% account risk
  const maxRiskCapital = capital * riskPct * regimeMult;
  
  let shares = 0;
  if (riskPts > 0) shares = Math.floor(maxRiskCapital / riskPts);
  const maxByCap = Math.floor((capital * 0.15) / entry); // Max 15% notional cap
  shares = Math.max(0, Math.min(shares, maxByCap));

  const positionPct = round((shares * entry) / capital * 100, 1);

  const howToTrade = tradeWorthy 
    ? `${bias === 'LONG' ? 'BUY' : 'SELL'} zone ₹${entry}. Stop ₹${stop}. Take 50% at T1 ₹${t1}, trail rest to T2 ₹${t2}. Size ${shares} shares (₹${round(riskPts * shares)} risk).`
    : `Skip this. ${setup === 'WAIT' ? 'No actionable setup right now.' : 'Failed risk/reward or wide stop checks.'}`;

  return {
    setup,
    bias,
    qualityScore: score,
    tradeWorthy,
    trend: ema.trend || 'SIDEWAYS',
    adx: adx.adx || 0,
    rsi,
    atr,
    volumeRatio: volRatio,
    levels: { entry, stop, t1, t2, t3: t2, nearestSupport, nearestResistance, strongSupport, strongResistance },
    riskRewardT1: rr,
    expectedReturnT1Pct: pct(entry, t1),
    stopDistancePct: round((riskPts / entry) * 100, 2),
    position: {
      referenceCapital: capital,
      riskPercent: riskPct * 100,
      shares,
      notionalPct: positionPct,
      note: `Regime multiplier applied: ${regimeMult}x. Never exceed 15% notional cap.`,
    },
    why: confluence,
    explain: {
      whyEntry: tradeWorthy ? `Entry near ₹${entry} confirms the ${setup} setup.` : 'N/A',
      whyStop: `Stop ₹${stop} is tighter of structure or ${atrMult} ATR. Min risk 0.8 ATR floor applied.`,
      whyTargets: `T1 (₹${t1}) ensures minimum 1.5 R:R. T2 (₹${t2}) captures trend tail.`,
      invalidation: `Close below ₹${stop}`,
      howToTrade,
      structure: 'V2 Structure Evaluation',
    },
    rules: [
      'Stop = tighter of structure and ATR, bounded by floor.',
      'Take 50% at T1, move stop to breakeven.',
      'Max total open risk 4% of capital.',
    ],
  };
}

module.exports = { buildSwingPlaybook };
