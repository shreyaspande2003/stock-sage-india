const { aggregateStockData } = require('./server/services/dataAggregator.cjs');

async function test() {
  console.log('Fetching data for RELIANCE...');
  try {
    const data = await aggregateStockData('RELIANCE', { newsApiKey: '' });
    console.log('Quote:', data.quote.price, data.quote.name);
    console.log('Technicals overall score:', data.technicals.overallTechnicalScore);
    console.log('News items:', data.news.length);
    console.log('Reddit posts:', data.reddit.posts.length);
    console.log('Data aggregation works perfectly!');
  } catch (err) {
    console.error('Error:', err);
  }
}

test();
