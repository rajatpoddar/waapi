import { useState } from 'react'

const BADGES = {
  message: '#22c55e',
  'message.sent': '#3b82f6',
  'message.delivered': '#f59e0b',
  'message.read': '#8b5cf6',
  'connection.open': '#10b981',
  'connection.close': '#ef4444',
  qr: '#eab308',
  logout: '#f43f5e',
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return ''
  }
}

function formatDate(iso) {
  try {
    const d = new Date(iso)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    return isToday ? formatTime(iso) : d.toLocaleString()
  } catch {
    return ''
  }
}

export default function WebhookFeed({ events, pageSize = 30, eventFilter = '' }) {
  const [visible, setVisible] = useState(pageSize)
  const [expanded, setExpanded] = useState(null)

  const filteredEvents = eventFilter
    ? events.filter((e) => eventFilter.split(',').includes(e.event))
    : events

  const shown = filteredEvents.slice(0, visible)
  const hasMore = filteredEvents.length > visible

  const toggleExpand = (key) => {
    setExpanded((prev) => (prev === key ? null : key))
  }

  if (!events.length) {
    return <p className="muted">No events yet — WhatsApp activity will appear here.</p>
  }

  if (!filteredEvents.length) {
    return (
      <div>
        <p className="muted">No events match the current filter.</p>
        <p className="dim" style={{ fontSize: 12, marginTop: 4 }}>
          {events.length} total events · showing 0
        </p>
      </div>
    )
  }

  return (
    <div className="webhook-feed">
      <div className="feed-stats">
        <span className="dim">
          Showing {Math.min(visible, filteredEvents.length)} of {filteredEvents.length} events
          {eventFilter && ` (filtered from ${events.length})`}
        </span>
      </div>

      <ul className="feed">
        {shown.map((e) => {
          const data = e.data || {}
          const summary = data.content || data.phone || data.messageId || data.reason || data.from || data.to || ''
          const key = e.timestamp || e.event + '-' + Math.random()
          const isExpanded = expanded === key
          return (
            <li
              key={key}
              className={`feed-item ${isExpanded ? 'expanded' : ''}`}
              onClick={() => toggleExpand(key)}
            >
              <div className="feed-item-main">
                <span className="badge" style={{ background: BADGES[e.event] || '#64748b' }}>
                  {e.event}
                </span>
                <span className="session-chip">{e.session}</span>
                <span className="mono dim feed-time">{formatDate(e.timestamp)}</span>
                <span className="mono feed-data">{String(summary).slice(0, 90)}</span>
                <span className="feed-expand-icon">{isExpanded ? '▾' : '▸'}</span>
              </div>
              {isExpanded && (
                <div className="feed-detail" onClick={(ev) => ev.stopPropagation()}>
                  <pre className="mono">{JSON.stringify(e, null, 2)}</pre>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {hasMore && (
        <div className="feed-load-more">
          <button
            className="btn ghost"
            onClick={() => setVisible((v) => v + pageSize)}
          >
            Load {Math.min(pageSize, filteredEvents.length - visible)} more
          </button>
          <span className="dim" style={{ fontSize: 11 }}>
            {filteredEvents.length - visible} remaining
          </span>
        </div>
      )}
    </div>
  )
}