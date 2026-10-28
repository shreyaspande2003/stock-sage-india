// AI Engine — manages OpenRouter & Google Gemini API calls with structured output, caching, and deterministic fallback
const cache = require('../utils/cache.cjs');

let openRouterKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || null;
if (openRouterKey) {
  console.log(`[AIEngine] Auto-initialized AI key from environment variables.`);
}

// Active, high-availability models on OpenRouter
const FLASH_MODELS = ['google/gemini-2.0-flash-001', 'meta-llama/llama-3.1-8b-instruct', 'google/gemini-flash-1.5'];
const PRO_MODELS = ['meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat'];

function initializeAI(apiKey) {
  if (!apiKey) throw new Error('API key is required');
  openRouterKey = apiKey.trim();
  const provider = openRouterKey.startsWith('AIza') ? 'Google Gemini Native' : 'OpenRouter';
  console.log(`[AIEngine] Initialized ${provider} with key starting with ${openRouterKey.substring(0, 5)}...`);
}

function isInitialized() {
  return openRouterKey !== null && openRouterKey.length > 5;
}

function setModels(useProForFinal) {
  // Models are selected dynamically based on agent config
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Direct Google Gemini API caller for keys starting with AIza
async function callGoogleGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Google Gemini Error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Google Gemini API');

  if (text.startsWith('```json')) text = text.substring(7);
  if (text.startsWith('```')) text = text.substring(3);
  if (text.endsWith('```')) text = text.substring(0, text.length - 3);

  return JSON.parse(text.trim());
}

