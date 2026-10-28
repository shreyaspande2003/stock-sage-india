import React, { useState, useEffect, useRef } from 'react';
import { uploadPortfolio, submitManualPortfolio, analyzeHolding, analyzePortfolio } from '../api.js';
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

  // Manual Form inputs
  const [manualSymbol, setManualSymbol] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [manualBuyPrice, setManualBuyPrice] = useState('');
  const [manualBuyDate, setManualBuyDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [manualStrategy, setManualStrategy] = useState('LONG_TERM'); // 'LONG_TERM' | 'SWING'

  const fileRef = useRef(null);

  // Auto-load portfolio from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('stocksage_active_portfolio');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          syncHoldings(parsed);
        }
      } catch (err) {
        console.error('Failed to parse saved portfolio:', err);
      }
    }
  }, []);

  // Synchronize holdings with backend to get live prices & quant badges
  const syncHoldings = async (holdingsList) => {
    if (!holdingsList || holdingsList.length === 0) {
      setPortfolio(null);
      setPortfolioAI(null);
      localStorage.removeItem('stocksage_active_portfolio');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await submitManualPortfolio(holdingsList);
      setPortfolio(data);
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
      setError(err.message || 'Failed to update portfolio holdings');
    }
    setLoading(false);
  };

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

          {/* Holdings Table with Institutional Quant Badges */}
          <div className="glass-card" style={{ overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0 }}>📋 Current Holdings & Real-Time Trade Desk</h3>
                <span className="text-xs text-muted">Click the strategy tag (💎 CORE / ⚡ SWING) to toggle between Long-Term and Swing mode</span>
              </div>
              <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: 'var(--accent-primary)', fontWeight: 600 }}>
                {portfolio.holdings.length} Positions Active
              </span>
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
                    <th>Quant Recommendation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.holdings.map((h, i) => {
                    const isSwing = (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING';
                    const badge = h.quantAction || {
                      badge: isSwing ? 'HOLD_IN_BASE' : 'CORE_HOLD',
                      label: isSwing ? 'HOLD BASE ⏳' : 'CORE HOLD 💎',
                      variant: 'cyan',
                      detail: 'Position within normal noise tolerance.',
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
                        <td>
                          <div
                            style={{
                              ...badgeStyle,
                              padding: '4px 8px',
                              borderRadius: '6px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              textAlign: 'center',
                              whiteSpace: 'nowrap',
                            }}
                            title={badge.detail}
                          >
                            {badge.label}
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
