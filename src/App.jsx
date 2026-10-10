import React, { useState, useEffect, Suspense, lazy } from 'react';
import Navbar from './components/Navbar.jsx';
import Dashboard from './components/Dashboard.jsx';
import StockAnalysis from './components/StockAnalysis.jsx';
import './App.css';

const PortfolioManager = lazy(() => import('./components/PortfolioManager.jsx'));
const Watchlist = lazy(() => import('./components/Watchlist.jsx'));
const Settings = lazy(() => import('./components/Settings.jsx'));
import './App.css';

export default function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [analysisData, setAnalysisData] = useState(null);
  const [isAIReady, setIsAIReady] = useState(false);
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('stocksage_settings');
    let parsed = saved ? JSON.parse(saved) : { geminiKey: '', newsApiKey: '', useProModel: false };
    // Clear old Google keys since we moved to OpenRouter
    if (parsed.geminiKey && !parsed.geminiKey.startsWith('sk-or-')) {
        parsed.geminiKey = '';
    }
    return parsed;
  });

  useEffect(() => {
    localStorage.setItem('stocksage_settings', JSON.stringify(settings));
  }, [settings]);

  const handleAnalyze = (data) => {
    setAnalysisData(data);
    setCurrentPage('analysis');
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard onAnalyze={handleAnalyze} settings={settings} isAIReady={isAIReady} setIsAIReady={setIsAIReady} />;
      case 'analysis':
        return <StockAnalysis data={analysisData} onBack={() => setCurrentPage('dashboard')} settings={settings} isAIReady={isAIReady} setIsAIReady={setIsAIReady} />;
      case 'watchlist':
        return <Watchlist onAnalyze={handleAnalyze} settings={settings} isAIReady={isAIReady} setIsAIReady={setIsAIReady} />;
      case 'portfolio':
        return <PortfolioManager settings={settings} isAIReady={isAIReady} onAnalyze={handleAnalyze} />;
      case 'settings':
        return <Settings settings={settings} setSettings={setSettings} isAIReady={isAIReady} setIsAIReady={setIsAIReady} />;
      default:
        return <Dashboard onAnalyze={handleAnalyze} settings={settings} isAIReady={isAIReady} setIsAIReady={setIsAIReady} />;
    }
  };

  return (
    <div className="app">
      <Navbar currentPage={currentPage} setCurrentPage={setCurrentPage} isAIReady={isAIReady} />
      <main className="main-content">
        <Suspense fallback={<div className="loading-overlay"><div className="spinner"></div></div>}>
          {renderPage()}
        </Suspense>
      </main>
    </div>
  );
}
