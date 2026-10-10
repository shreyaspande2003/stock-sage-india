import React from 'react';

export default function Navbar({ currentPage, setCurrentPage, isAIReady }) {
  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'watchlist', label: 'Watchlist', icon: '👁️' },
    { key: 'portfolio', label: 'Portfolio', icon: '💼' },
    { key: 'settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <nav className="navbar">
      <div className="navbar-brand" onClick={() => setCurrentPage('dashboard')}>
        <span className="navbar-brand-icon">🧠</span>
        <div>
          <h1>StockSage India</h1>
          <span>AI-Powered Multi-Expert Analysis</span>
        </div>
      </div>

      <div className="navbar-nav">
        {navItems.map(item => (
          <button
            key={item.key}
            className={`nav-item ${currentPage === item.key ? 'active' : ''}`}
            onClick={() => setCurrentPage(item.key)}
          >
            {item.icon} <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className={`ai-status ${isAIReady ? 'ready' : 'not-ready'}`}>
        <span className="ai-status-dot"></span>
        {isAIReady ? 'AI Ready' : 'AI Not Connected'}
      </div>
    </nav>
  );
}
