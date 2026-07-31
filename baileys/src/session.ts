/**
 * WhatsAppSession: wraps one Baileys connection (one WhatsApp number).
 *
 * Responsibilities:
 *  - create/restore the persistent auth state (auth/<session>/)
 *  - wire Baileys events and emit webhooks (qr, connection.*, message*, logout)
 *  - auto-reconnect on unexpected disconnects
 *  - send messages (text / media / contact / location)
 */
import fs from 'node:fs'
import path from 'node:path'
import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  jidNormalizedUser,
  useMultiFileAuthState,
  type AnyMessageContent,
  type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { config } from './config.js'
import { logger } from './logger.js'
import { ApiError, type SessionInfo, type SessionState } from './types.js'
import { delay, normalizePhone, nowIso, sanitizeSessionName } from './utils.js'
import { emitWebhook } from './webhooks.js'

/** Disconnect reasons that justify an automatic reconnect. */
const RECONNECTABLE = new Set<number>([
  DisconnectReason.connectionClosed,
  DisconnectReason.connectionLost,
  DisconnectReason.timedOut,
  DisconnectReason.restartRequired,
])

/** Map Baileys protobuf content types to a friendly media type. */
const MEDIA_TYPES: Record<string, string> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  locationMessage: 'location',
}

/** Content types that downloadMediaMessage() can actually download. */
const DOWNLOADABLE_MEDIA = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'])

/** Top-level keys of AnyMessageContent we can send. */
const SEND_TYPE_KEYS = ['text', 'image', 'document', 'audio', 'video', 'sticker', 'contacts', 'location'] as const

/** Friendly message type for an outgoing (API-initiated) message. */
function deriveSendType(content: AnyMessageContent): string {
  const key = SEND_TYPE_KEYS.find((k) => k in content)
  // server.ts sends contacts as { contacts: [...] } - map to the friendly name.
  return key === 'contacts' ? 'contact' : (key ?? 'unknown')
}

/** Human-readable body (text or caption) of an outgoing message. */
function deriveSendContent(content: AnyMessageContent): string | null {
  const any = content as Record<string, any>
  if (typeof any.text === 'string') return any.text
  if (typeof any.caption === 'string') return any.caption
  return null
}

function extractMediaInfo(
  messageContent: Record<string, any>,
  contentType: string,
): { isMedia: boolean; mediaType: string | null; fileName?: string; mimetype?: string; caption?: string } {
  const mediaType = MEDIA_TYPES[contentType] ?? null
  if (!mediaType) return { isMedia: false, mediaType: null }
  const isMedia = DOWNLOADABLE_MEDIA.has(contentType)
  const part = messageContent[contentType] ?? {}
  const info: { isMedia: boolean; mediaType: string; fileName?: string; mimetype?: string; caption?: string } = {
    isMedia,
    mediaType,
  }
  if (part.fileName) info.fileName = part.fileName
  if (part.mimetype) info.mimetype = part.mimetype
  if (part.caption) info.caption = part.caption
  return info
}

function extractMessageText(messageContent: Record<string, any>, contentType: string): string | null {
  const part = messageContent[contentType]
  if (!part) return null
  switch (contentType) {
    case 'conversation':
      return typeof part.conversation === 'string' ? part.conversation : null
    case 'extendedTextMessage':
      return typeof part.text === 'string' ? part.text : null
    case 'imageMessage':
    case 'videoMessage':
    case 'documentMessage':
      return typeof part.caption === 'string' ? part.caption : null
    case 'contactMessage':
      return typeof part.displayName === 'string' ? part.displayName : null
    case 'listMessage':
      return typeof part.title === 'string' ? part.title : null
    case 'buttonsMessage':
      return typeof part.contentText === 'string' ? part.contentText : null
    default:
      return null
  }
}

export class WhatsAppSession {
  readonly name: string
  state: SessionState = 'closed'
  phone: string | null = null
  connectedAt: string | null = null
  startedAt: string | null = null
  lastDisconnectReason: string | null = null
  isNewLogin = false

  private sock: WASocket | null = null
  private qr: string | null = null
  private qrUpdatedAt: number | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private manuallyStopped = false
  private readonly authDir: string
  private readonly onReconnect: (session: WhatsAppSession) => void
  /** Recently sent message ids: suppress the sync-echo duplicate of message.sent. */
  private readonly sentMessageIds = new Set<string>()

