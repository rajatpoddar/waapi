# WAPI — Self-Hosted WhatsApp API

<div align="center">

**Self-hosted WhatsApp automation API** — a production-ready drop-in replacement for
Evolution API, built with **Baileys** (Node.js engine) + **FastAPI** (Python REST API).

![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)
![Node](https://img.shields.io/badge/Node-20+-339933?logo=nodedotjs&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

Run your own WhatsApp API for personal business automation — multi-session, webhooks,
media sending, and a built-in admin panel. Deploy with **Docker** (including Synology
NAS) or run locally in seconds with a single script.

## ✨ Features

- **Admin panel** — a built-in dashboard (`/admin`) with API-key login: add sessions
  and scan QR codes, start/stop/logout/delete/rename sessions, live webhook feed with
  pagination, and settings — no coding needed
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

## 🚀 Quick start

### Option A — Docker (recommended for production / NAS)

```bash
# 1. Clone / copy the project and configure it
cp .env.example .env
#    edit .env: set a strong API_KEY, optionally WEBHOOK_URL

# 2. Start everything
docker compose up -d --build

# 3. Check health
curl http://localhost:2728/health

# 4. Open the admin panel, log in with your API key, and scan the QR
open http://localhost:2728/admin
```

### Option B — Local dev (no Docker, one command)

```bash
./run-local.sh            # installs deps, builds, starts services, opens the admin panel
./run-local.sh --down     # stop all services
```

The script checks prerequisites, builds the baileys engine, creates the Python
virtualenv, builds the dashboard, starts all three services, waits for health, and
opens the admin panel in your browser. The local dev API key is `local-test-key-123`.

> Manual alternative: `python3 scripts/dev.py up|status|logs|down` (see
> [docs/INSTALLATION.md](docs/INSTALLATION.md) and the script's docstring).

### Pair your first WhatsApp number

1. Open **`http://localhost:2728/admin`** (or the `/qr.png` image directly)
2. Log in with your **API key**
3. Click **+ Add Session**, name it, and scan the QR with
   **WhatsApp → Settings → Linked devices → Link a device**
4. The session connects automatically and stays paired across restarts

Or with curl (default session):

```bash
curl http://localhost:2728/qr.png   # open in a browser and scan
```

Send your first message:

```bash
export API_KEY=<your key from .env>   # dev: local-test-key-123
curl -X POST http://localhost:2728/send-text \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session":"default","number":"919876543210","message":"Hello from WAPI"}'
```

> **QR flow:** the QR refreshes every ~30 s while pairing — poll `/qr` until the state
> becomes `open`. Sessions with saved credentials reconnect automatically on restart.

## 🖥️ Admin panel

The dashboard is served by FastAPI at **`/admin`** and requires your **API key** to log in
(it is validated against the backend before access is granted — a wrong key shows an
error, a down server shows a distinct message).

| Tab | What you can do |
| --- | --- |
| **Sessions** | Add sessions (QR generation + scan), start/stop, cancel pairing, logout, delete, and rename inline — plus a test send form |
| **Webhooks** | Live feed of incoming events with pagination, filtering, and expandable JSON payloads |
| **Settings** | Dashboard preferences: page size, event filter, auto-refresh |

Sidebar shows engine health, session counts, and a **Sign out** button that locks the
dashboard (key is cleared from the browser).

> The **live webhook feed** is populated in local dev mode by the built-in
> `webhook_receiver/` service. In Docker, point `WEBHOOK_URL` at a receiver that also
> serves `/events`, and make sure the FastAPI `webhook_receiver_url` setting points at
> the same receiver, if you want the feed populated there.

## 🏗️ Architecture

```
                    ┌──────────────────────────────────────────────────────┐
                    │                    FastAPI (port 2728)               │
                    │  /send-*, /qr, /status, /sessions, /logout, /health │
                    │  Swagger docs at /docs · API key + JWT · rate limit │
                    │  Admin panel at /admin · webhook proxy /admin-api   │
                    └───────────────▲───────────────────┬──────────────────┘
                                    │ HTTP (internal)   │ X-API-Key
                                    │ BAILEYS_URL       ▼
                    ┌───────────────┴──────────────────────────────────────┐
                    │              Baileys engine (port 2729)             │
                    │  session manager → WhatsAppSession (per number)     │
                    │  QR · auto-reconnect · webhooks → WEBHOOK_URL       │
                    └───────────────┬───────────┬────────────┬────────────┘
                                    │           │            │
                              auth/<session>  uploads/     logs/
                              (WhatsApp creds) (media)    (baileys.log)
```

Only the FastAPI container is exposed to the network (port `2728`). The Baileys engine
stays on the private Docker network. In local dev, a lightweight `webhook_receiver/`
service (port `2730`) captures events for the dashboard's webhook feed.

## 🔌 API overview

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Liveness probe (no auth) |
| GET | `/status` | Overall status of all sessions |
| GET | `/sessions` | List sessions |
| POST | `/sessions/{name}/start` | Create/start a session |
| POST | `/sessions/{name}/stop` | Stop (keep credentials) |
| POST | `/sessions/{name}/logout` | Logout + delete credentials |
| POST | `/sessions/{name}/rename` | Rename a session (body: `{"new_name": "..."}`) |
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
Interactive Swagger UI: `http://localhost:2728/docs`.

### Session lifecycle

| Action | What happens | Credentials |
| --- | --- | --- |
| `start` | Creates/connects the session | kept |
| `stop` | Disconnects; session stays registered, marked stopped on disk so it **does not** auto-reconnect after a restart | kept |
| `logout` | Disconnects and wipes credentials | **deleted** |
| `delete` | Stops and removes the session entirely | **deleted** |

### Authentication

Every request (except `/health`) must authenticate with the API key:

```bash
curl http://localhost:2728/status -H "X-API-Key: your-api-key"
# or
curl "http://localhost:2728/status?apikey=your-api-key"
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

## ⚙️ Configuration

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

## 📁 Project structure

```
├── docker-compose.yml      # starts fastapi + baileys
├── .env.example            # configuration template
├── run-local.sh            # one-command local setup & run (no Docker)
├── baileys/                # WhatsApp engine (Node.js + TypeScript)
│   ├── src/                # config, session, session-manager, webhooks, server...
│   ├── tests/              # vitest unit tests
│   └── Dockerfile
├── fastapi/                # REST API (Python)
│   ├── app/                # routers, schemas, auth, client...
│   ├── tests/              # pytest tests
│   └── Dockerfile
├── dashboard/              # admin panel (React + Vite), served at /admin
├── webhook_receiver/       # local webhook receiver for the admin panel (dev only)
├── scripts/dev.py          # local dev runner without Docker
├── auth/                   # WhatsApp session credentials (persistent, git-ignored)
├── uploads/                # media saved by the engine (persistent)
├── logs/                   # baileys.log, api.log, errors.log
└── docs/                   # INSTALLATION, API, SYNAS, Postman collection
```

## 📚 Docs

- [Installation guide](docs/INSTALLATION.md) — Docker + troubleshooting
- [API reference (with examples)](docs/API.md)
- [Synology NAS deployment](docs/SYNAS.md)
- [Postman collection](docs/WAPI.postman_collection.json)

## 🔒 Security notes

- Change `API_KEY` (generate one with `openssl rand -hex 32`).
- The engine port `2729` is internal only; don't publish it unless you know why.
- Rate limiting keys on the client IP and honours `X-Forwarded-For`, so **only expose
  the API directly** (no reverse proxy) if you accept that the header can be spoofed
  to bypass limits; always put it behind a reverse proxy that overwrites that header.
- Session credentials in `auth/` grant full access to your WhatsApp account — keep
  backups of this folder private, and never commit it.
- Incoming webhooks are unsigned by default; set `WEBHOOK_SECRET` and verify the
  `X-Webhook-Signature` header on your receiver.
- The admin panel stores your API key in the browser's `localStorage` (for its session);
  use a reverse proxy with its own auth if you need stronger protection.

## ⚠️ Disclaimer

This project uses the **unofficial** WhatsApp Web protocol via Baileys. It is not
affiliated with or endorsed by Meta/WhatsApp. Automated messaging may violate
WhatsApp's Terms of Service and can lead to account bans — use responsibly, respect
recipients, and keep sending volumes low (`SEND_DELAY_MS` helps). You are responsible
for how you use this software.

## 📄 License

[MIT](LICENSE)
