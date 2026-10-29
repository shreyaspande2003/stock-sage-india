// Portfolio routes — CSV upload, analysis, recommendations
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { aggregateStockData } = require('../services/dataAggregator.cjs');
const { isInitialized, runExpertPipeline } = require('../services/aiEngine.cjs');
const yahooFinance = require('../services/yahooFinance.cjs');
const { UNIVERSE_200 } = require('../config/universe200.cjs');
const XLSX = require('xlsx');
const cache = require('../utils/cache.cjs');

// Configure multer for file upload (supports up to 10MB CSV or Excel files)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Static ISIN -> NSE Ticker Dictionary (covers user holdings and top Indian assets)
const ISIN_TO_SYMBOL_MAP = {
  // User's holdings from Groww statement
  'INE618L01018': '5PAISA',
  'INE117A01022': 'ABB',
  'INE012A01025': 'ACC',
  'INE793A01012': 'ACCELYA',
  'INE062D01024': 'ALICON',
  'INE1YPB01014': 'AGL',
  'INE418H01029': 'ALLCARGO',
  'INE263A01024': 'BEL',
  'INE836A01035': 'BSOFT',
  'INE0BV301023': 'MAPMYINDIA',
  'INE522F01014': 'COALINDIA',
  'INE111A01025': 'CONCOR',
  'INE509F01029': 'CUPID',
  'INE07O001026': 'EASEMYTRIP',
  'INE131A01031': 'GMDCLTD',
  'INE419U01012': 'HAPPSTMNDS',
  'INE860A01027': 'HCLTECH',
  'INE040A01034': 'HDFCBANK',
  'INE549A01026': 'HCC',
  'INF109KC1NT3': 'GOLDIETF',
  'INF109KC1Y56': 'SILVERIETF',
  'INE092T01019': 'IDFCFIRSTB',
  'INE242A01010': 'IOC',
  'INE095A01012': 'INDUSINDBK',
  'INE154A01025': 'ITC',
  'INE070D01027': 'JAICORPLTD',
  'INE0BJO01010': 'JPL',
  'INE121E01018': 'JSWENERGY',
  'INE880J01026': 'JSWINFRA',
  'INE599M01018': 'JUSTDIAL',
  'INE619B01017': 'NEWGEN',
  'INF732E01045': 'JUNIORBEES',
  'INF204KB1V68': 'MID150BEES',
  'INF204KB14I2': 'NIFTYBEES',
  'INE584A01023': 'NMDC',
  'INE0ONG01011': 'NTPCGREEN',
  'INE733E01010': 'NTPC',
  'INE877F01012': 'PTC',
  'INE411H01032': 'RSYSTEMS',
  'INE602W01027': 'SENCO',
  'INE964H01014': 'SEPC',
  'INE062A01020': 'SBIN',
  'INE660A01013': 'SUNDARMFIN',
  'INE040H01021': 'SUZLON',
  'INE467B01029': 'TCS',
  'INE142M01025': 'TATATECH',
  'INE763I01026': 'TARIL',
  'INE735W01017': 'UTKARSHBNK',
  'INE200M01039': 'VBL',
  'INE299N01021': 'WAAREERTL',

  // Major benchmark Indian bluechips and ETFs
  'INE002A01018': 'RELIANCE',
  'INE009A01021': 'INFY',
  'INE090A01021': 'ICICIBANK',
  'INE018A01030': 'LT',
  'INE155A01022': 'TATAMOTORS',
  'INE044A01036': 'SUNPHARMA',
  'INE397D01024': 'BHARTIARTL',
  'INE030A01027': 'HINDUNILVR',
  'INE238A01034': 'AXISBANK',
  'INE237A01028': 'KOTAKBANK',
  'INE081A01012': 'TATASTEEL',
  'INE102D01028': 'TITAN',
  'INE752E01010': 'POWERGRID',
  'INE123W01016': 'PAYTM',
  'INE758T01015': 'ZOMATO',
  'INE009N01054': 'NYKAA',
  'INE917I01012': 'CDSL',
  'INE118H01025': 'ANGELONE',
  'INE585B01010': 'MARUTI',
  'INE245A01021': 'BAJFINANCE',
  'INE918I01018': 'BAJAJFINSV',
  'INE213A01029': 'ONGC',
  'INE021A01026': 'ASIANPAINT',
  'INE047A01021': 'GRASIM',
  'INE019A01038': 'JSWSTEEL',
  'INE028A01039': 'BANKBARODA',
  'INE084A01016': 'PNB',
};

