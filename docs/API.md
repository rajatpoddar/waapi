# API Reference

Base URL: `http://<host>:8000` — interactive docs at `/docs` (Swagger).

All responses are JSON. Send endpoints return:

```json
{
  "success": true,
  "timestamp": "2026-07-31T10:00:00.000Z",
  "session": "default",
  "number": "919876543210@s.whatsapp.net",
  "messageId": "3EB0A16A...",
  "status": "sent"
}
```

> `status` is `"sent"` once WhatsApp accepted the message. Delivery/read confirmation
> arrives via webhooks (`message.delivered`, `message.read`).

Errors always look like:

```json
{ "success": false, "message": "WhatsApp not connected", "code": "SESSION_NOT_CONNECTED", "timestamp": "..." }
```

| HTTP | Meaning |
| --- | --- |
| 200 | Success |
| 400 | Invalid payload (missing field, bad number, no file) |
| 401 | Missing/invalid API key |
| 404 | Session not found |
| 409 | Session exists but not connected / QR not ready |
| 422 | Schema validation error (`details` array) |
| 429 | Rate limit exceeded |
| 500 | Internal error |
| 502 | Baileys engine unreachable |

## Authentication

All endpoints except `GET /health` require the API key:

- Header: `X-API-Key: <key>`
- or query: `?apikey=<key>`
- or (if `JWT_SECRET` is set) `Authorization: Bearer <jwt>` — HS256, any `sub`.

> The examples below use `$API_KEY` — either `export API_KEY=your-key` in your
> shell first, or substitute the key literally.

---

## System

### `GET /health` — liveness probe (no auth)

```bash
curl http://localhost:8000/health
```

```json
{ "success": true, "service": "wapi-fastapi", "status": "ok", "baileys": "reachable", "sessions": 0, "timestamp": "..." }
```

### `GET /status` — all sessions

```bash
curl http://localhost:8000/status -H "X-API-Key: $API_KEY"
```

```json
{
  "success": true,
  "timestamp": "...",
  "sessions": [
    {
      "name": "default",
      "state": "open",
      "phone": "919876543210",
      "qrAvailable": false,
      "connectedAt": "...",
      "startedAt": "...",
      "lastDisconnectReason": null,
      "isNewLogin": false
    }
  ],
  "connected": 1,
  "total": 1
}
```

`state`: `connecting` (waiting for QR/network) · `open` · `closed`.

### `GET /sessions` — list sessions

Returns `{ "success": true, "sessions": [ ...same objects as /status... ] }`.

---

## Sessions

### `POST /sessions/{name}/start`

Create the session if needed and connect it.

```bash
curl -X POST http://localhost:8000/sessions/default/start -H "X-API-Key: $API_KEY"
```

Returns the session object (usually `state: "connecting"` — pair with the QR next).

### `GET /sessions/{name}/qr` — QR as JSON

```bash
curl http://localhost:8000/sessions/default/qr -H "X-API-Key: $API_KEY"
```

```json
{ "success": true, "timestamp": "...", "session": { "name": "default", "state": "connecting", ... }, "qr": "2@AA3...", "expiresAt": "..." }
```

Render the `qr` string with any QR library, or open the PNG endpoint directly.

### `GET /sessions/{name}/qr.png` — QR as image

```bash
curl -o qr.png "http://localhost:8000/sessions/default/qr.png" -H "X-API-Key: $API_KEY"
```

Open in a browser and scan with **WhatsApp → Linked devices**.

### `GET /sessions/{name}/status`

```bash
curl http://localhost:8000/sessions/default/status -H "X-API-Key: $API_KEY"
```

### `POST /sessions/{name}/stop`

Disconnects but keeps credentials (the session reconnects on the next start/restart).

### `POST /sessions/{name}/logout`

Logs out of WhatsApp and **deletes the credentials** in `auth/<name>/`. Pair again with a new QR.

### `DELETE /sessions/{name}`

Stops the session and removes it (and its credentials) entirely.

### Aliases (Evolution-style)

