// AI Engine — manages OpenRouter API calls with structured output, caching, and multi-expert pipeline
const cache = require('../utils/cache.cjs');

let openRouterKey = process.env.OPENROUTER_API_KEY || null;
if (openRouterKey) {
  console.log(`[AIEngine] Auto-initialized OpenRouter from environment variables.`);
}
// Use free/cheap models on OpenRouter
const FLASH_MODELS = ['google/gemini-3.5-flash', 'google/gemini-2.5-flash', 'meta-llama/llama-3.1-8b-instruct'];
const PRO_MODELS = ['nvidia/nemotron-3-ultra-550b-a55b', 'google/gemini-2.5-pro', 'meta-llama/llama-3.1-70b-instruct'];

function initializeAI(apiKey) {
  if (!apiKey) throw new Error('OpenRouter API key is required');
  openRouterKey = apiKey;
  console.log(`[AIEngine] Initialized OpenRouter with key starting with ${apiKey.substring(0, 5)}...`);
}

function isInitialized() {
  return openRouterKey !== null;
}

function setModels(useProForFinal) {
  // Models are selected in the analyze function dynamically now
}

// Helper: sleep for ms
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Core function to call OpenRouter API with structured output + retry + fallback
async function analyzeWithAgent(agentConfig, dataContext, previousAnalyses = {}) {
  const { name, systemPrompt, outputSchema, useProModel } = agentConfig;
  
  const cacheKey = `ai:v2:${name}:${dataContext.symbol}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  if (!openRouterKey) throw new Error('AI models not initialized. Please set your OpenRouter API key in Settings.');

  // Build prompt with data context and previous analyses
  let fullPrompt = `${systemPrompt}\n\n`;
  fullPrompt += `## Stock Data for Analysis\n`;
  fullPrompt += `Symbol: ${dataContext.symbol}\n`;
  fullPrompt += `Company: ${dataContext.quote?.name || dataContext.symbol}\n\n`;
  
  // Add quote data
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

  // Add technical indicators (condensed)
  if (dataContext.technicals && !dataContext.technicals.error) {
    fullPrompt += `### Technical Indicators\n`;
    const t = dataContext.technicals;
    fullPrompt += `RSI(14): ${t.indicators.rsi.value} [${t.indicators.rsi.signal}]\n`;
    fullPrompt += `MACD: ${t.indicators.macd.macd} | Signal: ${t.indicators.macd.signal} | Histogram: ${t.indicators.macd.histogram} [${t.indicators.macd.crossover}]\n`;
    fullPrompt += `EMA9: ${t.indicators.ema.ema9} | EMA21: ${t.indicators.ema.ema21} | EMA50: ${t.indicators.ema.ema50} | EMA200: ${t.indicators.ema.ema200 || 'N/A'} [${t.indicators.ema.trend}]\n`;
    if (t.indicators.bollingerBands) {
      fullPrompt += `BB: Upper=${t.indicators.bollingerBands.upper} | Mid=${t.indicators.bollingerBands.middle} | Lower=${t.indicators.bollingerBands.lower} [${t.indicators.bollingerBands.position}]\n`;
    }
    if (t.indicators.adx) {
      fullPrompt += `ADX: ${t.indicators.adx.adx} | +DI: ${t.indicators.adx.pdi} | -DI: ${t.indicators.adx.mdi} [${t.indicators.adx.trendStrength} ${t.indicators.adx.trendDirection}]\n`;
    }
    fullPrompt += `ATR: ${t.indicators.atr.value} | Volume Ratio: ${t.indicators.volume.ratio}x [${t.indicators.volume.signal}]\n`;
    fullPrompt += `Support: ${t.supportResistance.supports.join(', ') || 'N/A'}\n`;
    fullPrompt += `Resistance: ${t.supportResistance.resistances.join(', ') || 'N/A'}\n`;
    fullPrompt += `Technical Score: ${t.overallTechnicalScore}/100\n`;
    fullPrompt += `Signals: ${t.signals.map(s => `[${s.type}] ${s.message}`).join('; ')}\n\n`;
  }

  // Add news (condensed)
  if (dataContext.news && dataContext.news.length > 0) {
    fullPrompt += `### Recent News Headlines (last 30 days)\n`;
    dataContext.news.slice(0, 10).forEach((n, i) => {
      fullPrompt += `${i + 1}. "${n.title}" — ${n.source} (${n.pubDate ? new Date(n.pubDate).toLocaleDateString() : 'recent'})\n`;
    });
    fullPrompt += '\n';
  }

  // Add Reddit data (condensed)
  if (dataContext.reddit && dataContext.reddit.posts.length > 0) {
    fullPrompt += `### Reddit Discussions (r/IndianStreetBets, r/IndianStockMarket)\n`;
    fullPrompt += `Total posts found: ${dataContext.reddit.summary.totalPosts} | Avg score: ${dataContext.reddit.summary.avgScore}\n`;
    dataContext.reddit.posts.slice(0, 8).forEach((p, i) => {
      fullPrompt += `${i + 1}. "${p.title}" [Score: ${p.score}, Comments: ${p.numComments}] — r/${p.subreddit}\n`;
    });
    fullPrompt += '\n';
  }

  // Add previous expert analyses
  if (Object.keys(previousAnalyses).length > 0) {
    fullPrompt += `### Previous Expert Analyses\n`;
    for (const [expertName, analysis] of Object.entries(previousAnalyses)) {
      fullPrompt += `\n--- ${expertName} ---\n`;
      fullPrompt += JSON.stringify(analysis, null, 1) + '\n';
    }
    fullPrompt += '\n';
  }

  if (dataContext.swingPlaybook) {
    fullPrompt += `### Quantitative Swing Playbook (math, not opinion)\n`;
    fullPrompt += JSON.stringify({
      setup: dataContext.swingPlaybook.setup,
      bias: dataContext.swingPlaybook.bias,
      qualityScore: dataContext.swingPlaybook.qualityScore,
      tradeWorthy: dataContext.swingPlaybook.tradeWorthy,
      levels: dataContext.swingPlaybook.levels,
      riskRewardT1: dataContext.swingPlaybook.riskRewardT1,
      why: dataContext.swingPlaybook.why,
      howToTrade: dataContext.swingPlaybook.explain?.howToTrade,
      invalidation: dataContext.swingPlaybook.explain?.invalidation,
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
    fullPrompt += `RS Rating: ${dataContext.relativeStrength.rsRating}/99 (${dataContext.relativeStrength.rsLineStatus})\n`;
    fullPrompt += `Outperformance 20d: ${dataContext.relativeStrength.outperformance20d}% | 60d: ${dataContext.relativeStrength.outperformance60d}%\n\n`;
  }

  fullPrompt += `\n\nCRITICAL INSTRUCTION: You MUST return ONLY a raw JSON object exactly matching this schema. Do not wrap in \`\`\`json markdown blocks. Just raw JSON text:\n${JSON.stringify(outputSchema, null, 2)}\n\nRULE: If the Quantitative Swing Playbook provides deterministic price levels, explain the thesis and sentiment around those levels, but DO NOT invent contradictory entry/stop levels. Today's date is ${new Date().toISOString().split('T')[0]}.`;

  // Try with fallback models and retry on 503/429
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
            "HTTP-Referer": "http://localhost:5173", // Optional, for including your app on openrouter.ai rankings.
            "X-Title": "StockSage India", // Optional. Shows in rankings on openrouter.ai.
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
        
        // Clean up markdown wrapping if present
        if (responseText.startsWith('```json')) {
            responseText = responseText.substring(7);
        }
        if (responseText.startsWith('```')) {
            responseText = responseText.substring(3);
        }
        if (responseText.endsWith('```')) {
            responseText = responseText.substring(0, responseText.length - 3);
        }
        
        const parsed = JSON.parse(responseText.trim());
        
        cache.set(cacheKey, parsed, 1800); // 30-min cache
        console.log(`[AIEngine] ${name} ✓ complete (${modelName}) for ${dataContext.symbol}`);
        return parsed;
      } catch (err) {
        const is503 = err.message?.includes('503') || err.message?.includes('502');
        const isRetryable = is503 || err.message?.includes('429');

        if (isRetryable && attempt < maxRetries) {
          const waitMs = (attempt + 1) * 2000; // 2s, 4s
          console.log(`[AIEngine] ${name}: ${modelName} returned ${is503 ? '503/502' : '429'}, retrying in ${waitMs}ms...`);
          await sleep(waitMs);
          continue;
        }

        if (mi < modelChain.length - 1) {
          console.log(`[AIEngine] ${name}: ${modelName} failed (${err.message.substring(0, 100)}...), falling back to ${modelChain[mi + 1]}...`);
          break; // break retry loop, try next model
        }

        // All models exhausted
        console.error(`[AIEngine] ${name} FAILED on all models:`, err.message);
        return {
          error: true,
          message: `${name} analysis failed: ${err.message}`,
          verdict: 'UNABLE_TO_ANALYZE',
        };
      }
    }
  }

  // Should not reach here, but just in case
  return { error: true, message: `${name}: all models exhausted`, verdict: 'UNABLE_TO_ANALYZE' };
}

