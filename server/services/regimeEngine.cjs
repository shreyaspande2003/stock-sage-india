// Market Regime Engine — StockSage India Quant V2
// Classifies Indian market regime into RISK_ON, NEUTRAL, or RISK_OFF
const yahooFinance = require('./yahooFinance.cjs');
const { EMA, ADX, RSI } = require('technicalindicators');
const config = require('../config/v2_config.json');
const cache = require('../utils/cache.cjs');

async function getMarketRegime() {
  const cacheKey = 'market:regime:v2';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const [niftyQuote, niftyHistory, vixQuote] = await Promise.all([
      yahooFinance.getQuote('^NSEI').catch(() => null),
      yahooFinance.getHistorical('^NSEI', '6mo', '1d').catch(() => []),
      yahooFinance.getQuote('^INDIAVIX').catch(() => null),
    ]);

    let niftyPrice = niftyQuote?.price || 0;
    let niftyChange = niftyQuote?.changePercent || 0;
    let vixPrice = vixQuote?.price || 14.5;

    if (!niftyHistory || niftyHistory.length < 50) {
      // Fallback neutral regime if history fetch fails
      return {
        regime: 'NEUTRAL',
        regimeScore: 0,
        entriesAllowed: config.regime.entries_allowed.NEUTRAL,
        regimeMultiplier: config.risk.regime_mult.NEUTRAL,
        minScoreAdd: config.regime.min_score_add.NEUTRAL,
        nifty: { price: niftyPrice, changePercent: niftyChange },
        vix: { price: vixPrice, status: 'NORMAL' },
        summary: 'Market data unavailable, defaulted to NEUTRAL regime.',
        asOf: new Date().toISOString()
      };
    }

    const closes = niftyHistory.map(d => d.close);
    if (!niftyPrice && closes.length) niftyPrice = closes[closes.length - 1];

    const ema20Arr = EMA.calculate({ values: closes, period: 20 });
    const ema50Arr = EMA.calculate({ values: closes, period: 50 });
    const ema200Arr = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : [];

    const ema20 = ema20Arr[ema20Arr.length - 1] || niftyPrice;
    const ema50 = ema50Arr[ema50Arr.length - 1] || niftyPrice;
    const ema200 = ema200Arr.length ? ema200Arr[ema200Arr.length - 1] : null;

    // 50 EMA slope (over 10 trading days)
    const ema50_10dAgo = ema50Arr.length > 10 ? ema50Arr[ema50Arr.length - 11] : ema50;
    const ema50Slope = ((ema50 - ema50_10dAgo) / ema50_10dAgo) * 100;

    // RSI & ADX
    const rsiArr = RSI.calculate({ values: closes, period: 14 });
    const currentRSI = rsiArr[rsiArr.length - 1] || 50;

    // Calculate Regime Score
    let score = 0;
    const signals = [];

    // Trend Components
    if (niftyPrice > ema20) {
      score += 1;
      signals.push('NIFTY above 20 EMA (+1)');
    } else {
      score -= 1;
      signals.push('NIFTY below 20 EMA (-1)');
    }

    if (niftyPrice > ema50) {
      score += 1;
      signals.push('NIFTY above 50 EMA (+1)');
    } else {
      score -= 1;
      signals.push('NIFTY below 50 EMA (-1)');
    }

    if (ema20 > ema50) {
      score += 1;
      signals.push('20 EMA > 50 EMA bullish alignment (+1)');
    }

    if (ema50Slope > 0) {
      score += 1;
      signals.push('50 EMA sloping upward (+1)');
    } else {
      score -= 1;
      signals.push('50 EMA sloping downward (-1)');
    }

    if (ema200 && niftyPrice > ema200) {
      score += 1;
      signals.push('NIFTY above 200 DMA macro bull (+1)');
    } else if (ema200 && niftyPrice < ema200) {
      score -= 2;
      signals.push('NIFTY below 200 DMA macro bear (-2)');
    }

    // Volatility / VIX Components
    let vixStatus = 'MODERATE';
    if (vixPrice < 15) {
      score += 1;
      vixStatus = 'LOW_VOLATILITY';
      signals.push(`India VIX low at ${vixPrice.toFixed(1)} (+1)`);
    } else if (vixPrice > 22) {
      score -= 2;
      vixStatus = 'ELEVATED_VOLATILITY';
      signals.push(`India VIX spiked to ${vixPrice.toFixed(1)} (-2)`);
    } else if (vixPrice > 18) {
      score -= 1;
      vixStatus = 'CAUTIOUS';
      signals.push(`India VIX elevated at ${vixPrice.toFixed(1)} (-1)`);
    }

    // Classify Regime
    let regime = 'NEUTRAL';
    if (score >= config.regime.risk_on_min) {
      regime = 'RISK_ON';
    } else if (score <= config.regime.risk_off_max) {
      regime = 'RISK_OFF';
    }

    const result = {
      regime,
      regimeScore: score,
      entriesAllowed: config.regime.entries_allowed[regime] ?? 3,
      regimeMultiplier: config.risk.regime_mult[regime] ?? 0.5,
      minScoreAdd: config.regime.min_score_add[regime] ?? 5,
      nifty: {
        price: Math.round(niftyPrice * 100) / 100,
        changePercent: Math.round(niftyChange * 100) / 100,
        ema20: Math.round(ema20 * 100) / 100,
        ema50: Math.round(ema50 * 100) / 100,
        ema200: ema200 ? Math.round(ema200 * 100) / 100 : null,
        rsi: Math.round(currentRSI),
        ema50Slope: Math.round(ema50Slope * 100) / 100
      },
      vix: {
        price: Math.round(vixPrice * 100) / 100,
        status: vixStatus
      },
      signals,
      summary: regime === 'RISK_ON'
        ? 'Market in clean uptrend. Full risk deployment permitted (up to 5 new swing trades).'
        : regime === 'NEUTRAL'
        ? 'Market in choppy or transitional phase. Selective trades only with halved position sizes (max 3).'
        : 'Market in high risk / breakdown regime. Cash preservation mode. 0 new long swing entries permitted.',
      asOf: new Date().toISOString()
    };

    cache.set(cacheKey, result, 900); // 15 mins cache
    return result;
  } catch (err) {
    console.error('[RegimeEngine] Error calculating regime:', err.message);
    return {
      regime: 'NEUTRAL',
      regimeScore: 0,
      entriesAllowed: 3,
      regimeMultiplier: 0.5,
      minScoreAdd: 5,
      summary: 'Regime calculation error, safe fallback applied.',
      asOf: new Date().toISOString()
    };
  }
}

module.exports = { getMarketRegime };
