// Reddit service — fetches stock discussions from Indian finance subreddits
const cache = require('../utils/cache.cjs');
const { limiters } = require('../utils/rateLimiter.cjs');

const SUBREDDITS = ['IndianStreetBets', 'IndianStockMarket', 'NSEbets'];

async function getRedditSentiment(symbol, companyName) {
  const cacheKey = `reddit:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const allPosts = [];

  const subResults = await Promise.all(SUBREDDITS.map(async (sub) => {
    try {
      await limiters.reddit.acquire();
      const query = encodeURIComponent(`${symbol} OR ${companyName || symbol}`);
      const url = `https://www.reddit.com/r/${sub}/search.json?q=${query}&restrict_sr=1&sort=new&limit=15&t=month`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'StockSageIndia/1.0 (Personal Analysis Tool)',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) return [];

      const data = await response.json();
      const posts = data?.data?.children || [];

      return posts.map(post => {
        const p = post.data;
        return {
          subreddit: sub,
          title: p.title || '',
          selftext: (p.selftext || '').substring(0, 300),
          score: p.score || 0,
          upvoteRatio: p.upvote_ratio || 0,
          numComments: p.num_comments || 0,
          created: new Date(p.created_utc * 1000).toISOString(),
          url: `https://reddit.com${p.permalink}`,
          flair: p.link_flair_text || '',
        };
      });
    } catch (err) {
      console.error(`[Reddit] Error fetching from r/${sub}:`, err.message);
      return [];
    }
  }));

  subResults.forEach(list => allPosts.push(...list));

  // Sort by score + comments engagement
  allPosts.sort((a, b) => (b.score + b.numComments) - (a.score + a.numComments));

  const result = {
    posts: allPosts.slice(0, 20),
    summary: {
      totalPosts: allPosts.length,
      totalEngagement: allPosts.reduce((sum, p) => sum + p.score + p.numComments, 0),
      avgScore: allPosts.length > 0 ? Math.round(allPosts.reduce((sum, p) => sum + p.score, 0) / allPosts.length) : 0,
      subredditBreakdown: SUBREDDITS.reduce((acc, sub) => {
        acc[sub] = allPosts.filter(p => p.subreddit === sub).length;
        return acc;
      }, {}),
    },
  };

  cache.set(cacheKey, result, 1800); // 30-min cache
  return result;
}

module.exports = { getRedditSentiment };
