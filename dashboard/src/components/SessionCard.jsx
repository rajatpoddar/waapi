import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function SessionCard({ session, onChanged }) {
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [qr, setQr] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(session.name)
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef(null)
  const connecting = session.state === 'connecting'

  // Poll QR while connecting, but NEVER while an action (stop/delete/logout) is
  // in flight - otherwise the in-flight requests hit the QR endpoint and can
  // resurrect the session the user just closed.
  useEffect(() => {
    if (!connecting || busy) {
      setQr(null)
      return undefined
    }
    setQr(api.qrPngUrl(session.name))
    const timer = setInterval(() => setQr(api.qrPngUrl(session.name)), 5000)
    return () => clearInterval(timer)
  }, [connecting, session.name, busy])

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [renaming])

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

  const handleRename = async () => {
    const trimmed = newName.trim()
    if (!trimmed || trimmed === session.name) {
      setRenaming(false)
      setNewName(session.name)
      return
    }
    setBusy('renaming')
    setActionError('')
    try {
      await api.renameSession(session.name, trimmed)
      setRenaming(false)
      onChanged()
    } catch (err) {
      setActionError(err.message)
      setNewName(session.name)
    } finally {
      setBusy('')
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete session "${session.name}"? This will stop the session and remove all credentials.`)) {
      return
    }
    setBusy('deleting')
    setActionError('')
    try {
      await api.deleteSession(session.name)
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
        <div className="card-name-area">
          {renaming ? (
            <div className="rename-inline">
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') { setRenaming(false); setNewName(session.name) }
                }}
                onBlur={handleRename}
                disabled={busy === 'renaming'}
                className="rename-input"
                maxLength={64}
              />
              <span className="mono dim rename-hint">Enter to save · Esc to cancel</span>
            </div>
          ) : (
            <div className="card-name-row">
              <h3>{session.name}</h3>
              <button
                className="icon-btn rename-btn"
                onClick={() => { setRenaming(true); setNewName(session.name) }}
                title="Rename session"
                disabled={!!busy}
              >
                ✏️
              </button>
            </div>
          )}
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

      {session.lastDisconnectReason && session.state === 'closed' && (
        <p className="meta dim">
          last disconnect: {session.lastDisconnectReason}
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
        <button
          className="btn danger-outline"
          disabled={!!busy}
          onClick={handleDelete}
        >
          {busy === 'deleting' ? 'Deleting…' : 'Delete'}
        </button>
      </div>
      {actionError && <p className="err">{actionError}</p>}
    </div>
  )
}