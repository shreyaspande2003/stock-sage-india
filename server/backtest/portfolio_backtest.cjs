// Multi-Stock Event-Driven Portfolio Backtester — StockSage India Quant V2
// Simulates realistic multi-stock swing trading with Indian costs and capital constraints
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
const { calculateIndicators } = require('../services/technicalAnalysis.cjs');
const { buildSwingPlaybook } = require('../services/swingEngine.cjs');
const config = require('../config/v2_config.json');

const DEFAULT_UNIVERSE = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'HINDUNILVR', 'ITC', 'SBIN', 'BHARTIARTL', 'BAJFINANCE'
];

class PortfolioBacktest {
  constructor(initialCapital = 500000, symbols = DEFAULT_UNIVERSE) {
    this.initialCapital = initialCapital;
    this.capital = initialCapital;
    this.symbols = symbols;
    this.positions = new Map(); // symbol -> position
    this.closedTrades = [];
    this.equityCurve = [];
    this.costs = config.costs;
    this.maxPositions = config.risk.max_positions.swing || 8;
    this.maxPositionNotional = initialCapital * (config.risk.max_position_pct_capital / 100 || 0.15);
  }

  calculateFillPrice(price, side) {
    const slippage = price * (this.costs.slippage_pct_per_side / 100);
    return side === 'BUY' ? price + slippage : price - slippage;
  }

  calculateCosts(value, side) {
    const stt = side === 'SELL' ? value * (this.costs.stt_delivery_pct / 100) : 0;
    const brokerage = value * 0.0005; // 0.05% brokerage
    return stt + brokerage;
  }

  async run(years = 2) {
    console.log(`[Backtest] Fetching historical data for ${this.symbols.length} stocks (${years} years)...`);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - years);

    // Fetch all stock histories
    const stockDataMap = new Map();
    const allDatesSet = new Set();

    for (const sym of this.symbols) {
      try {
        const querySym = `${sym}.NS`;
        const bars = await yf.historical(querySym, {
          period1: startDate,
          period2: endDate,
          interval: '1d'
        });

        if (bars && bars.length > 200) {
          const formatted = bars.map(b => ({
            date: b.date.toISOString().split('T')[0],
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume || 0
          }));
          stockDataMap.set(sym, formatted);
          formatted.forEach(b => allDatesSet.add(b.date));
        }
      } catch (err) {
        console.warn(`[Backtest] Failed to load ${sym}: ${err.message}`);
      }
    }

    const sortedDates = Array.from(allDatesSet).sort();
    console.log(`[Backtest] Running simulation across ${sortedDates.length} trading days...`);

    let peakEquity = this.initialCapital;
    let maxDrawdown = 0;

    // Fast index pointers per symbol
    const symbolIndices = new Map();
    for (const sym of stockDataMap.keys()) {
      symbolIndices.set(sym, 0);
    }

