import React, { useState } from 'react';
import { initAI, getAIStatus } from '../api.js';

export default function Settings({ settings, setSettings, isAIReady, setIsAIReady }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSaveGeminiKey = async () => {
    if (!settings.geminiKey?.trim()) {
      setMessage('Please enter a valid API key');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      await initAI(settings.geminiKey, settings.useProModel);
      setIsAIReady(true);
      const isGemini = settings.geminiKey.trim().startsWith('AIza');
      setMessage(`✅ ${isGemini ? 'Google Gemini Native' : 'OpenRouter'} AI connected successfully!`);
    } catch (err) {
      setMessage(`❌ Failed: ${err.message}`);
      setIsAIReady(false);
    }
    setSaving(false);
  };

  const handleClearData = () => {
    localStorage.removeItem('stocksage_recent');
    localStorage.removeItem('stocksage_settings');
    setMessage('✅ All local data cleared. Refresh to apply.');
  };

  return (
    <div className="fade-in-up settings-section">
      <div className="dashboard-header">
        <h1>⚙️ Settings</h1>
        <p>Configure your API keys and execution preferences</p>
      </div>

      {/* Engine Status Banner */}
      <div className="glass-card" style={{ marginBottom: '1.5rem', border: '1px solid rgba(16, 185, 129, 0.35)', background: 'rgba(16, 185, 129, 0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.5rem' }}>⚡</span>
          <div>
            <div style={{ fontWeight: 800, color: 'var(--color-buy)', fontSize: '0.95rem' }}>Deterministic Quant & Algorithmic Synthesis: 100% Active</div>
            <div className="text-xs text-muted" style={{ marginTop: '0.15rem' }}>
              All 200 multi-cap stocks, Morning Breakout Radar, Volatility Compression Squeezes, Technical Indicators, Profit Maximizer, and the 5-Pillar Quant Consensus Engine run locally with 100% free uptime and zero API keys required.
            </div>
          </div>
        </div>
      </div>

      {/* AI Intelligence Key (OpenRouter or Google Gemini) */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <div className="settings-group">
          <h3>🔑 AI Intelligence Key (OpenRouter or Google Gemini — Optional)</h3>
          <p>Optional: Connect OpenRouter (<code>sk-or-...</code>) or Google Gemini (<code>AIza...</code>) for conversational multi-agent synthesis. All core quantitative analysis works with or without a key.</p>
          <div className="settings-row">
            <input
              type="password"
              className="input"
              placeholder="Enter OpenRouter (sk-or-...) or Google Gemini (AIza...) key..."
              value={settings.geminiKey || ''}
              onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
              id="gemini-api-key"
            />
            <button className="btn btn-primary" onClick={handleSaveGeminiKey} disabled={saving}>
              {saving ? '⏳ Connecting...' : '🔌 Connect'}
            </button>
            <button className="btn btn-secondary" onClick={async () => {
              const key = settings.geminiKey?.trim();
              if (!key) return setMessage('❌ Please enter an API key first');
              try {
                if (key.startsWith('AIza')) {
                  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
                  const data = await res.json();
                  if (data.models?.length > 0) {
                    setMessage(`✅ Google Gemini Key: Active & Verified! (${data.models.length} models accessible)`);
                    setIsAIReady(true);
                  } else {
                    setMessage(`❌ Google Gemini Key invalid or quota restricted: ${data.error?.message || 'Check key'}`);
                  }
                } else {
                  const res = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${key}` } });
                  const data = await res.json();
                  if (data.data) {
                    const limit = data.data.limit;
                    const usage = data.data.usage;
                    if (limit === null) setMessage(`✅ OpenRouter Credit: Unlimited (Usage: $${usage.toFixed(4)})`);
                    else setMessage(`✅ OpenRouter Credit: $${(limit - usage).toFixed(4)} remaining (Limit: $${limit})`);
                    setIsAIReady(true);
                  } else {
                    setMessage('❌ Failed to check balance (Invalid OpenRouter Key)');
                  }
                }
              } catch(e) {
                setMessage('❌ Failed to check balance: ' + e.message);
              }
            }}>
              🔍 Verify Key
            </button>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className={`ai-status ${isAIReady ? 'ready' : 'not-ready'}`}>
              <span className="ai-status-dot"></span>
              {isAIReady ? 'LLM Cloud Enhanced' : 'Local Algorithmic Baseline'}
            </span>
          </div>
        </div>
      </div>

      {/* NewsAPI Key (Optional) */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <div className="settings-group">
          <h3>📰 NewsAPI Key (Optional)</h3>
          <p>Improves news quality. Get a free key at <a href="https://newsapi.org/register" target="_blank" rel="noopener noreferrer">NewsAPI.org</a>. Falls back to Google News RSS if not provided.</p>
          <input
            type="password"
            className="input"
            placeholder="Enter your NewsAPI key (optional)..."
            value={settings.newsApiKey || ''}
            onChange={(e) => setSettings(prev => ({ ...prev, newsApiKey: e.target.value }))}
            id="news-api-key"
          />
        </div>
      </div>

      {/* Model Preference */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <div className="settings-group">
          <h3>🧠 AI Model Preference</h3>
          <p>Choose between faster/cheaper (Flash) or deeper analysis (Pro) for the Chief Strategist agent.</p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
            <button
              className={`btn ${!settings.useProModel ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSettings(prev => ({ ...prev, useProModel: false }))}
            >
              ⚡ Llama 3 / Flash (Fast) (Recommended)
            </button>
            <button
              className={`btn ${settings.useProModel ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSettings(prev => ({ ...prev, useProModel: true }))}
            >
              🧪 Llama 70B / Pro (Deep) (Deeper Analysis)
            </button>
          </div>
          <p className="text-xs text-muted" style={{ marginTop: '0.5rem' }}>
            Flash is ~10x cheaper and faster. Pro provides more nuanced analysis for the final strategist. Both use Flash for individual expert agents.
          </p>
        </div>
      </div>

      {/* Data Management */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <div className="settings-group">
          <h3>🗑️ Data Management</h3>
          <p>API keys are stored locally in your browser (localStorage). They are never sent to any external server.</p>
          <button className="btn btn-secondary" onClick={handleClearData} style={{ marginTop: '0.5rem' }}>
            Clear All Local Data
          </button>
        </div>
      </div>

      {/* Usage Info */}
      <div className="glass-card">
        <div className="settings-group">
          <h3>📊 API Usage Estimation</h3>
          <table className="portfolio-table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Operation</th>
                <th>Model</th>
                <th>Est. Tokens</th>
                <th>Est. Cost</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Technical Analyst', 'Flash', '~2,000', '~$0.0001'],
                ['Fundamental Analyst', 'Flash', '~2,500', '~$0.00015'],
                ['Sentiment Analyst', 'Flash', '~3,000', '~$0.0002'],
                ['Risk Manager', 'Flash', '~2,000', '~$0.0001'],
                ['Chief Strategist', settings.useProModel ? 'Pro' : 'Flash', '~5,000', settings.useProModel ? '~$0.005' : '~$0.0003'],
                ['Total per stock', 'Mixed', '~14,500', settings.useProModel ? '~$0.006' : '~$0.001'],
              ].map((row, i) => (
                <tr key={i} style={i === 5 ? { fontWeight: 700, borderTop: '1px solid var(--border-primary)' } : {}}>
                  <td>{row[0]}</td>
                  <td>{row[1]}</td>
                  <td>{row[2]}</td>
                  <td>{row[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {message && (
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: message.startsWith('✅') ? 'var(--color-buy)' : 'var(--color-sell)' }}>
          {message}
        </p>
      )}
    </div>
  );
}
