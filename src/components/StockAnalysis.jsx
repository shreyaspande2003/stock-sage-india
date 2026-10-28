import React, { useState, useEffect, useRef } from 'react';

export default function StockAnalysis({ data: initialData, onBack, settings, isAIReady, setIsAIReady }) {
  const chartRef = useRef(null);
  const [holding, setHolding] = useState(null);
  const [expandedExpert, setExpandedExpert] = useState(null);
  const [data, setData] = useState(initialData);
  const [aiLoading, setAiLoading] = useState(!initialData.expertAnalysis);
  const [aiError, setAiError] = useState(null);

  // Fetch AI analysis if it wasn't provided yet
  useEffect(() => {
    if (!initialData.expertAnalysis && isAIReady) {
      import('../api.js').then(({ analyzeStock }) => {
        setAiLoading(true);
        analyzeStock(initialData.symbol, settings.newsApiKey)
          .then(fullData => {
            setData(fullData);
            setAiLoading(false);
          })
          .catch(err => {
            console.error(err);
            setAiError(err.message || 'Failed to fetch AI analysis');
            setAiLoading(false);
          });
      });
    }
  }, [initialData.symbol, initialData.expertAnalysis, isAIReady, settings.newsApiKey]);

  // Check if stock is in portfolio
  useEffect(() => {
    try {
      const p = localStorage.getItem('portfolio');
      if (p) {
        const parsed = JSON.parse(p);
        const match = parsed?.holdings?.find(h => h.symbol === data?.symbol || h.symbol === data?.quote?.symbol);
        if (match) setHolding(match);
      }
    } catch(e) {}
  }, [data]);

  // Initialize chart — compatible with lightweight-charts v5
  useEffect(() => {
    if (!data?.chartData?.length || !chartRef.current) return;
    
    let chart = null;
    let isMounted = true;
    let resizeObserver = null;

    async function initChart() {
      try {
        const lwc = await import('lightweight-charts');
        if (!isMounted) return;

        chart = lwc.createChart(chartRef.current, {
          layout: { background: { color: 'transparent' }, textColor: '#9ca3af', fontSize: 12, fontFamily: "'Plus Jakarta Sans', sans-serif" },
          grid: { vertLines: { color: 'rgba(255, 255, 255, 0.03)' }, horzLines: { color: 'rgba(255, 255, 255, 0.03)' } },
          crosshair: { mode: 0, vertLine: { color: 'rgba(6, 182, 212, 0.5)', width: 1, style: 2 }, horzLine: { color: 'rgba(6, 182, 212, 0.5)', width: 1, style: 2 } },
          rightPriceScale: { borderColor: 'rgba(255, 255, 255, 0.08)' },
          timeScale: { borderColor: 'rgba(255, 255, 255, 0.08)', timeVisible: false },
          width: chartRef.current.clientWidth,
          height: 380,
        });

        let candleSeries;
        if (typeof chart.addCandlestickSeries === 'function') {
          candleSeries = chart.addCandlestickSeries({
            upColor: '#10b981', downColor: '#ef4444', borderDownColor: '#ef4444', borderUpColor: '#10b981', wickDownColor: '#ef4444', wickUpColor: '#10b981',
          });
        } else if (lwc.CandlestickSeries) {
          candleSeries = chart.addSeries(lwc.CandlestickSeries, {
            upColor: '#10b981', downColor: '#ef4444', borderDownColor: '#ef4444', borderUpColor: '#10b981', wickDownColor: '#ef4444', wickUpColor: '#10b981',
          });
        } else {
          candleSeries = chart.addSeries(lwc.LineSeries || lwc.LineSeriesDefinition, { color: '#6366f1' });
        }
        
        const formattedData = data.chartData.map(d => ({
          time: d.date || d.time,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close
        })).sort((a, b) => new Date(a.time) - new Date(b.time));

        candleSeries.setData(formattedData);

        let volumeSeries;
        if (typeof chart.addHistogramSeries === 'function') {
          volumeSeries = chart.addHistogramSeries({
            color: 'rgba(99, 102, 241, 0.3)',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
          });
        } else if (lwc.HistogramSeries) {
          volumeSeries = chart.addSeries(lwc.HistogramSeries, {
            color: 'rgba(99, 102, 241, 0.3)',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
          });
        }
        
        if (volumeSeries) {
          chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          const volumeData = data.chartData.map(d => ({
            time: d.date || d.time,
            value: d.volume || 0,
            color: d.close >= d.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'
          })).sort((a, b) => new Date(a.time) - new Date(b.time));
          volumeSeries.setData(volumeData);
        }

        chart.timeScale().fitContent();

        resizeObserver = new ResizeObserver(() => {
          if (chartRef.current && chart) chart.applyOptions({ width: chartRef.current.clientWidth });
        });
        resizeObserver.observe(chartRef.current);
      } catch (err) {
        console.error('Chart init error:', err);
      }
    }
    initChart();
    
    return () => { 
      isMounted = false;
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) {
        chart.remove(); 
      } else if (chartRef.current) {
        chartRef.current.innerHTML = '';
      }
    };
  }, [data?.chartData]);

  if (!data) {
    return (
      <div className="loading-overlay">
        <p className="text-muted">No analysis data. Go back and search for a stock.</p>
        <button className="btn btn-primary" onClick={onBack}>← Back to Dashboard</button>
      </div>
    );
  }

  const { quote, technicals, expertAnalysis } = data;
  const chief = expertAnalysis?.chiefStrategist;
  const techAgent = expertAnalysis?.technicalAnalyst;
  const fundAgent = expertAnalysis?.fundamentalAnalyst;
  const riskAgent = expertAnalysis?.riskManager;
  const sentimentAgent = expertAnalysis?.sentimentAnalyst;
  const hasAI = chief && !chief.error;

  const getVerdictClass = (verdict) => {
    if (!verdict) return '';
    const v = verdict.toLowerCase().replace(/_/g, '-');
    if (['strong-buy', 'buy', 'accumulate', 'bullish', 'positive', 'approve'].includes(v)) return 'badge-buy';
    if (['strong-sell', 'sell', 'reduce', 'bearish', 'negative', 'reject'].includes(v)) return 'badge-sell';
    if (['hold', 'wait', 'neutral', 'mixed', 'cautious', 'approve-with-caution', 'reduce-size'].includes(v)) return 'badge-hold';
    return 'badge-neutral';
  };

  const getVerdictColor = (verdict) => {
    if (!verdict) return 'var(--text-tertiary)';
    const v = verdict.toLowerCase().replace(/_/g, '-');
    if (['strong-buy', 'buy', 'accumulate'].includes(v)) return 'var(--color-buy)';
    if (['strong-sell', 'sell', 'reduce'].includes(v)) return 'var(--color-sell)';
    if (['hold', 'wait'].includes(v)) return 'var(--color-hold)';
    return 'var(--text-tertiary)';
  };

  const getVerdictEmoji = (verdict) => {
    if (!verdict) return '⏳';
    const v = verdict.toLowerCase().replace(/_/g, ' ');
    if (v.includes('strong buy')) return '🚀';
    if (v.includes('buy') || v.includes('accumulate')) return '✅';
    if (v.includes('strong sell')) return '🔴';
    if (v.includes('sell') || v.includes('reduce')) return '⛔';
    if (v.includes('hold') || v.includes('wait')) return '⏸️';
    if (v.includes('avoid')) return '🚫';
    return '📊';
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return 'N/A';
    return `₹${Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };

  const formatLargeNumber = (num) => {
    if (!num) return 'N/A';
    if (num >= 1e12) return `₹${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e7) return `₹${(num / 1e7).toFixed(2)}Cr`;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const calcReturn = (entry, target) => {
    if (!entry || !target) return null;
    return ((target - entry) / entry * 100).toFixed(1);
  };

  // Confidence gauge
  const ConfidenceGauge = ({ score }) => {
    const pct = (score || 0) * 10;
    const color = pct >= 70 ? 'var(--color-buy)' : pct >= 40 ? 'var(--color-hold)' : 'var(--color-sell)';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ width: '80px', height: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease' }} />
        </div>
        <span style={{ fontWeight: 700, color, fontSize: '0.9rem' }}>{score}/10</span>
      </div>
    );
  };

  // Risk meter visual
  const RiskMeter = ({ level }) => {
    const levels = { LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 };
    const active = levels[level] || 0;
    const colors = ['var(--color-buy)', 'var(--color-hold)', '#f97316', 'var(--color-sell)'];
    return (
      <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-end' }}>
        {[1,2,3,4].map(i => (
          <div key={i} style={{
            width: '12px', height: `${10 + i * 6}px`,
            borderRadius: '3px',
            background: i <= active ? colors[active - 1] : 'var(--bg-tertiary)',
            transition: 'all 0.3s ease',
          }} />
        ))}
        <span style={{ marginLeft: '6px', fontSize: '0.75rem', fontWeight: 600, color: active > 0 ? colors[active-1] : 'var(--text-tertiary)' }}>
          {level?.replace(/_/g, ' ') || 'N/A'}
        </span>
      </div>
    );
  };

  const expertPanels = [
    { key: 'technical', name: '📈 Technical Analyst', agent: techAgent, color: '#3b82f6' },
    { key: 'fundamental', name: '📊 Fundamental Analyst', agent: fundAgent, color: '#10b981' },
    { key: 'sentiment', name: '📰 Sentiment Analyst', agent: sentimentAgent, color: '#f59e0b' },
    { key: 'risk', name: '🛡️ Risk Manager', agent: riskAgent, color: '#ef4444' },
  ];

  return (
    <div className="fade-in-up" style={{ maxWidth: '1280px', margin: '0 auto' }}>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: '1rem' }}>← Back to Dashboard</button>

      {/* ═══════ HERO: Stock Name + Price ═══════ */}
      <div style={{ marginBottom: '1.5rem', background: 'var(--bg-secondary)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-primary)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${getVerdictColor(chief?.overallVerdict)}, var(--accent-cyan))` }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.25rem', marginBottom: '0.25rem' }}>{quote?.name || data.symbol}</h1>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{data.symbol} • {quote?.sector !== 'N/A' ? quote?.sector : quote?.exchange || 'NSE'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '2.75rem', fontWeight: '800', lineHeight: 1, fontFamily: "'JetBrains Mono', monospace" }}>{formatPrice(quote?.price)}</div>
            <div className={`font-semibold ${quote?.changePercent >= 0 ? 'change-positive' : 'change-negative'}`} style={{ fontSize: '1.15rem', marginTop: '0.5rem' }}>
              {quote?.changePercent >= 0 ? '▲' : '▼'} {formatPrice(Math.abs(quote?.change))} ({quote?.changePercent?.toFixed(2)}%)
            </div>
          </div>
        </div>
      </div>

      {/* ═══════ THE VERDICT: Big, Clear, Unmissable ═══════ */}
      {aiLoading ? (
        <div style={{ marginBottom: '1.5rem', background: 'var(--bg-secondary)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div className="spinner" style={{ width: '40px', height: '40px', borderWidth: '3px' }}></div>
          <div style={{ fontWeight: 600 }}>Tauric Agents Analyzing...</div>
          <div className="text-sm text-muted">Running Quant Swing Engine, Debate, and Risk Committee</div>
        </div>
      ) : aiError ? (
        <div className="glass-card" style={{ marginBottom: '1.5rem', border: '1px solid var(--color-sell)' }}>
          <div style={{ color: 'var(--color-sell)', fontWeight: 'bold', marginBottom: '0.5rem' }}>⚠️ AI Analysis Failed</div>
          <p className="text-muted">{aiError}</p>
        </div>
      ) : hasAI ? (
        <div style={{ marginBottom: '1.5rem', background: 'linear-gradient(145deg, var(--bg-secondary) 0%, rgba(99, 102, 241, 0.06) 100%)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: `2px solid ${getVerdictColor(chief.overallVerdict)}40`, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: getVerdictColor(chief.overallVerdict) }} />
          
          {/* Verdict Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--accent-cyan)', marginBottom: '0.5rem', fontWeight: 800 }}>🤖 AI VERDICT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '3rem' }}>{getVerdictEmoji(chief.overallVerdict)}</span>
                <div style={{ fontSize: '2.5rem', fontWeight: 900, color: getVerdictColor(chief.overallVerdict), letterSpacing: '-0.02em' }}>
                  {chief.overallVerdict?.replace(/_/g, ' ')}
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="text-xs text-muted" style={{ marginBottom: '0.5rem' }}>AI Confidence</div>
              <ConfidenceGauge score={chief.confidenceScore} />
              <div className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>{chief.expertConsensus}</div>
            </div>
          </div>

          {/* Actionable Summary — the one paragraph */}
          <div style={{ padding: '1.25rem', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '1.05rem', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--accent-cyan)' }}>💡 Beginner's TL;DR (What this means in plain English): </strong>
            {chief.actionableSummary}
          </div>

          {/* ══ Trade Setups: Swing / Mid-Term / Long-Term ══ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {/* Swing Trade */}
            <div style={{ background: 'var(--bg-primary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent-cyan)', fontWeight: 700, marginBottom: '1rem' }}>🎯 Swing Trade (3–15 days)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span className="text-xs text-muted">Action</span>
                <span className={`badge ${getVerdictClass(chief.swingTrade?.action)}`}>{chief.swingTrade?.action || 'N/A'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div><div className="text-xs text-muted">Entry</div><div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{formatPrice(chief.swingTrade?.entryPrice)}</div></div>
                <div><div className="text-xs text-muted">Target</div><div style={{ fontWeight: 700, color: 'var(--color-buy)', fontFamily: 'monospace' }}>{formatPrice(chief.swingTrade?.targetPrice)}</div></div>
                <div><div className="text-xs text-muted">Stop Loss</div><div style={{ fontWeight: 700, color: 'var(--color-sell)', fontFamily: 'monospace' }}>{formatPrice(chief.swingTrade?.stopLoss)}</div></div>
                <div><div className="text-xs text-muted">Risk:Reward</div><div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{chief.swingTrade?.riskReward || 'N/A'}</div></div>
              </div>
              {chief.swingTrade?.entryPrice && chief.swingTrade?.targetPrice && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'var(--color-buy-bg)', borderRadius: 'var(--radius-sm)', textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-buy)' }}>
                  Potential Return: +{calcReturn(chief.swingTrade.entryPrice, chief.swingTrade.targetPrice)}%
                </div>
              )}
            </div>

            {/* Mid-Term */}
            <div style={{ background: 'var(--bg-primary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent-secondary)', fontWeight: 700, marginBottom: '1rem' }}>📈 Mid-Term (1–3 months)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span className="text-xs text-muted">Action</span>
                <span className={`badge ${getVerdictClass(chief.midTerm?.action)}`}>{chief.midTerm?.action || 'N/A'}</span>
              </div>
              <div><div className="text-xs text-muted">Target Price</div><div style={{ fontWeight: 700, color: 'var(--color-buy)', fontFamily: 'monospace', fontSize: '1.1rem', margin: '0.5rem 0' }}>{formatPrice(chief.midTerm?.targetPrice)}</div></div>
              <div className="text-xs text-muted" style={{ lineHeight: 1.5 }}>{chief.midTerm?.reasoning}</div>
            </div>

            {/* Long-Term */}
            <div style={{ background: 'var(--bg-primary)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-secondary)' }}>
              <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8b5cf6', fontWeight: 700, marginBottom: '1rem' }}>🏦 Long-Term (6–12 months)</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span className="text-xs text-muted">Action</span>
                <span className={`badge ${getVerdictClass(chief.longTerm?.action)}`}>{chief.longTerm?.action || 'N/A'}</span>
              </div>
              <div><div className="text-xs text-muted">Target Price</div><div style={{ fontWeight: 700, color: 'var(--color-buy)', fontFamily: 'monospace', fontSize: '1.1rem', margin: '0.5rem 0' }}>{formatPrice(chief.longTerm?.targetPrice)}</div></div>
              <div className="text-xs text-muted" style={{ lineHeight: 1.5 }}>{chief.longTerm?.reasoning}</div>
            </div>
          </div>

          {/* Catalysts & Risks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.25rem' }}>
            <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', color: 'var(--color-buy)' }}>▲ Key Catalysts</h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {chief.keyCatalysts?.map((c, i) => (
                  <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.3rem 0', paddingLeft: '1rem', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: 'var(--color-buy)', fontSize: '0.6rem', top: '0.5rem' }}>▲</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', color: 'var(--color-sell)' }}>▼ Key Risks</h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {chief.keyRisks?.map((r, i) => (
                  <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.3rem 0', paddingLeft: '1rem', position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 0, color: 'var(--color-sell)', fontSize: '0.6rem', top: '0.5rem' }}>▼</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '1.5rem', background: 'var(--bg-secondary)', padding: '2rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(245, 158, 11, 0.3)', textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
          <h3 style={{ marginBottom: '0.5rem' }}>AI Analysis Failed</h3>
          <p className="text-muted">The AI agents could not analyze this stock. This usually means your OpenRouter API key is invalid or has expired. Go to <strong>Settings</strong> to update your key, then try again.</p>
          {chief?.message && <p style={{ color: 'var(--color-sell)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{chief.message}</p>}
        </div>
      )}

      {/* ═══════ PORTFOLIO CONTEXT (if you hold this stock) ═══════ */}
      {holding && (
        <div className="fade-in-up" style={{ marginBottom: '1.5rem', padding: '1.5rem', borderRadius: 'var(--radius-lg)', border: '1px solid rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.05)' }}>
          <h3 style={{ marginBottom: '1rem' }}>💼 Your Holding — Personalized AI Action</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div><div className="text-xs text-muted">Avg Buy</div><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatPrice(holding.buyPrice)}</div></div>
            <div><div className="text-xs text-muted">Qty</div><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{holding.quantity}</div></div>
            <div><div className="text-xs text-muted">Current</div><div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{formatPrice(quote?.price)}</div></div>
            <div>
              <div className="text-xs text-muted">P&L</div>
              <div className={`font-bold ${(quote?.price >= holding.buyPrice) ? 'change-positive' : 'change-negative'}`} style={{ fontSize: '1.1rem' }}>
                {(quote?.price >= holding.buyPrice) ? '+' : ''}{formatPrice((quote?.price - holding.buyPrice) * holding.quantity)}
                <span style={{ fontSize: '0.85rem', marginLeft: '0.25rem' }}>({((quote?.price - holding.buyPrice) / holding.buyPrice * 100).toFixed(1)}%)</span>
              </div>
            </div>
          </div>
          {hasAI && (
            <div style={{ padding: '1rem', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem', borderLeft: `3px solid ${getVerdictColor(chief.overallVerdict)}` }}>
              <strong style={{ color: 'var(--accent-cyan)' }}>🤖 AI Says: </strong>
              {chief.overallVerdict === 'SELL' || chief.overallVerdict === 'STRONG_SELL'
                ? `Consider exiting your position. Sell near ${formatPrice(chief.swingTrade?.targetPrice || quote?.price)}. Set stop loss at ${formatPrice(chief.swingTrade?.stopLoss)}.`
                : chief.overallVerdict === 'BUY' || chief.overallVerdict === 'STRONG_BUY'
                ? `Good position! Consider averaging up. Target: ${formatPrice(chief.swingTrade?.targetPrice)}. Keep stop loss at ${formatPrice(chief.swingTrade?.stopLoss)}.`
                : `Hold your position. Set trailing stop loss at ${formatPrice(chief.swingTrade?.stopLoss)}. Watch for breakout above ${formatPrice(chief.swingTrade?.targetPrice)}.`}
            </div>
          )}
        </div>
      )}

      {/* ═══════ MAIN GRID: Chart + Metrics + Expert Panels ═══════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Left: Chart */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>📊 1-Year Price Action</h3>
              {techAgent && !techAgent.error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className="text-sm text-muted">Trend:</span>
                  <span style={{ fontWeight: 700, color: getVerdictColor(techAgent.trend?.includes('UP') ? 'BUY' : techAgent.trend?.includes('DOWN') ? 'SELL' : 'HOLD'), fontSize: '0.85rem' }}>
                    {techAgent.trend?.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
            </div>
            <div ref={chartRef} style={{ width: '100%', height: '380px', position: 'relative' }}></div>
          </div>

          {/* ══ Expert Deep Dive Accordion ══ */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>🔬 Expert Agent Deep Dive</h3>
            <p className="text-xs text-muted" style={{ marginBottom: '1rem' }}>Click each agent to see their full analysis and reasoning</p>
            {expertPanels.map(({ key, name, agent, color }) => (
              <div key={key} style={{ marginBottom: '0.75rem', border: '1px solid var(--border-secondary)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <button
                  onClick={() => setExpandedExpert(expandedExpert === key ? null : key)}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.875rem 1rem', background: expandedExpert === key ? 'rgba(255,255,255,0.04)' : 'transparent',
                    border: 'none', borderLeft: `3px solid ${color}`, cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    {agent && !agent.error && <span className={`badge ${getVerdictClass(agent.verdict || agent.overallSentiment)}`}>{(agent.verdict || agent.overallSentiment)?.replace(/_/g, ' ')}</span>}
                    {agent?.error && <span className="badge badge-neutral">FAILED</span>}
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{expandedExpert === key ? '▲' : '▼'}</span>
                  </div>
                </button>
                {expandedExpert === key && agent && !agent.error && (
                  <div style={{ padding: '1rem', borderTop: '1px solid var(--border-secondary)', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    <p style={{ marginBottom: '0.75rem' }}>{agent.reasoning}</p>
                    {agent.signals && agent.signals.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                        {agent.signals.slice(0, 5).map((s, i) => <span key={i} style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: 'var(--bg-tertiary)', borderRadius: '1rem', border: '1px solid var(--border-secondary)' }}>{s}</span>)}
                      </div>
                    )}
                    {agent.keyThemes && agent.keyThemes.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>
                        {agent.keyThemes.map((t, i) => <span key={i} style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', background: 'var(--bg-tertiary)', borderRadius: '1rem', border: '1px solid var(--border-secondary)' }}>#{t.replace(/\s+/g, '')}</span>)}
                      </div>
                    )}
                    {agent.keyStrengths && agent.keyStrengths.length > 0 && (
                      <div style={{ marginTop: '0.75rem' }}>
                        <strong style={{ color: 'var(--color-buy)', fontSize: '0.8rem' }}>Strengths: </strong>
                        {agent.keyStrengths.join(' • ')}
                      </div>
                    )}
                    {agent.keyRisks && agent.keyRisks.length > 0 && (
                      <div style={{ marginTop: '0.5rem' }}>
                        <strong style={{ color: 'var(--color-sell)', fontSize: '0.8rem' }}>Risks: </strong>
                        {agent.keyRisks.join(' • ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Quick Metrics + Risk Assessment + News */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          {/* Key Metrics */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>📈 Key Metrics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.9rem' }}>
              <div title="Total value of the company"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>Mkt Cap</span><strong>{formatLargeNumber(quote?.marketCap)}</strong></div>
              <div title="Price-to-Earnings Ratio"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>P/E Ratio</span><strong>{quote?.pe ? quote.pe.toFixed(2) : 'N/A'}</strong></div>
              <div title="52-week high"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>52W High</span><strong>{formatPrice(quote?.fiftyTwoWeekHigh)}</strong></div>
              <div title="52-week low"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>52W Low</span><strong>{formatPrice(quote?.fiftyTwoWeekLow)}</strong></div>
              <div title="50-day moving average"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>50 DMA</span><strong className={quote?.price > quote?.fiftyDayAvg ? 'change-positive' : 'change-negative'}>{formatPrice(quote?.fiftyDayAvg)}</strong></div>
              <div title="200-day moving average"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>200 DMA</span><strong className={quote?.price > quote?.twoHundredDayAvg ? 'change-positive' : 'change-negative'}>{formatPrice(quote?.twoHundredDayAvg)}</strong></div>
              <div title="EPS (Earnings Per Share)"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>EPS</span><strong>{quote?.eps ? `₹${quote.eps.toFixed(2)}` : 'N/A'}</strong></div>
              <div title="Volume"><span className="text-muted text-xs uppercase block" style={{ borderBottom: '1px dotted var(--text-tertiary)', cursor: 'help' }}>Volume</span><strong>{quote?.volume?.toLocaleString('en-IN') || 'N/A'}</strong></div>
            </div>
          </div>

          {/* Risk Assessment */}
          {riskAgent && !riskAgent.error && (
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>🛡️ Risk Assessment</h3>
              <div style={{ marginBottom: '1rem' }}>
                <div className="text-xs text-muted" style={{ marginBottom: '0.5rem' }}>Risk Level</div>
                <RiskMeter level={riskAgent.riskLevel} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                <div><span className="text-xs text-muted block">Risk:Reward</span><strong>{riskAgent.riskRewardRatio || 'N/A'}</strong></div>
                <div><span className="text-xs text-muted block">Position Size</span><strong>{riskAgent.positionSizing || 'N/A'}</strong></div>
                <div><span className="text-xs text-muted block">Trade Worthy?</span><strong style={{ color: riskAgent.isTradeWorthy ? 'var(--color-buy)' : 'var(--color-sell)' }}>{riskAgent.isTradeWorthy ? 'YES ✓' : 'NO ✗'}</strong></div>
                <div><span className="text-xs text-muted block">Max Drawdown</span><strong>{riskAgent.maxDrawdown || 'N/A'}</strong></div>
              </div>
              <div className="text-xs text-muted" style={{ marginTop: '1rem', lineHeight: 1.5, borderTop: '1px solid var(--border-secondary)', paddingTop: '0.75rem' }}>{riskAgent.reasoning}</div>
            </div>
          )}

          {/* Deterministic Swing Playbook (Quant Engine v2) */}
          {data.swingPlaybook && (
            <div className="glass-card" style={{ padding: '1.5rem', borderLeft: `4px solid ${data.swingPlaybook.tradeWorthy ? 'var(--color-buy)' : 'var(--text-tertiary)'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0 }}>🎯 Quant Swing Setup</h3>
                <span className={`badge ${data.swingPlaybook.tradeWorthy ? 'badge-strong-buy' : 'badge-neutral'}`}>
                  {data.swingPlaybook.setup?.replace(/_/g, ' ')}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.6rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
                <div><span className="text-xs text-muted block">Trigger/Entry</span><strong style={{ fontFamily: 'monospace' }}>₹{data.swingPlaybook.levels?.entry || quote?.price}</strong></div>
                <div><span className="text-xs text-muted block">Stop Loss</span><strong style={{ fontFamily: 'monospace', color: 'var(--color-sell)' }}>₹{data.swingPlaybook.levels?.stop}</strong></div>
                <div><span className="text-xs text-muted block">Target 1 (T1)</span><strong style={{ fontFamily: 'monospace', color: 'var(--color-buy)' }}>₹{data.swingPlaybook.levels?.t1}</strong></div>
                <div><span className="text-xs text-muted block">Target 2 (T2)</span><strong style={{ fontFamily: 'monospace', color: 'var(--color-buy)' }}>₹{data.swingPlaybook.levels?.t2}</strong></div>
                <div><span className="text-xs text-muted block">Risk : Reward</span><strong>{data.swingPlaybook.riskRewardT1 || 'N/A'}:1</strong></div>
                <div><span className="text-xs text-muted block">Position Size</span><strong>{data.swingPlaybook.position?.shares || 0} shares</strong></div>
              </div>
              {data.swingPlaybook.explain?.howToTrade && (
                <div style={{ fontSize: '0.75rem', padding: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', lineHeight: 1.4, color: 'var(--text-secondary)' }}>
                  {data.swingPlaybook.explain.howToTrade}
                </div>
              )}
            </div>
          )}

          {/* Technical Score & 6-Factor Model */}
          {technicals && !technicals.error && (
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0 }}>⚡ Quant Scorecard</h3>
                <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>V2 MULTI-FACTOR</span>
              </div>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div style={{
                  fontSize: '3rem', fontWeight: 900,
                  color: technicals.overallTechnicalScore >= 60 ? 'var(--color-buy)' : technicals.overallTechnicalScore >= 40 ? 'var(--color-hold)' : 'var(--color-sell)',
                }}>{technicals.overallTechnicalScore}<span style={{ fontSize: '1.2rem', color: 'var(--text-tertiary)' }}>/100</span></div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                  {technicals.overallTechnicalScore >= 65 ? 'High conviction trade candidate.' : technicals.overallTechnicalScore >= 50 ? 'Moderate momentum, awaiting clear trigger.' : 'Weak structure or overextended.'}
                </div>
              </div>

              {/* 6-Factor Meters */}
              {technicals.v2ScoreData?.components && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
                  {[
                    { label: 'Trend (25%)', val: technicals.v2ScoreData.components.trend },
                    { label: 'Relative Strength (20%)', val: technicals.v2ScoreData.components.rs },
                    { label: 'Momentum (15%)', val: technicals.v2ScoreData.components.mom },
                    { label: 'Volume Flow (15%)', val: technicals.v2ScoreData.components.vol },
                    { label: 'Market Structure (15%)', val: technicals.v2ScoreData.components.struct },
                    { label: 'Volatility Contraction (10%)', val: technicals.v2ScoreData.components.vc },
                  ].map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span className="text-muted">{f.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: '60px', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${Math.round((f.val || 0) * 100)}%`, height: '100%', background: (f.val >= 0.7 ? 'var(--color-buy)' : f.val >= 0.4 ? 'var(--color-hold)' : 'var(--color-sell)') }} />
                        </div>
                        <span style={{ fontFamily: 'monospace', minWidth: '30px', textAlign: 'right' }}>{Math.round((f.val || 0) * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {technicals.signals?.slice(0, 6).map((s, i) => (
                  <span key={i} style={{
                    fontSize: '0.7rem', padding: '0.2rem 0.5rem',
                    background: s.type === 'bullish' ? 'var(--color-buy-bg)' : s.type === 'bearish' ? 'var(--color-sell-bg)' : 'var(--bg-tertiary)',
                    color: s.type === 'bullish' ? 'var(--color-buy)' : s.type === 'bearish' ? 'var(--color-sell)' : 'var(--text-secondary)',
                    borderRadius: '1rem', border: '1px solid var(--border-secondary)',
                  }}>{s.message}</span>
                ))}
              </div>
            </div>
          )}

          {/* Recent News */}
          {data.news?.length > 0 && (
            <div className="glass-card" style={{ padding: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>📰 Recent News</h3>
              {data.news.slice(0, 5).map((n, i) => (
                <div key={i} style={{ padding: '0.5rem 0', borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                  <a href={n.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.4, display: 'block' }}>
                    {n.title}
                  </a>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                    {n.source} • {n.pubDate ? new Date(n.pubDate).toLocaleDateString('en-IN') : 'Recent'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