// Additional metadata for stocks outside UNIVERSE_200 (prevents "N/A MID" in UI)
const EXTENDED_METADATA = {
  'TARIL': { name: 'Transformers and Rectifiers (India) Ltd', sector: 'Capital Goods / Power Infra', cap: 'SMALL_CAP' },
  'SUNDARMFIN': { name: 'Sundaram Finance Ltd', sector: 'Financials / NBFC', cap: 'LARGE_CAP' },
  'TATATECH': { name: 'Tata Technologies Ltd', sector: 'IT / ER&D Services', cap: 'MID_CAP' },
  'WAAREERTL': { name: 'Waaree Renewable Tech Ltd', sector: 'Renewable Energy / Solar', cap: 'SMALL_CAP' },
  'MAPMYINDIA': { name: 'C.E. Info Systems (MapMyIndia)', sector: 'IT / Digital Mapping', cap: 'SMALL_CAP' },
  'BSOFT': { name: 'Birlasoft Ltd', sector: 'IT Services', cap: 'MID_CAP' },
  'NMDC': { name: 'NMDC Ltd', sector: 'Mining / Metals', cap: 'LARGE_CAP' },
  'JSWINFRA': { name: 'JSW Infrastructure Ltd', sector: 'Infrastructure / Ports', cap: 'LARGE_CAP' },
  'UTKARSHBNK': { name: 'Utkarsh Small Finance Bank', sector: 'Banking / Small Finance', cap: 'SMALL_CAP' },
  'SENCO': { name: 'Senco Gold Ltd', sector: 'Consumer / Jewellery', cap: 'SMALL_CAP' },
  'SEPC': { name: 'SEPC Ltd', sector: 'Engineering / EPC', cap: 'SMALL_CAP' },
  'PTC': { name: 'PTC India Ltd', sector: 'Power Trading / Infra', cap: 'SMALL_CAP' },
  'RSYSTEMS': { name: 'R Systems International', sector: 'IT Services', cap: 'SMALL_CAP' },
  'HAPPSTMNDS': { name: 'Happiest Minds Technologies', sector: 'IT Services', cap: 'SMALL_CAP' },
  'NEWGEN': { name: 'Newgen Software Technologies', sector: 'IT / Enterprise Software', cap: 'SMALL_CAP' },
  'NTPCGREEN': { name: 'NTPC Green Energy Ltd', sector: 'Renewable Energy', cap: 'LARGE_CAP' },
  'NIFTYBEES': { name: 'Nippon India Nifty 50 BeES', sector: 'Index ETF', cap: 'LARGE_CAP' },
  'JUNIORBEES': { name: 'Nippon India Nifty Next 50 BeES', sector: 'Index ETF', cap: 'LARGE_CAP' },
  'MID150BEES': { name: 'Nippon India Midcap 150 ETF', sector: 'Index ETF', cap: 'MID_CAP' },
  'GOLDIETF': { name: 'ICICI Prudential Gold ETF', sector: 'Commodity ETF', cap: 'LARGE_CAP' },
  'SILVERIETF': { name: 'ICICI Prudential Silver ETF', sector: 'Commodity ETF', cap: 'LARGE_CAP' },
  '5PAISA': { name: '5Paisa Capital Ltd', sector: 'Fintech / Broking', cap: 'SMALL_CAP' },
  'ACCELYA': { name: 'Accelya Solutions India Ltd', sector: 'IT / Aviation Tech', cap: 'SMALL_CAP' },
  'ALICON': { name: 'Alicon Castalloy Ltd', sector: 'Auto Ancillary', cap: 'SMALL_CAP' },
  'AGL': { name: 'Allcargo Gati Ltd', sector: 'Logistics', cap: 'SMALL_CAP' },
  'ALLCARGO': { name: 'Allcargo Logistics Ltd', sector: 'Logistics', cap: 'SMALL_CAP' },
  'CUPID': { name: 'Cupid Ltd', sector: 'Healthcare / Wellness', cap: 'SMALL_CAP' },
  'EASEMYTRIP': { name: 'Easy Trip Planners Ltd', sector: 'Consumer / Online Travel', cap: 'SMALL_CAP' },
  'GMDCLTD': { name: 'Gujarat Mineral Dev Corp', sector: 'Mining / Minerals', cap: 'MID_CAP' },
  'HCC': { name: 'Hindustan Construction Co', sector: 'Infrastructure / Construction', cap: 'SMALL_CAP' },
  'JAICORPLTD': { name: 'Jai Corp Ltd', sector: 'Infrastructure / Plastics', cap: 'SMALL_CAP' },
  'JPL': { name: 'Jio Platforms Ltd', sector: 'Telecom / Tech', cap: 'LARGE_CAP' },
  'JUSTDIAL': { name: 'Just Dial Ltd', sector: 'Internet / Local Search', cap: 'MID_CAP' },
  'IOC': { name: 'Indian Oil Corporation', sector: 'Oil & Gas', cap: 'LARGE_CAP' },
  'INDUSINDBK': { name: 'IndusInd Bank Ltd', sector: 'Banking', cap: 'LARGE_CAP' },
  'IDFCFIRSTB': { name: 'IDFC First Bank Ltd', sector: 'Banking', cap: 'MID_CAP' },
  'ACC': { name: 'ACC Limited', sector: 'Cement / Building Materials', cap: 'LARGE_CAP' },
  'CONCOR': { name: 'Container Corp of India', sector: 'Logistics / Rail', cap: 'LARGE_CAP' },
};

// Build quick lookup map for symbols to sectors and company names
const SECTOR_MAP = {};
const NAME_TO_SYMBOL_MAP = {};

UNIVERSE_200.forEach(item => {
  const sym = item.symbol.toUpperCase();
  SECTOR_MAP[sym] = { sector: item.sector, name: item.name, cap: item.cap };
  const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  NAME_TO_SYMBOL_MAP[cleanName] = sym;
  NAME_TO_SYMBOL_MAP[sym.toLowerCase()] = sym;
});

// Merge extended metadata
Object.entries(EXTENDED_METADATA).forEach(([sym, meta]) => {
  SECTOR_MAP[sym] = meta;
  const cleanName = meta.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  NAME_TO_SYMBOL_MAP[cleanName] = sym;
  NAME_TO_SYMBOL_MAP[sym.toLowerCase()] = sym;
});

