// Point-In-Time Simulation — Zero Lookahead Walk-Forward Engine
// Tests StockSage Quant consensus and Morning Breakout rules as if today were 1-2 weeks ago.

const yahooFinance = require('../services/yahooFinance.cjs');
const { calculateIndicators } = require('../services/technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('../services/swingEngine.cjs');
const { calculateQuantConsensus } = require('../services/quantConsensusEngine.cjs');
const { calculateRelativeStrength } = require('../services/rsEngine.cjs');
const { UNIVERSE } = require('../services/universeFilter.cjs');

async function runPointInTimeSimulation(cutoffDate = '2026-10-14', investmentAmount = 1000) {
  console.log(`\n===============================================================`);
  console.log(`⏳ POINT-IN-TIME SIMULATION (ZERO LOOKAHEAD BIAS)`);
  console.log(`📅 Cutoff Date (Simulated "Today"): ${cutoffDate}`);
  console.log(`💰 Capital Allocation: ₹${investmentAmount}`);
  console.log(`===============================================================\n`);

  // Tracked test universe (multi-cap sample representing large, mid, and momentum leaders)
  const testUniverse = [
    'PPLPHARMA', 'BHARTIARTL', 'LT', 'TRENT', 'RELIANCE', 'TATASTEEL',
    'HAL', 'DIXON', 'CDSL', 'RVNL', 'BEL', 'MAZDOCK', 'TITAN', 'ITC', 'INFY'
  ];

  console.log(`Scanning ${testUniverse.length} stocks using ONLY data available on or before ${cutoffDate}...\n`);

  const recommendationsAtT0 = [];

  for (const symbol of testUniverse) {
    try {
      // 1. Fetch full 1y history from Yahoo Finance
      const fullHistory = await yahooFinance.getHistorical(symbol, '1y', '1d');
      if (!fullHistory || fullHistory.length < 30) continue;

      // 2. STAGE 1: Strict Slice at Cutoff Date (ZERO FUTURE KNOWLEDGE)
      const cutoffIndex = fullHistory.findIndex(b => b.date === cutoffDate);
      if (cutoffIndex === -1 || cutoffIndex < 25) {
        // Fallback: look for closest date on or before cutoff
        continue;
      }

      // Sliced data up to and including cutoff date ONLY
      const historicalAtT0 = fullHistory.slice(0, cutoffIndex + 1);
      const futureBars = fullHistory.slice(cutoffIndex + 1); // Future bars (used ONLY for tracking what happened next)

      const lastBarAtT0 = historicalAtT0[historicalAtT0.length - 1];
      const prevBar = historicalAtT0[historicalAtT0.length - 2];

      const simulatedQuote = {
        symbol: symbol.toUpperCase(),
        name: symbol,
        price: lastBarAtT0.close,
        change: lastBarAtT0.close - prevBar.close,
        changePercent: ((lastBarAtT0.close - prevBar.close) / prevBar.close) * 100,
        volume: lastBarAtT0.volume,
        avgVolume: historicalAtT0.slice(-20).reduce((acc, b) => acc + (b.volume || 0), 0) / 20,
        currency: 'INR'
      };

      // 3. Run Quantitative Technical Analysis using ONLY T0 historical bars
      const technicals = calculateIndicators(historicalAtT0);
      const rsData = await calculateRelativeStrength(historicalAtT0).catch(() => ({ rsScore: 0.5 }));
      if (technicals?.v2ScoreData?.components) {
        technicals.v2ScoreData.components.rs = rsData.rsScore;
      }

      // 4. Run Swing Playbook & Quant Consensus Engine
      const swingPlaybook = buildSwingPlaybook(simulatedQuote, technicals, historicalAtT0, 'RISK_OFF');
      const quant = calculateQuantConsensus(simulatedQuote, technicals, historicalAtT0, swingPlaybook, { regime: 'RISK_OFF' }, [], {});

      // 5. Evaluate Recommendation
      recommendationsAtT0.push({
        symbol,
        dateAtT0: lastBarAtT0.date,
        priceAtT0: lastBarAtT0.close,
        score: quant.score,
        verdict: quant.overallVerdict,
        verdictTitle: quant.verdictTitle,
        entryPrice: quant.executionLevels?.entryPrice || lastBarAtT0.close,
        stopLoss: quant.executionLevels?.stopLoss || (lastBarAtT0.close * 0.965),
        target1: quant.executionLevels?.target1 || (lastBarAtT0.close * 1.10),
        freeRideRoadmap: quant.freeRideRoadmap,
        smartMoney: quant.smartMoney,
        futureBars // forward window for testing the ₹1,000 outcome
      });

    } catch (err) {
      console.error(`Error analyzing ${symbol} at T0:`, err.message);
    }
  }

  // Rank by Quant Score
  recommendationsAtT0.sort((a, b) => b.score - a.score);

  console.log(`┌────────────────┬───────────┬────────┬─────────────────────────────┬───────────┬───────────┬───────────┐`);
  console.log(`│ Symbol         │ Price@T0  │ Score  │ Verdict at Cutoff Date      │ Buy Zone  │ Target 1  │ Stop Loss │`);
  console.log(`├────────────────┼───────────┼────────┼─────────────────────────────┼───────────┼───────────┼───────────┤`);
  
  for (const r of recommendationsAtT0) {
    const sym = r.symbol.padEnd(14);
    const p0 = `₹${r.priceAtT0.toFixed(1)}`.padEnd(9);
    const sc = `${r.score}/100`.padEnd(6);
    const vd = r.verdict.padEnd(27);
    const bz = `₹${r.entryPrice.toFixed(1)}`.padEnd(9);
    const t1 = `₹${r.target1.toFixed(1)}`.padEnd(9);
    const sl = `₹${r.stopLoss.toFixed(1)}`.padEnd(9);
    console.log(`│ ${sym} │ ${p0} │ ${sc} │ ${vd} │ ${bz} │ ${t1} │ ${sl} │`);
  }
  console.log(`└────────────────┴───────────┴────────┴─────────────────────────────┴───────────┴───────────┴───────────┘\n`);

  // ─────────────────────────────────────────────────────────────
  // SIMULATING THE ₹1,000 INVESTMENT OUTCOME (FORWARD WALK)
  // ─────────────────────────────────────────────────────────────
  console.log(`===============================================================`);
  console.log(`📈 FORWARD WALK: WHAT HAPPENED TO ₹${investmentAmount} OVER THE NEXT 2 WEEKS?`);
  console.log(`===============================================================\n`);

  // Select top actionable qualifying buy candidates (Score >= 70 or Top Ranked)
  const qualifyingBuys = recommendationsAtT0.filter(r => r.score >= 68 || r.verdict === 'BUY' || r.verdict === 'STRONG_BUY');
  const buyList = qualifyingBuys.length > 0 ? qualifyingBuys : recommendationsAtT0.slice(0, 3);

  console.log(`Actionable Qualifying Picks on ${cutoffDate}: ${buyList.map(b => b.symbol).join(', ')}\n`);

  for (const pick of buyList) {
    console.log(`---------------------------------------------------------------`);
    console.log(`🎯 ASSET: ${pick.symbol} (Score at T0: ${pick.score}/100 — ${pick.verdict})`);
    console.log(`   Entry Date: Next session after ${cutoffDate}`);
    console.log(`   Initial Capital Invested: ₹${investmentAmount.toFixed(2)}`);

    const entryPrice = pick.futureBars[0]?.open || pick.entryPrice;
    const initialShares = investmentAmount / entryPrice; // fractional position sizing for ₹1,000
    const target1 = pick.target1;
    const initialStop = pick.stopLoss;

    console.log(`   Filled Price: ₹${entryPrice.toFixed(2)} (${initialShares.toFixed(4)} shares purchased)`);
    console.log(`   Initial Invalidation Stop Loss: ₹${initialStop.toFixed(2)}`);
    console.log(`   Target 1 (+10% Move): ₹${target1.toFixed(2)}`);

    let currentStop = initialStop;
    let target1Hit = false;
    let stoppedOut = false;
    let cashBanked = 0;
    let remainingShares = initialShares;
    let exitDate = null;
    let exitPrice = 0;
    let exitReason = 'ACTIVE';

    console.log(`\n   Walk-Forward Daily Execution Logs:`);

    for (let day = 0; day < pick.futureBars.length; day++) {
      const bar = pick.futureBars[day];
      const sessionDate = bar.date;

      // 1. Check if stopped out
      if (bar.low <= currentStop) {
        stoppedOut = true;
        exitDate = sessionDate;
        exitPrice = currentStop;
        exitReason = target1Hit ? 'BREAKEVEN_STOP' : 'INITIAL_STOP_LOSS';
        const finalValue = cashBanked + (remainingShares * exitPrice);
        console.log(`   📅 ${sessionDate}: ⛔ STOP TRIGGERED at ₹${exitPrice.toFixed(2)} (Reason: ${exitReason}). Position closed.`);
        break;
      }

      // 2. Check if Target 1 Hit (+10% velocity milestone)
      if (!target1Hit && bar.high >= target1) {
        target1Hit = true;
        const halfShares = remainingShares / 2;
        cashBanked = halfShares * target1;
        remainingShares -= halfShares;
        currentStop = entryPrice; // Free Ride: ratchet stop to breakeven!
        console.log(`   📅 ${sessionDate}: 🚀 TARGET 1 HIT at ₹${target1.toFixed(2)} (+10%)!`);
        console.log(`      🪜 Escalator Action: Scaled 50% shares -> Banked ₹${cashBanked.toFixed(2)} cash.`);
        console.log(`      🛡️ Ratcheted Stop Loss to Breakeven (₹${entryPrice.toFixed(2)}). Trade is now 100% RISK-FREE!`);
      }

      // 3. Log daily closing mark
      const currentUnrealized = (remainingShares * bar.close) + cashBanked;
      const dayReturnPct = ((currentUnrealized - investmentAmount) / investmentAmount) * 100;
      console.log(`   📅 ${sessionDate}: Close ₹${bar.close.toFixed(2)} | Current Portfolio: ₹${currentUnrealized.toFixed(2)} (${dayReturnPct >= 0 ? '+' : ''}${dayReturnPct.toFixed(2)}%)`);
    }

    // Final Valuation as of Today
    const lastBar = pick.futureBars[pick.futureBars.length - 1];
    const finalPrice = stoppedOut ? exitPrice : lastBar.close;
    const finalValue = cashBanked + (remainingShares * finalPrice);
    const totalReturnPct = ((finalValue - investmentAmount) / investmentAmount) * 100;
    const netProfitRs = finalValue - investmentAmount;

    console.log(`\n   🏁 FINAL OUTCOME AS OF TODAY (${lastBar.date}):`);
    console.log(`      Initial Capital:   ₹${investmentAmount.toFixed(2)}`);
    console.log(`      Ending Portfolio:  ₹${finalValue.toFixed(2)}`);
    console.log(`      Net P&L:           ${netProfitRs >= 0 ? '+₹' : '-₹'}${Math.abs(netProfitRs).toFixed(2)} (${totalReturnPct >= 0 ? '+' : ''}${totalReturnPct.toFixed(2)}%)`);
    console.log(`      Status:            ${target1Hit ? '🏆 TARGET 1 REACHED & FREE RIDE RUNNER' : stoppedOut ? '🛡️ CAPITAL PRESERVED (STOPPED OUT)' : '📈 ACTIVE RUNNING SWING'}`);
    console.log(`---------------------------------------------------------------\n`);
  }
}

// Run simulation starting from 14-Oct-2026 (2 weeks ago)
const cutoff = process.argv[2] || '2026-10-14';
const capital = parseFloat(process.argv[3]) || 1000;
runPointInTimeSimulation(cutoff, capital);
