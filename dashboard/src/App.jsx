import { useCallback, useEffect, useRef, useState } from 'react'
import { api, clearApiKey, getApiKey, getSettings, verifyKey } from './api'
import SessionCard from './components/SessionCard'
import WebhookFeed from './components/WebhookFeed'
import SendPanel from './components/SendPanel'
import AddSessionButton from './components/AddSessionButton'
import SettingsPanel from './components/SettingsPanel'
import LoginScreen from './components/LoginScreen'

const TABS = ['sessions', 'webhooks', 'settings']

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [health, setHealth] = useState(null)
  const [sessions, setSessions] = useState([])
  const [webhooks, setWebhooks] = useState([])
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('sessions')
  const [settings, setSettings] = useState(getSettings())
  const refreshTimer = useRef(null)

  const refresh = useCallback(async () => {
    if (!getApiKey()) return
    try {
      const [h, s, w] = await Promise.all([api.health(), api.status(), api.webhooks(500)])
      setHealth(h)
      setSessions(s.sessions || [])
      setWebhooks(w.events || [])
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [settings.pageSize])

  // Validate the stored API key once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = getApiKey()
      if (stored) {
        const result = await verifyKey(stored)
        if (cancelled) return
        if (result === 'ok') {
          setAuthed(true)
        } else {
          clearApiKey()
        }
      }
      setChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-refresh
  useEffect(() => {
    if (!authed || !settings.autoRefresh) return
    refresh()
    refreshTimer.current = setInterval(refresh, 5000)
    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current)
        refreshTimer.current = null
      }
    }
  }, [authed, refresh, settings.autoRefresh])

  const handleLogout = () => {
    clearApiKey()
    setAuthed(false)
    setSessions([])
    setWebhooks([])
    setHealth(null)
    setError('')
    setActiveTab('sessions')
  }

  if (checking) {
    return (
      <div className="login-screen">
        <div className="login-card login-card--loading">Loading…</div>
      </div>
    )
  }

  if (!authed) {
    return <LoginScreen onAuthed={() => setAuthed(true)} />
  }

  const connected = sessions.filter((s) => s.state === 'open').length
  const engineOnline = health?.baileys === 'reachable'

  const activeSessions = sessions.filter((s) => s.state === 'open')
  const closedSessions = sessions.filter((s) => s.state !== 'open')

  return (
    <div className="app">
      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="logo">W</span>
          <div className="sidebar-brand-text">
            <h1>WAPI</h1>
            <p>Admin Panel</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          {TABS.map((tab) => (
            <button
              key={tab}
              className={`nav-item ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              <span className="nav-icon">
                {tab === 'sessions' && '📱'}
                {tab === 'webhooks' && '🔔'}
                {tab === 'settings' && '⚙️'}
              </span>
              <span className="nav-label">
                {tab === 'sessions' && 'Sessions'}
                {tab === 'webhooks' && 'Webhooks'}
                {tab === 'settings' && 'Settings'}
              </span>
              {tab === 'sessions' && sessions.length > 0 && (
                <span className="nav-badge">{connected}/{sessions.length}</span>
              )}
              {tab === 'webhooks' && webhooks.length > 0 && (
                <span className="nav-badge">{webhooks.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className={`status-dot ${engineOnline ? 'ok' : 'bad'}`} />
            <span className="status-text">{engineOnline ? 'Engine online' : 'Engine offline'}</span>
          </div>
          <button className="ghost sidebar-logout" onClick={handleLogout} title="Clear API key and lock the dashboard">
            🔒 Sign out
          </button>
        </div>
      </aside>

      {/* ─── Main content ─── */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h2>
              {activeTab === 'sessions' && 'Sessions'}
              {activeTab === 'webhooks' && 'Webhook Events'}
              {activeTab === 'settings' && 'Settings'}
            </h2>
            <span className="muted">
              {activeTab === 'sessions' && `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`}
              {activeTab === 'webhooks' && `${webhooks.length} event${webhooks.length !== 1 ? 's' : ''} · live`}
              {activeTab === 'settings' && 'Configure dashboard preferences'}
            </span>
          </div>
          <div className="topbar-right">
            {activeTab === 'sessions' && (
              <>
                <AddSessionButton onCreated={refresh} />
                <button className="ghost" onClick={refresh} title="Refresh">
                  ↻
                </button>
              </>
            )}
            {activeTab === 'webhooks' && (
              <button className="ghost" onClick={refresh} title="Refresh">
                ↻ Refresh
              </button>
            )}
          </div>
        </header>

        {error && (
          <div className="banner">
            ⚠️ {error}
          </div>
        )}

        <main className="content">
          {activeTab === 'sessions' && (
            <div className="tab-content sessions-view">
              {activeSessions.length > 0 && (
                <div className="session-group">
                  <h3 className="group-label">Active</h3>
                  <div className="cards">
                    {activeSessions.map((s) => (
                      <SessionCard key={s.name} session={s} onChanged={refresh} />
                    ))}
                  </div>
                </div>
              )}
              {closedSessions.length > 0 && (
                <div className="session-group">
                  <h3 className="group-label">Inactive</h3>
                  <div className="cards">
                    {closedSessions.map((s) => (
                      <SessionCard key={s.name} session={s} onChanged={refresh} />
                    ))}
                  </div>
                </div>
              )}
              {sessions.length === 0 && !error && (
                <div className="empty-state">
                  <p className="muted">No sessions yet — click <strong>+ Add Session</strong> to create one and scan the QR.</p>
                </div>
              )}
              <SendPanel sessions={sessions} onSent={refresh} />
            </div>
          )}

          {activeTab === 'webhooks' && (
            <div className="tab-content">
              <WebhookFeed
                events={webhooks}
                pageSize={settings.pageSize}
                eventFilter={settings.eventFilter}
              />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="tab-content">
              <SettingsPanel onSettingsChange={(s) => setSettings(s)} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
