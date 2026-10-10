// Data Aggregator — orchestrates all data services to build a complete stock data packet
const yahooFinance = require('./yahooFinance.cjs');
const { calculateIndicators } = require('./technicalAnalysis.cjs');
const { getNewsForStock, getNewsFromNewsAPI } = require('./newsService.cjs');
const { getRedditSentiment } = require('./redditService.cjs');
const { buildSwingPlaybook } = require('./swingEngine.cjs');
const cache = require('../utils/cache.cjs');

async function aggregateStockData(symbol, options = {}) {
  const cacheKey = `aggregate:v2:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  console.log(`[DataAggregator] Collecting data for ${symbol}...`);

  const [quote, historical6m, news, newsAPI, reddit] = await Promise.allSettled([
    yahooFinance.getQuote(symbol),
    yahooFinance.getHistorical(symbol, '1y', '1d'),
    getNewsForStock(symbol, options.companyName),
    getNewsFromNewsAPI(symbol, options.companyName, options.newsApiKey),
    getRedditSentiment(symbol, options.companyName),
  ]);

  const quoteData = quote.status === 'fulfilled' ? quote.value : null;
  const hist6m = historical6m.status === 'fulfilled' ? historical6m.value : [];
  const newsData = news.status === 'fulfilled' ? news.value : [];
  const newsAPIData = newsAPI.status === 'fulfilled' ? newsAPI.value : [];
  const redditData = reddit.status === 'fulfilled' ? reddit.value : { posts: [], summary: {} };

  if (!quoteData) {
    throw new Error(`Could not fetch quote data for ${symbol}. Please verify the stock symbol.`);
  }

  const technicals = calculateIndicators(hist6m);
  const swingPlaybook = buildSwingPlaybook(quoteData, technicals, hist6m);

  const allNews = [...newsData, ...newsAPIData];
  const uniqueNews = allNews.filter((item, index, self) =>
    index === self.findIndex(n => n.title.toLowerCase().substring(0, 40) === item.title.toLowerCase().substring(0, 40))
  ).slice(0, 15);

  const packet = {
    symbol: symbol.toUpperCase(),
    fetchedAt: new Date().toISOString(),
    quote: quoteData,
    technicals,
    swingPlaybook,
    news: uniqueNews,
    reddit: redditData,
    chartData: hist6m.map(d => ({
      date: d.date,
      time: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    })),
  };

  cache.set(cacheKey, packet, 600);
  console.log(`[DataAggregator] Data packet ready for ${symbol}`);
  return packet;
}

module.exports = { aggregateStockData };