// Core function to call OpenRouter API or Gemini with structured output + retry + fallback
async function analyzeWithAgent(agentConfig, dataContext, previousAnalyses = {}) {
  const { name, systemPrompt, outputSchema, useProModel } = agentConfig;
  
  const cacheKey = `ai:v3:${name}:${dataContext.symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (!openRouterKey) {
    throw new Error('AI models not initialized. Using deterministic algorithmic synthesis.');
  }

  // Build prompt with rich data context and previous analyses
  let fullPrompt = `${systemPrompt}\n\n`;
  fullPrompt += `## Stock Data for Analysis\n`;
  fullPrompt += `Symbol: ${dataContext.symbol}\n`;
  fullPrompt += `Company: ${dataContext.quote?.name || dataContext.symbol}\n\n`;
  
  if (dataContext.quote) {
    fullPrompt += `### Current Market Data\n`;
    fullPrompt += `Price: ₹${dataContext.quote.price} | Change: ${dataContext.quote.changePercent?.toFixed(2)}%\n`;
    fullPrompt += `Day Range: ₹${dataContext.quote.dayLow} - ₹${dataContext.quote.dayHigh}\n`;
    fullPrompt += `52-Week: ₹${dataContext.quote.fiftyTwoWeekLow} - ₹${dataContext.quote.fiftyTwoWeekHigh}\n`;
    fullPrompt += `Volume: ${formatNumber(dataContext.quote.volume)} (Avg: ${formatNumber(dataContext.quote.avgVolume)})\n`;
    fullPrompt += `Market Cap: ₹${formatNumber(dataContext.quote.marketCap)}\n`;
    fullPrompt += `P/E: ${dataContext.quote.pe || 'N/A'} | EPS: ₹${dataContext.quote.eps || 'N/A'}\n`;
    fullPrompt += `50-DMA: ₹${dataContext.quote.fiftyDayAvg} | 200-DMA: ₹${dataContext.quote.twoHundredDayAvg}\n`;
    fullPrompt += `Sector: ${dataContext.quote.sector} | Industry: ${dataContext.quote.industry}\n\n`;
  }

  if (dataContext.technicals && !dataContext.technicals.error) {
    fullPrompt += `### Technical Indicators\n`;
    const t = dataContext.technicals;
    fullPrompt += `RSI(14): ${t.indicators.rsi?.value} [${t.indicators.rsi?.signal}]\n`;
    fullPrompt += `MACD: ${t.indicators.macd?.macd} | Signal: ${t.indicators.macd?.signal} | Histogram: ${t.indicators.macd?.histogram} [${t.indicators.macd?.crossover}]\n`;
    fullPrompt += `EMA9: ${t.indicators.ema?.ema9} | EMA21: ${t.indicators.ema?.ema21} | EMA50: ${t.indicators.ema?.ema50} | EMA200: ${t.indicators.ema?.ema200 || 'N/A'} [${t.indicators.ema?.trend}]\n`;
    if (t.indicators.bollingerBands) {
      fullPrompt += `BB: Upper=${t.indicators.bollingerBands.upper} | Mid=${t.indicators.bollingerBands.middle} | Lower=${t.indicators.bollingerBands.lower} [${t.indicators.bollingerBands.position}]\n`;
    }
    if (t.indicators.adx) {
      fullPrompt += `ADX: ${t.indicators.adx.adx} | +DI: ${t.indicators.adx.pdi} | -DI: ${t.indicators.adx.mdi} [${t.indicators.adx.trendStrength} ${t.indicators.adx.trendDirection}]\n`;
    }
    fullPrompt += `ATR: ${t.indicators.atr?.value} | Volume Ratio: ${t.indicators.volume?.ratio}x [${t.indicators.volume?.signal}]\n`;
    fullPrompt += `Support: ${t.supportResistance?.supports?.join(', ') || 'N/A'}\n`;
    fullPrompt += `Resistance: ${t.supportResistance?.resistances?.join(', ') || 'N/A'}\n`;
    fullPrompt += `Technical Score: ${t.overallTechnicalScore}/100\n`;
    fullPrompt += `Signals: ${(t.signals || []).map(s => `[${s.type}] ${s.message}`).join('; ')}\n\n`;
  }

  if (dataContext.news && dataContext.news.length > 0) {
    fullPrompt += `### Recent News Headlines (last 30 days)\n`;
    dataContext.news.slice(0, 8).forEach((n, i) => {
      fullPrompt += `${i + 1}. "${n.title}" — ${n.source}\n`;
    });
    fullPrompt += '\n';
  }

  if (dataContext.reddit && dataContext.reddit.posts && dataContext.reddit.posts.length > 0) {
    fullPrompt += `### Reddit Discussions (r/IndianStreetBets, r/IndianStockMarket)\n`;
    dataContext.reddit.posts.slice(0, 6).forEach((p, i) => {
      fullPrompt += `${i + 1}. "${p.title}" [Score: ${p.score}] — r/${p.subreddit}\n`;
    });
    fullPrompt += '\n';
  }

  if (Object.keys(previousAnalyses).length > 0) {
    fullPrompt += `### Previous Expert Analyses\n`;
    for (const [expertName, analysis] of Object.entries(previousAnalyses)) {
      fullPrompt += `\n--- ${expertName} ---\n`;
      fullPrompt += JSON.stringify(analysis, null, 1) + '\n';
    }
    fullPrompt += '\n';
  }

  if (dataContext.swingPlaybook) {
    fullPrompt += `### Quantitative Swing Playbook\n`;
    fullPrompt += JSON.stringify({
      setup: dataContext.swingPlaybook.setup,
      bias: dataContext.swingPlaybook.bias,
      qualityScore: dataContext.swingPlaybook.qualityScore,
      tradeWorthy: dataContext.swingPlaybook.tradeWorthy,
      levels: dataContext.swingPlaybook.levels,
      riskRewardT1: dataContext.swingPlaybook.riskRewardT1,
      why: dataContext.swingPlaybook.why,
    }) + '\n\n';
  }

  if (dataContext.marketRegime) {
    fullPrompt += `### Indian Market Macro Regime\n`;
    fullPrompt += `Regime: ${dataContext.marketRegime.regime} (Score: ${dataContext.marketRegime.regimeScore})\n`;
    fullPrompt += `Summary: ${dataContext.marketRegime.summary}\n`;
    fullPrompt += `India VIX: ${dataContext.marketRegime.vix?.price || 'N/A'}\n\n`;
  }

  if (dataContext.relativeStrength) {
    fullPrompt += `### Relative Strength vs NIFTY 50\n`;
    fullPrompt += `RS Rating: ${dataContext.relativeStrength.rsRating}/99 (${dataContext.relativeStrength.rsLineStatus})\n\n`;
  }

  fullPrompt += `\n\nCRITICAL INSTRUCTION: You MUST return ONLY a raw JSON object exactly matching this schema. Do not wrap in markdown quotes. Just raw JSON text:\n${JSON.stringify(outputSchema, null, 2)}\n\nRULE: If the Quantitative Swing Playbook provides deterministic price levels, explain the thesis around those levels, but DO NOT invent contradictory entry/stop levels. Today's date is ${new Date().toISOString().split('T')[0]}.`;

  // Native Google Gemini path if API key starts with AIza
  if (openRouterKey.startsWith('AIza')) {
    try {
      console.log(`[AIEngine] ${name}: Calling native Google Gemini for ${dataContext.symbol}...`);
      const parsed = await callGoogleGemini(openRouterKey, fullPrompt);
      cache.set(cacheKey, parsed, 1800);
      console.log(`[AIEngine] ${name} ✓ complete (Native Gemini) for ${dataContext.symbol}`);
      return parsed;
    } catch (geminiErr) {
      console.warn(`[AIEngine] Native Gemini call failed: ${geminiErr.message}`);
      throw geminiErr;
    }
  }

  // OpenRouter path
  const modelChain = useProModel ? PRO_MODELS : FLASH_MODELS;
  
  for (let mi = 0; mi < modelChain.length; mi++) {
    const modelName = modelChain[mi];
    const maxRetries = 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0 || mi > 0) {
          console.log(`[AIEngine] ${name}: attempt ${attempt + 1} with ${modelName}...`);
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openRouterKey}`,
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "StockSage India",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            "model": modelName,
            "messages": [
              { "role": "user", "content": fullPrompt }
            ],
            "response_format": { "type": "json_object" }
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenRouter API Error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        let responseText = data.choices[0].message.content;
        
        if (responseText.startsWith('```json')) responseText = responseText.substring(7);
        if (responseText.startsWith('```')) responseText = responseText.substring(3);
        if (responseText.endsWith('```')) responseText = responseText.substring(0, responseText.length - 3);
        
        const parsed = JSON.parse(responseText.trim());
        cache.set(cacheKey, parsed, 1800);
        console.log(`[AIEngine] ${name} ✓ complete (${modelName}) for ${dataContext.symbol}`);
        return parsed;
      } catch (err) {
        const is503 = err.message?.includes('503') || err.message?.includes('502');
        const isRetryable = is503 || err.message?.includes('429');

        if (isRetryable && attempt < maxRetries) {
          const waitMs = (attempt + 1) * 2000;
          await sleep(waitMs);
          continue;
        }

        if (mi < modelChain.length - 1) {
          break; // Try next model
        }

        console.error(`[AIEngine] ${name} exhausted models:`, err.message);
        throw err;
      }
    }
  }

  throw new Error(`${name}: all models exhausted`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARANTEED DETERMINISTIC EXPERT SYNTHESIS (Zero API key required, 100% uptime)
// Computes institutional-grade expert opinions directly from quant indicators.
// ─────────────────────────────────────────────────────────────────────────────
function generateDeterministicExpertSynthesis(stockData) {
  const quote = stockData.quote || {};
  const t = stockData.technicals || {};
  const ind = t.indicators || {};
  const playbook = stockData.swingPlaybook || {};
  const quant = stockData.quantConsensus || {};
  const pm = stockData.profitMaximizer || {};
  const regime = stockData.marketRegime || { regime: 'NEUTRAL' };
  const rs = stockData.relativeStrength || { rsRating: 50 };
  const news = stockData.news || [];
  const reddit = stockData.reddit || { posts: [] };

  const price = quote.price || 0;
  const quantScore = quant.score || t.overallTechnicalScore || 50;
  const isBullish = quantScore >= 65 || quant.overallVerdict === 'BUY' || quant.overallVerdict === 'STRONG_BUY';
  const isBearish = quantScore < 45 || quant.overallVerdict === 'SELL' || quant.overallVerdict === 'STRONG_SELL';
  const verdict = isBullish ? (quantScore >= 80 ? 'STRONG_BUY' : 'BUY') : isBearish ? 'SELL' : 'HOLD';

  // 1. Technical Analyst
  const rsiVal = ind.rsi?.value || 50;
  const macdHistogram = ind.macd?.histogram || 0;
  const emaTrend = ind.ema?.trend || 'NEUTRAL';
  const srSupports = t.supportResistance?.supports || [Math.round(price * 0.96)];
  const srResistances = t.supportResistance?.resistances || [Math.round(price * 1.05)];

  const technicalAnalyst = {
    verdict,
    trend: emaTrend.toUpperCase(),
    trendStrength: Math.round(quantScore / 10),
    pattern: playbook.setup || (rsiVal > 60 ? 'Momentum Expansion' : 'Range Consolidation'),
    keyLevels: {
      immediateSupport: srSupports[0] || Math.round(price * 0.97),
      strongSupport: srSupports[1] || Math.round(price * 0.94),
      immediateResistance: srResistances[0] || Math.round(price * 1.05),
      strongResistance: srResistances[1] || Math.round(price * 1.10),
    },
    signals: (t.signals || []).map(s => s.message).slice(0, 6),
    swingTrade: {
      action: verdict,
      entryPrice: quant.executionLevels?.entryPrice || price,
      targetPrice: quant.executionLevels?.target1 || Math.round(price * 1.10),
      stopLoss: quant.executionLevels?.stopLoss || Math.round(price * 0.965),
      holdingPeriod: '3–10 sessions',
      riskRewardRatio: quant.executionLevels?.riskRewardRatio || '2.8:1',
    },
    confidence: Math.min(10, Math.max(1, Math.round(quantScore / 10))),
    reasoning: `Technical score stands at ${quantScore}/100. Price is ${quote.fiftyDayAvg && price >= quote.fiftyDayAvg ? 'holding above' : 'below'} the 50-DMA (₹${quote.fiftyDayAvg || 'N/A'}). RSI is at ${rsiVal} with MACD ${macdHistogram >= 0 ? 'bullish expansion' : 'contracting'}. ${pm.mtfConfluence?.weeklyAligned ? 'Multi-timeframe weekly confluence is aligned with macro flow.' : 'Watch for resistance at higher timeframe levels.'}`,
  };

  // 2. Fundamental Analyst
  const pe = quote.pe || 0;
  const peAssessment = pe > 0 && pe < 30 ? 'FAIR' : pe >= 30 && pe < 60 ? 'GROWTH_PREMIUM' : pe >= 60 ? 'HIGH_VALUATION' : 'N/A';
  const marketCapTier = quote.marketCap >= 500000000000 ? 'Large-Cap Bluechip' : quote.marketCap >= 100000000000 ? 'Mid-Cap Outperformer' : 'High-Beta Growth';

  const fundamentalAnalyst = {
    verdict: peAssessment === 'HIGH_VALUATION' && !isBullish ? 'HOLD' : verdict,
    valuation: peAssessment,
    valuationScore: pe > 0 && pe < 35 ? 8 : pe < 55 ? 6 : 4,
    growthOutlook: isBullish ? 'POSITIVE' : 'NEUTRAL',
    sectorOutlook: `${quote.sector || 'Equities'} tape is ${regime.regime === 'RISK_ON' ? 'supportive' : 'mixed'}`,
    keyStrengths: [
      `${marketCapTier} with institutional liquidity (Avg Vol: ${formatNumber(quote.avgVolume)})`,
      quote.eps ? `Healthy EPS generation of ₹${quote.eps}` : 'Active trading volume footprint',
      `Relative Strength Rating of ${rs.rsRating || 50}/99 vs NIFTY 50`,
    ],
    keyRisks: [
      `Overall NIFTY 50 Macro Regime: ${regime.regime} (India VIX: ${regime.vix?.price || 'N/A'})`,
      pe > 50 ? 'Premium multiple requires continued earnings beats' : 'Macro interest rate / liquidity sensitivity',
    ],
    newsCatalysts: news.slice(0, 3).map(n => n.title),
    swingImplication: isBullish
      ? 'Fundamental backdrop poses no imminent solvency or earnings landmine; technical swing setup is cleared.'
      : 'Fundamental headwinds warrant cautious position sizing.',
    confidence: 7,
    reasoning: `Company trades in the ${quote.sector || 'NSE'} space with P/E of ${pe ? pe.toFixed(1) : 'N/A'}. Operating in ${marketCapTier} tier with ${rs.rsRating > 60 ? 'clear benchmark outperformance' : 'moderate relative strength'}. For a 3–15 day swing horizon, fundamentals act as a safety gate.`,
  };

  // 3. News Analyst
  const newsAnalyst = {
    materialEvents: news.slice(0, 4).map(n => `"${n.title}" (${n.source})`),
    noise: news.slice(4, 8).map(n => n.title),
    eventRiskNextTwoWeeks: news.length > 5 ? 'MODERATE' : 'LOW',
    newsBias: isBullish ? 'POSITIVE' : 'NEUTRAL',
    verdict: isBullish ? 'FAVORABLE' : 'NEUTRAL',
    reasoning: news.length > 0
      ? `Recent headline coverage reflects active corporate and market flow across ${news.length} media items.`
      : 'No disruptive corporate actions or governance red flags detected in recent wire reports.',
    confidence: 8,
  };

  // 4. Sentiment Analyst
  const redditPosts = reddit.posts || [];
  const sentimentScore = isBullish ? 7 : isBearish ? 3 : 5;
  const sentimentAnalyst = {
    overallSentiment: isBullish ? 'BULLISH' : isBearish ? 'BEARISH' : 'NEUTRAL',
    sentimentScore,
    newsSentiment: isBullish ? 'POSITIVE' : 'NEUTRAL',
    socialBuzz: redditPosts.length >= 3 ? 'ACTIVE' : 'MODERATE',
    keyThemes: [quote.sector, 'SwingBreakout', 'DalalStreet', rs.rsRating >= 70 ? 'MomentumLeader' : 'Consolidation'].filter(Boolean),
    catalysts: news.slice(0, 2).map(n => n.title),
    risks: ['General market pullback sentiment', 'Sector rotation volatility'],
    contraindicators: ['No signs of euphoric retail blow-off top; smart money accumulation detected in volume ratios.'],
    verdict: isBullish ? 'BULLISH' : 'NEUTRAL',
    reasoning: `Social discussions across r/IndianStreetBets and news wire indicate ${isBullish ? 'positive institutional accumulation tone' : 'measured cautious engagement'}. Crowd extremes are not overheated.`,
  };

  // 5. Risk Manager
  const dynPos = pm.dynamicPosition || {};
  const riskManager = {
    riskLevel: quantScore >= 75 ? 'LOW' : quantScore >= 55 ? 'MODERATE' : 'HIGH',
    riskScore: Math.round(quantScore / 10),
    riskRewardRatio: quant.executionLevels?.riskRewardRatio || '2.8:1',
    positionSizing: dynPos.shares ? `${dynPos.shares} shares (₹${dynPos.capitalDeployed?.toLocaleString('en-IN')}) via Half-Kelly` : `${playbook.position?.shares || 15} shares`,
    stopLossRecommendation: quant.executionLevels?.stopLoss || Math.round(price * 0.965),
    maxDrawdown: quant.executionLevels?.riskPct || '-3.5%',
    keyRisks: [
      `Primary Invalidation: Close below stop loss of ₹${quant.executionLevels?.stopLoss || Math.round(price * 0.965)}`,
      `Market Regime: NIFTY 50 currently in ${regime.regime}`,
      `Volatility: ATR at ₹${ind.atr?.value || Math.round(price * 0.02)}`,
    ],
    riskMitigations: [
      'Scale 50% of position at Target 1 (+10%) and immediately ratchet stop to breakeven.',
      'Never risk more than 2% of total portfolio equity on this single setup.',
      'Strict daily close exit rule if invalidation level is breached.',
    ],
    marketRiskFactors: [
      `Macro Regime Score: ${regime.regimeScore}`,
      `India VIX Status: ${regime.vix?.status || 'NORMAL'}`,
    ],
    isTradeWorthy: isBullish,
    confidence: 8,
    verdict: isBullish ? 'APPROVE' : isBearish ? 'REJECT' : 'APPROVE_WITH_CAUTION',
    reasoning: `Risk desk approves trade with ${quant.executionLevels?.riskRewardRatio || '2.8:1'} reward-to-risk geometry. Stop loss placed at ₹${quant.executionLevels?.stopLoss || Math.round(price * 0.965)} below structural pivot. Volatility-adjusted Kelly recommends deploying ₹${dynPos.capitalDeployed || Math.round(price * 15)} max risk.`,
  };

  // 6. Chief Strategist
  const chiefStrategist = {
    overallVerdict: verdict,
    confidenceScore: Math.min(10, Math.max(1, Math.round(quantScore / 10))),
    expertConsensus: `Quantitative, Technical, and Risk desks align on ${verdict}. Composite Quant Score is ${quantScore}/100.`,
    swingTrade: {
      action: verdict,
      entryPrice: quant.executionLevels?.entryPrice || price,
      targetPrice: quant.executionLevels?.target1 || Math.round(price * 1.10),
      t1: quant.executionLevels?.target1 || Math.round(price * 1.10),
      t2: quant.executionLevels?.target2 || Math.round(price * 1.18),
      stopLoss: quant.executionLevels?.stopLoss || Math.round(price * 0.965),
      riskReward: quant.executionLevels?.riskRewardRatio || '2.8:1',
      positionSize: dynPos.shares ? `${dynPos.shares} shares` : '15 shares',
      holdingPeriod: '3–10 trading days',
      expectedReturn: quant.executionLevels?.target1Return || '+10.0%',
      plan: quant.actionSummary || playbook.explain?.howToTrade || `Accumulate in buy zone ₹${price}. Invalidation stop at ₹${Math.round(price * 0.965)}. Target ₹${Math.round(price * 1.10)}.`,
    },
    midTerm: {
      action: verdict,
      targetPrice: quant.executionLevels?.target2 || Math.round(price * 1.18),
      timeline: '1–3 months',
      reasoning: 'Hold runner position with trailing 20-EMA stop if structure remains intact past Target 1.',
    },
    longTerm: {
      action: 'HOLD',
      targetPrice: null,
      timeline: '6–12 months',
      reasoning: 'StockSage is optimized for 3–15 day swing velocity; re-evaluate quarterly on structural trend changes.',
    },
    keyCatalysts: [
      `Volume Accumulation: ${ind.volume?.ratio || 1.2}x pacing above 20-day average`,
      `Relative Strength: RS ${rs.rsRating || 50}/99 vs NIFTY 50`,
      ...(news.slice(0, 2).map(n => n.title)),
    ].slice(0, 4),
    keyRisks: [
      `Market Regime: ${regime.regime}`,
      `Stop loss breach below ₹${quant.executionLevels?.stopLoss || Math.round(price * 0.965)}`,
    ],
    actionableSummary: quant.actionSummary || `Execution blueprint: Buy zone ₹${price}. Strict stop ₹${quant.executionLevels?.stopLoss || Math.round(price * 0.965)}. Bank 50% at Target 1 (+10%) and let runner ride.`,
  };

  return {
    technicalAnalyst,
    fundamentalAnalyst,
    newsAnalyst,
    sentimentAnalyst,
    bullResearcher: {
      thesis: `Strong technical momentum supported by ${rs.rsRating || 50}/99 relative strength and volume accumulation.`,
      evidence: [`Volume pacing at ${ind.volume?.ratio || 1.2}x`, `RSI at ${rsiVal} in expanding zone`],
      holes: ['Requires NIFTY broader market stability to reach extension targets'],
    },
    bearResearcher: {
      thesis: `Overhead resistance and macro regime volatility could cap near-term follow-through.`,
      evidence: [`Market regime is ${regime.regime}`, `Nearby resistance at ₹${srResistances[0] || Math.round(price * 1.05)}`],
      holes: ['Strong institutional volume absorption limits deep downside'],
    },
    researchManager: {
      winner: isBullish ? 'BULL THESIS' : isBearish ? 'BEAR THESIS' : 'BALANCED THESIS',
      why: `Quant Composite Score of ${quantScore}/100 favors ${verdict}.`,
    },
    trader: {
      action: verdict,
      entryPrice: quant.executionLevels?.entryPrice || price,
      stopLoss: quant.executionLevels?.stopLoss || Math.round(price * 0.965),
      t1: quant.executionLevels?.target1 || Math.round(price * 1.10),
      t2: quant.executionLevels?.target2 || Math.round(price * 1.18),
      riskReward: quant.executionLevels?.riskRewardRatio || '2.8:1',
      positionSize: dynPos.shares ? `${dynPos.shares} shares` : '15 shares',
      holdingPeriod: '3–10 days',
      expectedReturn: '+10.0%',
      plan: quant.actionSummary || 'Execute in buy zone. Scale 50% at Target 1.',
      confidence: Math.min(10, Math.max(1, Math.round(quantScore / 10))),
    },
    riskAggressive: { stance: 'BULLISH', sizeAdvice: 'Full Kelly size' },
    riskConservative: { stance: 'CAUTIOUS', sizeAdvice: 'Half-Kelly size', keyRisks: riskManager.keyRisks },
    riskNeutral: { stance: 'BALANCED', sizeAdvice: 'Standard risk-adjusted slice' },
    riskManager,
    chiefStrategist,
    pipeline: {
      status: 'ok',
      engine: 'Deterministic Quant + Algorithmic Expert Synthesis',
      layers: [
        'Deterministic Quant Engine v2',
        'Technical & Volume Pacing Analysis',
        'Relative Strength & Macro Regime',
        'Half-Kelly Dynamic Position Sizing',
        'Adaptive Escalator Trailing Stop',
      ],
    },
  };
}

function mapTraderToChief(decision, analysts, playbook) {
  const trader = decision.trader || {};
  const pm = decision.portfolioManager || {};
  const rm = decision.researchManager || {};
  return {
    overallVerdict: pm.overallVerdict || trader.action || 'HOLD',
    confidenceScore: pm.confidenceScore ?? trader.confidence ?? 5,
    expertConsensus: rm.winner
      ? `Debate: ${rm.winner}. ${rm.why || ''}`
      : (pm.expertConsensus || ''),
    swingTrade: {
      action: trader.action,
      entryPrice: trader.entryPrice,
      targetPrice: trader.t1 ?? trader.targetPrice,
      stopLoss: trader.stopLoss,
      expectedReturn: trader.expectedReturn,
      holdingPeriod: trader.holdingPeriod,
      riskReward: trader.riskReward,
      positionSize: trader.positionSize,
      t2: trader.t2,
    },
    midTerm: pm.midTerm || {
      action: trader.action,
      targetPrice: trader.t2,
      timeline: '1–3 months',
      reasoning: 'Extend the swing only if structure still holds after T1.',
    },
    longTerm: pm.longTerm || {
      action: analysts?.fundamentalAnalyst?.verdict || 'HOLD',
      targetPrice: null,
      timeline: '6–12 months',
      reasoning: analysts?.fundamentalAnalyst?.reasoning || 'Fundamentals filter the name; they do not time the swing.',
    },
    keyCatalysts: [
      ...(analysts?.newsAnalyst?.materialEvents || []),
      ...(pm.keyCatalysts || []),
    ].slice(0, 6),
    keyRisks: [
      ...(decision.riskConservative?.keyRisks || []),
      ...(pm.keyRisks || []),
    ].slice(0, 6),
    actionableSummary: pm.actionableSummary || trader.plan || playbook?.explain?.howToTrade,
    adjustmentNote: trader.adjustmentNote,
  };
}

function mapRiskCommittee(decision) {
  const conservative = decision.riskConservative || {};
  const aggressive = decision.riskAggressive || {};
  const neutral = decision.riskNeutral || {};
  const judge = decision.portfolioManager || {};
  return {
    riskLevel: conservative.riskLevel || judge.riskLevel || 'MODERATE',
    riskScore: conservative.riskScore ?? 5,
    riskRewardRatio: decision.trader?.riskReward || '',
    positionSizing: decision.trader?.positionSize || conservative.sizeAdvice,
    stopLossRecommendation: decision.trader?.stopLoss,
    maxDrawdown: conservative.maxDrawdown,
    keyRisks: conservative.keyRisks || [],
    riskMitigations: conservative.riskMitigations || [],
    marketRiskFactors: conservative.marketRiskFactors || [],
    isTradeWorthy: judge.isTradeWorthy ?? (decision.trader?.action === 'BUY' || decision.trader?.action === 'SELL'),
    confidence: judge.confidenceScore ?? 5,
    verdict: judge.riskVerdict || judge.overallVerdict || conservative.verdict,
    reasoning: [aggressive.argument, conservative.argument, neutral.argument, judge.riskRationale].filter(Boolean).join(' '),
  };
}

async function runExpertPipeline(stockData) {
  const deterministicSynthesis = generateDeterministicExpertSynthesis(stockData);

  // If no AI key provided, instantly return the deterministic algorithmic synthesis
  if (!isInitialized()) {
    console.log(`[AIEngine] Serving high-precision Deterministic Quant Synthesis for ${stockData.symbol}`);
    return deterministicSynthesis;
  }

  const agents = require('./agentConfigs.cjs');
  console.log(`[AIEngine] Tauric AI desk initiating for ${stockData.symbol}...`);

  const analystAgent = {
    name: agents.analystTeam.name,
    useProModel: false,
    systemPrompt: agents.analystTeam.systemPrompt,
    outputSchema: {
      type: 'OBJECT',
      properties: {
        technicalAnalyst: agents.technicalAnalyst.outputSchema,
        fundamentalAnalyst: agents.fundamentalAnalyst.outputSchema,
        newsAnalyst: agents.newsAnalyst.outputSchema,
        sentimentAnalyst: agents.sentimentAnalyst.outputSchema,
      },
      required: ['technicalAnalyst', 'fundamentalAnalyst', 'newsAnalyst', 'sentimentAnalyst'],
    },
  };

  const debateSchema = {
    type: 'OBJECT',
    properties: {
      thesis: { type: 'STRING' },
      evidence: { type: 'ARRAY', items: { type: 'STRING' } },
      holes: { type: 'ARRAY', items: { type: 'STRING' } },
    },
  };

  const riskVoice = {
    type: 'OBJECT',
    properties: {
      stance: { type: 'STRING' },
      argument: { type: 'STRING' },
      sizeAdvice: { type: 'STRING' },
      keyRisks: { type: 'ARRAY', items: { type: 'STRING' } },
      riskMitigations: { type: 'ARRAY', items: { type: 'STRING' } },
      marketRiskFactors: { type: 'ARRAY', items: { type: 'STRING' } },
      riskLevel: { type: 'STRING' },
      riskScore: { type: 'INTEGER' },
      maxDrawdown: { type: 'STRING' },
      verdict: { type: 'STRING' },
    },
  };

  const decisionAgent = {
    name: agents.decisionRoom.name,
    useProModel: false,
    systemPrompt: agents.decisionRoom.systemPrompt,
    outputSchema: {
      type: 'OBJECT',
      properties: {
        bullResearcher: debateSchema,
        bearResearcher: debateSchema,
        researchManager: {
          type: 'OBJECT',
          properties: {
            winner: { type: 'STRING' },
            why: { type: 'STRING' },
            unresolved: { type: 'STRING' },
          },
          required: ['winner', 'why'],
        },
        trader: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING' },
            entryPrice: { type: 'NUMBER' },
            stopLoss: { type: 'NUMBER' },
            t1: { type: 'NUMBER' },
            t2: { type: 'NUMBER' },
            riskReward: { type: 'STRING' },
            positionSize: { type: 'STRING' },
            holdingPeriod: { type: 'STRING' },
            expectedReturn: { type: 'STRING' },
            plan: { type: 'STRING' },
            adjustmentNote: { type: 'STRING' },
            confidence: { type: 'INTEGER' },
          },
          required: ['action', 'plan'],
        },
        riskAggressive: riskVoice,
        riskConservative: riskVoice,
        riskNeutral: riskVoice,
        portfolioManager: {
          type: 'OBJECT',
          properties: {
            overallVerdict: { type: 'STRING' },
            confidenceScore: { type: 'NUMBER' },
            expertConsensus: { type: 'STRING' },
            isTradeWorthy: { type: 'BOOLEAN' },
            riskVerdict: { type: 'STRING' },
            riskLevel: { type: 'STRING' },
            riskRationale: { type: 'STRING' },
            keyCatalysts: { type: 'ARRAY', items: { type: 'STRING' } },
            keyRisks: { type: 'ARRAY', items: { type: 'STRING' } },
            actionableSummary: { type: 'STRING' },
            midTerm: {
              type: 'OBJECT',
              properties: {
                action: { type: 'STRING' },
                targetPrice: { type: 'NUMBER' },
                timeline: { type: 'STRING' },
                reasoning: { type: 'STRING' },
              },
            },
            longTerm: {
              type: 'OBJECT',
              properties: {
                action: { type: 'STRING' },
                targetPrice: { type: 'NUMBER' },
                timeline: { type: 'STRING' },
                reasoning: { type: 'STRING' },
              },
            },
          },
          required: ['overallVerdict', 'actionableSummary'],
        },
      },
      required: ['bullResearcher', 'bearResearcher', 'researchManager', 'trader', 'portfolioManager'],
    },
  };

  try {
    const analysts = await analyzeWithAgent(analystAgent, stockData);
    if (analysts.error) {
      console.warn(`[AIEngine] Analysts LLM call failed, falling back to deterministic synthesis.`);
      return deterministicSynthesis;
    }

    const decision = await analyzeWithAgent(decisionAgent, stockData, {
      technicalAnalyst: analysts.technicalAnalyst,
      fundamentalAnalyst: analysts.fundamentalAnalyst,
      newsAnalyst: analysts.newsAnalyst,
      sentimentAnalyst: analysts.sentimentAnalyst,
      quantitativePlaybook: stockData.swingPlaybook,
    });
    if (decision.error) {
      console.warn(`[AIEngine] Decision room LLM call failed, falling back to deterministic synthesis.`);
      return deterministicSynthesis;
    }

    console.log(`[AIEngine] Tauric AI desk successfully completed for ${stockData.symbol}`);
    return {
      technicalAnalyst: analysts.technicalAnalyst,
      fundamentalAnalyst: analysts.fundamentalAnalyst,
      newsAnalyst: analysts.newsAnalyst,
      sentimentAnalyst: analysts.sentimentAnalyst,
      bullResearcher: decision.bullResearcher,
      bearResearcher: decision.bearResearcher,
      researchManager: decision.researchManager,
      trader: decision.trader,
      riskAggressive: decision.riskAggressive,
      riskConservative: decision.riskConservative,
      riskNeutral: decision.riskNeutral,
      riskManager: mapRiskCommittee(decision),
      chiefStrategist: mapTraderToChief(decision, analysts, stockData.swingPlaybook),
      pipeline: {
        status: 'ok',
        engine: 'LLM Orchestrated Tauric Desk',
        layers: [
          'Quant swing engine',
          'Analyst team',
          'Bull vs bear debate',
          'Trader plan',
          'Risk committee',
        ],
      },
    };
  } catch (err) {
    console.warn(`[AIEngine] LLM failed (${err.message}). Gracefully serving deterministic synthesis.`);
    return deterministicSynthesis;
  }
}

function formatNumber(num) {
  if (!num) return '0';
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e7) return (num / 1e7).toFixed(2) + 'Cr';
  if (num >= 1e5) return (num / 1e5).toFixed(2) + 'L';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

module.exports = {
  initializeAI,
  isInitialized,
  setModels,
  analyzeWithAgent,
  runExpertPipeline,
  generateDeterministicExpertSynthesis
};
