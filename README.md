# WAPI — Self-Hosted WhatsApp API

A production-ready, self-hosted WhatsApp API built with **Baileys** (Node.js engine) and
**FastAPI** (Python REST API). Designed as a drop-in replacement for Evolution API for
personal business automation — deployable on Docker, including Synology NAS.

```
docker compose up -d
```

## Features

- **WhatsApp engine** — Node.js + `@whiskeysockets/baileys` (multi-device, unofficial API)
- **REST API** — FastAPI with automatic Swagger docs at `/docs`
- **QR pairing** — JSON or PNG QR endpoints, session auto-save, auto-reconnect
- **Multiple sessions** — one WhatsApp number per session, each with its own auth folder
- **Messaging** — text, image, PDF/Excel/document, audio (incl. voice notes), video, sticker, contact, location
- **File uploads** — `multipart/form-data` *or* JSON `base64` for every media endpoint
- **Webhooks** — incoming message, sent, delivered, read, connection open/close, QR, logout
- **Security** — API key auth, optional JWT (HS256), CORS, rate limiting
- **Logging** — request/event/error logs persisted in `logs/`
- **Docker** — `docker compose up -d`, persistent volumes, health checks
- **Synology NAS ready** — see [docs/SYNAS.md](docs/SYNAS.md)

## Architecture

```
                    ┌──────────────────────────────────────────────────────┐
                    │                    FastAPI (port 8000)               │
                    │  /send-*, /qr, /status, /sessions, /logout, /health │
                    │  Swagger docs at /docs · API key + JWT · rate limit │
                    └───────────────▲───────────────────┬──────────────────┘
                                    │ HTTP (internal)   │ X-API-Key
                                    │ BAILEYS_URL       ▼
                    ┌───────────────┴──────────────────────────────────────┐
                    │              Baileys engine (port 3000)             │
                    │  session manager → WhatsAppSession (per number)     │
                    │  QR · auto-reconnect · webhooks → WEBHOOK_URL       │
                    └───────────────┬───────────┬────────────┬────────────┘
                                    │           │            │
                              auth/<session>  uploads/     logs/
                              (WhatsApp creds) (media)    (baileys.log)
```

Only the FastAPI container is exposed to the network (port `8000`). The Baileys engine
stays on the private Docker network.

## Quick start

```bash
# 1. Clone / copy the project and configure it
cp .env.example .env
#    edit .env: set a strong API_KEY, optionally WEBHOOK_URL

# 2. Start everything
docker compose up -d

# 3. Check health
curl http://localhost:8000/health

# 4. Pair your first WhatsApp number (default session)
#    open in a browser and scan the QR with WhatsApp > Linked devices:
open http://localhost:8000/qr.png

# 5. Send your first message
#    (export your API key so the curl examples work:  export API_KEY=<your key from .env>)
curl -X POST http://localhost:8000/send-text \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session":"default","number":"919876543210","message":"Hello from WAPI"}'
```

> **QR flow:** after pairing, the session connects automatically. Sessions with saved
> credentials reconnect automatically on restart (no need to re-scan). The QR refreshes
> every ~30 s while pairing — poll `/qr` until the state becomes `open`.

## API overview

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Liveness probe (no auth) |
| GET | `/status` | Overall status of all sessions |
| GET | `/sessions` | List sessions |
| POST | `/sessions/{name}/start` | Create/start a session |
| POST | `/sessions/{name}/stop` | Stop (keep credentials) |
| POST | `/sessions/{name}/logout` | Logout + delete credentials |
| DELETE | `/sessions/{name}` | Stop + delete session |
| GET | `/sessions/{name}/status` | Single session status |
| GET | `/sessions/{name}/qr` | QR as JSON |
| GET | `/sessions/{name}/qr.png` | QR as PNG |
| GET | `/qr` , `/qr.png` | QR for `default` session |
| POST | `/logout` | Logout `default` session |
| POST | `/send-text` | Text message |
| POST | `/send-image` | Image |
| POST | `/send-document` | PDF / Excel / any file |
| POST | `/send-audio` | Audio or voice note (`ptt`) |
| POST | `/send-video` | Video |
| POST | `/send-sticker` | Sticker (.webp) |
| POST | `/send-contact` | Contact card |
| POST | `/send-location` | Location pin |

Full reference with examples: **[docs/API.md](docs/API.md)**.
Interactive Swagger UI: `http://localhost:8000/docs`.

### Authentication

Every request (except `/health`) must authenticate with the API key:

