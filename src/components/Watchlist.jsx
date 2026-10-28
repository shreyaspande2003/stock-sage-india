import React, { useState, useEffect, useRef } from 'react';
import { searchStocks, getQuote, analyzeStock, initAI } from '../api.js';

export default function Watchlist({ onAnalyze, settings, isAIReady, setIsAIReady }) {
  const [watchlist, setWatchlist] = useState(() => {
    const saved = localStorage.getItem('stocksage_watchlist');
    return saved ? JSON.parse(saved) : [];
  });
  const [liveData, setLiveData] = useState({});
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [analyzing, setAnalyzing] = useState('');
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('change'); // change, name, signal
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  // Persist watchlist
  useEffect(() => {
    localStorage.setItem('stocksage_watchlist', JSON.stringify(watchlist));
  }, [watchlist]);

  // Fetch live data on mount and periodically
  useEffect(() => {
    if (watchlist.length > 0) refreshPrices();
    const interval = setInterval(() => {
      if (watchlist.length > 0) refreshPrices();
    }, 5 * 60 * 1000); // Refresh every 5 min
    return () => clearInterval(interval);
  }, [watchlist.length]);

  // Click outside to close search
  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const refreshPrices = async () => {
    setRefreshing(true);
    const newData = { ...liveData };
    // Batch fetch with small delays to respect rate limits
    for (const item of watchlist) {
      try {
        const res = await getQuote(item.symbol);
        newData[item.symbol] = res.quote || res;
      } catch (err) {
        console.error(`Quote error for ${item.symbol}:`, err.message);
      }
    }
    setLiveData(newData);
    setRefreshing(false);
  };

  const handleSearch = (value) => {
    setQuery(value);
    setError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 1) { setResults([]); setShowResults(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchStocks(value);
        setResults(data.results || []);
        setShowResults(true);
      } catch (err) { console.error('Search error:', err); }
      setLoading(false);
    }, 300);
  };

  const addToWatchlist = (stock) => {
    const symbol = stock.symbol?.replace('.NS', '').replace('.BO', '') || stock.symbol;
    if (watchlist.find(w => w.symbol === symbol)) {
      setError(`${symbol} is already in your watchlist`);
      return;
    }
    setWatchlist(prev => [...prev, {
      symbol,
      name: stock.name || symbol,
      addedAt: new Date().toISOString(),
    }]);
    setQuery('');
    setShowResults(false);
    setError('');
  };

  const removeFromWatchlist = (symbol) => {
    setWatchlist(prev => prev.filter(w => w.symbol !== symbol));
    setLiveData(prev => { const n = { ...prev }; delete n[symbol]; return n; });
  };

  const handleAnalyze = async (symbol) => {
    setAnalyzing(symbol);
    setError('');
    try {
      if (settings.geminiKey && !isAIReady) {
        try {
          await initAI(settings.geminiKey, settings.useProModel);
          setIsAIReady(true);
        } catch (e) {
          console.warn('AI init notice:', e.message);
        }
      }
      const data = await analyzeStock(symbol, settings.newsApiKey);
      setAnalyzing('');
      onAnalyze(data);
    } catch (err) {
      setAnalyzing('');
      setError(err.message || 'Analysis failed');
    }
  };

  // Quick signal assessment from live data
  const getQuickSignal = (quote) => {
    if (!quote) return { signal: '—', color: 'var(--text-tertiary)', reason: 'Loading...' };
    const change = quote.changePercent || 0;
    const nearHigh = quote.fiftyTwoWeekHigh ? (quote.price / quote.fiftyTwoWeekHigh) : 0;
    const nearLow = quote.fiftyTwoWeekLow ? (quote.price / quote.fiftyTwoWeekLow) : 0;
    const above50DMA = quote.fiftyDayAvg ? quote.price > quote.fiftyDayAvg : null;
    const above200DMA = quote.twoHundredDayAvg ? quote.price > quote.twoHundredDayAvg : null;

    // Simple signal logic from available data
    if (nearLow < 1.05 && above200DMA === false) {
      return { signal: '🔴 Near 52W Low', color: 'var(--color-sell)', reason: 'Trading near 52-week low, weak momentum' };
    }
    if (nearHigh > 0.95) {
      return { signal: '🟡 Near 52W High', color: 'var(--color-hold)', reason: 'Near 52-week high, potential breakout or resistance' };
    }
    if (above50DMA && above200DMA) {
      return { signal: '🟢 Bullish', color: 'var(--color-buy)', reason: 'Above 50 & 200 DMA, uptrend intact' };
    }
    if (above50DMA === false && above200DMA === false) {
      return { signal: '🔴 Bearish', color: 'var(--color-sell)', reason: 'Below 50 & 200 DMA, downtrend' };
    }
    if (change > 2) {
      return { signal: '🟢 Momentum', color: 'var(--color-buy)', reason: `+${change.toFixed(1)}% today, strong buying` };
    }
    if (change < -2) {
      return { signal: '🔴 Selling', color: 'var(--color-sell)', reason: `${change.toFixed(1)}% today, selling pressure` };
    }
    return { signal: '⚪ Neutral', color: 'var(--text-secondary)', reason: 'No strong signal, consolidating' };
  };

  const formatPrice = (p) => p ? `₹${Number(p).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—';

  // Sort watchlist items
  const sortedWatchlist = [...watchlist].sort((a, b) => {
    const qA = liveData[a.symbol];
    const qB = liveData[b.symbol];
    if (sortBy === 'change') {
      return (qB?.changePercent || 0) - (qA?.changePercent || 0);
    }
    if (sortBy === 'name') return a.symbol.localeCompare(b.symbol);
    return 0;
  });

  return (
    <div className="fade-in-up">
      <div className="dashboard-header">
        <h1>👁️ Watchlist Scanner</h1>
        <p>Track stocks, spot opportunities, and trigger deep analysis when signals align</p>
      </div>

      {/* Add Stock Search */}
      <div className="search-section" ref={searchRef} style={{ marginBottom: '1.5rem' }}>
        <div className="search-container" style={{ maxWidth: '500px' }}>
          <span className="search-icon">🔍</span>
          <input
            className="search-input"
            placeholder="Add stock to watchlist... e.g. RELIANCE, TCS"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) {
                addToWatchlist({ symbol: query.trim().toUpperCase(), name: query.trim().toUpperCase() });
              }
            }}
            id="watchlist-search"
          />
          {showResults && results.length > 0 && (
            <div className="search-results">
              {results.map((stock, i) => (
                <div key={i} className="search-result-item" onClick={() => addToWatchlist(stock)}>
                  <div>
                    <div className="search-result-symbol">{stock.symbol}</div>
                    <div className="search-result-name">{stock.name}</div>
                  </div>
                  <span className="search-result-exchange">{stock.exchange}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p style={{ color: 'var(--color-sell)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</p>}

      {/* Watchlist Controls */}
      {watchlist.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span className="text-xs text-muted font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {watchlist.length} stocks tracked
            </span>
            {refreshing && <span className="text-xs" style={{ color: 'var(--accent-cyan)' }}>⟳ Refreshing...</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={refreshPrices} disabled={refreshing}>
              🔄 Refresh Prices
            </button>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '0.375rem 0.75rem', fontSize: '0.8rem' }}
            >
              <option value="change">Sort by Change %</option>
              <option value="name">Sort by Name</option>
            </select>
          </div>
        </div>
      )}

      {/* Watchlist Grid */}
      {watchlist.length === 0 ? (
        <div className="glass-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>👁️</div>
          <h3>Your watchlist is empty</h3>
          <p className="text-muted" style={{ marginTop: '0.5rem' }}>
            Search and add stocks above to start tracking them. You'll see live prices, quick signals, and can trigger deep AI analysis with one click.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
          {sortedWatchlist.map(item => {
            const quote = liveData[item.symbol];
            const quickSignal = getQuickSignal(quote);
            const changeUp = (quote?.changePercent || 0) >= 0;

            return (
              <div key={item.symbol} className="glass-card" style={{ padding: '1.25rem', position: 'relative' }}>
                {/* Remove button */}
                <button
                  onClick={() => removeFromWatchlist(item.symbol)}
                  className="btn btn-ghost"
                  style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', padding: '0.25rem', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}
                  title="Remove from watchlist"
                >✕</button>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{item.symbol}</div>
                    <div className="text-xs text-muted truncate" style={{ maxWidth: '180px' }}>{item.name}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatPrice(quote?.price)}</div>
                    <div className={`text-xs font-semibold ${changeUp ? 'change-positive' : 'change-negative'}`}>
                      {changeUp ? '▲' : '▼'} {quote?.changePercent?.toFixed(2) || '0.00'}%
                    </div>
                  </div>
                </div>

                {/* Quick Signal */}
                <div style={{
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-secondary)',
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: quickSignal.color }}>{quickSignal.signal}</span>
                    {quote?.volume && quote?.avgVolume && (
                      <span className="text-xs text-muted">
                        Vol: {(quote.volume / quote.avgVolume).toFixed(1)}x avg
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>{quickSignal.reason}</div>
                </div>

                {/* Key Levels */}
                {quote && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <span className="text-muted">50 DMA: </span>
                      <span className={quote.price > quote.fiftyDayAvg ? 'change-positive' : 'change-negative'} style={{ fontWeight: 600 }}>
                        {formatPrice(quote.fiftyDayAvg)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">200 DMA: </span>
                      <span className={quote.price > quote.twoHundredDayAvg ? 'change-positive' : 'change-negative'} style={{ fontWeight: 600 }}>
                        {formatPrice(quote.twoHundredDayAvg)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">52W Low: </span>
                      <span style={{ fontWeight: 600 }}>{formatPrice(quote.fiftyTwoWeekLow)}</span>
                    </div>
                    <div>
                      <span className="text-muted">52W High: </span>
                      <span style={{ fontWeight: 600 }}>{formatPrice(quote.fiftyTwoWeekHigh)}</span>
                    </div>
                  </div>
                )}

                {/* Action */}
                <button
                  className="btn btn-primary btn-sm w-full"
                  onClick={() => handleAnalyze(item.symbol)}
                  disabled={!!analyzing || !isAIReady}
                  style={{ justifyContent: 'center' }}
                >
                  {analyzing === item.symbol ? '⏳ Analyzing...' : '🧠 Deep AI Analysis'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