function failDesk(message) {
  const errorObj = { error: true, verdict: 'UNABLE_TO_ANALYZE', reasoning: message };
  return {
    technicalAnalyst: errorObj,
    fundamentalAnalyst: errorObj,
    newsAnalyst: errorObj,
    sentimentAnalyst: errorObj,
    bullResearcher: errorObj,
    bearResearcher: errorObj,
    researchManager: errorObj,
    trader: errorObj,
    riskAggressive: errorObj,
    riskConservative: errorObj,
    riskNeutral: errorObj,
    riskManager: errorObj,
    chiefStrategist: {
      error: true,
      message,
      overallVerdict: 'UNABLE_TO_ANALYZE',
      actionableSummary: message,
    },
    pipeline: { status: 'failed', message },
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
  const agents = require('./agentConfigs.cjs');
  console.log(`[AIEngine] Tauric desk starting for ${stockData.symbol}...`);

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
    if (analysts.error) throw new Error(analysts.message);

    const decision = await analyzeWithAgent(decisionAgent, stockData, {
      technicalAnalyst: analysts.technicalAnalyst,
      fundamentalAnalyst: analysts.fundamentalAnalyst,
      newsAnalyst: analysts.newsAnalyst,
      sentimentAnalyst: analysts.sentimentAnalyst,
      quantitativePlaybook: stockData.swingPlaybook,
    });
    if (decision.error) throw new Error(decision.message);

    console.log(`[AIEngine] Desk complete for ${stockData.symbol}`);
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
        layers: [
          'Quant swing engine',
          'Analyst team',
          'Bull vs bear',
          'Trader plan',
          'Risk committee',
        ],
      },
    };
  } catch (err) {
    console.error(`[AIEngine] Desk failed:`, err.message);
    return failDesk(err.message);
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

module.exports = { initializeAI, isInitialized, setModels, analyzeWithAgent, runExpertPipeline };
