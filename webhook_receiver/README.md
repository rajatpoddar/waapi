# WAPI Webhook Receiver

A local endpoint that captures the WhatsApp events emitted by the Baileys engine
(`message`, `message.sent`, `message.delivered`, `message.read`,
`connection.open`, `connection.close`, `qr`, `logout`) so you can watch
delivery/read confirmations in real time.

## Run

`python scripts/dev.py up` starts it automatically on port **2730**
(engine wired to it via `WEBHOOK_URL=http://localhost:2730/webhook`).

Or manually:

```bash
fastapi/.venv/bin/python -m uvicorn webhook_receiver.app:app --host 127.0.0.1 --port 2730
```

## View

- **Dashboard:** http://localhost:2730 (auto-refreshes every 5s)
- **JSON:** http://localhost:2730/events
- **Swagger:** http://localhost:2730/docs

Events are appended to `logs/webhooks.log` (one JSON object per line).

## Security

If `WEBHOOK_SECRET` is set on the engine **and** the receiver, every request must
carry a valid `X-Webhook-Signature` header (HMAC-SHA256 hex of the raw body).
Requests with a missing or wrong signature get `401`. Without `WEBHOOK_SECRET`
the receiver accepts unsigned events — only use that on a trusted network.

## Production

This receiver is a testing/demo tool. In production, point `WEBHOOK_URL` (or
`WEBHOOK_URL_<SESSIONNAME>`) at your own endpoint (ERP/CRM/n8n/Make/…) and verify
the signature there with the same HMAC-SHA256 scheme.
