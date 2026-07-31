/** Pino logger writing to stdout and to logs/baileys.log. */
import fs from 'node:fs'
import path from 'node:path'
import pino from 'pino'
import { config } from './config.js'

fs.mkdirSync(config.logDir, { recursive: true })

const streams: pino.StreamEntry[] = [{ stream: process.stdout }]

try {
  streams.push({ stream: pino.destination(path.join(config.logDir, 'baileys.log')) })
} catch (err) {
  process.stderr.write(`[logger] file transport disabled: ${String(err)}\n`)
}

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: 'wapi-baileys' },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.multistream(streams),
)
