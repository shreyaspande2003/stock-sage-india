// News service — aggregates financial news from Google News RSS and optional NewsAPI
const { parseStringPromise } = require('xml2js');
const cache = require('../utils/cache.cjs');
const { limiters } = require('../utils/rateLimiter.cjs');

// Fetch stock-specific news via Google News RSS
async function getNewsForStock(symbol, companyName) {
  const cacheKey = `news:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const allNews = [];

  try {
    // Google News RSS
    const queries = [
      `${symbol}+stock+NSE`,
      `${companyName || symbol}+share+price`,
    ];

    const fetches = queries.map(async (query) => {
      await limiters.googleNews.acquire();
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (!response.ok) return [];
        const xml = await response.text();
        const parsed = await parseStringPromise(xml, { explicitArray: false });
        const items = parsed?.rss?.channel?.item;
        if (!items) return [];
        const itemArray = Array.isArray(items) ? items : [items];
        return itemArray.slice(0, 10).map(item => ({
          title: item.title || '',
          source: item.source?._ || item.source || 'Unknown',
          link: item.link || '',
          pubDate: item.pubDate || '',
          description: cleanHtml(item.description || ''),
        }));
      } catch (err) {
        console.error(`[News] RSS fetch error for query "${query}":`, err.message);
        return [];
      }
    });

    const batches = await Promise.all(fetches);
    batches.forEach(list => allNews.push(...list));

    // Deduplicate by title similarity
    const uniqueNews = deduplicateNews(allNews);
    const result = uniqueNews.slice(0, 15);
    
    cache.set(cacheKey, result, 1800); // 30-min cache
    return result;
  } catch (err) {
    console.error(`[News] Error fetching news for ${symbol}:`, err.message);
    return [];
  }
}

// Try NewsAPI if key is provided
async function getNewsFromNewsAPI(symbol, companyName, apiKey) {
  if (!apiKey) return [];
  
  const cacheKey = `newsapi:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const query = `${companyName || symbol} stock`;
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${apiKey}`;
    
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const data = await response.json();
    const articles = (data.articles || []).map(a => ({
      title: a.title || '',
      source: a.source?.name || 'Unknown',
      link: a.url || '',
      pubDate: a.publishedAt || '',
      description: a.description || '',
    }));

    cache.set(cacheKey, articles, 1800);
    return articles;
  } catch (err) {
    console.error(`[NewsAPI] Error:`, err.message);
    return [];
  }
}

// Get general market news
async function getMarketNews() {
  const cacheKey = 'market:news:general';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    await limiters.googleNews.acquire();
    const url = 'https://news.google.com/rss/search?q=Indian+Stock+Market+NSE+NIFTY&hl=en-IN&gl=IN&ceid=IN:en';
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });

    if (!response.ok) return [];

    const xml = await response.text();
    const parsed = await parseStringPromise(xml, { explicitArray: false });
    const items = parsed?.rss?.channel?.item;

    if (!items) return [];

    const itemArray = Array.isArray(items) ? items : [items];
    const result = itemArray.slice(0, 10).map(item => ({
      title: item.title || '',
      source: item.source?._ || item.source || 'Unknown',
      link: item.link || '',
      pubDate: item.pubDate || '',
      description: cleanHtml(item.description || ''),
    }));

    cache.set(cacheKey, result, 900); // 15-min cache
    return result;
  } catch (err) {
    console.error(`[News] Market news error:`, err.message);
    return [];
  }
}

function cleanHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
}

function deduplicateNews(articles) {
  const seen = new Set();
  return articles.filter(a => {
    const key = a.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { getNewsForStock, getNewsFromNewsAPI, getMarketNews };
