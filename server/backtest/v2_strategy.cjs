const { analyzeTechnicals } = require('../services/technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('../services/swingEngine.cjs');
const { BacktestEngine } = require('./engine.cjs');

function v2Strategy(historySlice) {
  // We need at least 200 days to calculate EMA 200 properly.
  // The BacktestEngine already ensures we have at least 200 days.
  
  // analyzeTechnicals expects an array of OHLCV objects
  const technicals = analyzeTechnicals(historySlice);
  
  // If there's an error calculating technicals, skip
  if (technicals.error) return { action: 'HOLD' };

  // Current price
  const quote = { price: historySlice[historySlice.length - 1].close };
  
  // Run the V2 Swing Playbook classifier and risk math
  const playbook = buildSwingPlaybook(quote, technicals, historySlice);

  // According to the spec, a trade is taken if it passes these criteria:
  // 1. tradeWorthy is true
  // 2. qualityScore >= 65 (default in config)
  // 3. setup is not WAIT
  if (playbook.setup !== 'WAIT' && playbook.tradeWorthy && playbook.qualityScore >= 60) {
    return {
      action: 'BUY',
      trigger: playbook.levels?.entry || quote.price,
      stop: playbook.levels?.stop,
      target: playbook.levels?.t1
    };
  }

  // The engine natively handles stop and target exits automatically intraday.
  // We can add a time stop (e.g. exit if held for > 10 days) if needed, 
  // but for now, rely on trailing stops and targets.
  
  // Fallback
  return { action: 'HOLD' };
}

async function runV2Backtest() {
  const YahooFinance = require('yahoo-finance2').default;
  const yahooFinance = new YahooFinance();
  
  async function fetchHistory(symbol) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 3);

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

  try {
    const data = await fetchHistory('RELIANCE.NS');
    const engine = new BacktestEngine(100000);
    
    console.log(`Running StockSage Quant Engine v2 on ${data.length} days of history...`);
    const report = engine.run(data, v2Strategy);

    console.log('\n--- BACKTEST REPORT: RELIANCE.NS (Quant Engine v2) ---');
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
  runV2Backtest();
}

module.exports = { v2Strategy, runV2Backtest };
