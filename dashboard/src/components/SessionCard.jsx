import { useEffect, useState } from 'react'
import { api } from '../api'

export default function SessionCard({ session, onChanged }) {
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [qr, setQr] = useState(null)
  const connecting = session.state === 'connecting'

  useEffect(() => {
    if (!connecting) {
      setQr(null)
      return undefined
    }
    setQr(api.qrPngUrl(session.name))
    const timer = setInterval(() => setQr(api.qrPngUrl(session.name)), 5000)
    return () => clearInterval(timer)
  }, [connecting, session.name])

  const run = async (fn, label) => {
    setBusy(label)
    setActionError('')
    try {
      await fn()
      onChanged()
    } catch (err) {
      setActionError(err.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={`card session state-${session.state}`}>
      <div className="card-top">
        <div>
          <h3>{session.name}</h3>
          <span className="mono dim">{session.phone ? `+${session.phone}` : 'not paired'}</span>
        </div>
        <span className={`pill state-${session.state}`}>{session.state}</span>
      </div>

      {connecting && qr && (
        <div className="qr">
          <img src={qr} alt={`${session.name} QR code`} />
          <p className="dim">Scan with WhatsApp → Settings → Linked devices</p>
          <button
            className="btn danger qr-cancel"
            disabled={!!busy}
            onClick={() => run(() => api.stopSession(session.name), 'cancelling')}
          >
            {busy === 'cancelling' ? 'Cancelling…' : 'Cancel & Close'}
          </button>
        </div>
      )}

      {session.state === 'open' && session.connectedAt && (
        <p className="meta dim">
          connected at {new Date(session.connectedAt).toLocaleTimeString()}
        </p>
      )}

      <div className="card-actions">
        {session.state !== 'open' ? (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => run(() => api.startSession(session.name), 'starting')}
          >
            {busy === 'starting' ? 'Starting…' : 'Start'}
          </button>
        ) : (
          <button
            className="btn"
            disabled={!!busy}
            onClick={() => run(() => api.stopSession(session.name), 'stopping')}
          >
            {busy === 'stopping' ? 'Stopping…' : 'Stop'}
          </button>
        )}
        <button
          className="btn danger"
          disabled={!!busy}
          onClick={() => run(() => api.logoutSession(session.name), 'logging out')}
        >
          {busy === 'logging out' ? 'Logging out…' : 'Logout'}
        </button>
      </div>
      {actionError && <p className="err">{actionError}</p>}
    </div>
  )
}
