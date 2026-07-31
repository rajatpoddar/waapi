# Installation Guide

This guide walks through a full install of WAPI on any machine with Docker
(including Synology NAS — see [SYNAS.md](SYNAS.md) for the NAS-specific walkthrough).

## Prerequisites

- **Docker Engine 24+** with **Docker Compose v2** (`docker compose version`)
- **A phone with WhatsApp** to scan the QR code
- Optional: an endpoint that receives webhooks (for automation)

## 1. Get the project

```bash
git clone <your-repo-url> wapi
cd wapi
```

If you received the project as a folder, just move into it.

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and change at least:

```ini
API_KEY=generate-a-long-random-string
```

Generate one with:

```bash
openssl rand -hex 32
```

Optional but recommended:

```ini
# Receive WhatsApp events in your application
WEBHOOK_URL=https://erp.example.com/hooks/whatsapp
# Protect webhooks with an HMAC signature
WEBHOOK_SECRET=another-long-random-string
```

## 3. Build and start

```bash
docker compose up -d --build
```

Docker will:

1. build the **baileys** image (TypeScript compile + native `libsignal` module),
2. build the **fastapi** image,
3. create the `auth/`, `uploads/`, `logs/` folders,
4. start both containers with health checks.

## 4. Verify

```bash
docker compose ps              # both containers should be "healthy"
curl http://localhost:8000/health
```

Expected:

```json
{ "success": true, "service": "wapi-fastapi", "status": "ok", "baileys": "reachable", "sessions": 0 }
```

## 5. Pair your first WhatsApp number

The examples below use `$API_KEY`. Either export it in your shell first,
or substitute your key literally:

```bash
export API_KEY="<the key you set in .env>"
```

Open the QR image in a browser:

```
http://<server-ip>:8000/qr.png
```

or fetch the raw QR JSON:

```bash
curl http://localhost:8000/qr -H "X-API-Key: $API_KEY"
```

On your phone: **WhatsApp → Settings → Linked devices → Link a device** → scan the QR.

Within a few seconds the session state becomes `open`:

```bash
curl http://localhost:8000/status -H "X-API-Key: $API_KEY"
```

> The QR refreshes roughly every 30 s. If the code expired, reload the page.
> The QR is also printed in the container logs: `docker logs -f wapi-baileys`.

## 6. Send your first message

```bash
curl -X POST http://localhost:8000/send-text \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session":"default","number":"919876543210","message":"Hello from WAPI"}'
```

Response:

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

> Note: the API reports `"status": "sent"` once WhatsApp accepted the message for
> delivery. Finer-grained delivery/read states arrive via webhooks
> (`message.delivered`, `message.read`).

## 7. Multiple sessions (multiple numbers)

Each WhatsApp number needs its own session. Sessions are created on first use or
explicitly:

```bash
curl -X POST http://localhost:8000/sessions/9198xxxxxxxx/start -H "X-API-Key: $API_KEY"
curl "http://localhost:8000/sessions/9198xxxxxxxx/qr.png" -H "X-API-Key: $API_KEY"   # scan this
curl -X POST http://localhost:8000/sessions/9170xxxxxxxx/start -H "X-API-Key: $API_KEY"
curl "http://localhost:8000/sessions/9170xxxxxxxx/qr.png" -H "X-API-Key: $API_KEY"   # scan this
```

Then send per session:

```bash
curl -X POST http://localhost:8000/send-text \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"session":"9198xxxxxxxx","number":"919876543210","message":"hi"}'
```

Each session stores its credentials in `auth/<session-name>/` and reconnects
automatically on restart.

## 8. Useful operations

```bash
# stop everything
docker compose down

# stop but keep session credentials
docker compose down          # credentials live in ./auth, they persist

# full wipe (removes WhatsApp credentials!)
docker compose down -v       # only if volumes were used; with bind mounts, delete ./auth manually
rm -rf auth                  # careful: logs everyone out

# view logs
docker compose logs -f fastapi
docker compose logs -f baileys
tail -f logs/api.log logs/baileys.log
```

## 9. Updating

```bash
git pull
docker compose up -d --build
```

Sessions stay logged in because credentials live in `./auth` on the host.

## 10. Backup

Back up (at minimum) the `auth/` directory and your `.env`:

```bash
tar czf wapi-backup-$(date +%F).tar.gz auth .env
```

`auth/` contains your WhatsApp credentials — treat it like a password.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Baileys engine unreachable` (502) | `docker compose ps` — wait for `wapi-baileys` to be healthy; check `docker compose logs baileys` |
| QR never becomes open | Make sure the phone's WhatsApp is online; the QR refreshes every ~30 s, reload `/qr.png` |
| `WhatsApp not connected` (409) | Session exists but isn't `open` — check `/status`, pair with QR if needed |
| Session logs out by itself | WhatsApp logged the device out (e.g. too many parallel instances) — re-pair |
| Sends fail with timeouts | Keep `SEND_DELAY_MS` > 0 and low volumes; WhatsApp limits unofficial clients |
| Can't reach port 8000 | Check firewall/security group; on Synology see [SYNAS.md](SYNAS.md) |
