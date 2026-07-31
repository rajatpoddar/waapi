/**
 * WAPI - Baileys engine HTTP server.
 *
 * Internal REST API consumed by the FastAPI gateway:
 *   GET  /health                      liveness probe (no auth)
 *   GET  /status                      overall session status
 *   GET  /sessions                    list sessions
 *   POST /sessions/:name/start        create/start a session
 *   POST /sessions/:name/stop         stop (keep credentials)
 *   POST /sessions/:name/logout       logout + delete credentials
 *   DELETE /sessions/:name            stop + delete
 *   GET  /sessions/:name/status       single session status
 *   GET  /sessions/:name/qr           QR code (JSON)
 *   GET  /sessions/:name/qr.png       QR code (PNG image)
 *   GET  /qr                          QR for "default" (alias, auto-creates)
 *   GET  /qr.png                      QR image alias
 *   POST /logout                      logout alias
 *   POST /send-text                   send text
 *   POST /send-image                  send image (multipart or base64)
 *   POST /send-document               send document
 *   POST /send-audio                  send audio / voice note
 *   POST /send-video                  send video
 *   POST /send-sticker                send sticker
 *   POST /send-contact                send contact card
 *   POST /send-location               send location pin
 *   POST /contacts/check              check if numbers are registered on WhatsApp
 */
import fs from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import QRCode from 'qrcode'
import type { AnyMessageContent } from '@whiskeysockets/baileys'
import { authenticate } from './auth.js'
import { config } from './config.js'
import { logger } from './logger.js'
import { manager } from './session-manager.js'
import { ApiError } from './types.js'
import { buildVCard, nowIso, randomFileName, toJid } from './utils.js'

const app = express()
app.disable('x-powered-by')

app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ extended: true }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next)
  }

function ok(res: Response, data: Record<string, unknown>, status = 200): void {
  res.status(status).json({ success: true, timestamp: nowIso(), ...data })
}

/** Resolve the session name from body.session or ?session=, defaulting to "default". */
function getSessionName(req: Request): string {
  const fromBody = (req.body as Record<string, unknown> | undefined)?.session
  const fromQuery = req.query.session
  if (typeof fromBody === 'string' && fromBody.trim() !== '') return fromBody.trim()
  if (typeof fromQuery === 'string' && fromQuery.trim() !== '') return fromQuery.trim()
  return 'default'
}

type MediaKind = 'image' | 'document' | 'audio' | 'video' | 'sticker'

interface MediaBundle {
  sessionName: string
  number: string
  buffer: Buffer
  contentType: string
  fileName: string
  caption?: string
  ptt?: boolean
}

function defaultMimeFor(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'image/png'
    case 'document':
      return 'application/octet-stream'
    case 'audio':
      return 'audio/mp4'
    case 'video':
      return 'video/mp4'
    case 'sticker':
      return 'image/webp'
  }
}

function parseMediaRequest(req: Request): {
  fields: Record<string, unknown>
  file?: { buffer: Buffer; originalName: string; mime: string }
} {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (req.is('multipart/form-data')) {
    const file = (req as Request & { file?: Express.Multer.File }).file
    return {
      fields: {
        session: typeof body.session === 'string' ? body.session : 'default',
        number: body.number,
        caption: body.caption,
        fileName: body.fileName,
        mimetype: body.mimetype,
        // Accept booleans and any case/spelling of the string form.
        ptt: body.ptt === true || body.ptt === 1 || String(body.ptt).toLowerCase() === 'true' || String(body.ptt) === '1',
      },
      file: file ? { buffer: file.buffer, originalName: file.originalname, mime: file.mimetype } : undefined,
    }
  }
  return { fields: { ...body } }
}

/** Normalise a media request (multipart file or JSON base64) into a MediaBundle. */
function resolveMedia(req: Request, kind: MediaKind): MediaBundle {
  const { fields, file } = parseMediaRequest(req)
  const sessionName = typeof fields.session === 'string' ? fields.session : 'default'
  const number = fields.number
  const caption = typeof fields.caption === 'string' ? fields.caption : undefined
  const ptt = Boolean(fields.ptt)

  if (typeof number !== 'string' || number.trim() === '') {
    throw new ApiError(400, 'Missing required field: number')
  }

  let buffer: Buffer
  let contentType: string
  let fileName: string

  if (file) {
    buffer = file.buffer
    contentType = file.mime || defaultMimeFor(kind)
    fileName = file.originalName || `upload-${Date.now()}`
  } else if (typeof fields.base64 === 'string' && fields.base64.length > 0) {
    let raw = fields.base64
    const dataUri = raw.match(/^data:([^;,]+);base64,(.*)$/s)
    if (dataUri) {
      contentType = dataUri[1] ?? defaultMimeFor(kind)
      raw = dataUri[2] ?? ''
    } else {
      contentType = typeof fields.mimetype === 'string' && fields.mimetype ? fields.mimetype : defaultMimeFor(kind)
    }
    buffer = Buffer.from(raw, 'base64')
    if (buffer.length === 0) throw new ApiError(400, 'Empty base64 payload', 'INVALID_BASE64')
    fileName = typeof fields.fileName === 'string' && fields.fileName ? fields.fileName : `upload-${Date.now()}`
  } else {
    throw new ApiError(400, 'Missing file or base64 field', 'MEDIA_REQUIRED')
  }

  return { sessionName, number: number.trim(), buffer, contentType, fileName, caption, ptt }
}

