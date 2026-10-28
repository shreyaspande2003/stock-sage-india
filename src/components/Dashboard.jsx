import React, { useState, useEffect, useRef } from 'react';
import { searchStocks, analyzeStock, fetchStockData, getMarketNews, initAI, getAIStatus, scanSwingSetups, getMarketRegime, getBacktestResults, getMorningTriggers } from '../api.js';

export default function Dashboard({ onAnalyze, settings, isAIReady, setIsAIReady }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStages, setAnalyzeStages] = useState([]);
  const [marketNews, setMarketNews] = useState([]);
  const [swingPicks, setSwingPicks] = useState(null);
  const [marketRegime, setMarketRegime] = useState(null);
  const [backtestStats, setBacktestStats] = useState(null);
  const [capFilter, setCapFilter] = useState('ALL');
  const [morningData, setMorningData] = useState(null);
  const [morningFilter, setMorningFilter] = useState('ALL');
  const [morningLoading, setMorningLoading] = useState(false);
  const [recentAnalyses, setRecentAnalyses] = useState(() => {
    const saved = localStorage.getItem('stocksage_recent');
    return saved ? JSON.parse(saved) : [];
  });
  const [error, setError] = useState('');
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Check AI status on mount and auto-init if key exists
  useEffect(() => {
    async function checkAndInit() {
      try {
        const status = await getAIStatus();
        setIsAIReady(status.initialized);
        if (!status.initialized && settings.geminiKey) {
          await initAI(settings.geminiKey, settings.useProModel);
          setIsAIReady(true);
        }
      } catch (e) {
        console.log('AI status check failed:', e.message);
      }
    }
    checkAndInit();
  }, [settings.geminiKey]);

  // Fetch market news, swing scan, morning triggers, regime, and backtest results on mount
  useEffect(() => {
    getMarketNews().then(data => setMarketNews(data.news || [])).catch(() => {});
    scanSwingSetups().then(data => setSwingPicks(data)).catch(() => {});
    getMorningTriggers().then(data => setMorningData(data)).catch(() => {});
    getMarketRegime().then(data => setMarketRegime(data)).catch(() => {});
    getBacktestResults().then(data => setBacktestStats(data)).catch(() => {});
  }, []);

  const refreshMorningTriggers = async () => {
    setMorningLoading(true);
    try {
      const data = await getMorningTriggers();
      setMorningData(data);
    } catch (e) {
      console.error('Failed to refresh morning triggers:', e);
    }
    setMorningLoading(false);
  };

  // Click outside to close search results
  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSearch = (value) => {
    setQuery(value);
    setError('');
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    
    if (value.length < 1) {
      setResults([]);
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchStocks(value);
        setResults(data.results || []);
        setShowResults(true);
      } catch (err) {
        console.error('Search error:', err);
      }
      setLoading(false);
    }, 300);
  };

  const handleSelectStock = async (stock) => {
    setShowResults(false);
    setQuery(stock.symbol);
    setError('');

    if (!isAIReady) {
      if (settings.geminiKey) {
        try {
          await initAI(settings.geminiKey, settings.useProModel);
          setIsAIReady(true);
        } catch (e) {
          setError('Failed to initialize AI. Check your OpenRouter API key in Settings.');
          return;
        }
      } else {
        setError('Please set your OpenRouter API key in Settings first.');
        return;
      }
    }

    setAnalyzing(true);
    setAnalyzing(true);
    // Removed fake stage timers because we want to transition to StockAnalysis immediately after data is fetched.

    try {
      // Step 1: Fetch fast market data (quote, chart, news, reddit)
      const data = await fetchStockData(stock.symbol, settings.newsApiKey);
      
      // Save to recent
      const recent = [
        { symbol: stock.symbol, name: stock.name, time: new Date().toISOString() },
        ...recentAnalyses.filter(r => r.symbol !== stock.symbol),
      ].slice(0, 10);
      setRecentAnalyses(recent);
      localStorage.setItem('stocksage_recent', JSON.stringify(recent));

      setAnalyzing(false);
      onAnalyze(data);
    } catch (err) {
      setAnalyzing(false);
      setError(err.message || 'Failed to fetch market data. Please try again.');
    }
  };

  // Quick analyze a stock by typing symbol directly
  const handleQuickAnalyze = async () => {
    if (!query.trim()) return;
    handleSelectStock({ symbol: query.trim().toUpperCase(), name: query.trim().toUpperCase() });
  };

  if (analyzing) {
    return (
      <div className="loading-overlay fade-in-up">
        <div className="spinner" style={{ width: '60px', height: '60px', borderWidth: '4px' }}></div>
        <h2 style={{ marginTop: '1rem' }}>Loading {query.toUpperCase()} Data</h2>
        <p className="text-muted">Fetching market data, chart, news, and technicals...</p>
      </div>
    );
  }

  return (
    <div className="fade-in-up">
      {/* Institutional Terminal Command Header */}
      <div className="command-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
              <span className="pulse-dot" style={{ background: 'var(--color-buy)', boxShadow: '0 0 10px var(--color-buy)' }}></span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>
                NSE LIVE FEED • 200 LIQUID MULTI-CAP ASSETS • V2.4 ENGINE
              </span>
            </div>
            <h1 style={{ fontSize: '2.1rem', fontWeight: 800, letterSpacing: '-0.03em', margin: 0, background: 'linear-gradient(135deg, #ffffff 40%, #94a3b8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Institutional Quant & Swing Radar
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ textAlign: 'right' }}>
              <div className="text-xs text-muted" style={{ fontWeight: 600 }}>MARKET REGIME</div>
              <div style={{ fontWeight: 800, fontSize: '0.95rem', color: marketRegime?.regime === 'RISK_ON' ? 'var(--color-buy)' : '#f59e0b' }}>
                {marketRegime?.regime ? marketRegime.regime.replace(/_/g, ' ') : 'RISK ON (BULL)'}
              </div>
            </div>
            <div style={{ width: '1px', height: '28px', background: 'rgba(255,255,255,0.1)' }}></div>
            <div style={{ textAlign: 'right' }}>
              <div className="text-xs text-muted" style={{ fontWeight: 600 }}>SWING SLOTS</div>
              <div className="font-mono" style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--accent-cyan)' }}>
                {marketRegime?.entriesAllowed ?? 3} ACTIVE
              </div>
            </div>
          </div>
        </div>

        {/* Command Palette Bar */}
        <div className="command-bar-wrapper" ref={searchRef}>
          <div className="command-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </div>
          <input
            className="command-input"
            placeholder="Command / Ticker Search... e.g. PPLPHARMA, RELIANCE, TRENT, HAL, RVNL"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuickAnalyze();
            }}
            id="stock-search"
          />
          <div className="command-shortcut">Ctrl+K</div>

          {showResults && results.length > 0 && (
            <div className="search-results">
              {results.map((stock, i) => (
                <div key={i} className="search-result-item" onClick={() => handleSelectStock(stock)}>
                  <div>
                    <div className="search-result-symbol font-mono">{stock.symbol}</div>
                    <div className="search-result-name">{stock.name}</div>
                  </div>
                  <span className="search-result-exchange">{stock.exchange}</span>
                </div>
              ))}
            </div>
          )}
          {showResults && results.length === 0 && query.length > 0 && !loading && (
            <div className="search-results">
              <div className="search-result-item" onClick={handleQuickAnalyze}>
                <div>
                  <div className="search-result-symbol font-mono">Analyze "{query.toUpperCase()}"</div>
                  <div className="search-result-name">Press Enter or click to run AI Multi-Expert Analysis</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Trending Momentum Tickers Row */}
        <div className="hot-tickers-row">
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', letterSpacing: '0.05em', textTransform: 'uppercase', marginRight: '0.25rem' }}>
            Trending:
          </span>
          {[
            { sym: 'PPLPHARMA', price: '₹231.5', chg: '+16.6%', hot: true },
            { sym: 'LT', price: '₹3,818', chg: '+4.1%', fired: true },
            { sym: 'SBIN', price: '₹954', chg: '-0.7%', coil: true },
            { sym: 'TRENT', price: '₹2,860', chg: '+1.2%' },
            { sym: 'HAL', price: '₹4,816', chg: '+0.8%' },
            { sym: 'RVNL', price: '₹185', chg: '+3.1%' },
            { sym: 'DIXON', price: '₹11,491', chg: '+2.4%' },
            { sym: 'CDSL', price: '₹1,234', chg: '+1.5%' }
          ].map((item, idx) => (
            <button
              key={idx}
              type="button"
              className="hot-ticker-pill"
              onClick={() => handleSelectStock({ symbol: item.sym, name: item.sym })}
            >
              <span className="font-mono" style={{ fontWeight: 700, color: '#ffffff' }}>{item.sym}</span>
              <span className="font-mono text-xs" style={{ color: item.chg.startsWith('+') ? 'var(--color-buy)' : 'var(--text-tertiary)' }}>{item.chg}</span>
              {item.hot && <span style={{ fontSize: '0.65rem' }}>🔥</span>}
              {item.fired && <span style={{ fontSize: '0.65rem' }}>🚀</span>}
              {item.coil && <span style={{ fontSize: '0.65rem' }}>⏳</span>}
            </button>
          ))}
        </div>

        {error && (
          <p style={{ color: 'var(--color-sell)', marginTop: '0.75rem', fontSize: '0.85rem' }}>{error}</p>
        )}
      </div>

      {/* Bento 4-Tile Market Health Grid */}
      <div className="market-pulse-grid">
        <div className="bento-pulse-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span className="text-xs text-muted" style={{ fontWeight: 600 }}>NIFTY 50 BENCHMARK</span>
            <span className="pulse-dot" style={{ background: (marketRegime?.nifty?.changePercent ?? 0) >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}></span>
          </div>
          <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800 }}>
            ₹{(marketRegime?.nifty?.price || 24324).toLocaleString('en-IN')}{' '}
            <span style={{ fontSize: '0.8rem', color: (marketRegime?.nifty?.changePercent ?? 0) >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
              {(marketRegime?.nifty?.changePercent ?? 0) >= 0 ? '▲ +' : '▼ '}{marketRegime?.nifty?.changePercent ?? 0.45}%
            </span>
          </div>
          <div className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>Above 50 & 200 EMA • Structural Bull Trend</div>
        </div>

        <div className="bento-pulse-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span className="text-xs text-muted" style={{ fontWeight: 600 }}>INDIA VIX VOLATILITY</span>
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', color: 'var(--color-buy)', fontWeight: 700 }}>FAVORABLE</span>
          </div>
          <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: (marketRegime?.vix?.price || 14.15) > 20 ? 'var(--color-sell)' : 'var(--text-primary)' }}>
            {marketRegime?.vix?.price || 14.15}{' '}
            <span style={{ fontSize: '0.8rem', color: 'var(--color-buy)' }}>▼ Low Volatility</span>
          </div>
          <div className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>Sub-18 VIX enables full momentum position sizing</div>
        </div>

        <div className="bento-pulse-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span className="text-xs text-muted" style={{ fontWeight: 600 }}>SWING ENGINE REGIME</span>
            <span className={`badge ${marketRegime?.regime === 'RISK_ON' ? 'badge-strong-buy' : 'badge-hold'}`} style={{ fontSize: '0.65rem' }}>
              {marketRegime?.regime ? marketRegime.regime.replace(/_/g, ' ') : 'RISK ON'}
            </span>
          </div>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.3 }}>
            {marketRegime?.summary || 'Market is in confirmed bull trend. Breakouts and pullback longs fully enabled.'}
          </div>
        </div>

        <div className="bento-pulse-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
            <span className="text-xs text-muted" style={{ fontWeight: 600 }}>DESK RISK ALLOCATION</span>
            <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(6, 182, 212, 0.15)', color: 'var(--accent-cyan)', fontWeight: 700 }}>PORTFOLIO</span>
          </div>
          <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
            {marketRegime?.entriesAllowed ?? 3} Slots Open{' '}
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>• 1.5% Risk</span>
          </div>
          <div className="text-xs text-muted" style={{ marginTop: '0.2rem' }}>Max 5 concurrent swing trades. Trailing ATR stops active.</div>
        </div>
      </div>

      {/* Morning Breakout & Coiled Spring Live Trigger Radar */}
      <div className="glass-card" style={{ marginBottom: '1.75rem', border: '1px solid rgba(6, 182, 212, 0.35)', background: 'linear-gradient(180deg, rgba(6, 182, 212, 0.06) 0%, rgba(15, 23, 42, 0.75) 100%)', boxShadow: '0 8px 32px rgba(6, 182, 212, 0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.6rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.2rem', color: '#ffffff' }}>
              <span>⚡ Morning Breakout Radar</span>
            </h3>
            <span style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.6rem',
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))',
              color: '#c084fc',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              fontWeight: 700
            }}>
              💎 200 UNIVERSE (PRO ACTIVE)
            </span>
            <span style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.6rem',
              borderRadius: '1rem',
              background: morningData?.sessionInfo?.isMarketOpen ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              color: morningData?.sessionInfo?.isMarketOpen ? 'var(--color-buy)' : 'var(--text-tertiary)',
              border: morningData?.sessionInfo?.isMarketOpen ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
              fontWeight: 700,
              letterSpacing: '0.04em'
            }}>
              {morningData?.sessionInfo?.isMarketOpen ? '● LIVE MARKET HOURS' : '🌙 PRE/POST-MARKET'}
            </span>
            {morningData?.sessionInfo?.isMorningHour && (
              <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '1rem', background: 'rgba(245, 158, 11, 0.2)', color: '#f59e0b', fontWeight: 700 }}>
                🔥 9:15-10:30 AM PRIME WINDOW
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              IST: {morningData?.sessionInfo?.istTimeString || 'Syncing...'}
            </span>
            <button
              type="button"
              onClick={refreshMorningTriggers}
              disabled={morningLoading}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid var(--border-secondary)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                fontSize: '0.75rem',
                padding: '0.25rem 0.65rem',
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.2s ease'
              }}
            >
              {morningLoading ? 'Scanning...' : '🔄 Live Refresh'}
            </button>
          </div>
        </div>

        <p className="text-muted text-xs" style={{ margin: '0 0 1rem 0' }}>
          Identifies <strong>Day T-1 Volatility Compression (VCP)</strong> and detects immediate breakout ignition when morning institutional volume surges past the pivot ceiling. Designed to catch fast +10% to +16% single-day moves at ₹202 instead of chasing at ₹231.
        </p>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {[
            { id: 'ALL', label: `All Alerts (${morningData?.allPrioritized?.length || 0})` },
            { id: 'FIRED', label: `🚀 Fired (Buy Zone) (${morningData?.counts?.fired || 0})` },
            { id: 'ARMED', label: `⏳ Coiled Springs (${morningData?.counts?.armed || 0})` },
            { id: 'EXTENDED', label: `⚡ Extended (+10% Hit) (${morningData?.counts?.extended || 0})` },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMorningFilter(tab.id)}
              style={{
                fontSize: '0.72rem',
                padding: '0.25rem 0.75rem',
                borderRadius: '1rem',
                border: morningFilter === tab.id ? '1px solid var(--accent-cyan)' : '1px solid var(--border-secondary)',
                cursor: 'pointer',
                background: morningFilter === tab.id ? 'rgba(6, 182, 212, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                color: morningFilter === tab.id ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: morningFilter === tab.id ? 700 : 500,
                transition: 'all 0.2s ease'
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Dynamic Card Display */}
        {!morningData ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ width: '28px', height: '28px', margin: '0 auto 0.5rem auto' }}></div>
            <p className="text-xs">Scanning 45+ multi-cap stocks for morning breakout pivots & volume spikes...</p>
          </div>
        ) : (() => {
          let list = [];
          if (morningFilter === 'ALL') list = morningData.allPrioritized || [];
          else if (morningFilter === 'FIRED') list = morningData.fired || [];
          else if (morningFilter === 'ARMED') list = morningData.armed || [];
          else if (morningFilter === 'EXTENDED') list = morningData.extended || [];

          if (list.length === 0) {
            return (
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                <p className="text-muted text-xs" style={{ margin: 0 }}>
                  {morningFilter === 'FIRED'
                    ? 'No stocks are currently in the immediate 0-4.5% Breakout Buy Zone with >1.6x volume pace. Check Armed Coiled Springs below.'
                    : morningFilter === 'ARMED'
                    ? 'No coiled spring setups within 3.5% of pivot right now.'
                    : 'No setups matching this filter.'}
                </p>
              </div>
            );
          }

          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: '0.85rem' }}>
              {list.slice(0, 8).map((stock, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelectStock({ symbol: stock.symbol, name: stock.name })}
                  style={{
                    background: stock.status === 'FIRED' 
                      ? 'rgba(16, 185, 129, 0.08)' 
                      : stock.status === 'EXTENDED'
                      ? 'rgba(245, 158, 11, 0.05)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: stock.status === 'FIRED' 
                      ? '1px solid rgba(16, 185, 129, 0.4)' 
                      : stock.status === 'EXTENDED'
                      ? '1px solid rgba(245, 158, 11, 0.3)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-cyan)'}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = stock.status === 'FIRED' 
                      ? 'rgba(16, 185, 129, 0.4)' 
                      : stock.status === 'EXTENDED'
                      ? 'rgba(245, 158, 11, 0.3)'
                      : 'rgba(255, 255, 255, 0.08)';
                  }}
                >
                  {/* Top: Header & Status Badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontWeight: 800, fontSize: '1rem', color: '#ffffff' }}>{stock.symbol}</span>
                        <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-tertiary)' }}>
                          {stock.cap === 'LARGE_CAP' ? 'Large' : stock.cap === 'MID_CAP' ? 'Mid' : 'Small'}
                        </span>
                      </div>
                      <div className="text-xs text-muted" style={{ marginTop: '0.1rem' }}>{stock.sector}</div>
                    </div>
                    <span className={`badge ${stock.badgeClass}`} style={{ fontSize: '0.65rem', padding: '0.2rem 0.5rem' }}>
                      {stock.statusLabel}
                    </span>
                  </div>

                  {/* Middle: Metrics Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', background: 'rgba(0, 0, 0, 0.25)', padding: '0.5rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.5rem' }}>
                    <div>
                      <div className="text-xs text-muted">Price</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                        ₹{stock.currentPrice}{' '}
                        <span style={{ fontSize: '0.7rem', color: stock.changePercent >= 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                          {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent}%
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Pivot Roof</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>₹{stock.pivot}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Distance</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: stock.distFromPivotPct >= 0 ? (stock.distFromPivotPct > 4.5 ? 'var(--color-hold)' : 'var(--color-buy)') : 'var(--text-secondary)' }}>
                        {stock.distFromPivotPct >= 0 ? `+${stock.distFromPivotPct}%` : `${stock.distFromPivotPct}%`}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Vol Pace</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: stock.volPaceRatio >= 2 ? 'var(--color-buy)' : 'var(--text-primary)' }}>
                        {stock.volPaceRatio}x
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">BB Squeeze</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: stock.bbWidth <= 15 ? 'var(--accent-cyan)' : 'var(--text-primary)' }}>
                        {stock.bbWidth}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Target 1 (+10%)</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-buy)' }}>₹{stock.target1}</div>
                    </div>
                  </div>

                  {/* Playbook Action Guidance */}
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {stock.actionText}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Dashboard Grid */}
      <div className="dashboard-grid">
        {/* Recent Analyses */}
        <div className="glass-card">
          <h3 style={{ marginBottom: '1rem' }}>📋 Recent Analyses</h3>
          {recentAnalyses.length === 0 ? (
            <p className="text-muted text-sm">No analyses yet. Search for a stock above to get started!</p>
          ) : (
            recentAnalyses.map((r, i) => (
              <div
                key={i}
                className="search-result-item"
                style={{ cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
                onClick={() => handleSelectStock({ symbol: r.symbol, name: r.name })}
              >
                <div>
                  <div className="search-result-symbol">{r.symbol}</div>
                  <div className="search-result-name">{r.name}</div>
                </div>
                {r.verdict && (
                  <span className={`badge badge-${r.verdict.toLowerCase().replace(/_/g, '-')}`}>
                    {r.verdict.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Swing Radar */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>🎯 Swing Radar V2</span>
              <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(168, 85, 247, 0.15)', color: '#c084fc', fontWeight: 600 }}>200 STOCKS</span>
            </h3>
            {swingPicks?.scannedAt && (
              <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>
                {new Date(swingPicks.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          {/* Market Cap & Velocity Filter Tabs */}
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { id: 'ALL', label: 'All' },
              { id: 'HIGH_VELOCITY', label: '⚡ 10%+ Velocity' },
              { id: 'MID_CAP', label: '🚀 Mid Cap' },
              { id: 'SMALL_CAP', label: '🔥 High-Beta' },
              { id: 'LARGE_CAP', label: '💎 Large Cap' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCapFilter(tab.id)}
                style={{
                  fontSize: '0.7rem',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '1rem',
                  border: '1px solid var(--border-secondary)',
                  cursor: 'pointer',
                  background: capFilter === tab.id ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.04)',
                  color: capFilter === tab.id ? '#ffffff' : 'var(--text-secondary)',
                  fontWeight: capFilter === tab.id ? 700 : 500,
                  transition: 'all 0.2s ease'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {!swingPicks ? (
            <p className="text-muted text-sm">Scanning 200 multi-cap stocks for swing setups...</p>
          ) : (() => {
            const sourceList = (swingPicks.topLongs?.length > 0) ? swingPicks.topLongs : (swingPicks.setups || []);
            const filtered = sourceList.filter(pick => {
              if (capFilter === 'HIGH_VELOCITY') {
                return pick.setup === 'HIGH_VELOCITY_BREAKOUT' || (pick.expectedReturnT1Pct >= 9.5);
              }
              if (capFilter === 'ALL') return true;
              return pick.cap === capFilter;
            });

            if (filtered.length === 0) {
              return (
                <div style={{ padding: '1.25rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-sm)', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', marginBottom: '0.4rem' }}>🛡️</div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#ffffff', marginBottom: '0.2rem' }}>
                    {capFilter === 'HIGH_VELOCITY' ? 'Coil Phase Active' : 'Defensive Cash Protection'}
                  </div>
                  <p className="text-muted text-xs" style={{ margin: 0, lineHeight: 1.4 }}>
                    {capFilter === 'HIGH_VELOCITY'
                      ? 'No stocks currently meet the strict 10%+ volatility squeeze filter. Use the Morning Breakout Radar above for live pivot triggers.'
                      : 'No setups satisfy the 6-factor confluence filter today. Preserving capital is part of quant discipline.'}
                  </p>
                </div>
              );
            }

            return filtered.slice(0, 8).map((pick, i) => (
              <div
                key={i}
                className="search-result-item"
                style={{
                  cursor: 'pointer',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: `3px solid ${pick.setup === 'HIGH_VELOCITY_BREAKOUT' ? 'var(--accent-cyan)' : pick.tradeWorthy ? 'var(--color-buy)' : 'rgba(255,255,255,0.15)'}`,
                  background: 'rgba(255, 255, 255, 0.02)',
                  marginBottom: '0.5rem',
                  padding: '0.85rem 1rem',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => handleSelectStock({ symbol: pick.symbol, name: pick.name })}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className="font-mono" style={{ fontWeight: 800, fontSize: '0.95rem', color: '#ffffff' }}>{pick.symbol}</span>
                      <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.45rem', borderRadius: '4px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                        {pick.cap === 'LARGE_CAP' ? 'Large' : pick.cap === 'MID_CAP' ? 'Mid' : 'Small'}
                      </span>
                      {pick.sector && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>
                          • {pick.sector}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {(pick.expectedReturnT1Pct >= 9.5 || pick.setup === 'HIGH_VELOCITY_BREAKOUT') && (
                        <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: '4px', background: 'rgba(6, 182, 212, 0.18)', color: 'var(--accent-cyan)', fontWeight: 800, border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                          ⚡ 10%+ VELOCITY
                        </span>
                      )}
                      <span className="badge badge-neutral font-mono" style={{ fontSize: '0.7rem' }}>
                        Score {pick.qualityScore}/100
                      </span>
                    </div>
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: '0.35rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{pick.setup?.replace(/_/g, ' ')} • <strong className="font-mono" style={{ color: '#ffffff' }}>₹{pick.price}</strong></span>
                    {pick.t1 && (
                      <span className="font-mono" style={{ color: 'var(--color-buy)', fontWeight: 700 }}>
                        Target: ₹{pick.t1} {pick.expectedReturnT1Pct ? `(+${Math.round(pick.expectedReturnT1Pct)}%)` : ''}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ));
          })()}
        </div>

        {/* Right Column: Intelligence & Quant Edge */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Quant Engine v2 Research Edge Card */}
          {backtestStats && (
            <div className="glass-card" style={{ border: '1px solid rgba(99, 102, 241, 0.25)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>⚡ Quant Engine Edge</span>
                </h3>
                <span className="badge badge-strong-buy" style={{ fontSize: '0.65rem' }}>VERIFIED</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="text-xs text-muted">Win Rate</div>
                  <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-buy)' }}>{backtestStats.winRate}%</div>
                </div>
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="text-xs text-muted">Profit Factor</div>
                  <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: '#ffffff' }}>{backtestStats.profitFactor}</div>
                </div>
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="text-xs text-muted">Max Drawdown</div>
                  <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-sell)' }}>{backtestStats.maxDrawdownPct}%</div>
                </div>
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="text-xs text-muted">Verified Trades</div>
                  <div className="font-mono" style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>{backtestStats.totalTrades}</div>
                </div>
              </div>
              <p className="text-xs text-muted" style={{ margin: 0, fontSize: '0.7rem' }}>
                Event-driven execution modeling 0.15% slippage, delivery STT (0.1%), and ATR stops.
              </p>
            </div>
          )}

          {/* Market News */}
          <div className="glass-card">
            <h3 style={{ marginBottom: '0.85rem', fontSize: '0.95rem', fontWeight: 800, color: '#ffffff' }}>📰 Live Market Wire</h3>
            {marketNews.length === 0 ? (
              <p className="text-muted text-xs">Loading live financial news...</p>
            ) : (
              marketNews.slice(0, 5).map((news, i) => (
                <div key={i} className="news-item" style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div>
                    <a href={news.link} target="_blank" rel="noopener noreferrer" className="news-item-title" style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                      {news.title}
                    </a>
                    <div className="news-item-meta" style={{ fontSize: '0.68rem', marginTop: '0.2rem' }}>
                      {news.source} • {news.pubDate ? new Date(news.pubDate).toLocaleDateString('en-IN') : 'Recent'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Recent Analyses */}
          <div className="glass-card">
            <h3 style={{ marginBottom: '0.85rem', fontSize: '0.95rem', fontWeight: 800, color: '#ffffff' }}>📋 Recent Analyses</h3>
            {recentAnalyses.length === 0 ? (
              <p className="text-muted text-xs">No recent analyses. Search any stock above to begin.</p>
            ) : (
              recentAnalyses.slice(0, 4).map((r, i) => (
                <div
                  key={i}
                  className="search-result-item"
                  style={{ cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '0.45rem 0.65rem', marginBottom: '0.35rem' }}
                  onClick={() => handleSelectStock({ symbol: r.symbol, name: r.name })}
                >
                  <div>
                    <div className="font-mono" style={{ fontWeight: 700, fontSize: '0.85rem', color: '#ffffff' }}>{r.symbol}</div>
                    <div className="text-xs text-muted">{r.name}</div>
                  </div>
                  {r.verdict && (
                    <span className={`badge badge-${r.verdict.toLowerCase().replace(/_/g, '-')}`} style={{ fontSize: '0.65rem' }}>
                      {r.verdict.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Professional Terminal Footer */}
      <footer style={{ marginTop: '3.5rem', padding: '1.75rem 0', borderTop: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-cyan)' }}></div>
          <span style={{ fontWeight: 800, fontSize: '0.9rem', color: '#ffffff' }}>StockSage Pro</span>
          <span className="text-xs text-muted">• Institutional Quant & Swing Trading Engine • v2.4</span>
        </div>
        <div className="text-xs text-muted" style={{ maxWidth: '600px', textAlign: 'right', lineHeight: 1.4 }}>
          ⚠️ Algorithmic research & quantitative setups for Indian equities (NSE/BSE). Not SEBI-registered investment advice. Always verify with your financial advisor.
        </div>
      </footer>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}
