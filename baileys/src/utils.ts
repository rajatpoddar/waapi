/** Shared helper utilities. */
import { ApiError } from './types.js'

export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function nowIso(): string {
  return new Date().toISOString()
}

/** Keep only digits (drop leading "+"). */
export function normalizePhone(input: string): string {
  let phone = input.trim().replace(/[^0-9+]/g, '')
  if (phone.startsWith('+')) phone = phone.slice(1)
  return phone
}

/**
 * Convert a phone number (or an existing JID) into a WhatsApp JID.
 * Values that already contain "@" (group ids, existing jids) pass through.
 */
export function toJid(input: string): string {
  const value = input.trim()
  if (value.includes('@')) return value
  const phone = normalizePhone(value)
  if (!/^\d{8,15}$/.test(phone)) {
    throw new ApiError(400, `Invalid phone number: "${input}"`)
  }
  return `${phone}@s.whatsapp.net`
}

/** Validate a session name: 1-64 chars, letters, digits, "-", "_". */
export function sanitizeSessionName(name: string): string {
  const trimmed = (name ?? '').trim()
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(trimmed)) {
    throw new ApiError(400, `Invalid session name: "${name}". Use 1-64 letters, numbers, "-" or "_".`)
  }
  return trimmed
}

/** Env var name used for a per-session webhook override: WEBHOOK_URL_<NAME>. */
export function sessionWebhookEnvName(name: string): string {
  return `WEBHOOK_URL_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
}

/** Escape characters with special meaning in vCard fields. */
function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/[\r\n]/g, ' ')
    .trim()
}

/** Build a vCard (3.0) string for a WhatsApp contact message. */
export function buildVCard(name: string, phone: string): string {
  const clean = normalizePhone(phone)
  const safeName = escapeVCard(name)
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${safeName}`,
    `N:${safeName};;;`,
    `TEL;type=CELL;type=VOICE;waid=${clean}:+${clean}`,
    'END:VCARD',
  ].join('\r\n')
}

export function fileExtensionFromMime(mimetype: string): string {
  // Strip parameters such as "; codecs=opus" before looking up the extension.
  const baseMime = mimetype.split(';')[0].trim()
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'application/msword': 'doc',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  }
  return map[baseMime] ?? 'bin'
}

/** Random file name for persisted uploads, e.g. "1722...-ab12cd34.pdf". */
export function randomFileName(mimetype: string): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${fileExtensionFromMime(mimetype)}`
}
