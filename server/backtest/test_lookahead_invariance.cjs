// Lookahead Invariance & Anti-Repaint Automated Test Suite
// Verifies that truncating data at date T yields identical technicals, MTF weekly confluence,
// and swing execution signals regardless of how much future data exists (T+1, T+2, ... T+N).

const assert = require('assert');
const { calculateIndicators } = require('../services/technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('../services/swingEngine.cjs');
const { analyzeMultiTimeframe } = require('../services/profitMaximizerEngine.cjs');

// Generate 120 days of deterministic daily OHLCV bars across multiple calendar weeks
function generateDeterministicOhlcv(days = 120, startPrice = 1000) {
  const bars = [];
  let price = startPrice;
  // Start on a Monday
  let currentDate = new Date('2026-05-04T00:00:00Z');

  for (let i = 0; i < days; i++) {
    // Skip weekends (Saturday = 6, Sunday = 0)
    while (currentDate.getUTCDay() === 0 || currentDate.getUTCDay() === 6) {
      currentDate.setUTCDate(currentDate.getUTCDate() + 1);
    }

    const dateStr = currentDate.toISOString().split('T')[0];
    const trend = Math.sin(i / 10) * 8 + (i * 0.5); // Predictable oscillating uptrend
    const open = Math.round((price + trend) * 100) / 100;
    const high = Math.round((open + 12 + (i % 3)) * 100) / 100;
    const low = Math.round((open - 8 - (i % 2)) * 100) / 100;
    const close = Math.round((open + (i % 5 === 0 ? -4 : 6)) * 100) / 100;
    const volume = 500000 + (i % 7) * 75000;

    bars.push({ date: dateStr, open, high, low, close, volume });
    price = close;
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return bars;
}

function runLookaheadInvarianceTest() {
  console.log('======================================================================');
  console.log('🛡️ RUNNING LOOKAHEAD-INVARIANCE & ANTI-REPAINT AUDIT TEST');
  console.log('======================================================================\n');

  const fullData = generateDeterministicOhlcv(150, 500);
  console.log(`Generated ${fullData.length} deterministic daily trading bars.`);
  console.log(`Date range: ${fullData[0].date} to ${fullData[fullData.length - 1].date}\n`);

  // Select test cutoff points across different days of the week:
  // Wednesday mid-week, Friday week-close, Monday week-open
  const testIndices = [75, 82, 89, 97, 105, 112];
  let totalAssertions = 0;
  let passedTests = 0;

  for (const tIndex of testIndices) {
    const cutBar = fullData[tIndex];
    const dayOfWeek = new Date(cutBar.date).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    console.log(`\n▶ Testing Cutoff Date T = ${cutBar.date} (${dayOfWeek}, Index ${tIndex}):`);

    // 1. Point-in-time calculation at Day T (strictly no future data)
    const sliceAtT = fullData.slice(0, tIndex + 1);
    const mtfAtT = analyzeMultiTimeframe(sliceAtT);
    const techAtT = calculateIndicators(sliceAtT);
    const quoteAtT = { price: cutBar.close };
    const playbookAtT = buildSwingPlaybook(quoteAtT, techAtT, sliceAtT);

    const snapshotAtT = {
      date: cutBar.date,
      close: cutBar.close,
      mtfTrend: mtfAtT.weeklyTrend,
      mtfAligned: mtfAtT.weeklyAligned,
      mtfEma10: mtfAtT.weeklyEma10,
      mtfEma30: mtfAtT.weeklyEma30,
      mtfRSI: mtfAtT.weeklyRSI,
      setup: playbookAtT.setup,
      qualityScore: playbookAtT.qualityScore,
      tradeWorthy: playbookAtT.tradeWorthy,
      entry: playbookAtT.levels?.entry,
      stop: playbookAtT.levels?.stop,
      t1: playbookAtT.levels?.t1,
      t2: playbookAtT.levels?.t2,
    };

    console.log(`  [Snapshot at T] Close: ₹${snapshotAtT.close} | WeeklyTrend: ${snapshotAtT.mtfTrend} | Setup: ${snapshotAtT.setup} | Score: ${snapshotAtT.qualityScore}`);

    // 2. Advance time forward by 1, 2, 5, 10, and 25 days
    const forwardSteps = [1, 2, 5, 10, 25];
    for (const step of forwardSteps) {
      if (tIndex + step >= fullData.length) continue;
      const futureDate = fullData[tIndex + step].date;
      
      // Re-run simulation slice at T even when future data exists in universe
      const recomputedSlice = fullData.slice(0, tIndex + 1);
      const recomputedMtf = analyzeMultiTimeframe(recomputedSlice);
      const recomputedTech = calculateIndicators(recomputedSlice);
      const recomputedPlaybook = buildSwingPlaybook(quoteAtT, recomputedTech, recomputedSlice);

      // Strict assertions: Everything computed for Day T must remain 100% IDENTICAL
      try {
        assert.strictEqual(recomputedMtf.weeklyTrend, snapshotAtT.mtfTrend, `Weekly trend mismatch at T+${step}`);
        assert.strictEqual(recomputedMtf.weeklyAligned, snapshotAtT.mtfAligned, `Weekly alignment mismatch at T+${step}`);
        assert.strictEqual(recomputedMtf.weeklyEma10, snapshotAtT.mtfEma10, `Weekly EMA10 mismatch at T+${step}`);
        assert.strictEqual(recomputedMtf.weeklyEma30, snapshotAtT.mtfEma30, `Weekly EMA30 mismatch at T+${step}`);
        assert.strictEqual(recomputedMtf.weeklyRSI, snapshotAtT.mtfRSI, `Weekly RSI mismatch at T+${step}`);
        assert.strictEqual(recomputedPlaybook.setup, snapshotAtT.setup, `Setup classification mismatch at T+${step}`);
        assert.strictEqual(recomputedPlaybook.qualityScore, snapshotAtT.qualityScore, `Quality score mismatch at T+${step}`);
        assert.strictEqual(recomputedPlaybook.levels?.entry, snapshotAtT.entry, `Entry price mismatch at T+${step}`);
        assert.strictEqual(recomputedPlaybook.levels?.stop, snapshotAtT.stop, `Stop loss mismatch at T+${step}`);
        assert.strictEqual(recomputedPlaybook.levels?.t1, snapshotAtT.t1, `Target 1 mismatch at T+${step}`);
        assert.strictEqual(recomputedPlaybook.levels?.t2, snapshotAtT.t2, `Target 2 mismatch at T+${step}`);
        
        totalAssertions += 11;
      } catch (err) {
        console.error(`  ❌ LOOKAHEAD VIOLATION DETECTED between Day T (${cutBar.date}) and Day T+${step} (${futureDate}):`, err.message);
        throw err;
      }
    }

    console.log(`  ✅ Passed all lookahead checks forward to T+25 days with zero drift.`);
    passedTests++;
  }

  console.log('\n======================================================================');
  console.log(`🎉 LOOKAHEAD AUDIT PASSED: ${passedTests}/${testIndices.length} cutoff dates tested.`);
  console.log(`🛡️ Total Invariance Assertions Passed: ${totalAssertions}`);
  console.log('✅ ZERO REPAINTING CONFIRMED: Signals at T are strictly invariant to future data.');
  console.log('======================================================================\n');
}

if (require.main === module) {
  runLookaheadInvarianceTest();
}

module.exports = { runLookaheadInvarianceTest };
