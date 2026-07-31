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

export default function WebhookFeed({ events }) {
  if (!events.length) {
    return <p className="muted">No events yet — WhatsApp activity will appear here.</p>
  }
  return (
    <ul className="feed">
      {events.map((e, i) => {
        const data = e.data || {}
        const summary = data.content || data.phone || data.messageId || data.reason || data.from || data.to || ''
        return (
          <li key={`${e.timestamp}-${i}`} className="feed-item">
            <span className="badge" style={{ background: BADGES[e.event] || '#64748b' }}>
              {e.event}
            </span>
            <span className="session-chip">{e.session}</span>
            <span className="mono dim feed-time">{formatTime(e.timestamp)}</span>
            <span className="mono feed-data">{String(summary).slice(0, 90)}</span>
          </li>
        )
      })}
    </ul>
  )
}
