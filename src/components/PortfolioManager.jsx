import React, { useState, useEffect, useRef } from 'react';
import { uploadPortfolio, loadGrowwStatement, submitManualPortfolio, analyzeHolding, analyzePortfolio } from '../api.js';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#14b8a6', '#f97316'];

const SAMPLE_HOLDINGS = [
  { symbol: 'RELIANCE', quantity: 10, buyPrice: 2850, buyDate: '2024-03-01', strategy: 'LONG_TERM' },
  { symbol: 'TCS', quantity: 6, buyPrice: 3820, buyDate: '2024-04-15', strategy: 'LONG_TERM' },
  { symbol: 'INFY', quantity: 15, buyPrice: 1460, buyDate: '2024-05-10', strategy: 'LONG_TERM' },
  { symbol: 'HDFCBANK', quantity: 8, buyPrice: 1640, buyDate: '2024-02-15', strategy: 'LONG_TERM' },
  { symbol: 'BHARTIARTL', quantity: 12, buyPrice: 1580, buyDate: '2024-06-20', strategy: 'SWING' },
];

const QUICK_SYMBOLS = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'BHARTIARTL', 'LT', 'ICICIBANK', 'SUNPHARMA', 'TATAMOTORS'];

export default function PortfolioManager({ settings, isAIReady, onAnalyze }) {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [analyzingSymbol, setAnalyzingSymbol] = useState('');
  const [portfolioAI, setPortfolioAI] = useState(null);
  const [analyzingPortfolio, setAnalyzingPortfolio] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('manual'); // 'manual' | 'csv'
  const [actionFilter, setActionFilter] = useState('ALL'); // 'ALL' | 'AVERAGE' | 'HOLD' | 'FREEZE' | 'PROFIT'

  // Manual Form inputs
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  const [manualBuyDate, setManualBuyDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [manualStrategy, setManualStrategy] = useState('LONG_TERM'); // 'LONG_TERM' | 'SWING'
  const [lastSyncTime, setLastSyncTime] = useState(() => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));

  const fileRef = useRef(null);

  const handleLoadGrowwStatement = async () => {
    setLoading(true);
    setError('');
    setPortfolioAI(null);
    try {
      const data = await loadGrowwStatement();
      setPortfolio(data);
      setLastSyncTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      if (data?.holdings?.length > 0) {
        const minimal = data.holdings.map(h => ({
          symbol: h.symbol,
          quantity: h.quantity,
          buyPrice: h.buyPrice,
          buyDate: h.buyDate || '',
          strategy: h.strategy || 'LONG_TERM',
        }));
        localStorage.setItem('stocksage_active_portfolio', JSON.stringify(minimal));
      }
    } catch (err) {
      setError(err.message || 'Failed to auto-load Groww holdings statement. Try uploading the file.');
    }
    setLoading(false);
  };

  // Synchronize holdings with backend to get live prices & quant badges
  const syncHoldings = async (holdingsList, silent = false) => {
    if (!holdingsList || holdingsList.length === 0) {
      setPortfolio(null);
      setPortfolioAI(null);
      localStorage.removeItem('stocksage_active_portfolio');
      return;
    }

    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await submitManualPortfolio(holdingsList);
      setPortfolio(data);
      setLastSyncTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      // Persist raw holdings in localStorage
      const minimal = holdingsList.map(h => ({
        symbol: h.symbol.toUpperCase().trim(),
        quantity: Number(h.quantity),
        buyPrice: Number(h.buyPrice),
        buyDate: h.buyDate || new Date().toISOString().split('T')[0],
        strategy: h.strategy || 'LONG_TERM',
      }));
      localStorage.setItem('stocksage_active_portfolio', JSON.stringify(minimal));
    } catch (err) {
      if (!silent) setError(err.message || 'Failed to update portfolio holdings');
    }
    if (!silent) setLoading(false);
  };

  // Auto-load portfolio from localStorage on mount (with auto-heal for old LT bug)
  useEffect(() => {
    const saved = localStorage.getItem('stocksage_active_portfolio');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const ltCount = parsed.filter(h => h.symbol === 'LT').length;
          // If 3 or more stocks were corrupted to LT by the old substring bug, auto-heal from Groww file
          if (ltCount >= 3) {
            handleLoadGrowwStatement();
            return;
          }
          syncHoldings(parsed);
        }
      } catch (err) {
        console.error('Failed to parse saved portfolio:', err);
      }
    }
  }, []);

  // Background live price polling every 25 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      const saved = localStorage.getItem('stocksage_active_portfolio');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            syncHoldings(parsed, true);
          }
        } catch (e) {}
      }
    }, 25000);
    return () => clearInterval(intervalId);
  }, []);

  const handleManualAdd = (e) => {
    e.preventDefault();
    const sym = manualSymbol.toUpperCase().trim();
    const qty = parseFloat(manualQty);
    const price = parseFloat(manualBuyPrice);

    if (!sym) {
      setError('Please enter a valid stock symbol (e.g. RELIANCE, TCS)');
      return;
    }
    if (!qty || qty <= 0) {
      setError('Quantity must be greater than 0');
      return;
    }
    if (!price || price <= 0) {
      setError('Buy price must be greater than 0');
      return;
    }

    const currentHoldings = portfolio?.holdings ? [...portfolio.holdings] : [];
    const existingIdx = currentHoldings.findIndex(h => h.symbol.toUpperCase() === sym);

    let updated = [];
    if (existingIdx !== -1) {
      // Average out if already exists
      const existing = currentHoldings[existingIdx];
      const newTotalQty = existing.quantity + qty;
      const weightedAvgPrice = ((existing.buyPrice * existing.quantity) + (price * qty)) / newTotalQty;
      updated = [...currentHoldings];
      updated[existingIdx] = {
        ...existing,
        quantity: newTotalQty,
        buyPrice: Math.round(weightedAvgPrice * 100) / 100,
        buyDate: manualBuyDate || existing.buyDate,
        strategy: manualStrategy,
      };
    } else {
      updated = [
        ...currentHoldings,
        {
          symbol: sym,
          quantity: qty,
          buyPrice: price,
          buyDate: manualBuyDate,
          strategy: manualStrategy,
        }
      ];
    }

    // Reset inputs
    setManualSymbol('');
    setManualQty('');
    setManualBuyPrice('');
    setError('');

    syncHoldings(updated);
  };

  const handleToggleStrategy = (symbol) => {
    if (!portfolio?.holdings) return;
    const updated = portfolio.holdings.map(h => {
      if (h.symbol === symbol) {
        const next = (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING' ? 'LONG_TERM' : 'SWING';
        return { ...h, strategy: next };
      }
      return h;
    });
    syncHoldings(updated);
  };

  const handleRemoveHolding = (symbolToRemove) => {
    if (!portfolio?.holdings) return;
    const filtered = portfolio.holdings.filter(h => h.symbol !== symbolToRemove);
    syncHoldings(filtered);
  };

  const handleLoadDemo = () => {
    syncHoldings(SAMPLE_HOLDINGS);
  };

  const handleClearPortfolio = () => {
    if (window.confirm('Are you sure you want to clear your current portfolio?')) {
      setPortfolio(null);
      setPortfolioAI(null);
      localStorage.removeItem('stocksage_active_portfolio');
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    setLoading(true);
    setError('');
    setPortfolioAI(null);

    try {
      const data = await uploadPortfolio(file);
      setPortfolio(data);
      if (data?.holdings?.length > 0) {
        const minimal = data.holdings.map(h => ({
          symbol: h.symbol,
          quantity: h.quantity,
          buyPrice: h.buyPrice,
          buyDate: h.buyDate || '',
          strategy: h.strategy || 'LONG_TERM',
        }));
        localStorage.setItem('stocksage_active_portfolio', JSON.stringify(minimal));
      }
    } catch (err) {
      setError(err.message || 'Failed to upload portfolio CSV');
    }
    setLoading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.type.includes('sheet') || file.type.includes('csv'))) {
      handleUpload(file);
    } else {
      setError('Please upload a valid .csv or .xlsx Excel file');
    }
  };

  const handleAnalyzeHolding = async (holding) => {
    setAnalyzingSymbol(holding.symbol);
    setError('');
    try {
      const data = await analyzeHolding(holding.symbol, holding.quantity, holding.buyPrice);
      onAnalyze(data);
    } catch (err) {
      setError(err.message || `Deep dive analysis failed for ${holding.symbol}`);
    }
    setAnalyzingSymbol('');
  };

  const handleAnalyzeAll = async () => {
    if (!portfolio?.holdings?.length) return;
    setAnalyzingPortfolio(true);
    setError('');
    try {
      const data = await analyzePortfolio(portfolio.holdings);
      setPortfolioAI(data);
    } catch (err) {
      setError(err.message || 'Portfolio-level analysis failed');
    }
    setAnalyzingPortfolio(false);
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return 'N/A';
    return `₹${Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };

  const coreCount = portfolio?.holdings?.filter(h => (h.strategy || 'LONG_TERM').toUpperCase() !== 'SWING').length || 0;
  const swingCount = portfolio?.holdings?.filter(h => (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING').length || 0;

  const allHoldings = portfolio?.holdings || [];
  const averageCount = allHoldings.filter(h => h.quantAction?.actionType === 'AVERAGE_DOWN').length;
  const holdCount = allHoldings.filter(h => h.quantAction?.actionType === 'HOLD_STEADY').length;
  const freezeCount = allHoldings.filter(h => h.quantAction?.actionType === 'FREEZE_CAPITAL' || h.quantAction?.actionType === 'CUT_LOSS').length;
  const profitCount = allHoldings.filter(h => h.quantAction?.actionType === 'KEEP_RUNNING' || h.quantAction?.actionType === 'BOOK_PROFIT').length;

  const filteredHoldings = allHoldings.filter(h => {
    if (actionFilter === 'AVERAGE') return h.quantAction?.actionType === 'AVERAGE_DOWN';
    if (actionFilter === 'HOLD') return h.quantAction?.actionType === 'HOLD_STEADY';
    if (actionFilter === 'FREEZE') return h.quantAction?.actionType === 'FREEZE_CAPITAL' || h.quantAction?.actionType === 'CUT_LOSS';
    if (actionFilter === 'PROFIT') return h.quantAction?.actionType === 'KEEP_RUNNING' || h.quantAction?.actionType === 'BOOK_PROFIT';
    return true;
  });

  return (
    <div className="fade-in-up" style={{ paddingBottom: '3rem' }}>
      {/* Header */}
      <div className="dashboard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1>💼 Dual-Engine Portfolio Desk</h1>
          <p>
            <strong>Core & Satellite Model:</strong> Long-term wealth compounders (with value dip accumulation) + high-velocity tactical swing trades (with hard -5.5% stops).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleLoadGrowwStatement}
            disabled={loading}
            title="Automatically loads all 47 holdings from your Groww statement file"
            style={{ fontWeight: 700 }}
          >
            📥 {loading ? 'Loading...' : 'Load Groww Statement (47 Stocks)'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleLoadDemo}
            title="Pre-fills a Core + Satellite Indian portfolio"
          >
            ⚡ Load Demo Portfolio
          </button>
          {portfolio && (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => syncHoldings(portfolio.holdings)}
                disabled={loading}
                title="Refresh live quotes from NSE"
              >
                🔄 {loading ? 'Refreshing...' : 'Refresh Quotes'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={handleClearPortfolio}
                style={{ color: 'var(--color-sell)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
              >
                🗑️ Clear
              </button>
            </>
          )}
        </div>
      </div>

      {/* Input Options Card (Tabs: Manual Entry vs CSV Upload) */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-secondary)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
          <button
            className={`btn btn-sm ${activeTab === 'manual' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('manual')}
          >
            ➕ Add Holding Manually
          </button>
          <button
            className={`btn btn-sm ${activeTab === 'csv' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setActiveTab('csv')}
          >
            📁 Bulk CSV Upload
          </button>
        </div>

        {activeTab === 'manual' ? (
          <div>
            <form onSubmit={handleManualAdd} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr)) 110px', gap: '0.75rem', alignItems: 'end' }}>
              <div>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>STOCK SYMBOL</label>
                <input
                  type="text"
                  placeholder="e.g. RELIANCE, TCS"
                  value={manualSymbol}
                  onChange={(e) => setManualSymbol(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                  }}
                />
              </div>

              <div>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>PORTFOLIO ROLE</label>
                <select
                  value={manualStrategy}
                  onChange={(e) => setManualStrategy(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    color: manualStrategy === 'LONG_TERM' ? 'var(--accent-cyan)' : 'var(--accent-primary)',
                    fontWeight: 700,
                  }}
                >
                  <option value="LONG_TERM">💎 Core Long-Term</option>
                  <option value="SWING">⚡ Tactical Swing</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>QUANTITY (SHARES)</label>
                <input
                  type="number"
                  placeholder="e.g. 10"
                  min="1"
                  step="1"
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>BUY PRICE (₹)</label>
                <input
                  type="number"
                  placeholder="e.g. 2450.50"
                  min="0.1"
                  step="0.05"
                  value={manualBuyPrice}
                  onChange={(e) => setManualBuyPrice(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="text-xs text-muted" style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>PURCHASE DATE</label>
                <input
                  type="date"
                  value={manualBuyDate}
                  onChange={(e) => setManualBuyDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  style={{ width: '100%', padding: '0.6rem', fontWeight: 700 }}
                >
                  {loading ? 'Adding...' : '➕ Add'}
                </button>
              </div>
            </form>

            {/* Quick Symbol Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
              <span className="text-xs text-muted">Quick picks:</span>
              {QUICK_SYMBOLS.map(sym => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setManualSymbol(sym)}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border-secondary)',
                    borderRadius: '4px',
                    padding: '2px 8px',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div
              className={`portfolio-upload-zone ${dragOver ? 'dragover' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              style={{ padding: '2rem 1rem' }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                  <p>Processing portfolio CSV...</p>
                </>
              ) : (
                <>
                  <div className="portfolio-upload-icon" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📄</div>
                  <h3 style={{ fontSize: '1.1rem' }}>Drop your Groww / Zerodha / AngelOne Excel (.xlsx) or CSV here</h3>
                  <p className="text-muted text-sm" style={{ marginTop: '0.25rem' }}>
                    or click to browse. Automatically extracts holdings from Groww statements, Zerodha, Upstox, etc.
                  </p>
                </>
              )}
            </div>
            <input
              type="file"
              ref={fileRef}
              accept=".csv, .xlsx, .xls"
              style={{ display: 'none' }}
              onChange={(e) => handleUpload(e.target.files[0])}
            />
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--color-sell)', borderRadius: 'var(--radius-sm)', padding: '0.75rem 1rem', marginBottom: '1.5rem', color: 'var(--color-sell)', fontSize: '0.9rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Portfolio Main View */}
      {portfolio && portfolio.holdings && portfolio.holdings.length > 0 ? (
        <div>

          {/* ═══ ACTIVE SWING TRADE PLAYBOOK — Live Phase Tracker ═══ */}
          {(() => {
            const swingHoldings = portfolio.holdings.filter(h => (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING');
            if (swingHoldings.length === 0) return null;

            return (
              <div style={{
                marginBottom: '1.5rem',
                background: 'linear-gradient(180deg, rgba(99,102,241,0.08) 0%, rgba(15,23,42,0.8) 100%)',
                border: '1px solid rgba(99,102,241,0.35)',
                borderRadius: 'var(--radius-lg)',
                padding: '1.5rem',
                position: 'relative',
                overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #6366f1, #10b981, #f59e0b)' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.1rem' }}>
                  <span style={{ fontSize: '1.3rem' }}>🎮</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: '#ffffff' }}>Active Swing Trade Playbook — Live Phase Tracker</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>
                      Real-time status of each swing trade. Shows exactly where you are in the 4-phase exit plan and what to do next.
                    </div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
                  {swingHoldings.map((h, idx) => {
                    const buyPrice = h.buyPrice || 0;
                    const currentPrice = h.currentPrice || buyPrice;
                    const pnlPct = h.pnlPercent || ((currentPrice - buyPrice) / buyPrice * 100);

                    // Compute key price levels
                    // Target 1 = +10% from buy, Stop loss = approx -5.5% from buy
                    const target1 = h.targetPrice || Math.round(buyPrice * 1.10 * 100) / 100;
                    const hardStop = h.stopLossPrice || Math.round(buyPrice * 0.945 * 100) / 100;
                    // 10 EMA estimated: use technicals if available, else approximate as -2% from current
                    const ema10 = h.ema10 || Math.round(currentPrice * 0.98 * 100) / 100;
                    const ema21 = h.ema21 || Math.round(currentPrice * 0.955 * 100) / 100;

                    // Determine which phase we're in
                    let phase, phaseNum, phaseColor, phaseBg, phaseBorder, phaseTitle, phaseDesc, currentStop, stopAction, exitNote;

                    if (pnlPct < -1 && currentPrice < hardStop * 1.01) {
                      // Near or below stop loss
                      phase = 'STOP_HIT';
                      phaseNum = '!';
                      phaseColor = '#ef4444';
                      phaseBg = 'rgba(239,68,68,0.1)';
                      phaseBorder = 'rgba(239,68,68,0.4)';
                      phaseTitle = '🔴 STOP LOSS ZONE — Exit Now';
                      phaseDesc = `Price is at/below your stop loss of ₹${hardStop}. The trade is invalidated. Exit the full position to protect capital.`;
                      currentStop = `₹${hardStop} (ORIGINAL — EXIT NOW)`;
                      stopAction = `Sell ALL ${h.quantity} shares immediately at market price. Do not wait.`;
                      exitNote = `Loss capped at ${Math.abs(pnlPct).toFixed(1)}%. This is normal — not every trade works. Protect capital for the next setup.`;
                    } else if (pnlPct < 10) {
                      // Phase 1: Still in trade, original hard stop active
                      phase = 'PHASE_1';
                      phaseNum = '1';
                      phaseColor = '#06b6d4';
                      phaseBg = 'rgba(6,182,212,0.06)';
                      phaseBorder = 'rgba(6,182,212,0.3)';
                      phaseTitle = '⏳ Phase 1 — Riding to Target 1';
                      phaseDesc = `Trade is active. Waiting for price to reach Target 1 of ₹${target1} (+10%). Your original hard stop is still active.`;
                      currentStop = `₹${hardStop} (HARD STOP — keep your GTT set here)`;
                      stopAction = `Do nothing. Your GTT stop order at ₹${hardStop} protects you. Wait patiently for ₹${target1}.`;
                      exitNote = `Still ${(((target1 - currentPrice) / currentPrice) * 100).toFixed(1)}% away from Target 1. If price closes a full daily candle below ₹${hardStop}, exit.`;
                    } else if (pnlPct >= 10 && pnlPct < 18) {
                      // Phase 2: Target 1 has been hit — user should have sold 50%
                      phase = 'PHASE_2';
                      phaseNum = '2';
                      phaseColor = '#10b981';
                      phaseBg = 'rgba(16,185,129,0.08)';
                      phaseBorder = 'rgba(16,185,129,0.4)';
                      phaseTitle = '🎯 Phase 2 — Target 1 HIT! Take Action Now';
                      phaseDesc = `Price has reached +${pnlPct.toFixed(1)}% — you've hit Target 1 zone (₹${target1}). Sell half your shares NOW. Then move your stop loss up to your buy price.`;
                      currentStop = `₹${buyPrice} (MOVE STOP TO BREAKEVEN)`;
                      stopAction = `Action 1: Sell ${Math.floor(h.quantity / 2)} shares (50%) at market. Action 2: Update your GTT order from ₹${hardStop} → ₹${buyPrice}. You now have zero risk on the trade.`;
                      exitNote = `After selling half, remaining ${Math.ceil(h.quantity / 2)} shares ride for free. Stop is at cost so you cannot lose.`;
                    } else if (pnlPct >= 18) {
                      // Phase 3/4: Super runner — trail on 10 EMA
                      phase = 'PHASE_3';
                      phaseNum = '3';
                      phaseColor = '#a855f7';
                      phaseBg = 'rgba(168,85,247,0.08)';
                      phaseBorder = 'rgba(168,85,247,0.4)';
                      phaseTitle = `🚀 Phase 3/4 — Super Runner! Trail on 10 EMA`;
                      phaseDesc = `Exceptional move of +${pnlPct.toFixed(1)}%! If you've sold 50% at T1 — great. Now let the rest ride using the 10-day EMA as a trailing stop.`;
                      currentStop = `₹${ema10} (10-DAY EMA — UPDATE DAILY)`;
                      stopAction = `Only exit remaining shares when the stock CLOSES below ₹${ema10} on a daily candle. Check this every evening. If above EMA — hold.`;
                      exitNote = `Current 10 EMA ≈ ₹${ema10}. Stock is ${((currentPrice - ema10) / ema10 * 100).toFixed(1)}% above trailing stop. Do NOT exit on intra-day dips below EMA — only daily closing price matters.`;
                    }

                    const isAtRisk = phase === 'STOP_HIT';
                    const isActionable = phase === 'PHASE_2';

                    return (
                      <div key={idx} style={{
                        background: phaseBg,
                        border: `1px solid ${phaseBorder}`,
                        borderRadius: 'var(--radius-md)',
                        padding: '1.1rem',
                        position: 'relative',
                      }}>
                        {isAtRisk && (
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: '#ef4444', animation: 'pulse 1s infinite' }} />
                        )}
                        {isActionable && (
                          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #10b981, #fbbf24)' }} />
                        )}

                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: `${phaseColor}22`, color: phaseColor, fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, flexShrink: 0, border: `1px solid ${phaseColor}55` }}>{phaseNum}</span>
                              <span style={{ fontWeight: 800, fontSize: '1rem', color: '#ffffff' }}>{h.symbol}</span>
                              <span style={{ fontSize: '0.68rem', background: 'rgba(99,102,241,0.2)', color: '#a78bfa', padding: '1px 6px', borderRadius: '3px', fontWeight: 700 }}>⚡ SWING</span>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                              Bought @ ₹{buyPrice} × {h.quantity} shares
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: pnlPct >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                              {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>₹{currentPrice}</div>
                          </div>
                        </div>

                        {/* Phase Title */}
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: phaseColor, marginBottom: '0.4rem' }}>{phaseTitle}</div>
                        <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{phaseDesc}</p>

                        {/* Current Stop Level */}
                        <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '0.6rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem' }}>
                            🎯 Your Stop Loss RIGHT NOW should be:
                          </div>
                          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: phase === 'STOP_HIT' ? '#ef4444' : phase === 'PHASE_3' ? '#a855f7' : 'var(--accent-cyan)', fontFamily: 'monospace' }}>
                            {currentStop}
                          </div>
                        </div>

                        {/* What to do */}
                        <div style={{ background: isActionable ? 'rgba(16,185,129,0.08)' : isAtRisk ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isActionable ? 'rgba(16,185,129,0.3)' : isAtRisk ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '0.5rem' }}>
                          <div style={{ fontSize: '0.65rem', color: isActionable ? '#10b981' : isAtRisk ? '#ef4444' : 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '0.15rem' }}>
                            ✅ What to do right now:
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 600, lineHeight: 1.45 }}>{stopAction}</div>
                        </div>

                        {/* Exit note */}
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', lineHeight: 1.45, fontStyle: 'italic' }}>
                          💡 {exitNote}
                        </div>

                        {/* Progress bar: buy → target1 */}
                        {phase !== 'STOP_HIT' && (
                          <div style={{ marginTop: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-tertiary)', marginBottom: '0.2rem' }}>
                              <span>₹{buyPrice} (Entry)</span>
                              <span style={{ color: phaseColor }}>{pnlPct.toFixed(1)}% gain</span>
                              <span style={{ color: 'var(--color-buy)' }}>₹{target1} (T1)</span>
                            </div>
                            <div style={{ height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%',
                                width: `${Math.min(100, Math.max(0, pnlPct / 10 * 100))}%`,
                                background: pnlPct >= 10 ? 'linear-gradient(90deg, #10b981, #a855f7)' : `linear-gradient(90deg, ${phaseColor}, ${phaseColor}88)`,
                                borderRadius: '3px',
                                transition: 'width 0.5s ease',
                              }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: '1rem', padding: '0.6rem 1rem', background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '0.73rem', color: 'var(--text-secondary)', display: 'flex', gap: '0.5rem' }}>
                  <span>💡</span>
                  <span>
                    <strong style={{color:'#fbbf24'}}>How to check the 10 EMA daily:</strong> Open the stock on Zerodha Kite or TradingView. Switch to Daily chart. Add indicator "EMA 10". Every evening before 4 PM, check if the closing price is above or below the EMA line. If it closes below — exit next morning at open. If above — hold.
                  </span>
                </div>
              </div>
            );
          })()}

          {/* Summary Metric Cards */}
          <div className="portfolio-summary-grid">

            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Total Capital Invested</div>
              <div className="portfolio-stat-value">{formatPrice(portfolio.summary.totalInvested)}</div>
              <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                {coreCount} Core Holdings • {swingCount} Swing Trades
              </div>
            </div>

            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Current Valuation</div>
              <div className="portfolio-stat-value">{formatPrice(portfolio.summary.totalCurrentValue)}</div>
              <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>Live NSE mark-to-market</div>
            </div>

            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Overall Net P&L</div>
              <div className={`portfolio-stat-value ${portfolio.summary.totalPnl >= 0 ? 'change-positive' : 'change-negative'}`}>
                {portfolio.summary.totalPnl >= 0 ? '+' : ''}{formatPrice(portfolio.summary.totalPnl)}
                <span style={{ fontSize: '0.9rem', marginLeft: '0.35rem', fontWeight: 600 }}>
                  ({portfolio.summary.totalPnlPercent >= 0 ? '+' : ''}{portfolio.summary.totalPnlPercent}%)
                </span>
              </div>
              <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                {portfolio.summary.totalPnl >= 0 ? '🟢 Profit zone' : '🔴 Capital defense active'}
              </div>
            </div>

            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Leaders & Laggards</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-buy)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{portfolio.summary.topGainer ? portfolio.summary.topGainer.symbol : 'N/A'}</span>
                <span>+{portfolio.summary.topGainer?.pnlPercent || 0}%</span>
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-sell)', display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem' }}>
                <span>{portfolio.summary.topLoser ? portfolio.summary.topLoser.symbol : 'N/A'}</span>
                <span>{portfolio.summary.topLoser?.pnlPercent || 0}%</span>
              </div>
            </div>
          </div>

          {/* AI / Quant Holistic Strategy Trigger Banner */}
          <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'rgba(99, 102, 241, 0.4)', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(34, 211, 238, 0.04) 100%)', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <span style={{ fontSize: '1.25rem' }}>⚡</span>
                <h3 style={{ margin: 0 }}>Core vs Satellite Institutional Desk</h3>
              </div>
              <p className="text-muted text-sm" style={{ margin: 0 }}>
                Synthesizes value accumulation on long-term bluechips while enforcing hard -5.5% stops on short-term swing trades.
              </p>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleAnalyzeAll}
              disabled={analyzingPortfolio}
              style={{ flexShrink: 0, padding: '0.75rem 1.25rem', fontWeight: 700 }}
            >
              {analyzingPortfolio ? '⏳ Synthesizing Strategy...' : '🧠 Run Holistic Portfolio Analysis'}
            </button>
          </div>

          {/* Strategy Results Section */}
          {portfolioAI?.analysis && (
            <div className="glass-card fade-in-up" style={{ marginBottom: '1.5rem', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
              {/* Health Score & Overview */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-secondary)', paddingBottom: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem' }}>📊 Strategic Portfolio Assessment</h3>
                  <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                    Analyzed at {new Date(portfolioAI.analyzedAt || Date.now()).toLocaleTimeString()}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255,255,255,0.03)', padding: '0.5rem 1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
                  <span className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Portfolio Health</span>
                  <span style={{
                    fontSize: '1.5rem',
                    fontWeight: 800,
                    color: portfolioAI.analysis.portfolioHealthScore >= 70 ? 'var(--color-buy)' : portfolioAI.analysis.portfolioHealthScore >= 45 ? 'var(--color-hold)' : 'var(--color-sell)',
                  }}>
                    {portfolioAI.analysis.portfolioHealthScore}/100
                  </span>
                </div>
              </div>

              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                {portfolioAI.analysis.overallAssessment}
              </p>

              {/* Real Sector Allocation and Concentration Warning */}
              {portfolioAI.analysis.sectorAllocation?.length > 0 && (
                <div style={{ marginBottom: '1.5rem', background: 'var(--bg-primary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ fontSize: '0.95rem', margin: 0 }}>🌐 Sector Diversification & Exposure</h4>
                    <span className="text-xs text-muted">{portfolioAI.analysis.sectorAllocation.length} active sectors</span>
                  </div>

                  <div style={{ height: '220px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioAI.analysis.sectorAllocation}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={4}
                          dataKey="percentage"
                          nameKey="sector"
                          stroke="none"
                        >
                          {portfolioAI.analysis.sectorAllocation.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          formatter={(value, name) => [`${value}%`, name]}
                          contentStyle={{ background: '#0c1220', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc' }}
                        />
                        <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '0.75rem', color: '#94a3b8', paddingTop: '10px' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {portfolioAI.analysis.sectorConcentration && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem', padding: '0.6rem 0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', borderLeft: '3px solid var(--accent-cyan)' }}>
                      <strong>Diversification Verdict: </strong>{portfolioAI.analysis.sectorConcentration}
                    </div>
                  )}
                </div>
              )}

              {/* Action Hub (Profit Booking, Loss Cutting, Dip Accumulation, Rebalancing) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {/* Profit Booking */}
                <div style={{ background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--color-buy)', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>💰</span> Profit Booking Targets
                  </h4>
                  {portfolioAI.analysis.profitBookingActions?.length > 0 ? (
                    portfolioAI.analysis.profitBookingActions.map((a, i) => (
                      <div key={i} style={{ marginBottom: '0.6rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '0.2rem' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{a.symbol} ({a.strategy === 'SWING' ? '⚡ Swing' : '💎 Core'})</span>
                          <span style={{ color: 'var(--color-buy)' }}>{a.action}</span>
                        </div>
                        <div className="text-muted" style={{ lineHeight: 1.4 }}>{a.reasoning}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted">No positions currently at profit target. Let winners develop.</p>
                  )}
                </div>

                {/* Tactical Swing Stop Losses (Only applies to SWING) */}
                <div style={{ background: 'rgba(239, 68, 68, 0.04)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--color-sell)', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>🛑</span> Swing Trade Stops (Exit at -5.5%)
                  </h4>
                  {portfolioAI.analysis.lossCuttingActions?.length > 0 ? (
                    portfolioAI.analysis.lossCuttingActions.map((a, i) => (
                      <div key={i} style={{ marginBottom: '0.6rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '0.2rem' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{a.symbol} (⚡ Swing)</span>
                          <span style={{ color: 'var(--color-sell)' }}>{a.action}</span>
                        </div>
                        <div className="text-muted" style={{ lineHeight: 1.4 }}>{a.reasoning}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted">Zero active swing trades have breached the -5.5% hard stop loss limit.</p>
                  )}
                </div>

                {/* Core Dip Accumulation (Strategic Averaging for Long-Term) */}
                <div style={{ background: 'rgba(34, 211, 238, 0.04)', border: '1px solid rgba(34, 211, 238, 0.25)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-cyan)', margin: '0 0 0.75rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span>🛒</span> Core Dip Accumulation Zone
                  </h4>
                  {portfolioAI.analysis.dipAccumulationActions?.length > 0 ? (
                    portfolioAI.analysis.dipAccumulationActions.map((a, i) => (
                      <div key={i} style={{ marginBottom: '0.6rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '0.82rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginBottom: '0.2rem' }}>
                          <span style={{ color: 'var(--text-primary)' }}>{a.symbol} (💎 Core)</span>
                          <span style={{ color: 'var(--accent-cyan)' }}>{a.action}</span>
                        </div>
                        <div className="text-muted" style={{ lineHeight: 1.4 }}>{a.reasoning}</div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted">Core compounders are steady. No major cyclical discount zones active right now.</p>
                  )}
                </div>
              </div>

              {/* Complementary Additions */}
              {portfolioAI.analysis.suggestedNewStocks?.length > 0 && (
                <div style={{ marginBottom: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
                  <h4 style={{ fontSize: '0.9rem', color: 'var(--accent-secondary)', margin: '0 0 0.75rem 0' }}>
                    🆕 Recommended Sector Complements (To Boost Diversification)
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
                    {portfolioAI.analysis.suggestedNewStocks.map((s, i) => (
                      <div key={i} style={{ padding: '0.6rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', fontSize: '0.82rem' }}>
                        <div style={{ fontWeight: 700, color: 'var(--accent-secondary)', marginBottom: '0.2rem' }}>
                          {s.symbol} {s.suggestedEntry && <span className="text-muted" style={{ fontWeight: 400 }}>({s.suggestedEntry})</span>}
                        </div>
                        <div className="text-muted">{s.reasoning}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* This Week's Tactical Execution Plan */}
              {portfolioAI.analysis.overallStrategy && (
                <div style={{ padding: '1rem', background: 'rgba(99, 102, 241, 0.08)', border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ color: 'var(--accent-primary)', display: 'block', marginBottom: '0.35rem', fontSize: '0.9rem' }}>
                    💡 Institutional Weekly Game Plan
                  </strong>
                  <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0, fontSize: '0.88rem' }}>
                    {portfolioAI.analysis.overallStrategy}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Holdings Table with Institutional Quant Badges & Filter Tabs */}
          <div className="glass-card" style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>📋 Current Holdings & Real-Time Trade Desk</h3>
                <span className="text-xs text-muted">Click strategy badge (💎 CORE / ⚡ SWING) to toggle mode. Full institutional prices & actions below.</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.7rem',
                  color: 'var(--color-buy)',
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '12px',
                  padding: '0.2rem 0.6rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}>
                  <span className="pulse-dot" style={{ width: '6px', height: '6px', background: 'var(--color-buy)' }}></span>
                  LIVE PULSE: 25s Auto-Sync ({lastSyncTime})
                </span>
                <button
                  type="button"
                  className="btn btn-xs btn-secondary"
                  onClick={() => {
                    if (portfolio?.holdings) syncHoldings(portfolio.holdings);
                  }}
                  disabled={loading}
                  title="Force refresh live prices from NSE"
                >
                  {loading ? 'Syncing...' : '🔄 Sync Now'}
                </button>
                <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                  Showing {filteredHoldings.length} of {allHoldings.length} Holdings
                </span>
              </div>
            </div>

            {/* Quick Action Filter Pills */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', padding: '0.65rem 1.25rem', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-secondary)', alignItems: 'center' }}>
              <span className="text-xs text-muted" style={{ fontWeight: 600, letterSpacing: '0.04em' }}>FILTER ACTIONS:</span>
              <button
                type="button"
                className={`btn btn-xs ${actionFilter === 'ALL' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActionFilter('ALL')}
              >
                All Positions ({allHoldings.length})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${actionFilter === 'AVERAGE' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActionFilter('AVERAGE')}
                style={{ color: '#34d399', borderColor: actionFilter === 'AVERAGE' ? '#10b981' : 'rgba(52, 211, 153, 0.3)' }}
              >
                🛒 Safe to Average ({averageCount})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${actionFilter === 'HOLD' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActionFilter('HOLD')}
                style={{ color: '#38bdf8', borderColor: actionFilter === 'HOLD' ? '#38bdf8' : 'rgba(56, 189, 248, 0.3)' }}
              >
                💎 Hold Core ({holdCount})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${actionFilter === 'FREEZE' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActionFilter('FREEZE')}
                style={{ color: '#f87171', borderColor: actionFilter === 'FREEZE' ? '#f87171' : 'rgba(239, 68, 68, 0.3)' }}
              >
                ⚠️ Sinking / Freeze Capital ({freezeCount})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${actionFilter === 'PROFIT' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActionFilter('PROFIT')}
                style={{ color: '#10b981', borderColor: actionFilter === 'PROFIT' ? '#10b981' : 'rgba(16, 185, 129, 0.3)' }}
              >
                🚀 Super Compounders ({profitCount})
              </button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="portfolio-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Stock / Role</th>
                    <th>Qty</th>
                    <th>Avg Buy Price</th>
                    <th>Current Price</th>
                    <th>Target</th>
                    <th>Stop / Review</th>
                    <th>Invested</th>
                    <th>Valuation</th>
                    <th>P&L</th>
                    <th>P&L %</th>
                    <th style={{ minWidth: '280px' }}>Institutional Recommendation & Action Plan</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map((h, i) => {
                    const isSwing = (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING';
                    const badge = h.quantAction || {
                      badge: isSwing ? 'HOLD_IN_BASE' : 'CORE_HOLD',
                      label: isSwing ? 'HOLD BASE ⏳' : 'CORE HOLD 💎',
                      variant: 'cyan',
                      headline: `Hold Steady — Target ₹${Math.round(h.buyPrice * 1.30)}`,
                      detail: 'Position within normal noise tolerance. Hold through noise.',
                    };

                    const badgeStyle = (badge.badge === 'RIDE_RUNNER' || badge.badge === 'CORE_COMPOUNDER')
                      ? { background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.4)' }
                      : (badge.badge === 'BANK_PROFIT_T1' || badge.badge === 'ACCUMULATE_DIP')
                      ? { background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', border: '1px solid rgba(52, 211, 153, 0.4)' }
                      : (badge.badge === 'CUT_LOSS' || badge.badge === 'REVIEW_THESIS')
                      ? { background: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)' }
                      : { background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' };

                    return (
                      <tr key={i}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{h.symbol}</div>
                            <button
                              type="button"
                              onClick={() => handleToggleStrategy(h.symbol)}
                              title="Click to toggle between Core Long-Term and Tactical Swing"
                              style={{
                                background: isSwing ? 'rgba(99, 102, 241, 0.18)' : 'rgba(34, 211, 238, 0.15)',
                                color: isSwing ? 'var(--accent-primary)' : 'var(--accent-cyan)',
                                border: `1px solid ${isSwing ? 'var(--accent-primary)' : 'var(--accent-cyan)'}`,
                                borderRadius: '4px',
                                padding: '1px 6px',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {isSwing ? '⚡ SWING' : '💎 CORE'}
                            </button>
                          </div>
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', marginTop: '0.2rem' }}>
                            {h.sector && (
                              <span style={{ fontSize: '0.7rem', padding: '1px 6px', background: 'rgba(255,255,255,0.06)', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                                {h.sector}
                              </span>
                            )}
                            {h.cap && (
                              <span style={{ fontSize: '0.65rem', padding: '1px 4px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '3px', color: 'var(--accent-primary)' }}>
                                {h.cap === 'LARGE_CAP' ? 'LARGE' : h.cap === 'MID_CAP' ? 'MID' : 'SMALL'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ fontWeight: 600 }}>{h.quantity}</td>
                        <td>{formatPrice(h.buyPrice)}</td>
                        <td>
                          {h.error ? (
                            <span className="text-muted" style={{ fontSize: '0.8rem' }}>Unavailable</span>
                          ) : (
                            <div>
                              <div style={{ fontWeight: 700 }}>{formatPrice(h.currentPrice)}</div>
                              {h.dayChange !== undefined && (
                                <div style={{ fontSize: '0.75rem', color: h.dayChange >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                                  {h.dayChange >= 0 ? '+' : ''}{h.dayChange.toFixed(2)}%
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ color: 'var(--color-buy)', fontWeight: 600 }}>
                          {formatPrice(h.targetPrice || h.buyPrice * (isSwing ? 1.08 : 1.30))}
                        </td>
                        <td style={{ color: isSwing ? 'var(--color-sell)' : 'var(--text-muted)', fontWeight: 600 }}>
                          {formatPrice(h.stopLossPrice || h.buyPrice * (isSwing ? 0.94 : 0.80))}
                        </td>
                        <td>{formatPrice(h.investedValue)}</td>
                        <td style={{ fontWeight: 600 }}>{formatPrice(h.currentValue)}</td>
                        <td className={h.pnl >= 0 ? 'change-positive' : 'change-negative'} style={{ fontWeight: 700 }}>
                          {h.pnl >= 0 ? '+' : ''}{formatPrice(h.pnl)}
                        </td>
                        <td className={h.pnlPercent >= 0 ? 'change-positive' : 'change-negative'} style={{ fontWeight: 700 }}>
                          {h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent}%
                        </td>
                        <td style={{ minWidth: '280px', maxWidth: '340px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  ...badgeStyle,
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 800,
                                  display: 'inline-block',
                                }}
                              >
                                {badge.label}
                              </span>
                              {badge.action && (
                                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                  {badge.action}
                                </span>
                              )}
                            </div>
                            {badge.headline && (
                              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: badge.variant === 'emerald' ? '#34d399' : badge.variant === 'danger' ? '#f87171' : badge.variant === 'success' ? '#10b981' : '#38bdf8' }}>
                                {badge.headline}
                              </div>
                            )}
                            {badge.detail && (
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.4, background: 'rgba(255,255,255,0.02)', padding: '5px 8px', borderRadius: '4px', borderLeft: `2px solid ${badge.variant === 'emerald' ? '#10b981' : badge.variant === 'danger' ? '#ef4444' : '#38bdf8'}` }}>
                                {badge.detail}
                              </div>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => handleAnalyzeHolding(h)}
                              disabled={!!analyzingSymbol}
                              title="Deep dive into multi-timeframe swing indicators, regime alignment, and order flow"
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
                            >
                              {analyzingSymbol === h.symbol ? '⏳' : '🧠 Deep Dive'}
                            </button>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleRemoveHolding(h.symbol)}
                              title="Remove from portfolio"
                              style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-sell)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="glass-card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem', marginTop: '1rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💼</div>
          <h3 style={{ marginBottom: '0.5rem' }}>No Holdings Added Yet</h3>
          <p className="text-muted" style={{ maxWidth: '520px', margin: '0 auto 1.5rem' }}>
            Enter your current stock holdings using the manual form above, or click <strong>Load Demo Portfolio</strong> to immediately see how the institutional trade desk analyzes and protects an equity portfolio.
          </p>
          <button className="btn btn-primary" onClick={handleLoadDemo}>
            ⚡ Load Demo Portfolio (5 Bluechips)
          </button>
        </div>
      )}
    </div>
  );
}
