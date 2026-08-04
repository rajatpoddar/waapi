/**
 * Centralised configuration for the Baileys engine.
 * All values can be overridden through environment variables (see .env.example).
 */
import dotenv from 'dotenv'

dotenv.config()

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function list(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export interface AppConfig {
  port: number
  apiKey: string
  jwtSecret: string | null
  authDir: string
  uploadDir: string
  logDir: string
  logLevel: string
  webhookUrl: string | null
  webhookEvents: Set<string>
  webhookRetries: number
  webhookSecret: string | null
  webhookMedia: boolean
  webhookMediaMaxBytes: number
  autoCreateSession: boolean
  sendDelayMs: number
  reconnectDelayMs: number
  maxSessions: number
  printQrInTerminal: boolean
  browser: [string, string, string]
}

export const DEFAULT_WEBHOOK_EVENTS = [
  'message',
  'message.sent',
  'message.delivered',
  'message.read',
  'connection.open',
  'connection.close',
  'qr',
  'logout',
]

const env = process.env
const webhookEventsList = list(env.WEBHOOK_EVENTS)

export const config: AppConfig = {
  port: int(env.PORT, 2729),
  apiKey: env.API_KEY || 'change-me',
  jwtSecret: env.JWT_SECRET && env.JWT_SECRET.trim().length > 0 ? env.JWT_SECRET.trim() : null,
  authDir: env.AUTH_DIR || 'auth',
  uploadDir: env.UPLOAD_DIR || 'uploads',
  logDir: env.LOG_DIR || 'logs',
  logLevel: env.LOG_LEVEL || 'info',
  webhookUrl: env.WEBHOOK_URL && env.WEBHOOK_URL.trim().length > 0 ? env.WEBHOOK_URL.trim() : null,
  webhookEvents: new Set(webhookEventsList.length > 0 ? webhookEventsList : DEFAULT_WEBHOOK_EVENTS),
  webhookRetries: int(env.WEBHOOK_RETRIES, 5),
  webhookSecret: env.WEBHOOK_SECRET && env.WEBHOOK_SECRET.trim().length > 0 ? env.WEBHOOK_SECRET.trim() : null,
  webhookMedia: bool(env.WEBHOOK_MEDIA, false),
  webhookMediaMaxBytes: int(env.WEBHOOK_MEDIA_MAX_BYTES, 10 * 1024 * 1024),
  autoCreateSession: bool(env.AUTO_CREATE_SESSION, true),
  sendDelayMs: int(env.SEND_DELAY_MS, 0),
  reconnectDelayMs: int(env.RECONNECT_DELAY_MS, 5000),
  maxSessions: int(env.MAX_SESSIONS, 10),
  printQrInTerminal: bool(env.PRINT_QR_IN_TERMINAL, true),
  browser: [
    env.BROWSER_PLATFORM || 'Chrome',
    env.BROWSER_NAME || 'WAPI',
    env.BROWSER_VERSION || '1.0.0',
  ],
}
