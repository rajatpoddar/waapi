# WAPI Admin Dashboard

A React (Vite) admin UI for WAPI — session management, QR pairing, live webhook
feed and message sending.

## Serve (production)

FastAPI serves the built app automatically at **`/admin`**:

```bash
cd dashboard
npm install
npm run build        # -> dashboard/dist
```

Then `http://<host>:8000/admin` (rebuild whenever you change the React code;
FastAPI picks the new files up without a restart).

## Develop

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5173/admin/ (base is /admin/), proxies API calls to :8000
```

## Using it

1. Enter your API key (stored in `localStorage` — a self-hosted admin tool, so
   the key lives client-side) and click **Save**.
2. **Sessions** — start/stop/logout, and scan the QR shown while a session is
   connecting.
3. **Webhook events** — live activity (message.sent/delivered/read, connection,
   qr, …) proxied from the webhook receiver.
4. **Send message** — text sends with a 2s gap (`SEND_DELAY_MS`). If messages
   stay in "waiting", WhatsApp is temporarily throttling the account — slow down.

## Notes

- The dashboard never stores credentials — only the API key, in the browser.
- `npm run build` only needs to run once per change; the Docker image serves the
  prebuilt `dist/` via FastAPI.
