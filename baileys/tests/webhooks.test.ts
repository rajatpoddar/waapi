import { describe, expect, it } from 'vitest'
import { buildPayload } from '../src/webhooks.js'

describe('buildPayload', () => {
  it('builds a well-formed webhook payload', () => {
    const payload = buildPayload('message', 'default', { messageId: 'ABC123', content: 'hello' })
    expect(payload.event).toBe('message')
    expect(payload.session).toBe('default')
    expect(payload.data.messageId).toBe('ABC123')
    expect(new Date(payload.timestamp).getTime()).not.toBeNaN()
  })
})
