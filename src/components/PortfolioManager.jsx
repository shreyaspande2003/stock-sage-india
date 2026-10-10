import React, { useState, useRef } from 'react';
import { uploadPortfolio, analyzeHolding, analyzePortfolio } from '../api.js';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'];

export default function PortfolioManager({ settings, isAIReady, onAnalyze }) {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [analyzingSymbol, setAnalyzingSymbol] = useState('');
  const [portfolioAI, setPortfolioAI] = useState(null);
  const [analyzingPortfolio, setAnalyzingPortfolio] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handleUpload = async (file) => {
    if (!file) return;
    setLoading(true);
    setError('');
    setPortfolioAI(null);

    try {
      const data = await uploadPortfolio(file);
      setPortfolio(data);
    } catch (err) {
      setError(err.message || 'Failed to upload portfolio');
    }
    setLoading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleUpload(file);
    } else {
      setError('Please upload a .csv file');
    }
  };

  const handleAnalyzeHolding = async (holding) => {
    if (!isAIReady) {
      setError('Please set your OpenRouter API key in Settings first.');
      return;
    }
    setAnalyzingSymbol(holding.symbol);
    try {
      const data = await analyzeHolding(holding.symbol, holding.quantity, holding.buyPrice);
      onAnalyze(data);
    } catch (err) {
      setError(err.message);
    }
    setAnalyzingSymbol('');
  };

  const handleAnalyzeAll = async () => {
    if (!isAIReady) {
      setError('Please set your OpenRouter API key in Settings first.');
      return;
    }
    if (!portfolio?.holdings?.length) return;
    setAnalyzingPortfolio(true);
    setError('');
    try {
      const data = await analyzePortfolio(portfolio.holdings);
      setPortfolioAI(data);
    } catch (err) {
      setError(err.message || 'Portfolio analysis failed');
    }
    setAnalyzingPortfolio(false);
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return 'N/A';
    return `₹${Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="fade-in-up">
      <div className="dashboard-header">
        <h1>💼 Portfolio Manager</h1>
        <p>Upload your portfolio CSV to get AI-powered recommendations for each holding</p>
      </div>

      {/* Upload Zone */}
      {!portfolio && (
        <div>
          <div
            className={`portfolio-upload-zone ${dragOver ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            {loading ? (
              <>
                <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                <p>Processing your portfolio...</p>
              </>
            ) : (
              <>
                <div className="portfolio-upload-icon">📄</div>
                <h3>Drop your Portfolio CSV here</h3>
                <p className="text-muted" style={{ marginTop: '0.5rem' }}>
                  or click to browse. Expected columns: Symbol, Quantity, BuyPrice, BuyDate
                </p>
              </>
            )}
          </div>
          <input
            type="file"
            ref={fileRef}
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => handleUpload(e.target.files[0])}
          />
          
          {/* Sample CSV format */}
          <div className="glass-card" style={{ marginTop: '1.5rem', maxWidth: '500px' }}>
            <h4 style={{ marginBottom: '0.5rem' }}>📝 Sample CSV Format</h4>
            <pre style={{
              background: 'var(--bg-secondary)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              color: 'var(--accent-cyan)',
              overflowX: 'auto',
            }}>
{`Symbol,Quantity,BuyPrice,BuyDate
RELIANCE,10,2450,2024-01-15
TCS,5,3800,2024-03-20
INFY,15,1480,2024-06-01
HDFCBANK,8,1650,2024-02-10`}
            </pre>
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--color-sell)', marginTop: '1rem', fontSize: '0.9rem' }}>{error}</p>
      )}

      {/* Portfolio View */}
      {portfolio && (
        <div>
          {/* Summary Cards */}
          <div className="portfolio-summary-grid">
            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Total Invested</div>
              <div className="portfolio-stat-value">{formatPrice(portfolio.summary.totalInvested)}</div>
            </div>
            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Current Value</div>
              <div className="portfolio-stat-value">{formatPrice(portfolio.summary.totalCurrentValue)}</div>
            </div>
            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Total P&L</div>
              <div className={`portfolio-stat-value ${portfolio.summary.totalPnl >= 0 ? 'change-positive' : 'change-negative'}`}>
                {portfolio.summary.totalPnl >= 0 ? '+' : ''}{formatPrice(portfolio.summary.totalPnl)}
                <span style={{ fontSize: '0.9rem', marginLeft: '0.25rem' }}>
                  ({portfolio.summary.totalPnlPercent >= 0 ? '+' : ''}{portfolio.summary.totalPnlPercent}%)
                </span>
              </div>
            </div>
            <div className="portfolio-stat-card">
              <div className="portfolio-stat-label">Holdings</div>
              <div className="portfolio-stat-value">{portfolio.summary.totalHoldings}</div>
            </div>
          </div>

          {/* AI Analyze All Button */}
          <div className="glass-card" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>🧠 AI Portfolio Strategy</h3>
              <p className="text-muted text-sm">Get holistic rebalancing, profit booking, and risk analysis for your entire portfolio in one shot</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={handleAnalyzeAll}
              disabled={analyzingPortfolio || !isAIReady}
              style={{ flexShrink: 0 }}
            >
              {analyzingPortfolio ? '⏳ Analyzing...' : '⚡ Analyze Portfolio'}
            </button>
          </div>

          {/* Portfolio AI Results */}
          {portfolioAI?.analysis && (
            <div className="glass-card fade-in-up" style={{ marginBottom: '1.5rem', borderColor: 'rgba(99, 102, 241, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3>🧠 AI Portfolio Insights</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="text-xs text-muted">Health Score</span>
                  <span style={{
                    fontSize: '1.5rem', fontWeight: 800,
                    color: portfolioAI.analysis.portfolioHealthScore >= 70 ? 'var(--color-buy)' : portfolioAI.analysis.portfolioHealthScore >= 40 ? 'var(--color-hold)' : 'var(--color-sell)',
                  }}>{portfolioAI.analysis.portfolioHealthScore}/100</span>
                </div>
              </div>

              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
                {portfolioAI.analysis.overallAssessment}
              </p>

              {/* Sector Allocation Pie Chart */}
              {portfolioAI.analysis.sectorAllocation?.length > 0 && (
                <div style={{ marginBottom: '1.5rem', background: 'var(--bg-primary)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                  <h4 style={{ fontSize: '0.9rem', marginBottom: '1rem' }}>pie Sector Allocation Risk</h4>
                  <div style={{ height: '200px', width: '100%' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioAI.analysis.sectorAllocation}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="percentage"
                          nameKey="sector"
                          stroke="none"
                        >
                          {portfolioAI.analysis.sectorAllocation.map((entry, index) => (
                            <Cell key={`cell-\${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          contentStyle={{ background: '#0c1220', border: '1px solid #1e293b', borderRadius: '8px', color: '#f8fafc' }}
                          itemStyle={{ color: '#94a3b8' }}
                        />
                        <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{ fontSize: '0.8rem', color: '#94a3b8' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  {portfolioAI.analysis.sectorConcentration && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                      <strong>AI Note: </strong>{portfolioAI.analysis.sectorConcentration}
                    </div>
                  )}
                </div>
              )}

              {/* Profit Booking Actions */}
              {portfolioAI.analysis.profitBookingActions?.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', color: 'var(--color-buy)', marginBottom: '0.5rem' }}>💰 Profit Booking Recommendations</h4>
                  {portfolioAI.analysis.profitBookingActions.map((a, i) => (
                    <div key={i} className="expert-signal-item bullish" style={{ marginBottom: '0.25rem' }}>
                      <strong>{a.symbol}</strong>: {a.action} {a.quantity && `(${a.quantity})`} {a.targetPrice ? `at ₹${a.targetPrice}` : ''} — {a.reasoning}
                    </div>
                  ))}
                </div>
              )}

              {/* Loss Cutting */}
              {portfolioAI.analysis.lossCuttingActions?.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', color: 'var(--color-sell)', marginBottom: '0.5rem' }}>✂️ Loss Cutting Actions</h4>
                  {portfolioAI.analysis.lossCuttingActions.map((a, i) => (
                    <div key={i} className="expert-signal-item bearish" style={{ marginBottom: '0.25rem' }}>
                      <strong>{a.symbol}</strong>: {a.action} — {a.reasoning}
                    </div>
                  ))}
                </div>
              )}

              {/* Rebalance */}
              {portfolioAI.analysis.rebalanceActions?.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', marginBottom: '0.5rem' }}>⚖️ Rebalancing Suggestions</h4>
                  {portfolioAI.analysis.rebalanceActions.map((a, i) => (
                    <div key={i} className="expert-signal-item" style={{ marginBottom: '0.25rem', borderColor: a.direction === 'INCREASE' ? 'var(--color-buy)' : a.direction === 'EXIT' ? 'var(--color-sell)' : 'var(--border-secondary)' }}>
                      <strong>{a.symbol}</strong>: {a.direction} {a.targetAllocation ? `→ ${a.targetAllocation}` : ''} — {a.reasoning}
                    </div>
                  ))}
                </div>
              )}

              {/* Suggested New Stocks */}
              {portfolioAI.analysis.suggestedNewStocks?.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.85rem', color: 'var(--accent-secondary)', marginBottom: '0.5rem' }}>🆕 Suggested Additions</h4>
                  {portfolioAI.analysis.suggestedNewStocks.map((s, i) => (
                    <div key={i} className="expert-signal-item" style={{ marginBottom: '0.25rem', borderColor: 'var(--accent-secondary)' }}>
                      <strong>{s.symbol}</strong> {s.suggestedEntry ? `(Entry: ${s.suggestedEntry})` : ''} — {s.reasoning}
                    </div>
                  ))}
                </div>
              )}

              {/* Overall Strategy */}
              <div style={{ padding: '1rem', background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.15)', borderRadius: 'var(--radius-md)', marginTop: '1rem' }}>
                <strong>💡 This Week's Strategy:</strong>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: '0.5rem' }}>
                  {portfolioAI.analysis.overallStrategy}
                </p>
              </div>

              {/* Risk Warnings */}
              {portfolioAI.analysis.riskWarnings?.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  {portfolioAI.analysis.riskWarnings.map((w, i) => (
                    <div key={i} style={{ fontSize: '0.8rem', color: 'var(--color-hold)', marginBottom: '0.25rem' }}>⚠️ {w}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Holdings Table */}
          <div className="glass-card" style={{ overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>📋 Holdings</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => { setPortfolio(null); setPortfolioAI(null); }}>
                Upload New CSV
              </button>
            </div>
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th>Stock</th>
                  <th>Qty</th>
                  <th>Buy Price</th>
                  <th>Current Price</th>
                  <th>Invested</th>
                  <th>Current Value</th>
                  <th>P&L</th>
                  <th>P&L %</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{h.symbol}</div>
                      {h.name && <div className="text-xs text-muted">{h.name}</div>}
                    </td>
                    <td>{h.quantity}</td>
                    <td>{formatPrice(h.buyPrice)}</td>
                    <td>{h.error ? <span className="text-muted">Error</span> : formatPrice(h.currentPrice)}</td>
                    <td>{formatPrice(h.investedValue)}</td>
                    <td>{formatPrice(h.currentValue)}</td>
                    <td className={h.pnl >= 0 ? 'change-positive' : 'change-negative'}>
                      {h.pnl >= 0 ? '+' : ''}{formatPrice(h.pnl)}
                    </td>
                    <td className={h.pnlPercent >= 0 ? 'change-positive' : 'change-negative'}>
                      {h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent}%
                    </td>
                    <td>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleAnalyzeHolding(h)}
                        disabled={!!analyzingSymbol || !isAIReady}
                      >
                        {analyzingSymbol === h.symbol ? '⏳' : '🧠'} Analyze
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Top Gainer / Loser */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            {portfolio.summary.topGainer && (
              <div className="glass-card" style={{ borderColor: 'rgba(16, 185, 129, 0.3)' }}>
                <div className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>🏆 Top Gainer</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>{portfolio.summary.topGainer.symbol}</div>
                <div className="change-positive font-semibold">+{portfolio.summary.topGainer.pnlPercent}% ({formatPrice(portfolio.summary.topGainer.pnl)})</div>
              </div>
            )}
            {portfolio.summary.topLoser && (
              <div className="glass-card" style={{ borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                <div className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase' }}>📉 Top Loser</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '0.25rem' }}>{portfolio.summary.topLoser.symbol}</div>
                <div className="change-negative font-semibold">{portfolio.summary.topLoser.pnlPercent}% ({formatPrice(portfolio.summary.topLoser.pnl)})</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
