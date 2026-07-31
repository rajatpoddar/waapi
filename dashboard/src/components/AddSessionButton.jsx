import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function AddSessionButton({ onCreated }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [qrInfo, setQrInfo] = useState(null)
  const qrTimer = useRef(null)

  // Poll QR URL every 5s while visible (QR expires every 30s)
  useEffect(() => {
    if (!qrInfo) return
    qrTimer.current = setInterval(() => {
      setQrInfo((prev) => {
        if (!prev) return prev
        return { ...prev, qrUrl: api.qrPngUrl(prev.name) }
      })
    }, 5000)
    return () => {
      if (qrTimer.current) {
        clearInterval(qrTimer.current)
        qrTimer.current = null
      }
    }
  }, [qrInfo])

  // Check if session became 'open' every 3s and auto-dismiss
  useEffect(() => {
    if (!qrInfo || busy) return
    const check = setInterval(async () => {
      try {
        const status = await api.sessionStatus(qrInfo.name)
        if (status.session?.state === 'open') {
          setQrInfo(null)
        }
      } catch {
        // ignore
      }
    }, 3000)
    return () => clearInterval(check)
  }, [qrInfo, busy])

  const create = async (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setErr('')
    try {
      const result = await api.startSession(trimmed)
      // If session is already open, no QR needed
      if (result.session?.state === 'open') {
        setName('')
        setOpen(false)
        onCreated()
        return
      }
      setQrInfo({ name: trimmed, qrUrl: api.qrPngUrl(trimmed) })
      setName('')
      onCreated()
    } catch (ex) {
      setErr(ex.message)
      setQrInfo(null)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    // If a session was just created and is still connecting, DELETE it entirely
    // (it was never paired, so stop() would just leave a stale closed card).
    const pendingName = qrInfo?.name
    setOpen(false)
    setName('')
    setErr('')
    setQrInfo(null)
    if (pendingName) {
      try {
        await api.deleteSession(pendingName)
        onCreated()
      } catch {
        // ignore - session may already be gone
      }
    }
  }

  if (!open) {
    return (
      <button className="ghost add-btn" onClick={() => setOpen(true)}>
        + Add Session
      </button>
    )
  }

  return (
    <div className="add-session-panel">
      <div className="add-session-header">
        <h3>New Session</h3>
        <button className="ghost small" onClick={cancel} title="Cancel">
          ✕
        </button>
      </div>

      <form onSubmit={create} className="add-session-form">
        <div className="row">
          <input
            placeholder="Session name, e.g. work"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
            required
          />
          <button className="btn primary" disabled={busy || !name.trim()}>
            {busy ? 'Connecting…' : 'Add & Connect'}
          </button>
        </div>
      </form>

      {err && <p className="err">{err}</p>}

      {qrInfo && (
        <div className="qr-preview">
          <img
            src={qrInfo.qrUrl}
            alt={`QR for ${qrInfo.name}`}
            className="qr-img"
          />
          <p className="dim">
            Scan with <strong>WhatsApp → Settings → Linked devices</strong>
          </p>
          <p className="dim mono small">
            Session: <strong>{qrInfo.name}</strong>
            &nbsp;· QR refreshes every 5s
          </p>
          <p className="dim mono small">
            Once connected, this panel will close automatically.
          </p>
        </div>
      )}
    </div>
  )
}