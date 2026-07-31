/**
 * Webhook dispatch: POSTs WhatsApp events to a configurable URL with
 * exponential-backoff retries. Supports a global WEBHOOK_URL and optional
 * per-session overrides via WEBHOOK_URL_<SESSIONNAME>.
 */
import { createHmac } from 'node:crypto'
import { config } from './config.js'
import { logger } from './logger.js'
import type { WebhookEvent } from './types.js'
import { delay, nowIso, sessionWebhookEnvName } from './utils.js'

export interface WebhookPayload {
  event: WebhookEvent
  session: string
  timestamp: string
  data: Record<string, unknown>
}

export function isEventEnabled(event: WebhookEvent, events: Set<string> = config.webhookEvents): boolean {
  if (events.size === 0) return true
  return events.has(event)
}

function resolveWebhookUrl(session: string): string | null {
  const custom = process.env[sessionWebhookEnvName(session)]
  if (custom && custom.trim().length > 0) return custom.trim()
  if (config.webhookUrl && config.webhookUrl.trim().length > 0) return config.webhookUrl.trim()
  return null
}

export function buildPayload(event: WebhookEvent, session: string, data: Record<string, unknown>): WebhookPayload {
  return { event, session, timestamp: nowIso(), data }
}

/** Fire-and-forget: enqueue the event for delivery (never throws). */
export function emitWebhook(event: WebhookEvent, session: string, data: Record<string, unknown>): void {
  try {
    if (!isEventEnabled(event)) return
    const url = resolveWebhookUrl(session)
    if (!url) return
    const payload = buildPayload(event, session, data)
    deliverWithRetry(url, payload).catch((err) => {
      logger.error({ err, event, session }, 'webhook delivery failed unexpectedly')
    })
  } catch (err) {
    logger.error({ err, event, session }, 'failed to enqueue webhook')
  }
}

async function deliverWithRetry(url: string, payload: WebhookPayload): Promise<void> {
  const maxAttempts = Math.max(0, config.webhookRetries) + 1
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const body = JSON.stringify(payload)
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'user-agent': 'wapi-baileys/1.0',
      }
      if (config.webhookSecret) {
        headers['x-webhook-signature'] = createHmac('sha256', config.webhookSecret).update(body).digest('hex')
      }
      const response = await fetch(url, { method: 'POST', headers, body })
      if (response.ok) {
        logger.debug({ event: payload.event, session: payload.session, status: response.status }, 'webhook delivered')
        return
      }
      logger.warn({ event: payload.event, session: payload.session, status: response.status }, 'webhook returned non-2xx')
    } catch (err) {
      logger.warn({ err, event: payload.event, session: payload.session, attempt }, 'webhook delivery attempt failed')
    }
    if (attempt < maxAttempts - 1) {
      const backoff = Math.min(1000 * 2 ** attempt, 30_000)
      await delay(backoff)
    }
  }
  logger.error({ event: payload.event, session: payload.session, url }, 'webhook delivery failed after all retries')
}
