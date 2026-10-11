const axios = require('axios');
const AdmZip = require('adm-zip');
const { parse } = require('csv-parse/sync');
const { db } = require('../db/setup.cjs');

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function getBhavcopyUrl(dateObj) {
  const year = dateObj.getFullYear();
  const month = MONTHS[dateObj.getMonth()];
  const day = String(dateObj.getDate()).padStart(2, '0');
  
  // Format: https://archives.nseindia.com/content/historical/EQUITIES/YYYY/MMM/cmDDMMMYYYYbhav.csv.zip
  return `https://archives.nseindia.com/content/historical/EQUITIES/${year}/${month}/cm${day}${month}${year}bhav.csv.zip`;
}

async function fetchBhavcopy(dateObj) {
  const url = getBhavcopyUrl(dateObj);
  console.log('Checking NSE Bhavcopy:', url);
  
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': '*/*'
      },
      timeout: 3000
    });
    
    return response.data;
  } catch (error) {
    console.log('NSE Bhavcopy archive not accessible (404/blocked).');
    return null;
  }
}

function processBhavcopy(zipBuffer, dateStr) {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  
  if (zipEntries.length === 0) throw new Error('Zip file is empty');
  
  const csvData = zipEntries[0].getData().toString('utf8');
  const records = parse(csvData, {
    columns: true,
    skip_empty_lines: true
  });
  
  const insert = db.prepare(`
    INSERT OR REPLACE INTO prices_daily 
    (symbol, date, open, high, low, close, volume, delivery_pct)
    VALUES (@symbol, @date, @open, @high, @low, @close, @volume, @delivery_pct)
  `);
  
  const insertUniverse = db.prepare(`
    INSERT OR IGNORE INTO universe (symbol, isin, exchange)
    VALUES (@symbol, @isin, 'NSE')
  `);
  
  let count = 0;
  
  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      if (row.SERIES !== 'EQ') continue;
      
      const symbol = row.SYMBOL;
      
      insertUniverse.run({
        symbol,
        isin: row.ISIN || ''
      });
      
      insert.run({
        symbol,
        date: dateStr,
        open: parseFloat(row.OPEN),
        high: parseFloat(row.HIGH),
        low: parseFloat(row.LOW),
        close: parseFloat(row.CLOSE),
        volume: parseInt(row.TOTTRDQTY, 10),
        delivery_pct: 0
      });
      
      count++;
    }
  });
  
  transaction(records);
  console.log(`Successfully ingested ${count} equity records for ${dateStr}.`);
}

async function runIngestion() {
  let found = false;
  for (let i = 0; i < 2; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    
    try {
      const buffer = await fetchBhavcopy(d);
      if (buffer) {
        const dateStr = d.toISOString().split('T')[0];
        processBhavcopy(buffer, dateStr);
        found = true;
        break;
      }
    } catch (err) {
      console.error('Error during ingestion:', err.message);
    }
  }
  
  if (!found) {
    console.log('Falling back to Yahoo Finance historical ingestion for universe...');
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });
    
    const universe = [
      'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'ITC', 'SBIN',
      'BHARTIARTL', 'BAJFINANCE', 'LT', 'TATAMOTORS', 'M&M', 'SUNPHARMA',
      'ZOMATO', 'IREDA', 'IRFC', 'JIOFIN', 'SUZLON', 'RVNL', 'HAL', 'BEL',
      'TRENT', 'DIXON', 'POLYCAB', 'KPITTECH', 'ANGELONE', 'BSE', 'CDSL'
    ];

    const insert = db.prepare(`
      INSERT OR REPLACE INTO prices_daily 
      (symbol, date, open, high, low, close, volume, delivery_pct)
      VALUES (@symbol, @date, @open, @high, @low, @close, @volume, 0)
    `);

    const insertUniverse = db.prepare(`
      INSERT OR IGNORE INTO universe (symbol, exchange)
      VALUES (@symbol, 'NSE')
    `);

    const insertTx = db.transaction((symbol, items) => {
      insertUniverse.run({ symbol });
      for (const item of items) {
        if (!item.close || !item.date) continue;
        insert.run({
          symbol,
          date: item.date.toISOString ? item.date.toISOString().split('T')[0] : String(item.date).split('T')[0],
          open: item.open || item.close,
          high: item.high || item.close,
          low: item.low || item.close,
          close: item.close,
          volume: item.volume || 0
        });
      }
    });

    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    const endDate = new Date();

    for (const sym of universe.slice(0, 10)) {
      try {
        const querySym = `${sym}.NS`;
        const result = await yf.historical(querySym, {
          period1: startDate,
          period2: endDate,
          interval: '1d'
        });
        if (result && result.length > 0) {
          insertTx(sym, result);
          console.log(`Ingested ${result.length} historical bars for ${sym}`);
        }
      } catch (err) {
        console.warn(`Could not sync ${sym}: ${err.message}`);
      }
    }
    console.log('Universe ingestion complete.');
  }
}

if (require.main === module) {
  runIngestion();
}

module.exports = { runIngestion };
