const { db } = require('../db/setup.cjs');
const config = require('../config/v2_config.json');

function getTradableUniverse() {
  const minPrice = config.universe.min_price || 50;
  // Note: 5 crore is 50,000,000 INR
  const minTradedValue = (config.universe.min_avg_traded_value_cr || 5) * 10000000;

  // Since we only have a daily snapshot currently, we'll approximate the 20-day avg 
  // with the latest available day's traded value.
  const query = `
    SELECT u.symbol, p.close, p.volume, (p.close * p.volume) as traded_value
    FROM universe u
    JOIN prices_daily p ON u.symbol = p.symbol
    WHERE p.date = (SELECT MAX(date) FROM prices_daily WHERE symbol = u.symbol)
      AND p.close >= ? 
      AND (p.close * p.volume) >= ?
      AND (u.flags IS NULL OR u.flags NOT LIKE '%ASM%')
  `;

  const rows = db.prepare(query).all(minPrice, minTradedValue);
  
  return rows.map(r => r.symbol);
}

module.exports = { getTradableUniverse };