- `GET /qr` · `GET /qr.png` — operate on the `default` session (`?session=name` to change), auto-creating it.
- `POST /logout` — logout for `default` (`{"session":"name"}` or `?session=name`).

---

## Messaging

### `POST /send-text`

```json
{ "session": "default", "number": "919876543210", "message": "Hello" }
```

```bash
curl -X POST http://localhost:8000/send-text \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"session":"default","number":"919876543210","message":"Hello"}'
```

`number` may be a full WhatsApp number (with country code), with `+`, spaces or
dashes. Group chats can be targeted with a group JID (`1234567890-12345@g.us`).

### Media endpoints — two formats

Every media endpoint accepts **either**:

1. `multipart/form-data` with a `file` field:

```bash
curl -X POST http://localhost:8000/send-document \
  -H "X-API-Key: $API_KEY" \
  -F "session=default" \
  -F "number=919876543210" \
  -F "caption=Monthly report" \
  -F "file=@report.pdf;type=application/pdf"
```

2. JSON with `base64`:

```json
{ "session": "default", "number": "919876543210", "base64": "JVBERi0xLjQK...", "fileName": "report.pdf", "mimetype": "application/pdf", "caption": "Monthly report" }
```

`data:...;base64,` prefixes are accepted too.

### `POST /send-image`

Fields: `session`, `number`, `file`/`base64`, `caption?`, `mimetype?`.

### `POST /send-document`

PDF, Excel, anything. Fields: `session`, `number`, `file`/`base64`, `fileName?`, `mimetype?`, `caption?`.
(Excel: `application/vnd.ms-excel` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.)

### `POST /send-audio`

Fields: `session`, `number`, `file`/`base64`, `ptt` (boolean/`"true"`), `mimetype?`.
Set `ptt: true` for a **voice note** (`audio/ogg; codecs=opus`), omit for regular audio.

### `POST /send-video`

Fields: `session`, `number`, `file`/`base64`, `caption?`, `mimetype?`.

### `POST /send-sticker`

Fields: `session`, `number`, `file`/`base64` (a `.webp` sticker).

### `POST /send-contact`

```json
{ "session": "default", "number": "919876543210", "name": "John Doe", "phone": "919876543211" }
```

### `POST /contacts/check` — is a number registered on WhatsApp?

Uses Baileys' `onWhatsApp()` lookup against the WhatsApp network (the session must
be connected). Useful to validate a number and its country code before sending —
a number that isn't registered will be rejected by WhatsApp with error `463`.

```json
{ "session": "default", "numbers": ["919876543210", "917250580175"] }
```

```bash
curl -X POST http://localhost:8000/contacts/check \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"numbers":["919876543210","917250580175"]}'
```

```json
{
  "success": true,
  "session": "default",
  "count": 2,
  "results": [
    { "number": "919876543210", "jid": "919876543210@s.whatsapp.net", "exists": true },
    { "number": "917250580175", "jid": null, "exists": false },
    { "number": "15551234567", "jid": null, "exists": false, "error": "Timed Out" }
  ]
}
```

`exists: false` means the number is not on WhatsApp in that country-code format —
try a different dialing code. If a result also carries `error`, the lookup itself
failed (e.g. WhatsApp timed out) — retry rather than assuming the number is invalid.

### `POST /send-location`

```json
{ "session": "default", "number": "919876543210", "latitude": 12.9716, "longitude": 77.5946, "name": "Bengaluru", "address": "Karnataka, India" }
```

Media responses additionally include `filePath` (the file saved under `uploads/`):

```json
{ "success": true, "...": "...", "status": "sent", "filePath": "image/1722...-ab12cd34.png" }
```

---

## Rate limiting

Message endpoints (`/send-*`) are limited per client IP via `RATE_LIMIT`
(default `60/minute`). The value is read **at startup**. Clients that exceed it get
`429`.

When the API sits behind a reverse proxy, `X-Forwarded-For` is honoured. Do not expose
the API directly to the internet without a proxy that overwrites that header, or the
limit can be bypassed.

