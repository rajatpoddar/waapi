const KEY_STORAGE = 'wapi_api_key'
const PAGE_SIZE_STORAGE = 'wapi_page_size'
const EVENT_FILTER_STORAGE = 'wapi_event_filter'
const AUTO_REFRESH_STORAGE = 'wapi_auto_refresh'

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || ''
}

export function setApiKey(key) {
  localStorage.setItem(KEY_STORAGE, key)
}

export function getSettings() {
  return {
    pageSize: parseInt(localStorage.getItem(PAGE_SIZE_STORAGE) || '30', 10),
    eventFilter: localStorage.getItem(EVENT_FILTER_STORAGE) || '',
    autoRefresh: localStorage.getItem(AUTO_REFRESH_STORAGE) !== 'false',
  }
}

export function saveSettings(settings) {
  if (settings.pageSize !== undefined) localStorage.setItem(PAGE_SIZE_STORAGE, String(settings.pageSize))
  if (settings.eventFilter !== undefined) localStorage.setItem(EVENT_FILTER_STORAGE, settings.eventFilter)
  if (settings.autoRefresh !== undefined) localStorage.setItem(AUTO_REFRESH_STORAGE, String(settings.autoRefresh))
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
  deleteSession: (name) => req(`/sessions/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  qrPngUrl: (name) =>
    `/sessions/${encodeURIComponent(name)}/qr.png?apikey=${encodeURIComponent(getApiKey())}&t=${Date.now()}`,
  sendText: (payload) => req('/send-text', { method: 'POST', body: JSON.stringify(payload) }),
  webhooks: (limit = 60) => req(`/admin-api/webhooks?limit=${limit}`),
  sessionStatus: (name) => req(`/sessions/${encodeURIComponent(name)}/status`),
}