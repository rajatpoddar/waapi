/** Shared types for the Baileys engine. */

export type SessionState = 'connecting' | 'open' | 'closed'

export type WebhookEvent =
  | 'message'
  | 'message.sent'
  | 'message.delivered'
  | 'message.read'
  | 'connection.open'
  | 'connection.close'
  | 'qr'
  | 'logout'

export interface SessionInfo {
  name: string
  state: SessionState
  phone: string | null
  qrAvailable: boolean
  connectedAt: string | null
  startedAt: string | null
  lastDisconnectReason: string | null
  isNewLogin: boolean
}

/** Error that maps directly to an HTTP response. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
