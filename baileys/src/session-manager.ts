/** SessionManager: owns all WhatsAppSession instances (one per WhatsApp number). */
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { logger } from './logger.js'
import { WhatsAppSession } from './session.js'
import { ApiError, type SessionInfo } from './types.js'
import { delay, sanitizeSessionName } from './utils.js'

const SESSION_DIR_RE = /^[a-zA-Z0-9_-]{1,64}$/

/** Marker file written inside a session auth dir when it is explicitly stopped. */
const STOPPED_MARKER = '.stopped'

export class SessionManager {
  private readonly sessions = new Map<string, WhatsAppSession>()

  /**
   * Names explicitly stopped or deleted during this process run. Used to keep
   * QR/auto-create endpoints from resurrecting a session the user just closed.
   * Cleared when the same name is explicitly started again.
   */
  private readonly tombstones = new Set<string>()

  private readonly reconnectHandler = (session: WhatsAppSession): void => {
    session.start().catch((err) => logger.error({ err, session: session.name }, 'auto-reconnect failed'))
  }

  private stoppedMarkerPath(name: string): string {
    return path.join(config.authDir, name, STOPPED_MARKER)
  }

  private removeStoppedMarker(name: string): void {
    try {
      fs.rmSync(this.stoppedMarkerPath(name), { force: true })
    } catch {
      /* noop */
    }
  }

  /** Explicit user action: allow a name again and clear its persisted stopped marker. */
  clearTombstone(name: string): void {
    const safeName = sanitizeSessionName(name)
    this.tombstones.delete(safeName)
    this.removeStoppedMarker(safeName)
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
    // The session is active again - clear tombstone and persisted stopped marker
    // so the next engine restart reconnects it. (spawn() still refuses tombstoned
    // NEW names, so a deleted session is never silently recreated here.)
    this.clearTombstone(safeName)
    return session
  }

  async stop(name: string): Promise<void> {
    const safeName = sanitizeSessionName(name)
    await this.get(safeName).stop()
    this.tombstones.add(safeName)
    // Persist the stopped state so an engine restart does NOT reconnect it.
    // JSON content: even if Baileys' auth-state reader inspects the file, it
    // parses cleanly and never matches its session-\d+ key pattern.
    try {
      fs.writeFileSync(this.stoppedMarkerPath(safeName), JSON.stringify({ stoppedAt: new Date().toISOString() }))
    } catch (err) {
      logger.warn({ err, session: safeName }, 'failed to write stopped marker')
    }
  }

  async logout(name: string): Promise<void> {
    const safeName = sanitizeSessionName(name)
    await this.get(safeName).logout()
    this.tombstones.add(safeName)
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

    // Remove old session from map and tombstone it so a stray QR/send request
    // for the old name can't silently recreate it.
    this.sessions.delete(safeName)
    this.tombstones.add(safeName)

    // Create a new session with the new name.
    // The auth directory has been renamed, so the new session
    // will pick up the auth state from the new directory.
    // Allow the new name even if it was tombstoned before (e.g. deleted earlier).
    // NOTE: do NOT remove a .stopped marker here - it moved with the renamed
    // dir, so a previously-stopped session stays stopped across restarts.
    this.tombstones.delete(safeNewName)
    const newSession = this.spawn(safeNewName, true)

    // Restart if it was previously open
    if (wasOpen) {
      await newSession.start()
    }

    logger.info({ from: safeName, to: safeNewName }, 'session renamed')
  }

  async delete(name: string): Promise<void> {
    const safeName = sanitizeSessionName(name)
    const session = this.get(safeName)
    await session.stop()
    session.removeCredentials()
    this.sessions.delete(safeName)
    this.tombstones.add(safeName)
    logger.info({ session: safeName }, 'session deleted')
  }

  /**
   * Resolve a session for the QR endpoints WITHOUT starting it.
   *
   * Explicitly stopped/deleted sessions (in `tombstones`) return 404 instead of
   * being resurrected. A brand-new name still auto-creates (README flow), but an
   * existing closed session is never silently restarted by a GET request.
   */
  async getForQR(name: string): Promise<WhatsAppSession> {
    const safeName = sanitizeSessionName(name)
    const existing = this.sessions.get(safeName)
    if (existing) {
      if (existing.state === 'closed' && this.tombstones.has(safeName)) {
        throw new ApiError(404, `Session "${name}" not found`, 'SESSION_NOT_FOUND')
      }
      return existing
    }
    if (this.tombstones.has(safeName)) {
      throw new ApiError(404, `Session "${name}" not found`, 'SESSION_NOT_FOUND')
    }
    if (!config.autoCreateSession) {
      throw new ApiError(404, `Session "${name}" not found (AUTO_CREATE_SESSION is disabled)`, 'SESSION_NOT_FOUND')
    }
    return this.start(safeName)
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
        const session = this.spawn(name, true)
        // A session explicitly stopped in a previous run stays closed across
        // restarts - only an explicit Start can bring it back.
        if (fs.existsSync(this.stoppedMarkerPath(name))) {
          this.tombstones.add(name)
          logger.info({ session: name }, 'restore: session marked stopped, keeping closed')
          continue
        }
        session.start().catch((err) => logger.error({ err, session: name }, 'failed to restore session'))
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
    // Never silently recreate a session the user explicitly stopped/deleted -
    // not even via an auto-create path (send/media/QR). They must start it again.
    if (this.tombstones.has(name)) {
      throw new ApiError(404, `Session "${name}" not found`, 'SESSION_NOT_FOUND')
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