// Resolve symbol from raw text, stock name, company name, or ISIN
function resolveSymbol(rawName, rawIsin) {
  // 1. ISIN check has absolute priority (unique 12-char global identifier)
  if (rawIsin) {
    const isinClean = String(rawIsin).trim().toUpperCase();
    if (ISIN_TO_SYMBOL_MAP[isinClean]) {
      return ISIN_TO_SYMBOL_MAP[isinClean];
    }
  }

  if (!rawName) return '';
  let str = String(rawName).trim().toUpperCase();

  // Strip exchange extensions and trade series
  str = str.replace(/-EQ$/i, '').replace(/\.NS$/i, '').replace(/\.BO$/i, '').replace(/\s+EQ$/i, '').trim();

  // If already a valid known ticker
  if (SECTOR_MAP[str]) return str;

  // Exact broker patterns for ETFs & Indian conglomerates
  if (str.includes('JUNIOR') && str.includes('BEES')) return 'JUNIORBEES';
  if (str.includes('NIFTY') && str.includes('BEES')) return 'NIFTYBEES';
  if (str.includes('MIDCAP') && str.includes('150')) return 'MID150BEES';
  if (str.includes('GOLD') && str.includes('ETF')) return 'GOLDIETF';
  if (str.includes('SILVER')) return 'SILVERIETF';
  if (str.includes('TATA TECHNOLOGIES')) return 'TATATECH';
  if (str.includes('TATA CONSULTANCY') || str.includes('TCS')) return 'TCS';
  if (str.includes('SUNDARAM FINANCE')) return 'SUNDARMFIN';
  if (str.includes('TRANS') && str.includes('RECTI')) return 'TARIL';
  if (str.includes('WAAREE') && str.includes('RENEW')) return 'WAAREERTL';
  if (str.includes('UTKARSH') && str.includes('BANK')) return 'UTKARSHBNK';
  if (str.includes('C.E. INFO') || str.includes('MAPMYINDIA')) return 'MAPMYINDIA';
  if (str.includes('STATE BANK OF INDIA')) return 'SBIN';
  if (str.includes('BHARAT ELECTRONICS')) return 'BEL';
  if (str.includes('CONTAINER CORP')) return 'CONCOR';
  if (str.includes('COAL INDIA')) return 'COALINDIA';
  if (str.includes('HCL TECH')) return 'HCLTECH';
  if (str.includes('HAPPIEST MINDS')) return 'HAPPSTMNDS';
  if (str.includes('EASY TRIP')) return 'EASEMYTRIP';
  if (str.includes('JSW INFRA')) return 'JSWINFRA';
  if (str.includes('JSW ENERGY')) return 'JSWENERGY';
  if (str.includes('NEWGEN')) return 'NEWGEN';
  if (str.includes('NTPC GREEN')) return 'NTPCGREEN';
  if (str.includes('R SYS')) return 'RSYSTEMS';
  if (str.includes('SEPC')) return 'SEPC';
  if (str.includes('SENCO')) return 'SENCO';
  if (str.includes('VARUN BEVERAGES')) return 'VBL';
  if (str.includes('SUZLON')) return 'SUZLON';
  if (str.includes('ACCELYA')) return 'ACCELYA';
  if (str.includes('ALICON')) return 'ALICON';
  if (str.includes('BIRLASOFT')) return 'BSOFT';
  if (str.includes('5PAISA')) return '5PAISA';
  if (str.includes('GUJARAT MINERAL') || str.includes('GMDC')) return 'GMDCLTD';
  if (str.includes('HINDUSTAN CONSTRUCTION') || str === 'HCC') return 'HCC';
  if (str.includes('JAI CORP')) return 'JAICORPLTD';
  if (str.includes('JIO PLATFORMS')) return 'JPL';
  if (str.includes('JUST DIAL') || str.includes('JUSTDIAL')) return 'JUSTDIAL';

  // Strip corporate suffix words before string matching
  // (CRUCIAL: Prevents "LTD" from mistakenly matching "LT"!)
  const strippedStr = str
    .replace(/\b(LIMITED|LTD\.?|PVT\.?|PRIVATE|CORP\.?|CORPORATION|HOLDINGS|HOLDING|SOLUTIONS|SOLN\.?|SERVICES|SERV\.?|TECHNOLOGIES|TECHNO|TECH|CO\.?|IND\.?|INDIA)\b/gi, '')
    .trim();

  const clean = strippedStr.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean && NAME_TO_SYMBOL_MAP[clean]) return NAME_TO_SYMBOL_MAP[clean];

  // Only allow substring matching if both search key AND target clean name are >= 5 chars
  // NEVER allow 2-character keys like "lt" to match!
  for (const [k, sym] of Object.entries(NAME_TO_SYMBOL_MAP)) {
    if (k.length >= 5 && clean.length >= 5 && (clean.includes(k) || k.includes(clean))) {
      return sym;
    }
  }

  // Fallback: extract first clean word token if alphanumeric
  const firstToken = strippedStr.split(/[\s,]+/)[0];
  if (firstToken && firstToken.length >= 2 && firstToken.length <= 15 && /^[A-Z0-9&-]+$/.test(firstToken)) {
    return firstToken;
  }
  return str;
}

// Extract tabular holding records from Excel (.xlsx or .xls)
function extractRecordsFromExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  if (!wb.SheetNames || wb.SheetNames.length === 0) return { records: [], columnMap: {} };

  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  if (!rawRows || rawRows.length === 0) return { records: [], columnMap: {} };

  // Find header row (must have at least 3 columns to avoid matching statement title rows)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(25, rawRows.length); i++) {
    const validCells = (rawRows[i] || []).filter(c => String(c).trim().length > 0);
    if (validCells.length < 3) continue;

    const rowStr = validCells.map(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).join(' ');
    const hasSymbolCol = rowStr.includes('symbol') || rowStr.includes('stock') || rowStr.includes('scrip') || rowStr.includes('company') || rowStr.includes('isin');
    const hasQtyCol = rowStr.includes('qty') || rowStr.includes('quantity') || rowStr.includes('shares') || rowStr.includes('units') || rowStr.includes('available');
    const hasPriceCol = rowStr.includes('price') || rowStr.includes('cost') || rowStr.includes('rate') || rowStr.includes('avg');

    if (hasSymbolCol && (hasQtyCol || hasPriceCol)) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) headerRowIdx = 0;
  const headers = rawRows[headerRowIdx].map(h => String(h || '').trim());
  const columnMap = detectColumns(headers);

  const records = [];
  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] !== undefined ? row[idx] : '';
    });
    if (obj[columnMap.symbol] || obj[columnMap.quantity]) {
      records.push(obj);
    }
  }

  return { records, columnMap };
}