function buildMediaContent(kind: MediaKind, bundle: MediaBundle): AnyMessageContent {
  switch (kind) {
    case 'image':
      return { image: bundle.buffer, mimetype: bundle.contentType, caption: bundle.caption }
    case 'document':
      return {
        document: bundle.buffer,
        fileName: bundle.fileName,
        mimetype: bundle.contentType,
        caption: bundle.caption,
      }
    case 'audio':
      return {
        audio: bundle.buffer,
        mimetype: bundle.ptt ? 'audio/ogg; codecs=opus' : bundle.contentType,
        ptt: bundle.ptt,
      }
    case 'video':
      return { video: bundle.buffer, mimetype: bundle.contentType, caption: bundle.caption }
    case 'sticker':
      return { sticker: bundle.buffer }
  }
}

/** Persist an upload to uploads/<kind>/ (best-effort). */
function saveUpload(kind: MediaKind, bundle: MediaBundle): string | null {
  try {
    const rel = path.join(kind, randomFileName(bundle.contentType))
    fs.mkdirSync(path.join(config.uploadDir, kind), { recursive: true })
    fs.writeFileSync(path.join(config.uploadDir, rel), bundle.buffer)
    return rel.replaceAll('\\', '/')
  } catch (err) {
    logger.warn({ err }, 'failed to persist upload')
    return null
  }
}

async function handleMediaSend(kind: MediaKind, req: Request, res: Response): Promise<void> {
  const bundle = resolveMedia(req, kind)
  const jid = toJid(bundle.number)
  const session = await manager.start(bundle.sessionName)
  const content = buildMediaContent(kind, bundle)
  const { messageId } = await session.sendMessage(jid, content)
  const saved = saveUpload(kind, bundle)
  ok(res, { session: bundle.sessionName, number: jid, messageId, status: 'sent', filePath: saved })
}

// ---------------------------------------------------------------------------
// middleware: authentication on everything except /health
// ---------------------------------------------------------------------------

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path === '/health') {
    next()
    return
  }
  authenticate(req, res, next)
})

// ---------------------------------------------------------------------------
// system / session routes
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  ok(res, {
    service: 'wapi-baileys',
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    sessions: manager.list().length,
  })
})

app.get('/status', (_req, res) => {
  const sessions = manager.list()
  ok(res, { sessions, connected: sessions.filter((s) => s.state === 'open').length, total: sessions.length })
})

app.get('/sessions', (_req, res) => {
  ok(res, { sessions: manager.list() })
})

app.post(
  '/sessions/:name/start',
  asyncHandler(async (req, res) => {
    const session = await manager.start(req.params.name)
    ok(res, { session: session.getStatus() })
  }),
)

app.post(
  '/sessions/:name/stop',
  asyncHandler(async (req, res) => {
    await manager.stop(req.params.name)
    ok(res, { session: manager.get(req.params.name).getStatus() })
  }),
)

app.post(
  '/sessions/:name/logout',
  asyncHandler(async (req, res) => {
    await manager.logout(req.params.name)
    ok(res, { session: manager.get(req.params.name).getStatus() })
  }),
)

app.delete(
  '/sessions/:name',
  asyncHandler(async (req, res) => {
    await manager.delete(req.params.name)
    ok(res, { deleted: req.params.name })
  }),
)

app.get(
  '/sessions/:name/status',
  asyncHandler(async (req, res) => {
    ok(res, { session: manager.get(req.params.name).getStatus() })
  }),
)

app.get(
  '/sessions/:name/qr',
  asyncHandler(async (req, res) => {
    // Auto-create the session so a fresh install can pair immediately
    // (GET /qr.png from the README just works). Respects AUTO_CREATE_SESSION.
    const session = await manager.start(req.params.name)
    const { qr, expiresAt } = session.getQR()
    ok(res, { session: session.getStatus(), qr, expiresAt })
  }),
)

app.get(
  '/sessions/:name/qr.png',
  asyncHandler(async (req, res) => {
    const session = await manager.start(req.params.name)
    const { qr } = session.getQR()
    const png = await QRCode.toBuffer(qr, { width: 420, margin: 1 })
    res.type('image/png').send(png)
  }),
)

app.get(
  '/qr',
  asyncHandler(async (req, res) => {
    const name = getSessionName(req)
    const session = await manager.start(name)
    const { qr, expiresAt } = session.getQR()
    ok(res, { session: session.getStatus(), qr, expiresAt })
  }),
)