```bash
curl http://localhost:8000/status -H "X-API-Key: your-api-key"
# or
curl "http://localhost:8000/status?apikey=your-api-key"
```

If `JWT_SECRET` is set, `Authorization: Bearer <jwt>` (HS256) also works.

### Webhooks

Set `WEBHOOK_URL` in `.env` and the engine will `POST` events to it (with retries and
exponential backoff). Events: `message`, `message.sent`, `message.delivered`,
`message.read`, `connection.open`, `connection.close`, `qr`, `logout`.

```json
{
  "event": "message",
  "session": "default",
  "timestamp": "2026-07-31T10:00:00.000Z",
  "data": { "messageId": "...", "from": "919876543210@s.whatsapp.net", "type": "conversation", "content": "Hello" }
}
```

Per-session override: `WEBHOOK_URL_<SESSIONNAME>=https://...`. Optional HMAC signature:
set `WEBHOOK_SECRET` and verify the `X-Webhook-Signature` header (HMAC-SHA256 hex of the body).

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Default | Description |
| --- | --- | --- |
| `API_KEY` | `change-me` | API key for all requests (**change it!**) |
| `JWT_SECRET` | *(empty)* | Optional HS256 JWT secret |
| `WEBHOOK_URL` | *(empty)* | Global webhook endpoint |
| `WEBHOOK_EVENTS` | all | Comma-separated event filter |
| `WEBHOOK_SECRET` | *(empty)* | HMAC signature for webhook payloads |
| `WEBHOOK_MEDIA` | `false` | Embed incoming media (base64) in webhooks |
| `WEBHOOK_MEDIA_MAX_BYTES` | `10485760` | Max media size embedded (bytes) |
| `WEBHOOK_RETRIES` | `5` | Webhook delivery retries |
| `AUTO_CREATE_SESSION` | `true` | Auto-create sessions on first use |
| `SEND_DELAY_MS` | `0` | Artificial delay between sends (anti-ban) |
| `RECONNECT_DELAY_MS` | `5000` | Reconnect delay after disconnect |
| `MAX_SESSIONS` | `10` | Max concurrent sessions |
| `PRINT_QR_IN_TERMINAL` | `true` | Print QR in `docker logs wapi-baileys` |
| `LOG_LEVEL` | `info` | Engine log level |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (FastAPI) |
| `RATE_LIMIT` | `60/minute` | Send-endpoint rate limit (read at startup) |

## Project structure

```
├── docker-compose.yml      # starts fastapi + baileys
├── .env.example            # configuration template
├── baileys/                # WhatsApp engine (Node.js + TypeScript)
│   ├── src/                # config, session, session-manager, webhooks, server...
│   ├── tests/              # vitest unit tests
│   └── Dockerfile
├── fastapi/                # REST API (Python)
│   ├── app/                # routers, schemas, auth, client...
│   ├── tests/              # pytest tests
│   └── Dockerfile
├── auth/                   # WhatsApp session credentials (persistent, git-ignored)
├── uploads/                # media saved by the engine (persistent)
├── logs/                   # baileys.log, api.log, errors.log
└── docs/                   # INSTALLATION, API, SYNAS, Postman collection
```

## Docs

- [Installation guide](docs/INSTALLATION.md)
- [API reference (with examples)](docs/API.md)
- [Synology NAS deployment](docs/SYNAS.md)
- [Postman collection](docs/WAPI.postman_collection.json)

## Security notes

- Change `API_KEY` (generate one with `openssl rand -hex 32`).
- The engine port `3000` is internal only; don't publish it unless you know why.
- Rate limiting keys on the client IP and honours `X-Forwarded-For`, so **only expose
  the API directly** (no reverse proxy) if you accept that the header can be spoofed
  to bypass limits; always put it behind a reverse proxy that overwrites that header.
- Session credentials in `auth/` grant full access to your WhatsApp account — keep
  backups of this folder private, and never commit it.
- Incoming webhooks are unsigned by default; set `WEBHOOK_SECRET` and verify the
  `X-Webhook-Signature` header on your receiver.

## Disclaimer

This project uses the **unofficial** WhatsApp Web protocol via Baileys. It is not
affiliated with or endorsed by Meta/WhatsApp. Automated messaging may violate
WhatsApp's Terms of Service and can lead to account bans — use responsibly, respect
recipients, and keep sending volumes low (`SEND_DELAY_MS` helps). You are responsible
for how you use this software.

## License

[MIT](LICENSE)
