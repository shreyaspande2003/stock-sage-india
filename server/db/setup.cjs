const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'stocksage_v2.db');
const db = new Database(dbPath);

function setup() {
  console.log('Initializing StockSage v2 Database Schema...');

  db.exec(`
    CREATE TABLE IF NOT EXISTS prices_daily (
      symbol TEXT,
      date TEXT,
      open REAL,
      high REAL,
      low REAL,
      close REAL,
      volume INTEGER,
      delivery_pct REAL,
      adj_factor REAL DEFAULT 1.0,
      PRIMARY KEY (symbol, date)
    );

    CREATE TABLE IF NOT EXISTS corp_actions (
      symbol TEXT,
      ex_date TEXT,
      type TEXT,
      ratio REAL,
      PRIMARY KEY (symbol, ex_date, type)
    );

    CREATE TABLE IF NOT EXISTS universe (
      symbol TEXT PRIMARY KEY,
      isin TEXT,
      exchange TEXT,
      sector TEXT,
      industry TEXT,
      listing_date TEXT,
      flags TEXT
    );

    CREATE TABLE IF NOT EXISTS signals (
      date TEXT,
      symbol TEXT,
      setup TEXT,
      score INTEGER,
      entry REAL,
      stop REAL,
      t1 REAL,
      t2 REAL,
      regime TEXT,
      features_json TEXT,
      PRIMARY KEY (date, symbol)
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      symbol TEXT,
      signal_date TEXT,
      entry_fill REAL,
      exit_fill REAL,
      exit_reason TEXT,
      pnl_r REAL,
      notes TEXT
    );
  `);

  console.log('Schema initialized successfully at:', dbPath);
}

setup();

module.exports = { db, setup };
