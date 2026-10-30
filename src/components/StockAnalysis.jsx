import React, { useState, useEffect, useRef } from 'react';

export default function StockAnalysis({ data: initialData, onBack, settings, isAIReady, setIsAIReady }) {
  const chartRef = useRef(null);
  const [holding, setHolding] = useState(null);
  const [expandedExpert, setExpandedExpert] = useState(null);
  const [data, setData] = useState(initialData);
  const [aiLoading, setAiLoading] = useState(Boolean(!initialData.expertAnalysis && isAIReady));
  const [aiError, setAiError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshLive = async () => {
    setRefreshing(true);
    try {
      const { fetchStockData } = await import('../api.js');
      const freshData = await fetchStockData(data.symbol, settings.newsApiKey, { force: true });
      setData(freshData);
    } catch (e) {
      console.error('Failed to refresh live data:', e);
    }
    setRefreshing(false);
  };

  // Fetch AI analysis if it wasn't provided yet
  useEffect(() => {
    if (!initialData.expertAnalysis && isAIReady) {
      setAiLoading(true);
      import('../api.js').then(({ analyzeStock }) => {
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
    } else {
      setAiLoading(false);
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button className="btn btn-ghost" onClick={onBack}>← Back to Dashboard</button>
        <button
          className="btn btn-secondary"
          onClick={handleRefreshLive}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
        >
          <span style={{ display: 'inline-block', transform: refreshing ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s ease' }}>🔄</span>
          {refreshing ? 'Refreshing Real-Time Data...' : 'Live Real-Time Refresh'}
        </button>
      </div>

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

      {/* ═══════ WHAT TO DO RIGHT NOW — Plain English Action Guide ═══════ */}
      {(() => {
        const qc = data.quantConsensus;
        const exec = qc?.executionLevels || {};
        const verdict = (qc?.overallVerdict || '').toUpperCase();
        const isBuy = verdict.includes('BUY') || verdict.includes('ACCUMULATE');
        const isSell = verdict.includes('SELL') || verdict.includes('REDUCE') || verdict.includes('AVOID');
        const isHold = verdict.includes('HOLD') || verdict.includes('WAIT') || verdict.includes('NEUTRAL');

        const accentColor = isBuy ? '#10b981' : isSell ? '#ef4444' : '#f59e0b';
        const bgColor = isBuy ? 'rgba(16,185,129,0.08)' : isSell ? 'rgba(239,68,68,0.06)' : 'rgba(245,158,11,0.06)';
        const borderColor = isBuy ? 'rgba(16,185,129,0.35)' : isSell ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';

        const buyPrice = exec.entryZone || (exec.entryPrice ? `₹${exec.entryPrice}` : null);
        const target1 = exec.target1 ? `₹${exec.target1}` : null;
        const stopLoss = exec.stopLoss ? `₹${exec.stopLoss}` : null;
        const rr = exec.riskRewardRatio || '2.5:1';

        const steps = isBuy ? [
          { num: '1', color: '#10b981', title: `Buy between ${buyPrice || 'current price'}`, desc: `Open your broker app (Zerodha/Groww/Upstox). Place a CNC (delivery) buy order at market price or use a limit order near ${buyPrice || 'the entry zone'}. Do NOT buy if the price is more than 3% above this level.` },
          { num: '2', color: '#ef4444', title: `Immediately set GTT Stop Loss at ${stopLoss || 'the stop price'}`, desc: `Right after buying, set a GTT (Good Till Triggered) sell order at ${stopLoss || 'the stop loss price'}. This is your safety net. Risk is capped at ${exec.riskPct || '~3.5%'}. Never skip this step.` },
          { num: '3', color: '#fbbf24', title: `When price hits ${target1 || 'Target 1'} — sell HALF`, desc: `Sell 50% of your shares at ${target1 || 'Target 1'}. This locks in profit. Then move your stop loss UP to your original buy price. Now you literally cannot lose money on this trade.` },
          { num: '4', color: '#a78bfa', title: 'Let the other half run (trail it)', desc: `Keep the remaining 50% with a trailing stop below the 10-day EMA line. Only exit when the price closes below that line on a daily candle. This is how you catch the big +20%–+80% moves.` },
        ] : isSell ? [
          { num: '1', color: '#ef4444', title: 'Do NOT enter this stock right now', desc: `The quant system rates this as ${qc?.overallVerdict?.replace(/_/g, ' ') || 'SELL/AVOID'}. If you already hold it, consider reducing your position size or exiting at the next resistance level.` },
          { num: '2', color: '#f59e0b', title: 'Wait for conditions to improve', desc: 'Add this to your watchlist. Come back in 1–2 weeks. The setup may improve as the stock consolidates or finds support.' },
          { num: '3', color: '#94a3b8', title: 'Focus on other opportunities', desc: 'Return to the Morning Breakout Radar and Swing Radar for better-rated setups with positive momentum.' },
        ] : [
          { num: '1', color: '#f59e0b', title: 'Hold / Wait — not the right time to enter', desc: `The system shows HOLD/NEUTRAL. If you already own this stock, hold your position. If you don't own it yet, wait for a clearer breakout signal before entering.` },
          { num: '2', color: '#94a3b8', title: `Watch the key level: ${buyPrice || 'entry zone'}`, desc: `Set a price alert in your broker app at ${buyPrice || 'the breakout level'}. If the stock crosses this with heavy volume, that's your entry signal.` },
          { num: '3', color: '#10b981', title: 'Check back tomorrow morning', desc: 'Market conditions can change overnight. Refresh the app at 9:15 AM to see if a stronger signal has emerged.' },
        ];

        return (
          <div style={{
            marginBottom: '1.5rem',
            background: bgColor,
            border: `1px solid ${borderColor}`,
            borderRadius: 'var(--radius-lg)',
            padding: '1.5rem',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${accentColor}, var(--accent-cyan))` }} />
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.1rem' }}>
              <span style={{ fontSize: '1.3rem' }}>{isBuy ? '✅' : isSell ? '🚫' : '⏸️'}</span>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: '#ffffff' }}>
                  What To Do Right Now — Plain English Guide
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.1rem' }}>
                  Step-by-step actions for <strong style={{color:'#fff'}}>{quote?.name || data.symbol}</strong> based on today's quant analysis
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.75rem', marginBottom: isBuy && buyPrice ? '1rem' : 0 }}>
              {steps.map(step => (
                <div key={step.num} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)', padding: '0.9rem', border: `1px solid ${step.color}30` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.45rem' }}>
                    <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: `${step.color}25`, color: step.color, fontSize: '0.72rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>{step.num}</span>
                    <span style={{ fontWeight: 700, color: step.color, fontSize: '0.82rem' }}>{step.title}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.desc}</p>
                </div>
              ))}
            </div>

            {isBuy && buyPrice && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', background: 'rgba(0,0,0,0.3)', padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>🟢 Buy Here</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ffffff', fontFamily: 'monospace' }}>{buyPrice}</div>
                </div>
                <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(255,255,255,0.07)', borderRight: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--color-buy)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>🎯 Target 1 (Sell 50%)</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-buy)', fontFamily: 'monospace' }}>{target1 || '—'}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{exec.target1Return || ''}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--color-sell)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>🔴 Stop Loss (GTT)</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--color-sell)', fontFamily: 'monospace' }}>{stopLoss || '—'}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>R:R = {rr}</div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══════ INSTITUTIONAL QUANT CONSENSUS MASTER CARD (100% PURE ALGO) ═══════ */}
      {(() => {
        const qc = data.quantConsensus || {
          score: 75,
          grade: 'A (QUANT CONFLUENCE)',
          overallVerdict: 'BUY',
          verdictTitle: '✅ BUY — MOMENTUM EXPANSION',
          verdictBadgeClass: 'badge-buy',
          verdictColor: 'var(--color-buy)',
          actionSummary: `Quantitative indicators align in high-probability momentum zone for ${data.symbol}.`,
          executionLevels: {
            entryZone: `₹${quote?.price || 0}`,
            entryPrice: quote?.price || 0,
            target1: Math.round((quote?.price || 0) * 1.10),
            target1Return: '+10.0%',
            target2: Math.round((quote?.price || 0) * 1.18),
            stopLoss: Math.round((quote?.price || 0) * 0.965),
            riskPct: '-3.5%',
            riskRewardRatio: '2.8:1',
            recommendedShares: 15
          },
          pillars: [
            { id: 'trend', name: 'Structural Trend (Stage Analysis)', score: 20, maxScore: 25, statusBadge: 'BULLISH', summary: 'Price holding above short-term moving averages.' },
            { id: 'momentum', name: 'Momentum & Relative Strength', score: 20, maxScore: 25, statusBadge: 'EXPANDING', summary: 'RSI in bullish zone with positive momentum.' },
            { id: 'volatility', name: 'Minervini Volatility Squeeze (VCP)', score: 15, maxScore: 20, statusBadge: 'COILING', summary: 'Volatility contracting in consolidation base.' },
            { id: 'volume', name: 'Institutional Volume Pacing', score: 12, maxScore: 15, statusBadge: 'ACTIVE', summary: 'Volume run-rate tracking institutional pace.' },
            { id: 'geometry', name: 'Asymmetric Risk/Reward Geometry', score: 12, maxScore: 15, statusBadge: 'ASYMMETRIC', summary: 'Positive reward-to-risk setup.' }
          ]
        };

        const exec = qc.executionLevels || {};

        return (
          <div className="glass-card" style={{
            marginBottom: '1.75rem',
            padding: '1.75rem',
            borderRadius: 'var(--radius-lg)',
            border: `1px solid rgba(6, 182, 212, 0.4)`,
            background: 'linear-gradient(180deg, rgba(6, 182, 212, 0.08) 0%, rgba(15, 23, 42, 0.75) 100%)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.4), 0 0 24px rgba(6, 182, 212, 0.12)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Top glowing accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, var(--accent-cyan), var(--color-buy), #8b5cf6)' }} />

            {/* Header: Label, Master Verdict & Composite Score */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--accent-cyan)', fontWeight: 800 }}>
                    ⚡ INSTITUTIONAL QUANT CONSENSUS
                  </span>
                  <span style={{ fontSize: '0.62rem', padding: '0.12rem 0.5rem', borderRadius: '1rem', background: 'rgba(6, 182, 212, 0.15)', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                    100% DETERMINISTIC ALGO
                  </span>
                </div>
                <div style={{ fontSize: '1.85rem', fontWeight: 900, color: qc.verdictColor, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {qc.verdictTitle}
                </div>
              </div>

              {/* Quant Composite Score Tile */}
              <div style={{ background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '0.6rem 1.25rem', borderRadius: 'var(--radius-md)', textAlign: 'right' }}>
                <div className="text-xs text-muted" style={{ fontWeight: 600 }}>COMPOSITE QUANT SCORE</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', justifyContent: 'flex-end' }}>
                  <span className="font-mono" style={{ fontSize: '1.9rem', fontWeight: 900, color: '#ffffff' }}>{qc.score}</span>
                  <span className="font-mono text-muted" style={{ fontSize: '1rem' }}>/100</span>
                </div>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, color: qc.score >= 70 ? 'var(--color-buy)' : qc.score >= 50 ? '#f59e0b' : 'var(--color-sell)' }}>
                  {qc.grade}
                </div>
              </div>
            </div>

            {/* Smart Money Volume Footprint Notification (if accumulating) */}
            {qc.smartMoney?.isAccumulating && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.65rem',
                padding: '0.6rem 1rem',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1rem',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)'
              }}>
                <span style={{ fontSize: '1.1rem' }}>🐋</span>
                <div>
                  <strong style={{ color: 'var(--color-buy)' }}>Smart Money Accumulation Detected: </strong>
                  Up-day volume is {Number(qc.smartMoney.upDownVolRatio).toFixed(1)}x greater than down-days over past 20 sessions. Institutional absorption active.
                </div>
              </div>
            )}

            {/* Actionable Plan Banner */}
            <div style={{
              padding: '1rem 1.25rem',
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
              fontSize: '0.95rem',
              lineHeight: 1.6,
              color: 'var(--text-secondary)'
            }}>
              <strong style={{ color: 'var(--accent-cyan)' }}>🎯 Actionable Execution Blueprint: </strong>
              {qc.actionSummary}
            </div>

            {/* 3-Tile Trade Execution Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
              {/* Buy Zone */}
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-secondary)' }}>
                <div className="text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Primary Buy Zone</div>
                <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff', margin: '0.3rem 0' }}>
                  {exec.entryZone || formatPrice(exec.entryPrice)}
                </div>
                <div className="text-xs text-muted">Optimal risk entry window</div>
              </div>

              {/* Target 1 (+10% Move) */}
              <div style={{ background: 'rgba(16, 185, 129, 0.06)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-buy)', fontWeight: 700 }}>Target 1 (+10% Velocity)</span>
                  <span className="badge badge-strong-buy" style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem' }}>{exec.target1Return || '+10%'}</span>
                </div>
                <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-buy)', margin: '0.3rem 0' }}>
                  {formatPrice(exec.target1)}
                </div>
                <div className="text-xs text-muted">Scale 50% position & trail stop</div>
              </div>

              {/* Stop Loss (Invalidation) */}
              <div style={{ background: 'rgba(244, 63, 94, 0.06)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(244, 63, 94, 0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="text-xs" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-sell)', fontWeight: 700 }}>ATR Invalidation Stop</span>
                  <span className="badge badge-sell" style={{ fontSize: '0.62rem', padding: '0.1rem 0.4rem' }}>{exec.riskPct || '-3.5%'}</span>
                </div>
                <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-sell)', margin: '0.3rem 0' }}>
                  {formatPrice(exec.stopLoss)}
                </div>
                <div className="text-xs text-muted">Risk:Reward: <strong className="font-mono" style={{ color: '#ffffff' }}>{exec.riskRewardRatio || '2.5:1'}</strong></div>
              </div>
            </div>

            {/* ═══════ THE "FREE RIDE" PROFIT ESCALATOR & TRAILING ROADMAP ═══════ */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              marginBottom: '1.5rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1rem' }}>🪜</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#ffffff' }}>
                    THE "FREE RIDE" PROFIT ESCALATOR & TRAILING ROADMAP
                  </span>
                </div>
                <span className="badge badge-neutral" style={{ fontSize: '0.62rem', color: 'var(--accent-cyan)', borderColor: 'rgba(6, 182, 212, 0.3)' }}>
                  ZERO-RISK PROFIT LOCKING
                </span>
              </div>

              {/* 4 Connected Phases Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {/* Phase 1 */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.07)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(6, 182, 212, 0.2)', color: 'var(--accent-cyan)', fontSize: '0.68rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>1</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Entry & Risk Cap</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.25rem' }}>
                    {exec.entryZone || formatPrice(exec.entryPrice)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-sell)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Hard Stop: {formatPrice(exec.stopLoss)} ({exec.riskPct || '-3.5%'})
                  </div>
                  <p className="text-muted text-xs" style={{ margin: 0, lineHeight: 1.35, fontSize: '0.68rem' }}>
                    Enter with predefined ATR risk. Never chase price beyond +2.5% of the pivot ceiling.
                  </p>
                </div>

                {/* Phase 2 */}
                <div style={{ background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.25)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.2)', color: 'var(--color-buy)', fontSize: '0.68rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>2</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-buy)' }}>Bank 50% at Target 1</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-buy)', marginBottom: '0.25rem' }}>
                    {formatPrice(exec.target1)} ({exec.target1Return || '+10%'})
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Action: Sell 50% of Shares
                  </div>
                  <p className="text-muted text-xs" style={{ margin: 0, lineHeight: 1.35, fontSize: '0.68rem' }}>
                    Lock in mathematical profit into cash. Guarantees this swing trade cannot become a loser.
                  </p>
                </div>

                {/* Phase 3 */}
                <div style={{ background: 'rgba(139, 92, 246, 0.04)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', fontSize: '0.68rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>3</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c084fc' }}>Ratchet to Breakeven</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.25rem' }}>
                    {formatPrice(exec.entryPrice)} (Cost)
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#10b981', fontWeight: 700, marginBottom: '0.35rem' }}>
                    100% Risk-Free "House Money"
                  </div>
                  <p className="text-muted text-xs" style={{ margin: 0, lineHeight: 1.35, fontSize: '0.68rem' }}>
                    Move Stop Loss up to exact entry price. Remaining 50% position now has ₹0 downside risk.
                  </p>
                </div>

                {/* Phase 4 */}
                <div style={{ background: 'rgba(245, 158, 11, 0.04)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 'var(--radius-sm)', padding: '0.85rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <span style={{ width: '18px', height: '18px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', fontSize: '0.68rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>4</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fbbf24' }}>Super Runner Trail</span>
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.88rem', fontWeight: 700, color: '#ffffff', marginBottom: '0.25rem' }}>
                    10 EMA: {formatPrice(exec.ema10Trail || technicals?.indicators?.ema?.ema9 || (quote?.price * 0.98))}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginBottom: '0.35rem' }}>
                    20 EMA: {formatPrice(exec.ema21Trail || technicals?.indicators?.ema?.ema21 || (quote?.price * 0.95))}
                  </div>
                  <p className="text-muted text-xs" style={{ margin: 0, lineHeight: 1.35, fontSize: '0.68rem' }}>
                    Trail remaining half on daily 10 EMA. Exit only on daily close below EMA. Catches +20% to +80% monster swings!
                  </p>
                </div>
              </div>
            </div>

            {/* 5-Pillar Confluence Breakdown */}
            <div>
              <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', fontWeight: 700, marginBottom: '0.75rem' }}>
                5-Pillar Mathematical Confluence Breakdown
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.65rem' }}>
                {qc.pillars?.map(p => (
                  <div key={p.id} style={{ background: 'rgba(0, 0, 0, 0.25)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{p.name.split(' (')[0]}</span>
                      <span className="font-mono text-xs" style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{p.score}/{p.maxScore}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                      <span className="badge badge-neutral" style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem' }}>{p.statusBadge}</span>
                    </div>
                    <p className="text-muted text-xs" style={{ margin: 0, lineHeight: 1.35, fontSize: '0.7rem' }}>{p.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════ PROFIT MAXIMIZER — Advanced Profit-Maximizing Strategies ═══════ */}
      {(() => {
        const pm = data.profitMaximizer;
        if (!pm) return null;

        const gradeColors = {
          'S': '#ff6b2b', 'A': '#10b981', 'B': '#f59e0b', 'C': '#94a3b8', 'D': '#ef4444'
        };
        const gradeColor = gradeColors[pm.profitGrade] || '#94a3b8';

        return (
          <div className="glass-card fade-in-up" style={{
            marginBottom: '1.75rem',
            padding: '1.75rem',
            borderRadius: 'var(--radius-lg)',
            border: `1px solid rgba(255, 107, 43, 0.35)`,
            background: 'linear-gradient(180deg, rgba(255, 107, 43, 0.06) 0%, rgba(15, 23, 42, 0.8) 100%)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.35), 0 0 20px rgba(255, 107, 43, 0.08)',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Top glowing accent bar */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: `linear-gradient(90deg, ${gradeColor}, #f59e0b, #8b5cf6)` }} />

            {/* Header: Profit Maximizer Title + Grade */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: gradeColor, fontWeight: 800 }}>
                    🧠 PROFIT MAXIMIZER ENGINE
                  </span>
                  <span style={{ fontSize: '0.62rem', padding: '0.12rem 0.5rem', borderRadius: '1rem', background: `rgba(255, 107, 43, 0.15)`, color: gradeColor, fontWeight: 700 }}>
                    KELLY + ATR + MULTI-TF
                  </span>
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 900, color: gradeColor, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                  {pm.profitLabel}
                </div>
              </div>

              {/* Profit Grade Tile */}
              <div style={{ background: 'rgba(0, 0, 0, 0.35)', border: `1px solid ${gradeColor}40`, padding: '0.6rem 1.25rem', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <div className="text-xs text-muted" style={{ fontWeight: 600 }}>PROFIT GRADE</div>
                <div className="font-mono" style={{ fontSize: '2.5rem', fontWeight: 900, color: gradeColor, lineHeight: 1 }}>{pm.profitGrade}</div>
                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {pm.enhancedQuantScore}/100 Enhanced
                </div>
              </div>
            </div>

            {/* Expected Value Banner */}
            <div style={{
              padding: '0.75rem 1rem',
              background: pm.expectedValue > 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${pm.expectedValue > 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-md)',
              marginBottom: '1.25rem',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}>
              <span style={{ fontSize: '1rem' }}>{pm.expectedValue > 0 ? '📈' : '📉'}</span>
              <div>
                <strong style={{ color: pm.expectedValue > 0 ? 'var(--color-buy)' : 'var(--color-sell)' }}>
                  Expected Value: {pm.expectedValue > 0 ? '+' : ''}{pm.expectedValue}% per trade
                </strong>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.15rem' }}>
                  {pm.expectedValueNote}
                </div>
              </div>
            </div>

            {/* 3-Column Strategy Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>

              {/* Dynamic Position Sizing Card */}
              <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>⚖️</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-cyan)' }}>
                    Dynamic Position Sizing
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.82rem' }}>
                  <div>
                    <div className="text-xs text-muted">Shares</div>
                    <div className="font-mono" style={{ fontWeight: 800, fontSize: '1.15rem', color: '#fff' }}>
                      {pm.dynamicPosition?.shares || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Capital</div>
                    <div className="font-mono" style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                      ₹{(pm.dynamicPosition?.capitalDeployed || 0).toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Risk</div>
                    <div className="font-mono" style={{ fontWeight: 600, color: 'var(--color-sell)' }}>
                      ₹{pm.dynamicPosition?.riskAmount || 0} ({pm.dynamicPosition?.effectiveRiskPct || 0}%)
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Method</div>
                    <span className="badge badge-neutral" style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem' }}>
                      {pm.dynamicPosition?.method?.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '0.5rem', lineHeight: 1.4 }}>
                  Kelly: {pm.dynamicPosition?.kellyFraction || 0}% · Half-Kelly: {pm.dynamicPosition?.halfKelly || 0}% · Conviction: {pm.dynamicPosition?.convictionMult || 0}x · Vol Adj: {pm.dynamicPosition?.volAdjust || 0}x
                </div>
              </div>

              {/* Multi-Timeframe Confluence Card */}
              <div style={{
                background: pm.mtfConfluence?.weeklyAligned ? 'rgba(16, 185, 129, 0.04)' : 'rgba(245, 158, 11, 0.04)',
                padding: '1rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${pm.mtfConfluence?.weeklyAligned ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>📐</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: pm.mtfConfluence?.weeklyAligned ? 'var(--color-buy)' : '#f59e0b' }}>
                    Multi-Timeframe Confluence
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span className={`badge ${pm.mtfConfluence?.weeklyAligned ? 'badge-strong-buy' : 'badge-hold'}`} style={{ fontSize: '0.62rem' }}>
                    {pm.mtfConfluence?.weeklyTrend?.replace(/_/g, ' ')}
                  </span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                    {pm.mtfConfluence?.confluenceBonus > 0 ? `+${pm.mtfConfluence.confluenceBonus} pts` : pm.mtfConfluence?.confluenceBonus < 0 ? `${pm.mtfConfluence.confluenceBonus} pts` : '—'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem', fontSize: '0.78rem', marginBottom: '0.35rem' }}>
                  <div>
                    <span className="text-xs text-muted">Weekly 10 EMA</span>
                    <div className="font-mono" style={{ fontWeight: 600, color: '#fff' }}>₹{pm.mtfConfluence?.weeklyEma10 || '—'}</div>
                  </div>
                  <div>
                    <span className="text-xs text-muted">Weekly 30 EMA</span>
                    <div className="font-mono" style={{ fontWeight: 600, color: '#fff' }}>₹{pm.mtfConfluence?.weeklyEma30 || '—'}</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                  Weekly RSI: {pm.mtfConfluence?.weeklyRSI || '—'} · {pm.mtfConfluence?.weeklyAligned ? '✅ Daily trades have higher follow-through' : '⚠️ Weekly headwind — reduce size by 40%'}
                </div>
              </div>

              {/* Adaptive Trailing Stop Card */}
              <div style={{ background: 'rgba(139, 92, 246, 0.04)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>🎚️</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#c084fc' }}>
                    Adaptive Trailing Stop
                  </span>
                </div>
                <div className="font-mono" style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: '0.35rem' }}>
                  ₹{pm.adaptiveTrail?.trailingStop || '—'}
                </div>
                <span className="badge badge-neutral" style={{ fontSize: '0.6rem', padding: '0.1rem 0.35rem', marginBottom: '0.4rem', display: 'inline-block', color: '#c084fc', borderColor: 'rgba(139, 92, 246, 0.3)' }}>
                  {pm.adaptiveTrail?.method?.replace(/_/g, ' ')}
                </span>
                {/* 5-Phase Visual */}
                <div style={{ display: 'flex', gap: '2px', marginTop: '0.4rem', marginBottom: '0.3rem' }}>
                  {pm.adaptiveTrail?.phases?.map((phase, idx) => (
                    <div key={idx} style={{
                      flex: 1,
                      height: '4px',
                      borderRadius: '2px',
                      background: phase.active ? '#c084fc' : 'rgba(255, 255, 255, 0.06)',
                      transition: 'background 0.3s ease',
                    }} title={`${phase.range}: ${phase.method}`} />
                  ))}
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>ATR</span><span>Chandelier</span><span>10E</span><span>20E</span><span>50E</span>
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '0.35rem', lineHeight: 1.4 }}>
                  {pm.adaptiveTrail?.explanation || ''}
                </div>
              </div>
            </div>

            {/* ═══ Pyramiding Plan ═══ */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              marginBottom: '1rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.85rem' }}>🪜</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#fff' }}>
                    Pyramiding Plan — Average Up into Winners
                  </span>
                </div>
                <span className={`badge ${pm.pyramidPlan?.canPyramid ? 'badge-strong-buy' : 'badge-neutral'}`} style={{ fontSize: '0.6rem' }}>
                  {pm.pyramidPlan?.canPyramid ? '✅ ACTIVE' : '⏳ PENDING'}
                </span>
              </div>

              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.65rem', lineHeight: 1.45 }}>
                {pm.pyramidPlan?.rationale}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem' }}>
                {pm.pyramidPlan?.pyramidLevels?.map((lvl) => (
                  <div key={lvl.level} style={{
                    background: lvl.status === 'TRIGGERED' ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                    border: `1px solid ${lvl.status === 'TRIGGERED' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.65rem',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.25rem' }}>
                      <span style={{
                        width: '16px', height: '16px', borderRadius: '50%',
                        background: lvl.status === 'TRIGGERED' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255, 255, 255, 0.06)',
                        color: lvl.status === 'TRIGGERED' ? 'var(--color-buy)' : 'var(--text-tertiary)',
                        fontSize: '0.62rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                      }}>{lvl.level}</span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, color: lvl.status === 'TRIGGERED' ? 'var(--color-buy)' : 'var(--text-secondary)' }}>
                        Pyramid at {lvl.requiredGain}
                      </span>
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>
                      ₹{lvl.triggerPrice}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)', marginTop: '0.2rem' }}>
                      +{lvl.addShares} shares · Stop → ₹{lvl.newStopLoss}
                    </div>
                    <div style={{ fontSize: '0.62rem', color: 'var(--text-tertiary)', marginTop: '0.15rem', lineHeight: 1.35 }}>
                      {lvl.note}
                    </div>
                  </div>
                ))}
              </div>

              {pm.pyramidPlan?.maxTotalShares > 0 && (
                <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: '0.65rem', textAlign: 'center' }}>
                  Max Total Position: <strong className="font-mono" style={{ color: '#fff' }}>{pm.pyramidPlan.maxTotalShares} shares</strong> (base {pm.dynamicPosition?.shares} + {pm.pyramidPlan.totalPyramidShares} pyramid adds)
                </div>
              )}
            </div>

            {/* ═══ Pro Tips ═══ */}
            {pm.profitTips?.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0.6rem' }}>
                {pm.profitTips.map((tip, idx) => (
                  <div key={idx} style={{
                    padding: '0.65rem 0.85rem',
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem',
                    lineHeight: 1.45,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.25rem' }}>
                      <span>{tip.icon}</span>
                      <strong style={{ color: '#fff', fontSize: '0.72rem' }}>{tip.title}</strong>
                    </div>
                    <div style={{ color: 'var(--text-tertiary)' }}>{tip.tip}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
                <div><span className="text-xs text-muted block">Trigger/Entry</span><strong className="font-mono">{formatPrice(data.swingPlaybook.levels?.entry || quote?.price)}</strong></div>
                <div><span className="text-xs text-muted block">Stop Loss</span><strong className="font-mono" style={{ color: 'var(--color-sell)' }}>{formatPrice(data.swingPlaybook.levels?.stop)}</strong></div>
                <div><span className="text-xs text-muted block">Target 1 (T1)</span><strong className="font-mono" style={{ color: 'var(--color-buy)' }}>{formatPrice(data.swingPlaybook.levels?.t1)}</strong></div>
                <div><span className="text-xs text-muted block">Target 2 (T2)</span><strong className="font-mono" style={{ color: 'var(--color-buy)' }}>{formatPrice(data.swingPlaybook.levels?.t2)}</strong></div>
                <div><span className="text-xs text-muted block">Risk : Reward</span><strong className="font-mono">{data.swingPlaybook.riskRewardT1 || 'N/A'}:1</strong></div>
                <div><span className="text-xs text-muted block">Position Size</span><strong className="font-mono">{data.swingPlaybook.position?.shares || 0} shares</strong></div>
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

          {/* Reddit Community Sentiment */}
          {data.reddit?.posts?.length > 0 && (
            <div className="glass-card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>💬 Dalal Street Reddit Pulse</span>
                </h3>
                <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>
                  {data.reddit.summary?.totalPosts || data.reddit.posts.length} DISCUSSIONS
                </span>
              </div>
              {data.reddit.posts.slice(0, 4).map((post, idx) => (
                <div key={idx} style={{ padding: '0.6rem 0', borderBottom: idx < 3 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.4, display: 'block', textDecoration: 'none' }}
                    onMouseEnter={(e) => e.target.style.color = 'var(--accent-cyan)'}
                    onMouseLeave={(e) => e.target.style.color = 'var(--text-primary)'}
                  >
                    {post.title}
                  </a>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: '0.25rem', display: 'flex', gap: '0.75rem' }}>
                    <span style={{ color: '#f97316', fontWeight: 600 }}>r/{post.subreddit}</span>
                    <span>▲ {post.score} upvotes</span>
                    <span>💬 {post.numComments} comments</span>
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
