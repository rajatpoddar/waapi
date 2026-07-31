import { useCallback, useEffect, useState } from 'react'
import { api, getApiKey, setApiKey } from './api'
import SessionCard from './components/SessionCard'
import WebhookFeed from './components/WebhookFeed'
import SendPanel from './components/SendPanel'

export default function App() {
  const [apiKey, setApiKeyState] = useState(getApiKey())
  const [apiKeyDraft, setApiKeyDraft] = useState(getApiKey())
  const [health, setHealth] = useState(null)
  const [sessions, setSessions] = useState([])
  const [webhooks, setWebhooks] = useState([])
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [h, s, w] = await Promise.all([api.health(), api.status(), api.webhooks()])
      setHealth(h)
      setSessions(s.sessions || [])
      setWebhooks(w.events || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const saveKey = () => {
    setApiKey(apiKeyDraft)
    setApiKeyState(apiKeyDraft)
    refresh()
  }

  const connected = sessions.filter((s) => s.state === 'open').length
  const engineOnline = health?.baileys === 'reachable'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">W</span>
          <div>
            <h1>WAPI Admin</h1>
            <p>Self-hosted WhatsApp API · Baileys + FastAPI</p>
          </div>
        </div>
        <div className="topbar-right">
          <div className="key-input">
            <input
              type="password"
              placeholder="API key"
              value={apiKeyDraft}
              onChange={(e) => setApiKeyDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveKey()}
            />
            <button onClick={saveKey}>Save</button>
          </div>
          <span className={`pill ${engineOnline ? 'ok' : 'bad'}`}>
            {engineOnline ? 'engine online' : 'engine offline'}
          </span>
          <span className="pill neutral">
            {connected}/{sessions.length || 0} connected
          </span>
        </div>
      </header>

      {error && (
        <div className="banner">
          ⚠️ {error}
          {!apiKey && ' — enter your API key above to load data.'}
        </div>
      )}

      <main className="grid">
        <section className="col">
          <div className="section-head">
            <h2>Sessions</h2>
            <button className="ghost" onClick={refresh}>
              Refresh
            </button>
          </div>
          <div className="cards">
            {sessions.length === 0 && !error && (
              <p className="muted">No sessions yet — create one with <span className="mono">POST /sessions/&#123;name&#125;/start</span> and scan the QR.</p>
            )}
            {sessions.map((s) => (
              <SessionCard key={s.name} session={s} onChanged={refresh} />
            ))}
          </div>
          <SendPanel sessions={sessions} onSent={refresh} />
        </section>

        <section className="col">
          <div className="section-head">
            <h2>Webhook events</h2>
            <span className="muted">live · refreshes every 5s</span>
          </div>
          <WebhookFeed events={webhooks} />
        </section>
      </main>
    </div>
  )
}
