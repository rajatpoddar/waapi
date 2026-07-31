import { useEffect, useState } from 'react'
import { api } from '../api'

export default function SendPanel({ sessions, onSent }) {
  // Start empty and sync once sessions load, so we never auto-create an
  // unintended session by sending with a name that isn't in the list.
  const [session, setSession] = useState('')
  const [number, setNumber] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (sessions.length > 0) {
      setSession((current) => (sessions.some((s) => s.name === current) ? current : sessions[0].name))
    }
  }, [sessions])

  const send = async (e) => {
    e.preventDefault()
    setSending(true)
    setErr('')
    setResult(null)
    try {
      const r = await api.sendText({ session, number, message })
      setResult(r)
      setMessage('')
      onSent()
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="card send">
      <h3>Send message</h3>
      <form onSubmit={send} className="send-form">
        <div className="row">
          <select value={session} onChange={(e) => setSession(e.target.value)}>
            {sessions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
            {sessions.length === 0 && <option value="default">default</option>}
          </select>
          <input
            placeholder="Number with country code, e.g. 919876543210"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            required
          />
        </div>
        <textarea
          placeholder="Message text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          required
        />
        <div className="row end">
          <p className="dim note">
            Sends are spaced 2s apart (SEND_DELAY_MS). If a message stays in “waiting”, WhatsApp is throttling the
            account — slow down and wait.
          </p>
          <button className="btn primary" disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
      {err && <p className="err">{err}</p>}
      {result && (
        <p className="ok">
          Sent ✓ <span className="mono">{result.messageId}</span> · status {result.status}
        </p>
      )}
    </div>
  )
}
