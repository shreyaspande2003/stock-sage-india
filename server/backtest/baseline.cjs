const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const { EMA, ATR } = require('technicalindicators');
const { BacktestEngine } = require('./engine.cjs');

async function fetchHistory(symbol) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(endDate.getFullYear() - 3); // 3 years of data for backtest

  console.log(`Fetching historical data for ${symbol}...`);
  const result = await yahooFinance.historical(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d'
  });

  return result.map(r => ({
    symbol,
    date: r.date.toISOString().split('T')[0],
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume
  }));
}

function baselineStrategy(historySlice) {
  // Simple EMA 20 vs 50 Crossover baseline
  const closes = historySlice.map(h => h.close);
  const highs = historySlice.map(h => h.high);
  const lows = historySlice.map(h => h.low);

  const ema20 = EMA.calculate({ period: 20, values: closes });
  const ema50 = EMA.calculate({ period: 50, values: closes });
  const atr14 = ATR.calculate({ period: 14, high: highs, low: lows, close: closes });

  const currentEMA20 = ema20[ema20.length - 1];
  const currentEMA50 = ema50[ema50.length - 1];
  const prevEMA20 = ema20[ema20.length - 2];
  const prevEMA50 = ema50[ema50.length - 2];
  
  const currentPrice = closes[closes.length - 1];
  const currentATR = atr14[atr14.length - 1];

  // Logic: Buy if EMA 20 crosses above EMA 50
  if (prevEMA20 <= prevEMA50 && currentEMA20 > currentEMA50) {
    return {
      action: 'BUY',
      trigger: currentPrice,
      stop: currentPrice - (currentATR * 2), // 2 ATR stop
      target: currentPrice + (currentATR * 4) // 4 ATR target (2.0 R:R)
    };
  }
  
  // Logic: Sell if EMA 20 crosses below EMA 50 (Trend breakdown)
  if (prevEMA20 >= prevEMA50 && currentEMA20 < currentEMA50) {
    return { action: 'SELL' };
  }

  return { action: 'HOLD' };
}

async function runBaseline() {
  try {
    const data = await fetchHistory('RELIANCE.NS'); // Use Reliance as baseline test
    const engine = new BacktestEngine(100000); // 1 Lakh starting capital
    
    console.log(`Running Backtest on ${data.length} days of history...`);
    const report = engine.run(data, baselineStrategy);

    console.log('\n--- BACKTEST REPORT: RELIANCE.NS (Baseline EMA Crossover) ---');
    console.log(`Total Trades:   ${report.totalTrades}`);
    console.log(`Win Rate:       ${report.winRate.toFixed(2)}%`);
    console.log(`Avg Win:        ${report.avgWinPct.toFixed(2)}%`);
    console.log(`Avg Loss:       ${report.avgLossPct.toFixed(2)}%`);
    console.log(`Profit Factor:  ${report.profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown:   ${report.maxDrawdownPct.toFixed(2)}%`);
    console.log(`Net Return:     ${report.totalReturnPct.toFixed(2)}%`);
    console.log('-----------------------------------------------------------');
  } catch (e) {
    console.error('Backtest error:', e);
  }
}

if (require.main === module) {
  runBaseline();
}

module.exports = { baselineStrategy, runBaseline };
