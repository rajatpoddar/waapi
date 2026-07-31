import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/types.js'
import {
  buildVCard,
  fileExtensionFromMime,
  normalizePhone,
  randomFileName,
  sanitizeSessionName,
  sessionWebhookEnvName,
  toJid,
} from '../src/utils.js'
import { isEventEnabled } from '../src/webhooks.js'

describe('toJid', () => {
  it('appends @s.whatsapp.net to a plain number', () => {
    expect(toJid('919876543210')).toBe('919876543210@s.whatsapp.net')
  })

  it('strips formatting and the leading +', () => {
    expect(toJid('+91 98765 43210')).toBe('919876543210@s.whatsapp.net')
  })

  it('passes through existing jids and group ids', () => {
    expect(toJid('1234567890-12345@g.us')).toBe('1234567890-12345@g.us')
    expect(toJid('919876543210@s.whatsapp.net')).toBe('919876543210@s.whatsapp.net')
  })

  it('rejects garbage input', () => {
    expect(() => toJid('not-a-number')).toThrow(ApiError)
    expect(() => toJid('123')).toThrow(ApiError)
  })
})

describe('normalizePhone', () => {
  it('keeps only digits', () => {
    expect(normalizePhone('+91 (987) 654-3210')).toBe('919876543210')
  })
})

describe('sanitizeSessionName', () => {
  it('accepts valid names', () => {
    expect(sanitizeSessionName('default')).toBe('default')
    expect(sanitizeSessionName('shop-2_x')).toBe('shop-2_x')
  })

  it('rejects invalid names', () => {
    expect(() => sanitizeSessionName('bad name!')).toThrow(ApiError)
    expect(() => sanitizeSessionName('')).toThrow(ApiError)
    expect(() => sanitizeSessionName('x'.repeat(65))).toThrow(ApiError)
  })
})

describe('buildVCard', () => {
  it('builds a vCard with FN and waid', () => {
    const vcard = buildVCard('John Doe', '+91 98765 43210')
    expect(vcard.startsWith('BEGIN:VCARD')).toBe(true)
    expect(vcard.endsWith('END:VCARD')).toBe(true)
    expect(vcard).toContain('FN:John Doe')
    expect(vcard).toContain('waid=919876543210')
  })
})

describe('fileExtensionFromMime', () => {
  it('maps common mime types', () => {
    expect(fileExtensionFromMime('application/pdf')).toBe('pdf')
    expect(fileExtensionFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx')
    expect(fileExtensionFromMime('application/x-unknown')).toBe('bin')
  })
})

describe('randomFileName', () => {
  it('uses the mapped extension', () => {
    expect(randomFileName('image/png')).toMatch(/^\d+-[a-z0-9]{8}\.png$/)
  })
})

describe('sessionWebhookEnvName', () => {
  it('builds the env var name', () => {
    expect(sessionWebhookEnvName('my-shop_1')).toBe('WEBHOOK_URL_MY_SHOP_1')
  })
})

describe('isEventEnabled', () => {
  it('respects the configured event set', () => {
    const events = new Set(['message', 'qr'])
    expect(isEventEnabled('message', events)).toBe(true)
    expect(isEventEnabled('logout', events)).toBe(false)
  })

  it('enables everything when the set is empty', () => {
    expect(isEventEnabled('logout', new Set())).toBe(true)
  })
})
