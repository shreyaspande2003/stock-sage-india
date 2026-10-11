const config = require('../config/v2_config.json');

class BacktestEngine {
  constructor(initialCapital = 100000) {
    this.initialCapital = initialCapital;
    this.capital = initialCapital;
    this.positions = {};
    this.trades = [];
    this.equityCurve = [];
    
    this.costs = config.costs;
  }

  // Costs modeled: slippage (0.15%), STT (0.1%), brokerage (assumed fixed 0.05% for delivery)
  calculateExecutionPrice(price, side) {
    const slippage = price * (this.costs.slippage_pct_per_side / 100);
    return side === 'BUY' ? price + slippage : price - slippage;
  }

  calculateCosts(value) {
    const stt = value * (this.costs.stt_delivery_pct / 100);
    const brokerage = value * 0.0005; // 0.05% approx
    return stt + brokerage;
  }

  run(ohlcvData, strategyFn) {
    if (ohlcvData.length < 200) {
      throw new Error("Need at least 200 days of data for backtesting (EMA 200 requirement)");
    }

    this.equityCurve = [];
    this.trades = [];
    let peakEquity = this.initialCapital;
    let maxDrawdown = 0;

    for (let i = 200; i < ohlcvData.length - 1; i++) {
      const today = ohlcvData[i];
      const tomorrow = ohlcvData[i + 1];
      const historySlice = ohlcvData.slice(0, i + 1);

      // Evaluate Strategy on Day T close
      const signal = strategyFn(historySlice);

      // Execute on Day T+1 (Tomorrow) Open
      if (signal.action === 'BUY' && !this.positions[today.symbol]) {
        const fillPrice = this.calculateExecutionPrice(tomorrow.open, 'BUY');
        
        // Skip if gaping too high (gap risk rule)
        if (signal.stop && (fillPrice - signal.trigger) > (signal.trigger - signal.stop) * 1.5) {
            // Gap too big, skip
            continue;
        }

        const size = Math.floor((this.capital * 0.15) / fillPrice); // Max 15% capital per trade
        const tradeValue = size * fillPrice;
        const totalCost = tradeValue + this.calculateCosts(tradeValue);

        if (this.capital >= totalCost && size > 0) {
          this.capital -= totalCost;
          this.positions[today.symbol] = {
            entryPrice: fillPrice,
            entryDate: tomorrow.date,
            size: size,
            stop: signal.stop,
            target: signal.target
          };
        }
      }

      // Exit Management (Trailing Stop, Target, Hard Stop)
      if (this.positions[today.symbol]) {
        const pos = this.positions[today.symbol];
        let exitPrice = null;
        let exitReason = '';

        // Check if Stop Hit intraday (Low goes below stop)
        if (tomorrow.low <= pos.stop) {
          exitPrice = this.calculateExecutionPrice(pos.stop, 'SELL'); // slippage on stop
          exitReason = 'STOP_LOSS';
        }
        // Check if Target Hit intraday (High goes above target)
        else if (pos.target && tomorrow.high >= pos.target) {
          exitPrice = this.calculateExecutionPrice(pos.target, 'SELL');
          exitReason = 'TARGET';
        }
        // Force exit signal from strategy (e.g. time stop or trend breakdown)
        else if (signal.action === 'SELL') {
          exitPrice = this.calculateExecutionPrice(tomorrow.open, 'SELL');
          exitReason = 'STRATEGY_EXIT';
        }

        if (exitPrice !== null) {
          const tradeValue = pos.size * exitPrice;
          const fees = this.calculateCosts(tradeValue);
          this.capital += (tradeValue - fees);

          const pnl = (exitPrice - pos.entryPrice) * pos.size - fees;
          const pnlPct = (exitPrice - pos.entryPrice) / pos.entryPrice;
          
          this.trades.push({
            symbol: today.symbol,
            entryDate: pos.entryDate,
            exitDate: tomorrow.date,
            entryPrice: pos.entryPrice,
            exitPrice: exitPrice,
            reason: exitReason,
            pnl: pnl,
            pnlPct: pnlPct
          });

          delete this.positions[today.symbol];
        }
      }

      // Track Equity
      let currentEquity = this.capital;
      if (this.positions[today.symbol]) {
        currentEquity += this.positions[today.symbol].size * tomorrow.close;
      }
      
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const drawdown = (peakEquity - currentEquity) / peakEquity;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;

      this.equityCurve.push({ date: tomorrow.date, equity: currentEquity, drawdown });
    }

    return this.generateReport(maxDrawdown);
  }

  generateReport(maxDrawdown) {
    const finalEquity = this.equityCurve.length > 0 ? this.equityCurve[this.equityCurve.length - 1].equity : this.initialCapital;
    const totalReturnPct = ((finalEquity - this.initialCapital) / this.initialCapital) * 100;
    
    const winningTrades = this.trades.filter(t => t.pnl > 0);
    const losingTrades = this.trades.filter(t => t.pnl <= 0);
    
    const winRate = this.trades.length > 0 ? (winningTrades.length / this.trades.length) * 100 : 0;
    
    const avgWin = winningTrades.length > 0 ? winningTrades.reduce((sum, t) => sum + t.pnlPct, 0) / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? losingTrades.reduce((sum, t) => sum + Math.abs(t.pnlPct), 0) / losingTrades.length : 0;
    const profitFactor = avgLoss === 0 ? (avgWin > 0 ? 999 : 0) : avgWin / avgLoss;

    return {
      initialCapital: this.initialCapital,
      finalEquity,
      totalReturnPct,
      maxDrawdownPct: maxDrawdown * 100,
      totalTrades: this.trades.length,
      winRate,
      avgWinPct: avgWin * 100,
      avgLossPct: avgLoss * 100,
      profitFactor,
      trades: this.trades
    };
  }
}

module.exports = { BacktestEngine };