  constructor(name: string, onReconnect: (session: WhatsAppSession) => void) {
    this.name = sanitizeSessionName(name)
    this.authDir = path.join(config.authDir, this.name)
    this.onReconnect = onReconnect
  }

  get qrAvailable(): boolean {
    return this.state === 'connecting' && this.qr !== null
  }

  /** Create (or restore) the WhatsApp connection for this session. */
  async start(): Promise<void> {
    if (this.sock) return
    this.manuallyStopped = false
    this.state = 'connecting'
    this.startedAt = nowIso()

    fs.mkdirSync(config.authDir, { recursive: true })
    fs.mkdirSync(this.authDir, { recursive: true })
    fs.mkdirSync(config.uploadDir, { recursive: true })

    let version: [number, number, number] = [6, 7, 24]
    try {
      const latest = await fetchLatestBaileysVersion()
      version = latest.version
    } catch (err) {
      logger.warn({ err }, 'could not fetch latest Baileys version, using fallback')
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
    const socket = makeWASocket({
      version,
      auth: state,
      logger,
      printQRInTerminal: config.printQrInTerminal,
      browser: config.browser,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    })
    this.sock = socket
    this.attachEvents(socket, saveCreds)
    logger.info({ session: this.name }, 'session socket created')
  }

  private attachEvents(socket: WASocket, saveCreds: () => Promise<void>): void {
    socket.ev.on('creds.update', saveCreds)

    socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this.qr = qr
        this.qrUpdatedAt = Date.now()
        emitWebhook('qr', this.name, { qr, expiresAt: new Date(Date.now() + 30_000).toISOString() })
      }

      if (connection === 'open') {
        this.state = 'open'
        this.qr = null
        this.isNewLogin = update.isNewLogin ?? false
        this.lastDisconnectReason = null
        this.connectedAt = nowIso()
        const userJid = socket.user?.id
        this.phone = userJid ? (jidNormalizedUser(userJid).split('@')[0] ?? null) : null
        emitWebhook('connection.open', this.name, {
          phone: this.phone,
          isNewLogin: this.isNewLogin,
          timestamp: nowIso(),
        })
        logger.info({ session: this.name, phone: this.phone }, 'WhatsApp connection open')
      } else if (connection === 'close') {
        const boom = lastDisconnect?.error as Boom | undefined
        const statusCode = boom?.output?.statusCode
        const reason = statusCode !== undefined ? (DisconnectReason[statusCode] ?? `UNKNOWN(${statusCode})`) : 'unknown'
        const willReconnect =
          !this.manuallyStopped &&
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.connectionReplaced &&
          RECONNECTABLE.has(statusCode ?? -1)

        this.state = 'closed'
        this.qr = null
        this.sock = null
        this.lastDisconnectReason = reason

        emitWebhook('connection.close', this.name, {
          reason,
          statusCode: statusCode ?? null,
          willReconnect,
          timestamp: nowIso(),
        })
        logger.info({ session: this.name, reason, statusCode, willReconnect }, 'WhatsApp connection closed')

        if (!this.manuallyStopped && statusCode === DisconnectReason.loggedOut) {
          emitWebhook('logout', this.name, { reason, timestamp: nowIso() })
          this.cleanupAuth().catch((err) => logger.error({ err, session: this.name }, 'auth cleanup failed'))
        } else if (willReconnect) {
          this.scheduleReconnect()
        }
      }
    })

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      for (const message of messages) {
        this.handleMessage(message, type).catch((err) =>
          logger.error({ err, session: this.name }, 'message handler failed'),
        )
      }
    })

    socket.ev.on('message-receipt.update', (events) => {
      for (const event of events) {
        const key = event.key
        const messageId = key?.id
        const remoteJid = key?.remoteJid
        const receipt = event.receipt
        const participant = receipt?.userJid ?? null
        // Baileys reports receipts as receiptTimestamp (delivered) or readTimestamp (read).
        if (receipt?.readTimestamp !== undefined && receipt.readTimestamp !== null) {
          emitWebhook('message.read', this.name, { messageId, to: remoteJid, participant, at: nowIso() })
        } else if (receipt?.receiptTimestamp !== undefined && receipt.receiptTimestamp !== null) {
          emitWebhook('message.delivered', this.name, { messageId, to: remoteJid, participant, at: nowIso() })
        }
      }
    })
  }

  /** Handle one incoming/sent message and emit the matching webhook. */
  private async handleMessage(message: any, upsertType: string): Promise<void> {
    if (!message?.message || !message.key) return
    const key = message.key
    const messageId: string = key.id ?? ''
    const remoteJid: string = key.remoteJid ?? ''
    const fromMe: boolean = key.fromMe ?? false
    const contentType = getContentType(message.message) ?? 'unknown'
    const media = extractMediaInfo(message.message, contentType)
    const text = extractMessageText(message.message, contentType)
    const timestamp = new Date(
      message.messageTimestamp ? Number(message.messageTimestamp) * 1000 : Date.now(),
    ).toISOString()

    if (upsertType !== 'notify') return

    if (fromMe) {
      // API-initiated sends already fired message.sent in sendMessage(); skip the
      // sync-echo duplicate (phone-initiated sends still fire here).
      if (this.sentMessageIds.has(messageId)) {
        this.sentMessageIds.delete(messageId)
      } else {
        emitWebhook('message.sent', this.name, {
          messageId,
          to: remoteJid,
          type: media.mediaType ?? contentType,
          content: text,
          timestamp,
        })
      }
      return
    }

    const data: Record<string, unknown> = {
      messageId,
      from: remoteJid,
      type: media.mediaType ?? contentType,
      content: text,
      timestamp,
    }
    if (media.fileName) data.fileName = media.fileName
    if (media.mimetype) data.mimetype = media.mimetype
    if (media.caption) data.caption = media.caption

    if (media.isMedia) {
      const downloaded = await this.tryDownloadMedia(message)
      if (downloaded) {
        if (downloaded.base64) data.mediaBase64 = downloaded.base64
        data.mediaSizeBytes = downloaded.size
        if (downloaded.truncated) data.mediaTruncated = true
      }
    }

    emitWebhook('message', this.name, data)
  }

  private async tryDownloadMedia(
    message: any,
  ): Promise<{ base64?: string; size: number; truncated: boolean } | null> {
    if (!config.webhookMedia) return null
    try {
      const sock = this.sock
      const reuploadRequest: (msg: any) => Promise<any> = sock
        ? (msg: any) => sock.updateMediaMessage(msg)
        : (msg: any) => Promise.resolve(msg)
      const buffer = await downloadMediaMessage(message, 'buffer', {}, { logger, reuploadRequest })
      if (Buffer.isBuffer(buffer) && buffer.length > 0) {
        if (buffer.length > config.webhookMediaMaxBytes) {
          logger.warn(
            { session: this.name, size: buffer.length, max: config.webhookMediaMaxBytes },
            'incoming media larger than WEBHOOK_MEDIA_MAX_BYTES, base64 skipped',
          )
          return { size: buffer.length, truncated: true }
        }
        return { base64: buffer.toString('base64'), size: buffer.length, truncated: false }
      }
    } catch (err) {
      logger.warn({ err, session: this.name }, 'incoming media download failed')
    }
    return null
  }

  /** Remove every event listener we attached to the socket. */
  private detachEvents(socket: WASocket): void {
    const events = ['creds.update', 'connection.update', 'messages.upsert', 'message-receipt.update'] as const
    for (const event of events) {
      try {
        socket.ev.removeAllListeners(event)
      } catch {
        /* noop */
      }
    }
  }

  /** Send a message; returns the WhatsApp message id. */
  async sendMessage(
    jid: string,
    content: AnyMessageContent,
    options: Record<string, unknown> = {},
  ): Promise<{ messageId: string }> {
    const socket = this.requireSocket()
    if (config.sendDelayMs > 0) await delay(config.sendDelayMs)
    const sent = await socket.sendMessage(jid, content, options)
    const messageId = sent?.key?.id ?? ''
    // socket.sendMessage() does not echo the sent message back through
    // messages.upsert on the sending socket (only device-synced messages do), so
    // emit message.sent here - the single chokepoint every send type goes through.
    if (messageId) {
      this.sentMessageIds.add(messageId)
      emitWebhook('message.sent', this.name, {
        messageId,
        to: jid,
        type: deriveSendType(content),
        content: deriveSendContent(content),
        timestamp: nowIso(),
      })
      if (this.sentMessageIds.size > 500) this.sentMessageIds.clear()
    }
    return { messageId }
  }

  /**
   * Check whether phone numbers are registered on WhatsApp (onWhatsApp lookup).
   * Lookups run sequentially and never throw; unparseable numbers are reported
   * as not existing. Lookup errors (e.g. WhatsApp timeout) are reported in
   * `error` so callers can tell "not registered" apart from "try again".
   */
  async checkContacts(
    numbers: string[],
  ): Promise<{ number: string; jid: string | null; exists: boolean; error?: string }[]> {
    const socket = this.requireSocket()
    const results: { number: string; jid: string | null; exists: boolean; error?: string }[] = []
    for (const raw of numbers) {
      const phone = normalizePhone(raw)
      if (!/^\d{8,15}$/.test(phone)) {
        results.push({ number: raw, jid: null, exists: false, error: 'invalid phone number' })
        continue
      }
      try {
        const found = await socket.onWhatsApp(phone)
        const match = found?.[0]
        results.push({ number: raw, jid: match?.jid ?? null, exists: Boolean(match?.exists) })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn({ err, session: this.name, number: raw }, 'onWhatsApp lookup failed')
        results.push({ number: raw, jid: null, exists: false, error: message })
      }
    }
    return results
  }

  /** Stop the connection but keep credentials (no logout). */
  async stop(): Promise<void> {
    this.clearReconnectTimer()
    this.manuallyStopped = true
    const socket = this.sock
    this.sock = null
    this.state = 'closed'
    this.qr = null
    if (socket) {
      this.detachEvents(socket)
      try {
        socket.end(new Error('Session stopped by user'))
      } catch {
        /* noop */
      }
    }
    logger.info({ session: this.name }, 'session stopped')
  }

  /** Log out from WhatsApp and delete the local credentials. */
  async logout(): Promise<void> {
    this.clearReconnectTimer()
    this.manuallyStopped = true
    const socket = this.sock
    this.sock = null
    this.state = 'closed'
    this.qr = null
    if (socket) {
      this.detachEvents(socket)
      try {
        await socket.logout()
      } catch (err) {
        logger.warn({ err, session: this.name }, 'socket.logout failed')
      }
      try {
        socket.end(new Error('Session logged out'))
      } catch {
        /* noop */
      }
    }
    await this.cleanupAuth()
    emitWebhook('logout', this.name, { reason: 'user_requested', timestamp: nowIso() })
    logger.info({ session: this.name }, 'session logged out, credentials removed')
  }

  /** Remove the auth directory (credentials) from disk. */
  removeCredentials(): void {
    this.cleanupAuthSync()
  }

  private async cleanupAuth(): Promise<void> {
    this.cleanupAuthSync()
  }

  private cleanupAuthSync(): void {
    try {
      fs.rmSync(this.authDir, { recursive: true, force: true })
    } catch (err) {
      logger.warn({ err, session: this.name }, 'failed to remove auth directory')
    }
  }

  getStatus(): SessionInfo {
    return {
      name: this.name,
      state: this.state,
      phone: this.phone,
      qrAvailable: this.qrAvailable,
      connectedAt: this.connectedAt,
      startedAt: this.startedAt,
      lastDisconnectReason: this.lastDisconnectReason,
      isNewLogin: this.isNewLogin,
    }
  }

  getQR(): { qr: string; expiresAt: string } {
    if (this.state === 'open') {
      throw new ApiError(409, 'Session is already connected', 'SESSION_CONNECTED')
    }
    if (this.state !== 'connecting' || !this.qr) {
      throw new ApiError(409, 'QR code not available yet', 'QR_NOT_AVAILABLE')
    }
    return { qr: this.qr, expiresAt: new Date((this.qrUpdatedAt ?? Date.now()) + 30_000).toISOString() }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.onReconnect(this)
    }, config.reconnectDelayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private requireSocket(): WASocket {
    if (!this.sock || this.state !== 'open') {
      throw new ApiError(409, 'WhatsApp not connected', 'SESSION_NOT_CONNECTED')
    }
    return this.sock
  }
}
