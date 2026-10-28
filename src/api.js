// API helper — centralized fetch wrapper for all backend calls
const API_BASE = '/api';
const analysisMem = new Map();

async function apiFetch(path, options = {}) {
  const { method = 'GET', body, headers = {}, signal } = options;
  
  const config = {
    method,
    headers: {
      ...headers,
    },
    signal,
  };

  if (body && !(body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    config.body = body;
  }

  const response = await fetch(`${API_BASE}${path}`, config);
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || `API error: ${response.status}`);
  }
  
  return data;
}

export const searchStocks = (query) => apiFetch(`/stocks/search?q=${encodeURIComponent(query)}`);
export const getQuote = (symbol) => apiFetch(`/stocks/quote/${symbol}`);
export const getHistorical = (symbol, range = '6mo') => apiFetch(`/stocks/historical/${symbol}?range=${range}`);
export const scanSwingSetups = (tier = 'PRO') => apiFetch(`/stocks/scan?tier=${tier}`);
export const getMorningTriggers = (tier = 'PRO') => apiFetch(`/stocks/morning-triggers?tier=${tier}`);
export const getMarketRegime = () => apiFetch('/stocks/regime');
export const getBacktestResults = () => apiFetch('/stocks/backtest');

export const initAI = (apiKey, useProModel = false) => apiFetch('/analysis/init', { method: 'POST', body: { apiKey, useProModel } });
export const getAIStatus = () => apiFetch('/analysis/status');
export const fetchStockData = async (symbol, newsApiKey = '', { signal, force } = {}) => {
  const key = `data:${String(symbol).toUpperCase()}`;
  if (!force) {
    const hit = analysisMem.get(key);
    if (hit && Date.now() - hit.at < 25 * 60 * 1000) return hit.data;
  }
  const data = await apiFetch('/analysis/data', { method: 'POST', body: { symbol, newsApiKey }, signal });
  analysisMem.set(key, { at: Date.now(), data });
  return data;
};

export const analyzeStock = async (symbol, newsApiKey = '', { signal, force } = {}) => {
  const key = String(symbol).toUpperCase();
  if (!force) {
    const hit = analysisMem.get(key);
    if (hit && Date.now() - hit.at < 25 * 60 * 1000) return hit.data;
  }
  const data = await apiFetch('/analysis/analyze', { method: 'POST', body: { symbol, newsApiKey }, signal });
  analysisMem.set(key, { at: Date.now(), data });
  return data;
};
export const getMarketNews = () => apiFetch('/analysis/market-news');

export const uploadPortfolio = (file) => {
  const formData = new FormData();
  formData.append('portfolio', file);
  return apiFetch('/portfolio/upload', { method: 'POST', body: formData });
};
export const loadGrowwStatement = () => apiFetch('/portfolio/load-groww-file', { method: 'POST' });
export const submitManualPortfolio = (holdings) => apiFetch('/portfolio/manual', { method: 'POST', body: { holdings } });
export const analyzeHolding = (symbol, quantity, buyPrice) => apiFetch('/portfolio/analyze-holding', { method: 'POST', body: { symbol, quantity, buyPrice } });
export const analyzePortfolio = (holdings) => apiFetch('/portfolio/analyze-all', { method: 'POST', body: { holdings } });