    // Daily event-driven simulation loop
    for (let dIdx = 100; dIdx < sortedDates.length - 1; dIdx++) {
      const todayDate = sortedDates[dIdx];
      const tomorrowDate = sortedDates[dIdx + 1];

      // 1. Manage Active Positions on today's price action
      for (const [sym, pos] of Array.from(this.positions.entries())) {
        const history = stockDataMap.get(sym);
        const todayBar = history.find(b => b.date === todayDate);
        if (!todayBar) continue;

        pos.daysHeld++;

        // Stop loss hit intraday
        if (todayBar.low <= pos.stop) {
          const exitPrice = this.calculateFillPrice(Math.min(pos.stop, todayBar.open), 'SELL');
          const value = pos.shares * exitPrice;
          const costs = this.calculateCosts(value, 'SELL');
          const pnl = (exitPrice - pos.entryPrice) * pos.shares - costs - pos.entryCosts;
          const pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;

          this.capital += (value - costs);
          this.closedTrades.push({
            symbol: sym,
            entryDate: pos.entryDate,
            exitDate: todayDate,
            entryPrice: pos.entryPrice,
            exitPrice,
            shares: pos.shares,
            pnl: Math.round(pnl),
            pnlPct: Math.round(pnlPct * 100) / 100,
            reason: 'STOP_LOSS',
            daysHeld: pos.daysHeld
          });
          this.positions.delete(sym);
          continue;
        }

        // Target 1 hit: take 50% profit and trail stop to breakeven
        if (!pos.t1Hit && todayBar.high >= pos.t1) {
          const sellShares = Math.floor(pos.shares / 2);
          if (sellShares > 0) {
            const exitPrice = this.calculateFillPrice(pos.t1, 'SELL');
            const value = sellShares * exitPrice;
            const costs = this.calculateCosts(value, 'SELL');
            const pnl = (exitPrice - pos.entryPrice) * sellShares - costs - (pos.entryCosts * 0.5);
            
            this.capital += (value - costs);
            pos.shares -= sellShares;
            pos.t1Hit = true;
            pos.stop = pos.entryPrice; // Move stop to breakeven

            this.closedTrades.push({
              symbol: sym,
              entryDate: pos.entryDate,
              exitDate: todayDate,
              entryPrice: pos.entryPrice,
              exitPrice,
              shares: sellShares,
              pnl: Math.round(pnl),
              pnlPct: Math.round(((exitPrice - pos.entryPrice) / pos.entryPrice) * 10000) / 100,
              reason: 'TARGET_1_SCALE',
              daysHeld: pos.daysHeld
            });
          }
        }

        // Target 2 hit
        if (todayBar.high >= pos.t2) {
          const exitPrice = this.calculateFillPrice(pos.t2, 'SELL');
          const value = pos.shares * exitPrice;
          const costs = this.calculateCosts(value, 'SELL');
          const pnl = (exitPrice - pos.entryPrice) * pos.shares - costs - (pos.entryCosts * 0.5);

          this.capital += (value - costs);
          this.closedTrades.push({
            symbol: sym,
            entryDate: pos.entryDate,
            exitDate: todayDate,
            entryPrice: pos.entryPrice,
            exitPrice,
            shares: pos.shares,
            pnl: Math.round(pnl),
            pnlPct: Math.round(((exitPrice - pos.entryPrice) / pos.entryPrice) * 10000) / 100,
            reason: 'TARGET_2_FULL',
            daysHeld: pos.daysHeld
          });
          this.positions.delete(sym);
          continue;
        }

        // 10-day time stop
        if (pos.daysHeld >= 10) {
          const exitPrice = this.calculateFillPrice(todayBar.close, 'SELL');
          const value = pos.shares * exitPrice;
          const costs = this.calculateCosts(value, 'SELL');
          const pnl = (exitPrice - pos.entryPrice) * pos.shares - costs;

          this.capital += (value - costs);
          this.closedTrades.push({
            symbol: sym,
            entryDate: pos.entryDate,
            exitDate: todayDate,
            entryPrice: pos.entryPrice,
            exitPrice,
            shares: pos.shares,
            pnl: Math.round(pnl),
            pnlPct: Math.round(((exitPrice - pos.entryPrice) / pos.entryPrice) * 10000) / 100,
            reason: 'TIME_STOP',
            daysHeld: pos.daysHeld
          });
          this.positions.delete(sym);
          continue;
        }
      }

      // 2. Generate EOD Signals on Day T close
      const candidateSignals = [];
      for (const [sym, history] of stockDataMap.entries()) {
        if (this.positions.has(sym)) continue;

        const currentBarIdx = history.findIndex(b => b.date === todayDate);
        if (currentBarIdx < 60) continue;

        const slice = history.slice(0, currentBarIdx + 1);
        const currentBar = slice[slice.length - 1];
        const quote = { price: currentBar.close };
        const technicals = calculateIndicators(slice);

        if (!technicals.error) {
          const playbook = buildSwingPlaybook(quote, technicals, slice);
          if (playbook.tradeWorthy && playbook.qualityScore >= 60 && playbook.setup !== 'WAIT') {
            candidateSignals.push({
              symbol: sym,
              setup: playbook.setup,
              score: playbook.qualityScore,
              trigger: playbook.levels?.entry || currentBar.close,
              stop: playbook.levels?.stop,
              t1: playbook.levels?.t1,
              t2: playbook.levels?.t2,
              historyIdx: currentBarIdx
            });
          }
        }
      }

      // Rank candidate signals by quality score
      candidateSignals.sort((a, b) => b.score - a.score);

      // 3. Execute top signals on Day T+1 Open (strictly no lookahead)
      for (const sig of candidateSignals) {
        if (this.positions.size >= this.maxPositions) break;

        const history = stockDataMap.get(sig.symbol);
        const tomorrowBar = history.find(b => b.date === tomorrowDate);
        if (!tomorrowBar || !tomorrowBar.open) continue;

        const fillPrice = this.calculateFillPrice(tomorrowBar.open, 'BUY');
        const notional = Math.min(this.maxPositionNotional, this.capital * 0.15);
        const shares = Math.floor(notional / fillPrice);

        if (shares > 0) {
          const totalCost = shares * fillPrice;
          const entryCosts = this.calculateCosts(totalCost, 'BUY');

          if (this.capital >= totalCost + entryCosts) {
            this.capital -= (totalCost + entryCosts);
            this.positions.set(sig.symbol, {
              entryDate: tomorrowDate,
              entryPrice: fillPrice,
              shares,
              stop: sig.stop || fillPrice * 0.96,
              t1: sig.t1 || fillPrice * 1.06,
              t2: sig.t2 || fillPrice * 1.12,
              t1Hit: false,
              daysHeld: 0,
              entryCosts
            });
          }
        }
      }

      // Record daily portfolio equity
      let openPositionsValue = 0;
      for (const [sym, pos] of this.positions.entries()) {
        const history = stockDataMap.get(sym);
        const todayBar = history.find(b => b.date === todayDate);
        if (todayBar) {
          openPositionsValue += (pos.shares * todayBar.close);
        }
      }

      const totalEquity = this.capital + openPositionsValue;
      if (totalEquity > peakEquity) peakEquity = totalEquity;
      const dd = ((peakEquity - totalEquity) / peakEquity) * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;

      this.equityCurve.push({
        date: todayDate,
        equity: Math.round(totalEquity),
        capital: Math.round(this.capital),
        openPositions: this.positions.size,
        drawdownPct: Math.round(dd * 100) / 100
      });
    }

    // Final metrics calculation
    const totalTrades = this.closedTrades.length;
    const winningTrades = this.closedTrades.filter(t => t.pnl > 0);
    const losingTrades = this.closedTrades.filter(t => t.pnl < 0);

    const winRate = totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;

    const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;

    const finalEquity = this.equityCurve.length ? this.equityCurve[this.equityCurve.length - 1].equity : this.capital;
    const totalReturnPct = ((finalEquity - this.initialCapital) / this.initialCapital) * 100;

    return {
      initialCapital: this.initialCapital,
      finalEquity,
      totalReturnPct: Math.round(totalReturnPct * 100) / 100,
      totalTrades,
      winRate: Math.round(winRate * 100) / 100,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      profitFactor: Math.round(profitFactor * 100) / 100,
      avgWin: Math.round(avgWin),
      avgLoss: Math.round(avgLoss),
      winLossRatio: avgLoss > 0 ? Math.round((avgWin / avgLoss) * 100) / 100 : 0,
      maxDrawdownPct: Math.round(maxDrawdown * 100) / 100,
      recentTrades: this.closedTrades.slice(-10),
      equityCurveSample: this.equityCurve.filter((_, idx) => idx % 5 === 0)
    };
  }
}

module.exports = { PortfolioBacktest };