// Shared pipeline to enrich holdings with live quotes, sector mapping, and institutional quant recommendations
async function processEnrichedPortfolio(holdings) {
  const cacheKey = `enrichedPortfolio:${holdings.map(h => `${h.symbol}_${h.quantity}_${h.buyPrice}_${h.strategy || 'CORE'}`).sort().join('|')}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const { mapPool } = require('../utils/pool.cjs');
  // Process with concurrency of 12 for high-speed responsiveness
  const enrichedHoldings = await mapPool(holdings, 12, async (holding) => {
    const sym = holding.symbol.toUpperCase();
    const meta = SECTOR_MAP[sym] || {};
    try {
      // Race quote fetch against a 2500ms timeout so a slow symbol never blocks the portfolio
      const quotePromise = Promise.race([
        yahooFinance.getQuote(sym),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Quote timeout')), 2500))
      ]);
      const quote = await quotePromise;
      const currentPrice = quote.price || holding.closingPrice || holding.buyPrice;
      const currentValue = currentPrice * holding.quantity;
      const investedValue = holding.buyPrice * holding.quantity;
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? ((pnl / investedValue) * 100) : 0;
      const roundedPnlPct = Math.round(pnlPercent * 100) / 100;

      const isSwing = (holding.strategy || 'LONG_TERM').toUpperCase() === 'SWING';
      const strategy = isSwing ? 'SWING' : 'LONG_TERM';

      let targetPrice, stopLossPrice, quantAction;

      if (isSwing) {
        // Tactical Swing Trading Rules
        targetPrice = Math.round(holding.buyPrice * 1.08 * 10) / 10;
        stopLossPrice = Math.round(holding.buyPrice * 0.94 * 10) / 10;

        if (roundedPnlPct >= 12) {
          quantAction = {
            badge: 'RIDE_RUNNER',
            label: 'RIDE RUNNER 🏃',
            action: 'TRAIL STOP & RIDE',
            actionType: 'KEEP_RUNNING',
            targetPrice: Math.round(currentPrice * 1.08),
            actionPrice: Math.round(currentPrice * 0.94),
            variant: 'success',
            headline: `Ride Trend | Trail Stop to ₹${Math.round(currentPrice * 0.94)}`,
            detail: `Up +${roundedPnlPct}%. High-velocity swing runner. Trail stop-loss to ₹${Math.round(currentPrice * 0.94)} (20-EMA) to lock in gains while letting momentum compound.`,
          };
        } else if (roundedPnlPct >= 7) {
          quantAction = {
            badge: 'BANK_PROFIT_T1',
            label: 'BOOK 50% (T1) 💰',
            action: 'BOOK 50% PROFIT',
            actionType: 'BOOK_PROFIT',
            targetPrice: Math.round(holding.buyPrice * 1.08),
            actionPrice: Math.round(currentPrice),
            variant: 'emerald',
            headline: `Sell 50% Shares @ ₹${Math.round(currentPrice)} (Target 1 Reached)`,
            detail: `Up +${roundedPnlPct}%. Target 1 reached. Sell 50% shares at market to bank profit; move stop-loss on remaining 50% shares to Breakeven (₹${holding.buyPrice}).`,
          };
        } else if (roundedPnlPct <= -5.5) {
          quantAction = {
            badge: 'CUT_LOSS',
            label: 'CUT LOSS 🛑',
            action: 'EXIT / CUT LOSS',
            actionType: 'CUT_LOSS',
            targetPrice: Math.round(holding.buyPrice),
            actionPrice: Math.round(currentPrice),
            variant: 'danger',
            headline: `Exit 100% Shares @ ₹${Math.round(currentPrice)} (Violated -5.5% Rule)`,
            detail: `Down ${roundedPnlPct}%. Swing stop-loss limit (-5.5%) breached. Exit immediately to protect trading capital and prevent deep capital erosion.`,
          };
        } else {
          quantAction = {
            badge: 'HOLD_IN_BASE',
            label: 'HOLD BASE ⏳',
            action: 'HOLD BASE',
            actionType: 'HOLD_STEADY',
            targetPrice,
            actionPrice: stopLossPrice,
            variant: 'cyan',
            headline: `Hold Setup | Target ₹${targetPrice} • Stop ₹${stopLossPrice}`,
            detail: `Within normal noise tolerance (-3% to +6%). Hold base and let the consolidation breakout develop toward Target ₹${targetPrice}.`,
          };
        }
      } else {
        // Multi-Year Core Long-Term Horizon
        targetPrice = Math.round(holding.buyPrice * 1.30 * 10) / 10;
        stopLossPrice = Math.round(holding.buyPrice * 0.80 * 10) / 10;

        if (roundedPnlPct >= 25) {
          quantAction = {
            badge: 'CORE_COMPOUNDER',
            label: 'COMPOUNDING 🚀',
            action: 'HOLD CORE (DO NOT SELL)',
            actionType: 'KEEP_RUNNING',
            targetPrice: Math.round(currentPrice * 1.25),
            actionPrice: Math.round(currentPrice * 0.90),
            variant: 'success',
            headline: `Multi-Year Compounder — DO NOT SELL | Next Target ₹${Math.round(currentPrice * 1.25)}`,
            detail: `Up +${roundedPnlPct}%. Outstanding long-term compounder. Do NOT sell just because it is green. Let compounding work; only trim if single holding exceeds 20% of total portfolio.`,
          };
        } else if (roundedPnlPct <= -25) {
          quantAction = {
            badge: 'REVIEW_THESIS',
            label: 'FREEZE CAPITAL ⚠️',
            action: 'FREEZE - DO NOT AVERAGE',
            actionType: 'FREEZE_CAPITAL',
            targetPrice: Math.round(holding.buyPrice * 0.90),
            actionPrice: Math.round(currentPrice),
            variant: 'danger',
            headline: `Deep Capital Drawdown — DO NOT AVERAGE DOWN`,
            detail: `Down ${roundedPnlPct}%. Major capital loss. Do NOT throw good money after bad. Hold current ${holding.quantity} shares, but freeze all fresh buying until quarterly earnings show net operating margin recovery.`,
          };
        } else if (roundedPnlPct <= -10) {
          const avgZoneMax = Math.round(currentPrice * 1.03);
          const upsidePct = Math.round(((targetPrice - currentPrice) / currentPrice) * 100);
          quantAction = {
            badge: 'ACCUMULATE_DIP',
            label: 'SAFE TO AVERAGE 🛒',
            action: 'BUY / AVERAGE DOWN',
            actionType: 'AVERAGE_DOWN',
            targetPrice,
            actionPrice: avgZoneMax,
            variant: 'emerald',
            headline: `Safe to Average Below ₹${avgZoneMax} | Target ₹${targetPrice} (+${upsidePct}%)`,
            detail: `Down ${roundedPnlPct}%. Prime strategic value-accumulation dip. Business fundamentals intact. Safe to add 10-25% more shares on dips below ₹${avgZoneMax} to systematically lower cost basis.`,
          };
        } else {
          const upsidePct = Math.round(((targetPrice - currentPrice) / currentPrice) * 100);
          quantAction = {
            badge: 'CORE_HOLD',
            label: 'CORE HOLD 💎',
            action: 'HOLD CORE',
            actionType: 'HOLD_STEADY',
            targetPrice,
            actionPrice: holding.buyPrice,
            variant: 'cyan',
            headline: `Hold Steady — Target ₹${targetPrice} (+${upsidePct}%)`,
            detail: `Within normal ±10% market volatility. Core long-term holding. Keep existing ${holding.quantity} shares without stress.`,
          };
        }
      }

      return {
        ...holding,
        strategy,
        name: quote.name || meta.name || sym,
        sector: meta.sector || quote.sector || 'Equities',
        cap: meta.cap || 'MID_CAP',
        currentPrice,
        currentValue,
        investedValue,
        pnl,
        pnlPercent: roundedPnlPct,
        dayChange: quote.changePercent || 0,
        targetPrice,
        stopLossPrice,
        quantAction,
      };
    } catch (err) {
      const currentPrice = holding.closingPrice || holding.buyPrice;
      const investedValue = holding.buyPrice * holding.quantity;
      const currentValue = currentPrice * holding.quantity;
      const pnl = currentValue - investedValue;
      const pnlPercent = investedValue > 0 ? ((pnl / investedValue) * 100) : 0;
      const roundedPnlPct = Math.round(pnlPercent * 100) / 100;

      const isSwing = (holding.strategy || 'LONG_TERM').toUpperCase() === 'SWING';
      const strategy = isSwing ? 'SWING' : 'LONG_TERM';
      const targetPrice = Math.round(holding.buyPrice * (isSwing ? 1.08 : 1.30));
      const stopLossPrice = Math.round(holding.buyPrice * (isSwing ? 0.94 : 0.80));

      return {
        ...holding,
        strategy,
        name: meta.name || sym,
        sector: meta.sector || 'Equities',
        cap: meta.cap || 'MID_CAP',
        currentPrice,
        currentValue,
        investedValue,
        pnl,
        pnlPercent: roundedPnlPct,
        dayChange: 0,
        targetPrice,
        stopLossPrice,
        quantAction: {
          badge: isSwing ? 'HOLD_IN_BASE' : 'CORE_HOLD',
          label: isSwing ? 'HOLD BASE ⏳' : 'CORE HOLD 💎',
          action: 'HOLD CORE',
          actionType: 'HOLD_STEADY',
          targetPrice,
          actionPrice: holding.buyPrice,
          variant: 'cyan',
          headline: `Hold Steady — Target ₹${targetPrice}`,
          detail: 'Maintained cost-basis anchor while live quote refreshes.',
        },
      };
    }
  });

  const totalInvested = enrichedHoldings.reduce((sum, h) => sum + h.investedValue, 0);
  const totalCurrent = enrichedHoldings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPercent = totalInvested > 0 ? ((totalPnl / totalInvested) * 100) : 0;

  // Real sector breakdown
  const sectorSums = {};
  for (const h of enrichedHoldings) {
    const s = h.sector || 'Equities';
    sectorSums[s] = (sectorSums[s] || 0) + h.currentValue;
  }
  const sectorAllocation = Object.entries(sectorSums).map(([sector, val]) => ({
    sector,
    percentage: totalCurrent > 0 ? Math.round((val / totalCurrent) * 100) : 0,
  })).sort((a, b) => b.percentage - a.percentage);

  const result = {
    holdings: enrichedHoldings,
    summary: {
      totalHoldings: enrichedHoldings.length,
      totalInvested: Math.round(totalInvested),
      totalCurrentValue: Math.round(totalCurrent),
      totalPnl: Math.round(totalPnl),
      totalPnlPercent: Math.round(totalPnlPercent * 100) / 100,
      sectorAllocation,
      topGainer: enrichedHoldings.reduce((best, h) => h.pnlPercent > (best?.pnlPercent || -Infinity) ? h : best, null),
      topLoser: enrichedHoldings.reduce((worst, h) => h.pnlPercent < (worst?.pnlPercent || Infinity) ? h : worst, null),
    },
  };

  cache.set(cacheKey, result, 600); // 10-minute cache for blazing-fast responses
  return result;
}

// Upload and parse portfolio CSV or Excel (.xlsx / .xls)
router.post('/upload', upload.single('portfolio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = (req.file.originalname || '').toLowerCase();
    const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls') || (req.file.mimetype && req.file.mimetype.includes('sheet'));

    let records = [];
    let columnMap = {};

    if (isExcel) {
      const parsedExcel = extractRecordsFromExcel(req.file.buffer);
      records = parsedExcel.records;
      columnMap = parsedExcel.columnMap;
    } else {
      const csvContent = req.file.buffer.toString('utf-8');
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      });
      if (records.length > 0) {
        columnMap = detectColumns(Object.keys(records[0]));
      }
    }

    if (!records || records.length === 0) {
      return res.status(400).json({ error: 'Uploaded file contains no readable holding records' });
    }

    const holdings = records.map(row => {
      const rawSym = row[columnMap.symbol] || '';
      const rawIsin = columnMap.isin ? (row[columnMap.isin] || '') : '';
      const resolved = resolveSymbol(rawSym, rawIsin);
      const rawQty = String(row[columnMap.quantity] || '0').replace(/,/g, '').trim();
      const rawPrice = String(row[columnMap.buyPrice] || '0').replace(/,/g, '').trim();
      return {
        symbol: (resolved || rawSym).toUpperCase().trim(),
        quantity: parseFloat(rawQty) || 0,
        buyPrice: parseFloat(rawPrice) || 0,
        buyDate: row[columnMap.buyDate] || new Date().toISOString().split('T')[0],
        strategy: (row[columnMap.strategy] || 'LONG_TERM').toUpperCase().includes('SWING') ? 'SWING' : 'LONG_TERM',
      };
    }).filter(h => h.symbol && h.quantity > 0);

    if (holdings.length === 0) {
      return res.status(400).json({ 
        error: 'No valid holdings found. Expected columns: Symbol/Stock Name, Quantity, Buy/Avg Price',
        detectedColumns: Object.keys(records[0] || {}),
      });
    }

    const result = await processEnrichedPortfolio(holdings);
    res.json(result);
  } catch (err) {
    console.error('[Portfolio] Upload error:', err.message);
    res.status(500).json({ error: 'Failed to parse portfolio file: ' + err.message });
  }
});

// Auto-load statement from Downloads folder (one-click restore)
router.all('/load-groww-file', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const downloadsDir = path.join(os.homedir(), 'Downloads');

    let targetFile = null;
    if (fs.existsSync(downloadsDir)) {
      const files = fs.readdirSync(downloadsDir)
        .filter(f => f.startsWith('Stocks_Holdings_Statement') && (f.endsWith('.xlsx') || f.endsWith('.csv')))
        .sort()
        .reverse();
      if (files.length > 0) {
        targetFile = path.join(downloadsDir, files[0]);
      }
    }

    if (!targetFile || !fs.existsSync(targetFile)) {
      return res.status(404).json({ error: 'No Groww holdings statement found in Downloads folder.' });
    }

    const fileBuffer = fs.readFileSync(targetFile);
    let records = [];
    let columnMap = {};

    if (targetFile.endsWith('.xlsx') || targetFile.endsWith('.xls')) {
      const parsedExcel = extractRecordsFromExcel(fileBuffer);
      records = parsedExcel.records;
      columnMap = parsedExcel.columnMap;
    } else {
      const csvContent = fileBuffer.toString('utf-8');
      records = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
      if (records.length > 0) columnMap = detectColumns(Object.keys(records[0]));
    }

    const holdings = records.map(row => {
      const rawSym = row[columnMap.symbol] || '';
      const rawIsin = columnMap.isin ? (row[columnMap.isin] || '') : '';
      const resolved = resolveSymbol(rawSym, rawIsin);
      const rawQty = String(row[columnMap.quantity] || '0').replace(/,/g, '').trim();
      const rawPrice = String(row[columnMap.buyPrice] || '0').replace(/,/g, '').trim();
      return {
        symbol: (resolved || rawSym).toUpperCase().trim(),
        quantity: parseFloat(rawQty) || 0,
        buyPrice: parseFloat(rawPrice) || 0,
        buyDate: row[columnMap.buyDate] || new Date().toISOString().split('T')[0],
        strategy: 'LONG_TERM',
      };
    }).filter(h => h.symbol && h.quantity > 0);

    const result = await processEnrichedPortfolio(holdings);
    res.json({ ...result, filename: path.basename(targetFile) });
  } catch (err) {
    console.error('[Portfolio] Auto-load error:', err.message);
    res.status(500).json({ error: 'Failed to auto-load Groww statement: ' + err.message });
  }
});

// Manual portfolio submission or real-time refresh
router.post('/manual', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'Holdings array is required' });
    }
    const cleanHoldings = holdings.map(h => ({
      symbol: (h.symbol || '').toUpperCase().trim(),
      quantity: parseFloat(h.quantity) || 0,
      buyPrice: parseFloat(h.buyPrice) || 0,
      buyDate: h.buyDate || new Date().toISOString().split('T')[0],
      strategy: (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING' ? 'SWING' : 'LONG_TERM',
    })).filter(h => h.symbol && h.quantity > 0);

    if (cleanHoldings.length === 0) {
      return res.status(400).json({ error: 'No valid holdings provided with quantity > 0' });
    }

    const result = await processEnrichedPortfolio(cleanHoldings);
    res.json(result);
  } catch (err) {
    console.error('[Portfolio] Manual entry error:', err.message);
    res.status(500).json({ error: 'Failed to process portfolio: ' + err.message });
  }
});

// Analyze a specific portfolio holding
router.post('/analyze-holding', async (req, res) => {
  try {
    const { symbol, quantity, buyPrice } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol is required' });
    }
    const stockData = await aggregateStockData(symbol);
    const expertAnalysis = await runExpertPipeline(stockData);

    // Add portfolio-specific context to the analysis
    const currentPrice = stockData.quote.price;
    const portfolioContext = {
      holdingQuantity: quantity,
      buyPrice,
      currentPrice,
      pnl: quantity ? (currentPrice - buyPrice) * quantity : 0,
      pnlPercent: buyPrice ? ((currentPrice - buyPrice) / buyPrice * 100) : 0,
    };

    res.json({
      symbol: symbol.toUpperCase(),
      analyzedAt: new Date().toISOString(),
      portfolioContext,
      quote: stockData.quote,
      marketRegime: stockData.marketRegime,
      relativeStrength: stockData.relativeStrength,
      technicals: stockData.technicals,
      swingPlaybook: stockData.swingPlaybook,
      quantConsensus: stockData.quantConsensus,
      profitMaximizer: stockData.profitMaximizer,
      expertAnalysis,
      chartData: stockData.chartData,
    });
  } catch (err) {
    console.error('[Portfolio] Analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper for deterministic portfolio synthesis
function generateDeterministicPortfolioAnalysis(holdings, totalInvested, totalCurrent, totalPnl) {
  const pnlPct = totalInvested > 0 ? ((totalPnl / totalInvested) * 100) : 0;
  const winners = holdings.filter(h => (h.pnl || (h.currentPrice - h.buyPrice) * h.quantity) > 0);
  const losers = holdings.filter(h => (h.pnl || (h.currentPrice - h.buyPrice) * h.quantity) < 0);
  const healthScore = Math.min(95, Math.max(35, Math.round(55 + (pnlPct * 1.2) + (winners.length >= losers.length ? 10 : -10))));

  const swingHoldings = holdings.filter(h => (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING');
  const longTermHoldings = holdings.filter(h => (h.strategy || 'LONG_TERM').toUpperCase() !== 'SWING');

  // Dynamic real sector allocation calculation
  const sectorSums = {};
  for (const h of holdings) {
    const s = h.sector || SECTOR_MAP[h.symbol?.toUpperCase()]?.sector || 'Equities';
    const val = h.currentValue || (h.currentPrice * h.quantity) || 0;
    sectorSums[s] = (sectorSums[s] || 0) + val;
  }
  const sectorAllocation = Object.entries(sectorSums).map(([sector, val]) => ({
    sector,
    percentage: totalCurrent > 0 ? Math.round((val / totalCurrent) * 100) : 0,
  })).sort((a, b) => b.percentage - a.percentage);

  const topSector = sectorAllocation[0];
  const sectorConcentration = topSector && topSector.percentage >= 35
    ? `High single-sector risk: ${topSector.sector} accounts for ${topSector.percentage}% of total portfolio value. Limit any one sector to <= 25-30%.`
    : holdings.length < 4
    ? 'Under-diversified (< 4 stocks). Vulnerable to idiosyncratic stock gaps. Target 6-8 positions across distinct sectors.'
    : `Well balanced. Top sector (${topSector ? topSector.sector : 'General'}) represents ${topSector ? topSector.percentage : 0}% of portfolio.`;

  // Profit Booking (Differentiates swing profit banking from core multi-year compounding)
  const profitBooking = [
    ...swingHoldings.filter(w => (w.pnlPercent || 0) >= 7).map(w => ({
      symbol: w.symbol,
      strategy: 'SWING',
      action: (w.pnlPercent || 0) >= 12 ? 'TRAIL_STOP_20EMA' : 'SCALE_OUT_50_PCT',
      targetPrice: Math.round(w.currentPrice * 1.05),
      quantity: (w.pnlPercent || 0) >= 12 ? 'Keep 100% with trailing stop' : 'Sell 50% shares',
      reasoning: (w.pnlPercent || 0) >= 12
        ? `Swing runner up +${(w.pnlPercent || 0).toFixed(1)}%. Trail stop to 20-DMA (₹${Math.round(w.currentPrice * 0.93)}) to capture trend.`
        : `Swing Target 1 reached (+${(w.pnlPercent || 0).toFixed(1)}%). Bank half gains to secure positive expectancy, move stop on rest to breakeven.`
    })),
    ...longTermHoldings.filter(w => (w.pnlPercent || 0) >= 30).map(w => ({
      symbol: w.symbol,
      strategy: 'LONG_TERM',
      action: 'CORE_COMPOUND_HOLD',
      targetPrice: Math.round(w.currentPrice * 1.25),
      quantity: 'Hold core position',
      reasoning: `Up +${(w.pnlPercent || 0).toFixed(1)}%. Core multi-year compounder doing its job. Let profits accumulate; trim only if single position exceeds 25% of portfolio.`
    }))
  ];

  // Loss Cutting ONLY applies to active Swing Trades!
  const lossCutting = swingHoldings.filter(l => (l.pnlPercent || 0) <= -5.5).map(l => ({
    symbol: l.symbol,
    strategy: 'SWING',
    action: 'CUT_SWING_LOSS',
    reasoning: `Active swing trade down ${(l.pnlPercent || 0).toFixed(1)}%. Violates strict -5.5% swing stop rule. Cut now to protect trading capital.`
  }));

  // Dip Accumulation for Long-Term Core holdings
  const dipAccumulation = longTermHoldings.filter(h => (h.pnlPercent || 0) <= -10 && (h.pnlPercent || 0) > -25).map(h => ({
    symbol: h.symbol,
    strategy: 'LONG_TERM',
    action: 'ACCUMULATE_ON_DIPS',
    reasoning: `Core holding down ${(h.pnlPercent || 0).toFixed(1)}%. Normal cyclical correction. Strategic SIP / value accumulation is permitted if fundamentals remain sound.`
  }));

  const thesisReview = longTermHoldings.filter(h => (h.pnlPercent || 0) <= -25).map(h => ({
    symbol: h.symbol,
    strategy: 'LONG_TERM',
    action: 'REVIEW_FUNDAMENTALS',
    reasoning: `Core holding down ${(h.pnlPercent || 0).toFixed(1)}%. Deep structural breakdown. Verify quarterly EPS growth, balance sheet debt, and governance before adding further.`
  }));

  const rebalance = holdings.map(h => {
    const val = h.currentValue || (h.currentPrice * h.quantity);
    const alloc = totalCurrent > 0 ? (val / totalCurrent) * 100 : 0;
    const isSwing = (h.strategy || 'LONG_TERM').toUpperCase() === 'SWING';
    let direction = 'HOLD';
    let targetAllocation = `${Math.round(alloc)}%`;
    let reasoning = isSwing ? 'Swing allocation within risk boundaries.' : 'Core long-term investment holding.';

    if (alloc > 25) {
      direction = 'DECREASE';
      targetAllocation = 'Trim to 15-20%';
      reasoning = `Overweight: Single stock represents ${Math.round(alloc)}% of equity (institutional limit is 20%).`;
    } else if (isSwing && (h.pnlPercent || 0) <= -5.5) {
      direction = 'EXIT';
      targetAllocation = '0%';
      reasoning = 'Swing stop loss breached. Exit position to preserve cash.';
    } else if (isSwing && (h.pnlPercent || 0) >= 8) {
      direction = 'TRIM_TO_LOCK';
      targetAllocation = `${Math.max(5, Math.round(alloc * 0.5))}%`;
      reasoning = 'Bank 50% partial profit on swing trade and let remaining ride.';
    } else if (!isSwing && (h.pnlPercent || 0) <= -10) {
      direction = 'ACCUMULATE';
      targetAllocation = `${Math.min(20, Math.round(alloc + 5))}%`;
      reasoning = 'Value dip in core holding. Opportunity for staggered accumulation.';
    }

    return {
      symbol: h.symbol,
      strategy: isSwing ? 'SWING' : 'LONG_TERM',
      direction,
      targetAllocation,
      reasoning
    };
  });

  // Suggest complementary stocks from underrepresented sectors
  const existingSectors = new Set(sectorAllocation.map(s => s.sector.toLowerCase()));
  const suggestedNewStocks = [];
  if (!existingSectors.has('it')) {
    suggestedNewStocks.push({ symbol: 'INFY', reasoning: 'Add IT sector exposure with solid relative strength and healthy dividend yield.', suggestedEntry: 'On breakout above 20-EMA' });
  }
  if (!existingSectors.has('banking')) {
    suggestedNewStocks.push({ symbol: 'HDFCBANK', reasoning: 'Nifty heavy-weight private banking anchor with low volatility.', suggestedEntry: 'Near 50-DMA support' });
  }
  if (!existingSectors.has('telecom') && !existingSectors.has('infra')) {
    suggestedNewStocks.push({ symbol: 'BHARTIARTL', reasoning: 'Top momentum leader with defensive pricing power in telecom.', suggestedEntry: 'Dip to 20-EMA' });
  }
  if (suggestedNewStocks.length === 0) {
    suggestedNewStocks.push(
      { symbol: 'LT', reasoning: 'Capital goods & infra flagship benefiting from Indian capex cycle.', suggestedEntry: 'On fresh swing consolidation breakout' },
      { symbol: 'SUNPHARMA', reasoning: 'Pharma defensive hedge providing decorrelation from broad market swings.', suggestedEntry: 'Retest of previous resistance' }
    );
  }

  return {
    portfolioHealthScore: healthScore,
    overallAssessment: `Portfolio valuation: ₹${Math.round(totalCurrent).toLocaleString('en-IN')} with net P&L of ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%. ${winners.length} winning positions, ${losers.length} losing positions across ${holdings.length} holdings (${longTermHoldings.length} Core Long-Term, ${swingHoldings.length} Tactical Swing).`,
    sectorConcentration,
    sectorAllocation,
    profitBookingActions: profitBooking,
    lossCuttingActions: lossCutting,
    dipAccumulationActions: dipAccumulation,
    thesisReviewActions: thesisReview,
    rebalanceActions: rebalance,
    suggestedNewStocks,
    overallStrategy: `Core & Satellite Discipline: For Long-Term Core compounders, hold through noise and accumulate on cyclical dips (-10% to -20%) if fundamental earnings remain intact. For Tactical Swing trades, cut any trade that breaches -5.5% without hesitation, and bank 50% profits at +8% (Target 1).`,
    riskWarnings: [
      `Overall portfolio P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
      lossCutting.length > 0 ? `Swing Risk Alert: ${lossCutting.length} active swing trades have violated the -5.5% stop loss limit.` : 'Swing risk controls intact.',
      dipAccumulation.length > 0 ? `Core Opportunity: ${dipAccumulation.length} long-term holdings are in the value accumulation dip zone.` : 'Core holdings steady.',
      topSector && topSector.percentage >= 35 ? `Concentration alert: ${topSector.sector} sector is ${topSector.percentage}% of your capital.` : 'Sector spread is within standard guidelines.'
    ]
  };
}

