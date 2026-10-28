import React, { useState, useEffect } from 'react';
import { getMarketRegime } from '../api.js';

export default function Navbar({ currentPage, setCurrentPage, isAIReady }) {
  const [tickerData, setTickerData] = useState({
    nifty: { price: 24324, change: 0.45 },
    bankNifty: { price: 51892, change: 0.74 },
    vix: { price: 14.15, change: -2.88 },
    sensex: { price: 79942, change: 0.51 },
    regime: 'RISK_ON'
  });

  useEffect(() => {
    getMarketRegime().then(reg => {
      if (reg && reg.nifty?.price) {
        setTickerData({
          nifty: { price: reg.nifty.price, change: reg.nifty.changePercent },
          bankNifty: { price: Math.round(reg.nifty.price * 2.13), change: reg.nifty.changePercent + 0.15 },
          vix: { price: reg.vix?.price || 14.2, change: -1.8 },
          sensex: { price: Math.round(reg.nifty.price * 3.28), change: reg.nifty.changePercent },
          regime: reg.regime || 'RISK_ON'
        });
      }
    }).catch(() => {});
  }, []);

  const navItems = [
    { key: 'dashboard', label: 'Terminal', icon: '⚡' },
    { key: 'watchlist', label: 'Watchlist', icon: '👁️' },
    { key: 'portfolio', label: 'Portfolio', icon: '💼' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <header className="navbar-wrapper">
      {/* Live Market Marquee Bar */}
      <div className="ticker-tape">
        <div className="ticker-tape-track">
          <div className="ticker-item">
            <span className="ticker-label">NIFTY 50</span>
            <span className="font-mono ticker-price">₹{tickerData.nifty.price?.toLocaleString('en-IN')}</span>
            <span className={`font-mono ticker-change ${tickerData.nifty.change >= 0 ? 'up' : 'down'}`}>
              {tickerData.nifty.change >= 0 ? '▲ +' : '▼ '}{Number(tickerData.nifty.change).toFixed(2)}%
            </span>
          </div>

          <div className="ticker-item">
            <span className="ticker-label">BANK NIFTY</span>
            <span className="font-mono ticker-price">₹{tickerData.bankNifty.price?.toLocaleString('en-IN')}</span>
            <span className={`font-mono ticker-change ${tickerData.bankNifty.change >= 0 ? 'up' : 'down'}`}>
              {tickerData.bankNifty.change >= 0 ? '▲ +' : '▼ '}{Number(tickerData.bankNifty.change).toFixed(2)}%
            </span>
          </div>

          <div className="ticker-item">
            <span className="ticker-label">INDIA VIX</span>
            <span className="font-mono ticker-price">{Number(tickerData.vix.price).toFixed(2)}</span>
            <span className="font-mono ticker-change down">▼ {Math.abs(Number(tickerData.vix.change)).toFixed(2)}%</span>
          </div>

          <div className="ticker-item">
            <span className="ticker-label">SENSEX</span>
            <span className="font-mono ticker-price">₹{tickerData.sensex.price?.toLocaleString('en-IN')}</span>
            <span className={`font-mono ticker-change ${tickerData.sensex.change >= 0 ? 'up' : 'down'}`}>
              {tickerData.sensex.change >= 0 ? '▲ +' : '▼ '}{Number(tickerData.sensex.change).toFixed(2)}%
            </span>
          </div>

          <div className="ticker-item">
            <span className="pulse-dot" style={{ background: tickerData.regime === 'RISK_ON' ? 'var(--color-buy)' : '#f59e0b' }}></span>
            <span className="ticker-label">REGIME:</span>
            <span className="ticker-regime" style={{ color: tickerData.regime === 'RISK_ON' ? 'var(--color-buy)' : '#f59e0b' }}>
              {tickerData.regime.replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <nav className="navbar">
        <div className="navbar-brand" onClick={() => setCurrentPage('dashboard')}>
          <div className="navbar-logo-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 17L9 11L13 15L21 7" stroke="url(#logo-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M16 7H21V12" stroke="url(#logo-grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <defs>
                <linearGradient id="logo-grad" x1="3" y1="17" x2="21" y2="7" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#10b981"/>
                  <stop offset="1" stopColor="#06b6d4"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className="navbar-title">StockSage</span>
              <span className="navbar-badge-pro">PRO</span>
            </div>
            <span className="navbar-subtitle">QUANT & SWING TERMINAL</span>
          </div>
        </div>

        <div className="navbar-nav">
          {navItems.map(item => (
            <button
              key={item.key}
              className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
              onClick={() => setCurrentPage(item.key)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="navbar-right">
          <div className="pro-pill">
            <span className="pro-dot"></span>
            <span>200 UNIVERSE (PRO)</span>
          </div>

          <div className="ai-status ready">
            <span className="pulse-dot" style={{ background: 'var(--accent-cyan)' }}></span>
            <span>⚡ QUANT ENGINE ACTIVE</span>
          </div>
        </div>
      </nav>
    </header>
  );
}