app.get(
  '/qr.png',
  asyncHandler(async (req, res) => {
    const name = getSessionName(req)
    const session = await manager.start(name)
    const { qr } = session.getQR()
    const png = await QRCode.toBuffer(qr, { width: 420, margin: 1 })
    res.type('image/png').send(png)
  }),
)

app.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const name = getSessionName(req)
    await manager.logout(name)
    ok(res, { session: manager.get(name).getStatus() })
  }),
)

// ---------------------------------------------------------------------------
// contact routes
// ---------------------------------------------------------------------------

app.post(
  '/contacts/check',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const sessionName = getSessionName(req)
    const raw = Array.isArray(body.numbers) ? body.numbers : typeof body.number === 'string' ? [body.number] : null
    if (!raw || raw.length === 0) throw new ApiError(400, 'Missing required field: numbers')
    const numbers = raw
      .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
      .map((n) => n.trim())
    if (numbers.length === 0) throw new ApiError(400, 'Missing required field: numbers')
    const session = await manager.start(sessionName)
    const results = await session.checkContacts(numbers.slice(0, 50))
    ok(res, { session: sessionName, count: results.length, results })
  }),
)

// ---------------------------------------------------------------------------
// message routes
// ---------------------------------------------------------------------------

app.post(
  '/send-text',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const sessionName = getSessionName(req)
    const number = body.number
    const message = body.message

    if (typeof number !== 'string' || number.trim() === '') throw new ApiError(400, 'Missing required field: number')
    if (typeof message !== 'string' || message.trim() === '') {
      throw new ApiError(400, 'Missing required field: message')
    }

    const jid = toJid(number)
    const session = await manager.start(sessionName)
    const { messageId } = await session.sendMessage(jid, { text: message })
    ok(res, { session: sessionName, number: jid, messageId, status: 'sent' })
  }),
)

app.post('/send-image', upload.single('file'), asyncHandler((req, res) => handleMediaSend('image', req, res)))
app.post('/send-document', upload.single('file'), asyncHandler((req, res) => handleMediaSend('document', req, res)))
app.post('/send-audio', upload.single('file'), asyncHandler((req, res) => handleMediaSend('audio', req, res)))
app.post('/send-video', upload.single('file'), asyncHandler((req, res) => handleMediaSend('video', req, res)))
app.post('/send-sticker', upload.single('file'), asyncHandler((req, res) => handleMediaSend('sticker', req, res)))

app.post(
  '/send-contact',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const sessionName = getSessionName(req)
    for (const field of ['number', 'name', 'phone'] as const) {
      if (typeof body[field] !== 'string' || (body[field] as string).trim() === '') {
        throw new ApiError(400, `Missing required field: ${field}`)
      }
    }
    const jid = toJid(body.number as string)
    const session = await manager.start(sessionName)
    const vcard = buildVCard(body.name as string, body.phone as string)
    const { messageId } = await session.sendMessage(jid, {
      contacts: { displayName: body.name as string, contacts: [{ vcard }] },
    })
    ok(res, { session: sessionName, number: jid, messageId, status: 'sent' })
  }),
)

app.post(
  '/send-location',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const sessionName = getSessionName(req)
    const number = body.number
    const latitude = Number(body.latitude)
    const longitude = Number(body.longitude)

    if (typeof number !== 'string' || number.trim() === '') throw new ApiError(400, 'Missing required field: number')
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new ApiError(400, 'Invalid latitude (must be between -90 and 90)')
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new ApiError(400, 'Invalid longitude (must be between -180 and 180)')
    }

    const jid = toJid(number)
    const session = await manager.start(sessionName)
    const location: { degreesLatitude: number; degreesLongitude: number; name?: string; address?: string } = {
      degreesLatitude: latitude,
      degreesLongitude: longitude,
    }
    if (typeof body.name === 'string' && body.name.trim() !== '') location.name = body.name
    if (typeof body.address === 'string' && body.address.trim() !== '') location.address = body.address
    const { messageId } = await session.sendMessage(jid, { location })
    ok(res, { session: sessionName, number: jid, messageId, status: 'sent' })
  }),
)

// ---------------------------------------------------------------------------
// error handling
// ---------------------------------------------------------------------------

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      message: err.message,
      code: err.code ?? 'ERROR',
      timestamp: nowIso(),
    })
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 100 MB)' : `Upload error: ${err.message}`
    return res.status(400).json({ success: false, message, code: 'UPLOAD_ERROR', timestamp: nowIso() })
  }
  const parseError = err as { type?: string }
  if (parseError?.type === 'entity.parse.failed' || parseError?.type === 'entity.too.large') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body', code: 'BAD_JSON', timestamp: nowIso() })
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error')
  res.status(500).json({ success: false, message: 'Internal server error', code: 'INTERNAL', timestamp: nowIso() })
})

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'wapi-baileys listening')
  manager.restore().catch((err) => logger.error({ err }, 'session restore failed'))
})

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down')
  await manager.shutdown()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
