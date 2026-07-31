import { useState } from 'react'
import { getSettings, saveSettings } from '../api'

const EVENT_TYPES = [
  'message',
  'message.sent',
  'message.delivered',
  'message.read',
  'connection.open',
  'connection.close',
  'qr',
  'logout',
]

const PAGE_SIZE_OPTIONS = [15, 30, 50, 100]

export default function SettingsPanel({ onSettingsChange }) {
  const [settings, setSettings] = useState(getSettings())

  const update = (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
    if (onSettingsChange) onSettingsChange(next)
  }

  const toggleEvent = (event) => {
    const current = settings.eventFilter ? settings.eventFilter.split(',') : []
    const next = current.includes(event)
      ? current.filter((e) => e !== event)
      : [...current, event]
    update({ eventFilter: next.join(',') })
  }

  const selectedEvents = settings.eventFilter ? settings.eventFilter.split(',').filter(Boolean) : []

  return (
    <div className="settings-panel">
      <div className="settings-group">
        <h3>Webhook Feed</h3>

        <div className="setting-row">
          <label>Page size</label>
          <select
            value={settings.pageSize}
            onChange={(e) => update({ pageSize: parseInt(e.target.value, 10) })}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} events</option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <label>Auto-refresh</label>
          <button
            className={`toggle ${settings.autoRefresh ? 'on' : 'off'}`}
            onClick={() => update({ autoRefresh: !settings.autoRefresh })}
          >
            {settings.autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>

        <div className="setting-row">
          <label>Filter events</label>
          {settings.eventFilter && (
            <button className="btn ghost small" onClick={() => update({ eventFilter: '' })}>
              Clear filter
            </button>
          )}
        </div>
        <div className="event-toggles">
          {EVENT_TYPES.map((event) => (
            <button
              key={event}
              className={`event-chip ${selectedEvents.includes(event) ? 'active' : ''}`}
              onClick={() => toggleEvent(event)}
            >
              {event}
            </button>
          ))}
          {selectedEvents.length === 0 && (
            <span className="dim" style={{ fontSize: 12 }}>All events shown (no filter)</span>
          )}
        </div>
      </div>

      <div className="settings-group">
        <h3>About</h3>
        <p className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <strong>WAPI</strong> — Self-hosted WhatsApp API.<br />
          Baileys engine + FastAPI REST API.<br />
          Messages are sent with a 2s delay between sends to avoid WhatsApp throttling.
        </p>
      </div>
    </div>
  )
}