## Webhooks

Set `WEBHOOK_URL` (or `WEBHOOK_URL_<SESSIONNAME>` per session). Every enabled event is
`POST`ed as JSON with retries (exponential backoff, `WEBHOOK_RETRIES`). If
`WEBHOOK_SECRET` is set, the header `X-Webhook-Signature` contains the HMAC-SHA256 hex
of the body — verify it on your receiver.

Payload envelope:

```json
{ "event": "<event>", "session": "<session-name>", "timestamp": "2026-07-31T10:00:00.000Z", "data": { ... } }
```

| Event | When | `data` fields |
| --- | --- | --- |
| `message` | Incoming message | `messageId`, `from`, `type`, `content`, `timestamp`; media: `fileName`, `mimetype`, `caption`, `mediaBase64` (if `WEBHOOK_MEDIA=true`), `mediaSizeBytes`, `mediaTruncated` |
| `message.sent` | Outgoing message sent | `messageId`, `to`, `type`, `content`, `timestamp` |
| `message.delivered` | Recipient received it | `messageId`, `to`, `participant`, `at` |
| `message.read` | Recipient read it | `messageId`, `to`, `participant`, `at` |
| `connection.open` | Connection established | `phone`, `isNewLogin`, `timestamp` |
| `connection.close` | Connection dropped | `reason`, `statusCode`, `willReconnect`, `timestamp` |
| `qr` | New QR while pairing | `qr`, `expiresAt` |
| `logout` | Session logged out | `reason`, `timestamp` |

`type` values: `conversation`, `extendedTextMessage`, `image`, `video`, `audio`,
`document`, `sticker`, `contact`, `location`, `listMessage`, `buttonsMessage`, … .

Example incoming-message webhook:

```json
{
  "event": "message",
  "session": "default",
  "timestamp": "2026-07-31T10:00:00.000Z",
  "data": {
    "messageId": "BANCA2EAA8A1",
    "from": "919876543210@s.whatsapp.net",
    "type": "conversation",
    "content": "Hello, are you there?",
    "timestamp": "2026-07-31T09:59:58.000Z"
  }
}
```

Example read-receipt webhook:

```json
{
  "event": "message.read",
  "session": "default",
  "timestamp": "2026-07-31T10:00:05.000Z",
  "data": { "messageId": "3EB0A16A...", "to": "919876543210@s.whatsapp.net", "participant": "919876543210@s.whatsapp.net", "at": "2026-07-31T10:00:05.000Z" }
}
```

### Local webhook receiver (dev/testing)

A ready-made receiver lives in `webhook_receiver/` and is started automatically by
`python scripts/dev.py up` on port **9001**. The engine is wired to it via
`WEBHOOK_URL=http://localhost:9001/webhook`, and webhooks are signed with
`WEBHOOK_SECRET` (HMAC-SHA256) which the receiver verifies.

- **Dashboard:** http://localhost:9001 (auto-refreshes, shows every event)
- **JSON:** http://localhost:9001/events
- **Log:** `logs/webhooks.log` (one JSON object per line; under `dev.py` it is
  `/tmp/wapi-logs/webhooks.log` because `LOG_DIR` is overridden)

For production, point `WEBHOOK_URL` (or `WEBHOOK_URL_<SESSIONNAME>`) at your own
receiver (ERP/CRM/n8n/etc.) and verify `X-Webhook-Signature` with the same
HMAC-SHA256 scheme.

## JWT

When `JWT_SECRET` is set, mint tokens with any tool:

```bash
# example using python
python3 -c "
import jwt, time
print(jwt.encode({'sub': 'my-app', 'iat': int(time.time())}, 'YOUR-JWT-SECRET', algorithm='HS256'))
"
```

```bash
curl http://localhost:8000/status -H "Authorization: Bearer <jwt>"
```

## Postman

Import [WAPI.postman_collection.json](WAPI.postman_collection.json) and set the
collection variables `base_url`, `api_key`, `session`, `number`.
