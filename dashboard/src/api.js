const KEY_STORAGE = 'wapi_api_key'

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || ''
}

export function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key)
}

async function req(path, options = {}) {
  const headers = { ...(options.headers || {}) }
  const key = getApiKey()
  if (key) headers['X-API-Key'] = key
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const res = await fetch(path, { ...options, headers })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const message = data?.message || (typeof data?.detail === 'string' ? data.detail : null) || `HTTP ${res.status}`
    throw new Error(message)
  }
  return data
}

export const api = {
  health: () => req('/health'),
  status: () => req('/status'),
  startSession: (name) => req(`/sessions/${encodeURIComponent(name)}/start`, { method: 'POST' }),
  stopSession: (name) => req(`/sessions/${encodeURIComponent(name)}/stop`, { method: 'POST' }),
  logoutSession: (name) => req(`/sessions/${encodeURIComponent(name)}/logout`, { method: 'POST' }),
  qrPngUrl: (name) =>
    `/sessions/${encodeURIComponent(name)}/qr.png?apikey=${encodeURIComponent(getApiKey())}&t=${Date.now()}`,
  sendText: (payload) => req('/send-text', { method: 'POST', body: JSON.stringify(payload) }),
  webhooks: (limit = 60) => req(`/admin-api/webhooks?limit=${limit}`),
}
