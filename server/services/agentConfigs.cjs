// Tauric-style desk: Analysts → Bull/Bear research → Trader → Risk committee.
// Schemas stay JSON-only so the UI can show every layer.

const technicalAnalyst = {
  name: 'Technical Analyst',
  systemPrompt: `You are the market / technical analyst on an Indian NSE swing desk (3–15 day holds).
Use ONLY the provided OHLCV-derived indicators and the quantitative playbook.
Be specific in INR. If the setup is late or R:R is poor, say WAIT.`,
  outputSchema: {
    type: 'OBJECT',
    properties: {
      trend: { type: 'STRING' },
      trendStrength: { type: 'INTEGER' },
      pattern: { type: 'STRING', description: 'Pullback, flag, range, breakdown, etc.' },
      keyLevels: {
        type: 'OBJECT',
        properties: {
          immediateSupport: { type: 'NUMBER' },
          strongSupport: { type: 'NUMBER' },
          immediateResistance: { type: 'NUMBER' },
          strongResistance: { type: 'NUMBER' },
        },
      },
      signals: { type: 'ARRAY', items: { type: 'STRING' } },
      swingTrade: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING' },
          entryPrice: { type: 'NUMBER' },
          targetPrice: { type: 'NUMBER' },
          stopLoss: { type: 'NUMBER' },
          holdingPeriod: { type: 'STRING' },
          riskRewardRatio: { type: 'STRING' },
        },
      },
      confidence: { type: 'INTEGER' },
      verdict: { type: 'STRING' },
      reasoning: { type: 'STRING' },
    },
    required: ['trend', 'signals', 'swingTrade', 'confidence', 'verdict', 'reasoning'],
  },
};

const fundamentalAnalyst = {
  name: 'Fundamental Analyst',
  systemPrompt: `You are the fundamentals analyst for Indian equities. For a 3–15 day swing, fundamentals are a FILTER (avoid value traps / event landmines), not the entry trigger.
Flag valuation, earnings proximity if inferable from news, and sector tape.`,
  outputSchema: {
    type: 'OBJECT',
    properties: {
      valuation: { type: 'STRING' },
      valuationScore: { type: 'INTEGER' },
      growthOutlook: { type: 'STRING' },
      sectorOutlook: { type: 'STRING' },
      keyStrengths: { type: 'ARRAY', items: { type: 'STRING' } },
      keyRisks: { type: 'ARRAY', items: { type: 'STRING' } },
      newsCatalysts: { type: 'ARRAY', items: { type: 'STRING' } },
      swingImplication: { type: 'STRING', description: 'Does fundamental tape help, hurt, or not matter for this swing?' },
      confidence: { type: 'INTEGER' },
      verdict: { type: 'STRING' },
      reasoning: { type: 'STRING' },
    },
    required: ['valuation', 'keyStrengths', 'keyRisks', 'confidence', 'verdict', 'reasoning'],
  },
};

const newsAnalyst = {
  name: 'News Analyst',
  systemPrompt: `You are the news analyst. Separate material catalysts (results, regulation, large orders, promoter, FII) from headline noise.
State what would actually move the stock in the next 2 weeks.`,
  outputSchema: {
    type: 'OBJECT',
    properties: {
      materialEvents: { type: 'ARRAY', items: { type: 'STRING' } },
      noise: { type: 'ARRAY', items: { type: 'STRING' } },
      eventRiskNextTwoWeeks: { type: 'STRING' },
      newsBias: { type: 'STRING' },
      verdict: { type: 'STRING' },
      reasoning: { type: 'STRING' },
      confidence: { type: 'INTEGER' },
    },
    required: ['materialEvents', 'newsBias', 'verdict', 'reasoning'],
  },
};

const sentimentAnalyst = {
  name: 'Sentiment Analyst',
  systemPrompt: `You are the social/sentiment analyst for Indian retail (Reddit + headlines).
Crowd extremes are often wrong. Call out FOMO vs fear. Do not treat Reddit as truth.`,
  outputSchema: {
    type: 'OBJECT',
    properties: {
      overallSentiment: { type: 'STRING' },
      sentimentScore: { type: 'INTEGER' },
      newsSentiment: { type: 'STRING' },
      socialBuzz: { type: 'STRING' },
      keyThemes: { type: 'ARRAY', items: { type: 'STRING' } },
      catalysts: { type: 'ARRAY', items: { type: 'STRING' } },
      risks: { type: 'ARRAY', items: { type: 'STRING' } },
      contraindicators: { type: 'ARRAY', items: { type: 'STRING' } },
      confidence: { type: 'INTEGER' },
      verdict: { type: 'STRING' },
      reasoning: { type: 'STRING' },
    },
    required: ['overallSentiment', 'sentimentScore', 'keyThemes', 'confidence', 'verdict', 'reasoning'],
  },
};

const analystTeam = {
  name: 'Analyst Team',
  useProModel: false,
  systemPrompt: `You are four desk analysts writing independent memos for the SAME Indian stock (NSE/BSE swing, 3–15 days).

Roles (fill every section):
1. technicalAnalyst — structure, indicators, exact INR levels.
2. fundamentalAnalyst — valuation/health/sector as a swing FILTER.
3. newsAnalyst — material vs noise.
4. sentimentAnalyst — crowd psychology, contrarian flags.

Rules:
- Disagree if the data disagrees. Do not force consensus.
- Prefer WAIT over a bad R:R.
- Anchor prices to the quantitative playbook when it is provided, but you may adjust with a reason.
- Return ONLY JSON matching the schema.`,
};

const decisionRoom = {
  name: 'Decision Room',
  useProModel: false,
  systemPrompt: `You are the rest of a Tauric-style trading firm after the analyst memos:

1) bullResearcher — strongest honest case FOR a swing (long or covering). Cite analyst facts.
2) bearResearcher — strongest honest case AGAINST. Cite facts. No strawmen.
3) researchManager — who won the debate and WHY (one winner: BULL, BEAR, or STALEMATE).
4) trader — a single swing plan: action BUY/SELL/WAIT/AVOID, entry, stop, T1, T2, size as % of equity, hold window.
   You MUST refuse the trade if T1 risk-reward < 1.5 after costs, or if event risk is high.
5) riskAggressive — would take it larger / earlier.
6) riskConservative — would pass or cut size.
7) riskNeutral — balance.
8) portfolioManager — FINAL call after the risk debate: overallVerdict, confidence, actionableSummary.

This is for a retail Indian trader. Capital preservation first. Be decisive and explainable in plain language.
If you change the quantitative entry/stop, say why in trader.adjustmentNote.`,
};

module.exports = {
  technicalAnalyst,
  fundamentalAnalyst,
  newsAnalyst,
  sentimentAnalyst,
  analystTeam,
  decisionRoom,
};
