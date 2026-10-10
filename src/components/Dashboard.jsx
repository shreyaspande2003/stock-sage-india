import React, { useState, useEffect, useRef } from 'react';
import { searchStocks, analyzeStock, fetchStockData, getMarketNews, initAI, getAIStatus, scanSwingSetups } from '../api.js';

export default function Dashboard({ onAnalyze, settings, isAIReady, setIsAIReady }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStages, setAnalyzeStages] = useState([]);
  const [marketNews, setMarketNews] = useState([]);
  const [swingPicks, setSwingPicks] = useState(null);
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

  // Fetch market news and swing scan on mount
  useEffect(() => {
    getMarketNews().then(data => setMarketNews(data.news || [])).catch(() => {});
    scanSwingSetups().then(data => setSwingPicks(data)).catch(() => {});
  }, []);

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
      <div className="disclaimer-banner">
        ⚠️ <span>Disclaimer: This tool is for educational purposes only. AI-generated analysis should not be the sole basis for investment decisions. Always do your own research.</span>
      </div>

      <div className="dashboard-header">
        <h1>Good {getGreeting()}, Trader! 👋</h1>
        <p>Search for any NSE/BSE stock to get a comprehensive AI-powered expert analysis</p>
      </div>

      {/* Search */}
      <div className="search-section" ref={searchRef}>
        <div className="search-container">
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            placeholder="Search stock... e.g. RELIANCE, TCS, HDFC, INFY"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleQuickAnalyze();
            }}
            id="stock-search"
          />
          {showResults && results.length > 0 && (
            <div className="search-results">
              {results.map((stock, i) => (
                <div key={i} className="search-result-item" onClick={() => handleSelectStock(stock)}>
                  <div>
                    <div className="search-result-symbol">{stock.symbol}</div>
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
                  <div className="search-result-symbol">Analyze "{query.toUpperCase()}"</div>
                  <div className="search-result-name">Press Enter or click to analyze directly</div>
                </div>
              </div>
            </div>
          )}
        </div>
        {error && (
          <p style={{ color: 'var(--color-sell)', marginTop: '0.75rem', fontSize: '0.9rem' }}>{error}</p>
        )}
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
          <h3 style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>🎯 Swing Radar</span>
            {swingPicks?.scannedAt && (
              <span className="text-muted" style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>
                {new Date(swingPicks.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </h3>
          {!swingPicks ? (
            <p className="text-muted text-sm">Scanning universe for setups...</p>
          ) : swingPicks.topLongs?.length === 0 ? (
            <p className="text-muted text-sm">No high-quality setups found today. Cash is a position.</p>
          ) : (
            swingPicks.topLongs.map((pick, i) => (
              <div
                key={i}
                className="search-result-item"
                style={{ cursor: 'pointer', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-buy)' }}
                onClick={() => handleSelectStock({ symbol: pick.symbol, name: pick.name })}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="search-result-symbol">{pick.symbol}</div>
                    <div className="text-xs" style={{ color: 'var(--color-buy)' }}>Tgt: ₹{pick.t1}</div>
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                    {pick.setup.replace(/_/g, ' ')} • R/R: {pick.riskRewardT1}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Market News */}
        <div className="glass-card">
          <h3 style={{ marginBottom: '1rem' }}>📰 Market News</h3>
          {marketNews.length === 0 ? (
            <p className="text-muted text-sm">Loading market news...</p>
          ) : (
            marketNews.slice(0, 6).map((news, i) => (
              <div key={i} className="news-item">
                <div>
                  <a href={news.link} target="_blank" rel="noopener noreferrer" className="news-item-title">
                    {news.title}
                  </a>
                  <div className="news-item-meta">
                    {news.source} • {news.pubDate ? new Date(news.pubDate).toLocaleDateString('en-IN') : 'Recent'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Quick Stats / How It Works */}
        <div className="glass-card dashboard-grid-full">
          <h3 style={{ marginBottom: '1rem' }}>🧠 How StockSage Works</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
            {[
              { icon: '📊', title: 'Data Collection', desc: 'Price, volume, OHLCV from Yahoo Finance' },
              { icon: '📈', title: 'Technical Analysis', desc: 'RSI, MACD, EMA, Bollinger, ADX, Support/Resistance' },
              { icon: '📰', title: 'News & Sentiment', desc: 'Google News, Reddit, social buzz analysis' },
              { icon: '🛡️', title: 'Risk Assessment', desc: 'Risk-reward ratio, position sizing, stop-loss' },
              { icon: '⚖️', title: 'Final Verdict', desc: 'Buy/Sell/Hold with entry, target, stop-loss' },
            ].map((step, i) => (
              <div key={i} style={{ textAlign: 'center', padding: '0.5rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{step.icon}</div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>{step.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!isAIReady && (
        <div className="glass-card" style={{ marginTop: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.3)' }}>
          <h3>🔑 Setup Required</h3>
          <p className="text-muted" style={{ marginTop: '0.5rem' }}>
            Go to <strong>Settings</strong> to add your OpenRouter API key before analyzing stocks.
            Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.
          </p>
        </div>
      )}
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Evening';
}
