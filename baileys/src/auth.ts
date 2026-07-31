/** Express authentication middleware: X-API-Key header, `apikey` query param, or optional JWT bearer. */
import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config.js'
import { ApiError } from './types.js'

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const headerKey = req.header('x-api-key')
  const queryKey = typeof req.query.apikey === 'string' ? req.query.apikey : undefined

  if (config.apiKey && (headerKey === config.apiKey || (queryKey !== undefined && queryKey === config.apiKey))) {
    next()
    return
  }

  if (config.jwtSecret) {
    const authHeader = req.header('authorization') ?? ''
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      try {
        const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] })
        if (decoded) {
          next()
          return
        }
      } catch {
        // fall through to 401
      }
    }
  }

  next(new ApiError(401, 'Invalid or missing API key', 'UNAUTHORIZED'))
}
