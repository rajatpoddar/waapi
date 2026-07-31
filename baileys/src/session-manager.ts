/** SessionManager: owns all WhatsAppSession instances (one per WhatsApp number). */
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { logger } from './logger.js'
import { WhatsAppSession } from './session.js'
import { ApiError, type SessionInfo } from './types.js'
import { delay, sanitizeSessionName } from './utils.js'

const SESSION_DIR_RE = /^[a-zA-Z0-9_-]{1,64}$/

export class SessionManager {
  private readonly sessions = new Map<string, WhatsAppSession>()

  private readonly reconnectHandler = (session: WhatsAppSession): void => {
    session.start().catch((err) => logger.error({ err, session: session.name }, 'auto-reconnect failed'))
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.getStatus())
  }

  get(name: string): WhatsAppSession {
    const session = this.sessions.get(sanitizeSessionName(name))
    if (!session) throw new ApiError(404, `Session "${name}" not found`, 'SESSION_NOT_FOUND')
    return session
  }

  /** Create (if needed) and start a session. */
  async start(name: string): Promise<WhatsAppSession> {
    const safeName = sanitizeSessionName(name)
    const session = this.spawn(safeName, config.autoCreateSession)
    await session.start()
    return session
  }

  async stop(name: string): Promise<void> {
    await this.get(name).stop()
  }

  async logout(name: string): Promise<void> {
    await this.get(name).logout()
  }

  async rename(name: string, newName: string): Promise<void> {
    const safeName = sanitizeSessionName(name)
    const safeNewName = sanitizeSessionName(newName)
    if (safeName === safeNewName) {
      return // no-op
    }
    if (this.sessions.has(safeNewName)) {
      throw new ApiError(409, `Session "${newName}" already exists`, 'SESSION_ALREADY_EXISTS')
    }
    const session = this.get(safeName)
    const wasOpen = session.state === 'open'

    // Stop the session first
    await session.stop()

    // Rename the auth directory on disk
    const oldAuthDir = path.join(config.authDir, safeName)
    const newAuthDir = path.join(config.authDir, safeNewName)
    try {
      if (fs.existsSync(oldAuthDir)) {
        fs.renameSync(oldAuthDir, newAuthDir)
      }
    } catch (err) {
      logger.error({ err, from: oldAuthDir, to: newAuthDir }, 'failed to rename auth directory')
      throw new ApiError(500, 'Failed to rename session auth directory', 'RENAME_FAILED')
    }

    // Remove old session from map
    this.sessions.delete(safeName)

    // Create a new session with the new name.
    // The auth directory has been renamed, so the new session
    // will pick up the auth state from the new directory.
    const newSession = this.spawn(safeNewName, true)

    // Restart if it was previously open
    if (wasOpen) {
      await newSession.start()
    }

    logger.info({ from: safeName, to: safeNewName }, 'session renamed')
  }

  async delete(name: string): Promise<void> {
    const session = this.get(name)
    await session.stop()
    session.removeCredentials()
    this.sessions.delete(session.name)
    logger.info({ session: session.name }, 'session deleted')
  }

  /** On boot, restore every persisted session found in the auth directory. */
  async restore(): Promise<void> {
    try {
      if (!fs.existsSync(config.authDir)) return
      const dirs = fs
        .readdirSync(config.authDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SESSION_DIR_RE.test(entry.name))
        .map((entry) => entry.name)
      for (const name of dirs) {
        await delay(300)
        // Restore existing sessions even when AUTO_CREATE_SESSION is disabled.
        this.spawn(name, true)
          .start()
          .catch((err) => logger.error({ err, session: name }, 'failed to restore session'))
      }
      logger.info({ restored: dirs.length }, 'session restore finished')
    } catch (err) {
      logger.error({ err }, 'session restore failed')
    }
  }

  /** Gracefully stop every session (used on shutdown). */
  async shutdown(): Promise<void> {
    const tasks = [...this.sessions.values()].map((s) => s.stop())
    await Promise.allSettled(tasks)
    logger.info('all sessions stopped')
  }

  private spawn(name: string, allowAutoCreate: boolean): WhatsAppSession {
    const existing = this.sessions.get(name)
    if (existing) return existing
    if (!allowAutoCreate) {
      throw new ApiError(404, `Session "${name}" not found (AUTO_CREATE_SESSION is disabled)`, 'SESSION_NOT_FOUND')
    }
    if (this.sessions.size >= config.maxSessions) {
      throw new ApiError(429, `Maximum number of sessions reached (${config.maxSessions})`, 'MAX_SESSIONS')
    }
    const session = new WhatsAppSession(name, this.reconnectHandler)
    this.sessions.set(name, session)
    return session
  }
}

export const manager = new SessionManager()
