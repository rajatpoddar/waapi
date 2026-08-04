import { useState } from 'react'
import { setApiKey, verifyKey } from '../api'

/**
 * Full-screen login gate: the user enters the API key, it is validated
 * against the backend, and only then is the dashboard revealed.
 */
export default function LoginScreen({ onAuthed }) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = key.trim()
    if (!trimmed) {
      setError('Please enter your API key.')
      return
    }
    setBusy(true)
    setError('')
    const result = await verifyKey(trimmed)
    if (result === 'ok') {
      setApiKey(trimmed)
      onAuthed()
    } else if (result === 'invalid') {
      setError('Invalid API key. Check the key in your server .env / dev.py config.')
      setBusy(false)
    } else {
      setError('Could not reach the server. Make sure it is running (./run-local.sh) and try again.')
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">W</div>
        <h1 className="login-title">WAPI Admin</h1>
        <p className="login-subtitle">Enter your API key to access the dashboard</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="login-input-wrap">
            <input
              className="login-input"
              type={show ? 'text' : 'password'}
              placeholder="API key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="login-eye"
              onClick={() => setShow((v) => !v)}
              title={show ? 'Hide key' : 'Show key'}
              tabIndex={-1}
            >
              {show ? '🙈' : '👁'}
            </button>
          </div>

          {error && <div className="login-error">⚠️ {error}</div>}

          <button className="login-btn" type="submit" disabled={busy}>
            {busy ? 'Verifying…' : 'Sign in →'}
          </button>
        </form>

        <p className="login-hint">
          Local dev key: <code>local-test-key-123</code>
          <br />
          In production, use the <code>API_KEY</code> from your <code>.env</code>.
        </p>
      </div>
    </div>
  )
}
