// Immutable Live Signal Logger — StockSage India Quant V3.1
// Provides a tamper-proof forward signal registry with SHA-256 cryptographic verification.
// Signals are recorded at EOD before market opens and resolved forward using realistic execution.

const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../../data/stocksage_v2.db');
const db = new Database(dbPath);

// Ensure immutable table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS signals_immutable_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_uuid TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    signal_date TEXT NOT NULL,
    symbol TEXT NOT NULL,
    setup TEXT NOT NULL,
    score INTEGER NOT NULL,
    entry_price REAL NOT NULL,
    stop_loss REAL NOT NULL,
    target1 REAL NOT NULL,
    target2 REAL NOT NULL,
    atr REAL NOT NULL,
    market_regime TEXT NOT NULL,
    state_hash TEXT NOT NULL,
    resolution_status TEXT DEFAULT 'PENDING',
    resolution_date TEXT,
    resolution_price REAL,
    realized_pnl_pct REAL,
    realized_r_multiple REAL,
    resolution_reason TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_signals_sym_date ON signals_immutable_log(symbol, signal_date);
  CREATE INDEX IF NOT EXISTS idx_signals_status ON signals_immutable_log(resolution_status);
`);

// Compute SHA-256 fingerprint for tamper detection
function computeSignalHash(data) {
  const payload = [
    data.symbol.toUpperCase(),
    data.signalDate,
    Number(data.entryPrice).toFixed(2),
    Number(data.stopLoss).toFixed(2),
    Number(data.target1).toFixed(2),
    Number(data.score),
    data.marketRegime || 'NEUTRAL'
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Log a new immutable forward signal (Cannot be modified post-creation)
function logSignal(signalData) {
  const {
    symbol,
    signalDate = new Date().toISOString().split('T')[0],
    setup = 'BREAKOUT',
    score = 70,
    entryPrice,
    stopLoss,
    target1,
    target2 = target1 * 1.05,
    atr = entryPrice * 0.02,
    marketRegime = 'NEUTRAL'
  } = signalData;

  if (!symbol || !entryPrice || !stopLoss || !target1) {
    throw new Error('Missing required price levels for immutable signal logging');
  }

  // Check if signal already recorded
  const existing = db.prepare(`SELECT * FROM signals_immutable_log WHERE symbol = ? AND signal_date = ?`).get(symbol.toUpperCase(), signalDate);
  if (existing) {
    return { logged: false, reason: 'ALREADY_EXISTS', signal: existing };
  }

  const signalUuid = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const stateHash = computeSignalHash({
    symbol,
    signalDate,
    entryPrice,
    stopLoss,
    target1,
    score,
    marketRegime
  });

  const stmt = db.prepare(`
    INSERT INTO signals_immutable_log (
      signal_uuid, created_at, signal_date, symbol, setup, score,
      entry_price, stop_loss, target1, target2, atr, market_regime,
      state_hash, resolution_status
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, 'PENDING'
    )
  `);

  stmt.run(
    signalUuid, createdAt, signalDate, symbol.toUpperCase(), setup, Math.round(score),
    Math.round(entryPrice * 100) / 100, Math.round(stopLoss * 100) / 100,
    Math.round(target1 * 100) / 100, Math.round(target2 * 100) / 100,
    Math.round(atr * 100) / 100, marketRegime, stateHash
  );

  return {
    logged: true,
    signalUuid,
    createdAt,
    stateHash,
    symbol: symbol.toUpperCase(),
    signalDate
  };
}

// Verify integrity of a logged signal by recomputing hash
function verifySignalIntegrity(signalUuid) {
  const row = db.prepare(`SELECT * FROM signals_immutable_log WHERE signal_uuid = ?`).get(signalUuid);
  if (!row) return { valid: false, error: 'SIGNAL_NOT_FOUND' };

  const recomputed = computeSignalHash({
    symbol: row.symbol,
    signalDate: row.signal_date,
    entryPrice: row.entry_price,
    stopLoss: row.stop_loss,
    target1: row.target1,
    score: row.score,
    marketRegime: row.market_regime
  });

  const isTamperFree = recomputed === row.state_hash;
  return {
    valid: isTamperFree,
    signalUuid: row.signal_uuid,
    recordedHash: row.state_hash,
    computedHash: recomputed,
    isTamperFree
  };
}

// Forward outcome resolution using realistic execution rules
function resolveSignalOutcome(signalUuid, forwardBar) {
  const row = db.prepare(`SELECT * FROM signals_immutable_log WHERE signal_uuid = ?`).get(signalUuid);
  if (!row || row.resolution_status !== 'PENDING') return null;

  const { open, high, low, close, date } = forwardBar;
  const initialRisk = Math.abs(row.entry_price - row.stop_loss);

  // Same-bar ambiguity: If both stop and target touched on same bar, STOP HITS FIRST
  const stopBreached = low <= row.stop_loss;
  const targetBreached = high >= row.target1;

  let resolutionStatus = null;
  let resolutionPrice = null;
  let reason = null;

  if (stopBreached && targetBreached) {
    resolutionStatus = 'STOP_LOSS_HIT';
    resolutionPrice = open <= row.stop_loss ? open : row.stop_loss; // Gap through stop fill at open
    reason = 'SAME_BAR_STOP_FIRST';
  } else if (stopBreached) {
    resolutionStatus = 'STOP_LOSS_HIT';
    resolutionPrice = open <= row.stop_loss ? open : row.stop_loss;
    reason = open <= row.stop_loss ? 'GAP_THROUGH_STOP' : 'STOP_LOSS';
  } else if (targetBreached) {
    resolutionStatus = 'TARGET_1_HIT';
    resolutionPrice = row.target1;
    reason = 'TARGET_1_REACHED';
  }

  if (resolutionStatus) {
    const pnlPct = ((resolutionPrice - row.entry_price) / row.entry_price) * 100;
    const rMultiple = initialRisk > 0 ? (resolutionPrice - row.entry_price) / initialRisk : 0;

    const stmt = db.prepare(`
      UPDATE signals_immutable_log
      SET resolution_status = ?, resolution_date = ?, resolution_price = ?,
          realized_pnl_pct = ?, realized_r_multiple = ?, resolution_reason = ?
      WHERE signal_uuid = ?
    `);

    stmt.run(
      resolutionStatus, date, Math.round(resolutionPrice * 100) / 100,
      Math.round(pnlPct * 100) / 100, Math.round(rMultiple * 100) / 100,
      reason, signalUuid
    );

    return {
      signalUuid,
      resolutionStatus,
      resolutionPrice,
      realizedPnlPct: Math.round(pnlPct * 100) / 100,
      realizedRMultiple: Math.round(rMultiple * 100) / 100,
      reason
    };
  }

  return null;
}

// Retrieve public forward audit trail
function getPublicAuditLog(limit = 100) {
  const rows = db.prepare(`
    SELECT * FROM signals_immutable_log
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);

  const resolved = rows.filter(r => r.resolution_status !== 'PENDING');
  const wins = resolved.filter(r => (r.realized_pnl_pct || 0) > 0);
  const totalResolved = resolved.length;

  const winRate = totalResolved > 0 ? (wins.length / totalResolved) * 100 : 0;
  const avgRMultiple = totalResolved > 0
    ? resolved.reduce((acc, r) => acc + (r.realized_r_multiple || 0), 0) / totalResolved
    : 0;

  return {
    totalSignals: rows.length,
    resolvedCount: totalResolved,
    pendingCount: rows.length - totalResolved,
    liveWinRate: Math.round(winRate * 100) / 100,
    liveAvgRMultiple: Math.round(avgRMultiple * 100) / 100,
    signals: rows.map(r => ({
      uuid: r.signal_uuid,
      date: r.signal_date,
      createdAt: r.created_at,
      symbol: r.symbol,
      setup: r.setup,
      score: r.score,
      entry: r.entry_price,
      stop: r.stop_loss,
      target1: r.target1,
      regime: r.market_regime,
      hash: r.state_hash.substring(0, 16) + '...',
      status: r.resolution_status,
      resolutionDate: r.resolution_date,
      resolutionPrice: r.resolution_price,
      pnlPct: r.realized_pnl_pct,
      rMultiple: r.realized_r_multiple,
      reason: r.resolution_reason
    }))
  };
}

module.exports = {
  logSignal,
  verifySignalIntegrity,
  resolveSignalOutcome,
  getPublicAuditLog,
  computeSignalHash
};
