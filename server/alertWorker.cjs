require('dotenv').config();
const { aggregateStockData } = require('./services/dataAggregator.cjs');
const { runExpertPipeline, initializeAI } = require('./services/aiEngine.cjs');

async function checkAlerts() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    console.error('❌ Please provide at least one stock symbol to check.');
    console.error('Usage: node server/alertWorker.cjs TCS RELIANCE INFY');
    process.exit(1);
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENROUTER_API_KEY not found in .env');
    process.exit(1);
  }

  try {
    initializeAI(apiKey);
    console.log(`\n🔍 StockSage Alert Worker Started for: ${symbols.join(', ')}`);
    console.log(`⏰ Time: ${new Date().toLocaleString('en-IN')}\n`);

    const alerts = [];

    for (const symbol of symbols) {
      console.log(`[Worker] Analyzing ${symbol}...`);
      try {
        const data = await aggregateStockData(symbol);
        const analysis = await runExpertPipeline(data);
        
        const chief = analysis.chiefStrategist;
        if (!chief || chief.error) {
          console.log(`[Worker] ⚠️ AI analysis failed for ${symbol}`);
          continue;
        }

        const verdict = chief.overallVerdict?.toUpperCase();
        
        // Trigger alert only on actionable verdicts (BUY, STRONG_BUY, SELL, STRONG_SELL)
        if (['STRONG_BUY', 'BUY', 'STRONG_SELL', 'SELL'].includes(verdict)) {
          alerts.push({
            symbol,
            price: data.quote.price,
            verdict,
            target: chief.swingTrade?.targetPrice,
            stopLoss: chief.swingTrade?.stopLoss,
            summary: chief.actionableSummary
          });
          console.log(`[Worker] 🚨 Alert triggered for ${symbol}: ${verdict}`);
        } else {
          console.log(`[Worker] 💤 No alert for ${symbol} (Verdict: ${verdict})`);
        }
      } catch (err) {
        console.error(`[Worker] ❌ Error processing ${symbol}:`, err.message);
      }
    }

    if (alerts.length > 0) {
      console.log('\n======================================================');
      console.log('🔔 EMAIL/PUSH NOTIFICATION PAYLOAD GENERATED');
      console.log('======================================================');
      console.log(`Subject: StockSage Daily Alert: ${alerts.length} actionable setups\n`);
      
      alerts.forEach(alert => {
        const emoji = alert.verdict.includes('BUY') ? '🟢' : '🔴';
        console.log(`${emoji} **${alert.symbol}** | CMP: ₹${alert.price} | Action: ${alert.verdict}`);
        console.log(`   Target: ₹${alert.target} | Stop Loss: ₹${alert.stopLoss}`);
        console.log(`   AI Note: ${alert.summary}\n`);
      });
      
      console.log('======================================================');
      console.log('💡 To hook this up to a real email, install nodemailer and plug your SMTP creds here.');
    } else {
      console.log('\n💤 No actionable alerts today. Relax and do not force trades.');
    }

  } catch (error) {
    console.error('Fatal Worker Error:', error);
  }
  process.exit(0);
}

checkAlerts();
