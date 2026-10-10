import React, { useState } from 'react';
import { initAI, getAIStatus } from '../api.js';

export default function Settings({ settings, setSettings, isAIReady, setIsAIReady }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSaveGeminiKey = async () => {
    if (!settings.geminiKey.trim()) {
      setMessage('Please enter a valid API key');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      await initAI(settings.geminiKey, settings.useProModel);
      setIsAIReady(true);
      setMessage('✅ OpenRouter AI connected successfully!');
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
        <p>Configure your API keys and preferences</p>
      </div>

      {/* OpenRouter API Key */}
      <div className="glass-card" style={{ marginBottom: '1.5rem' }}>
        <div className="settings-group">
          <h3>🔑 OpenRouter API Key</h3>
          <p>Required for AI-powered stock analysis. Get a free key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">openrouter.ai/keys</a>.</p>
          <div className="settings-row">
            <input
              type="password"
              className="input"
              placeholder="sk-or-v1-..."
              value={settings.geminiKey}
              onChange={(e) => setSettings(prev => ({ ...prev, geminiKey: e.target.value }))}
              id="gemini-api-key"
            />
            <button className="btn btn-primary" onClick={handleSaveGeminiKey} disabled={saving}>
              {saving ? '⏳ Connecting...' : '🔌 Connect'}
            </button>
            <button className="btn btn-secondary" onClick={async () => {
              if (!settings.geminiKey) return setMessage('❌ Please enter an API key first');
              try {
                const res = await fetch('https://openrouter.ai/api/v1/auth/key', { headers: { Authorization: `Bearer ${settings.geminiKey}` } });
                const data = await res.json();
                if (data.data) {
                  const limit = data.data.limit;
                  const usage = data.data.usage;
                  if (limit === null) setMessage(`✅ OpenRouter Credit: Unlimited (Usage: $${usage.toFixed(4)})`);
                  else setMessage(`✅ OpenRouter Credit: $${(limit - usage).toFixed(4)} remaining (Limit: $${limit})`);
                } else {
                  setMessage('❌ Failed to check balance (Invalid Key)');
                }
              } catch(e) {
                setMessage('❌ Failed to check balance');
              }
            }}>
              💰 Check Balance
            </button>
          </div>
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className={`ai-status ${isAIReady ? 'ready' : 'not-ready'}`}>
              <span className="ai-status-dot"></span>
              {isAIReady ? 'Connected' : 'Not Connected'}
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