// Holistic portfolio-level analysis
router.post('/analyze-all', async (req, res) => {
  try {
    const { holdings } = req.body;
    if (!holdings || !holdings.length) {
      return res.status(400).json({ error: 'Holdings data is required' });
    }

    const totalInvested = holdings.reduce((s, h) => s + (h.investedValue || h.buyPrice * h.quantity), 0);
    const totalCurrent = holdings.reduce((s, h) => s + (h.currentValue || h.currentPrice * h.quantity), 0);
    const totalPnl = totalCurrent - totalInvested;

    // Zero-config deterministic fallback if AI not initialized
    if (!isInitialized()) {
      return res.json(generateDeterministicPortfolioAnalysis(holdings, totalInvested, totalCurrent, totalPnl));
    }

    const { analyzeWithAgent } = require('../services/aiEngine.cjs');
    const cache = require('../utils/cache.cjs');
    
    const cacheKey = `portfolioAnalysis:${holdings.map(h => h.symbol).sort().join(',')}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    // Build condensed portfolio summary for AI
    const portfolioContext = {
      symbol: 'PORTFOLIO',
      quote: {
        name: 'Full Portfolio Analysis',
        price: totalCurrent,
        sector: 'Diversified',
        industry: 'Multi-sector',
      },
      technicals: { error: 'N/A — portfolio-level analysis' },
      news: [],
      reddit: { posts: [], summary: {} },
    };

    const holdingsSummary = holdings.map(h => ({
      symbol: h.symbol,
      qty: h.quantity,
      buyPrice: h.buyPrice,
      currentPrice: h.currentPrice,
      pnl: h.pnl,
      pnlPercent: h.pnlPercent,
      allocation: totalCurrent > 0 ? ((h.currentValue || h.currentPrice * h.quantity) / totalCurrent * 100).toFixed(1) : 0,
    }));

    const agentConfig = {
      name: 'Portfolio Strategist',
      useProModel: false,
      systemPrompt: `You are a Portfolio Strategist for an Indian retail investor. Analyze their ENTIRE portfolio holistically.

Portfolio Overview:
- Total Invested: ₹${totalInvested.toFixed(0)}
- Current Value: ₹${totalCurrent.toFixed(0)}
- Total P&L: ₹${totalPnl.toFixed(0)} (${totalInvested > 0 ? ((totalPnl / totalInvested) * 100).toFixed(2) : 0}%)

Holdings:
${holdingsSummary.map(h => `  ${h.symbol}: ${h.qty} shares @ ₹${h.buyPrice} → ₹${h.currentPrice} (${h.pnlPercent >= 0 ? '+' : ''}${h.pnlPercent}%, ${h.allocation}% allocation)`).join('\n')}

Analyze for:
1. Portfolio health — sector concentration risk, over/under allocation
2. Profit booking — which winners to partially exit and at what price
3. Loss cutting — which losers to exit or average down
4. Rebalancing — which stocks to increase/decrease allocation
5. New opportunities — based on current holdings, what complementary stocks could improve risk-adjusted returns
6. Overall strategy — swing/mid-term/long-term optimization for maximum profit

Be specific with prices and quantities. Think like a profitable trader helping a friend maximize returns while managing risk.`,
      outputSchema: {
        type: 'OBJECT',
        properties: {
          portfolioHealthScore: { type: 'INTEGER', description: '1-100 portfolio health score' },
          overallAssessment: { type: 'STRING', description: '2-3 sentence portfolio assessment' },
          sectorConcentration: { type: 'STRING', description: 'Assessment of sector diversification' },
          sectorAllocation: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { sector: { type: 'STRING' }, percentage: { type: 'INTEGER' } } },
            description: 'Estimated breakdown of portfolio by sector'
          },
          profitBookingActions: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, action: { type: 'STRING' },
              targetPrice: { type: 'NUMBER' }, quantity: { type: 'STRING' },
              reasoning: { type: 'STRING' },
            }},
          },
          lossCuttingActions: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, action: { type: 'STRING' },
              reasoning: { type: 'STRING' },
            }},
          },
          rebalanceActions: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, direction: { type: 'STRING', description: 'INCREASE, DECREASE, HOLD, EXIT' },
              targetAllocation: { type: 'STRING' }, reasoning: { type: 'STRING' },
            }},
          },
          suggestedNewStocks: {
            type: 'ARRAY', items: { type: 'OBJECT', properties: {
              symbol: { type: 'STRING' }, reasoning: { type: 'STRING' },
              suggestedEntry: { type: 'STRING' },
            }},
          },
          overallStrategy: { type: 'STRING', description: 'Actionable paragraph — what to do this week for maximum profit' },
          riskWarnings: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['portfolioHealthScore', 'overallAssessment', 'sectorAllocation', 'profitBookingActions', 'rebalanceActions', 'overallStrategy'],
      },
    };

    const analysis = await analyzeWithAgent(agentConfig, portfolioContext);

    const result = {
      analyzedAt: new Date().toISOString(),
      holdingsCount: holdings.length,
      totalInvested,
      totalCurrent,
      totalPnl,
      analysis,
    };

    cache.set(cacheKey, result, 1800);
    res.json(result);
  } catch (err) {
    console.error('[Portfolio] Full analysis error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Detect column names from CSV / Excel headers (flexible)
function detectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  
  const findCol = (candidates) => {
    for (const c of candidates) {
      const idx = lower.findIndex(h => h.includes(c));
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  return {
    symbol: findCol(['stockname', 'symbol', 'ticker', 'scrip', 'company', 'stock', 'name']) || headers[0],
    isin: findCol(['isin']),
    quantity: findCol(['quantity', 'qty', 'shares', 'units', 'count', 'available', 'holding']),
    buyPrice: findCol(['averagebuyprice', 'avgprice', 'buyprice', 'avgcost', 'cost', 'avg', 'price', 'purchase']),
    buyDate: findCol(['buydate', 'purchasedate', 'date', 'bought']),
    strategy: findCol(['strategy', 'role', 'type', 'horizon', 'mode']),
  };
}

module.exports = router;
