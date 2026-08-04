"""WAPI Webhook Receiver.

Captures the WhatsApp events emitted by the Baileys engine (message,
message.sent, message.delivered, message.read, connection.open,
connection.close, qr, logout) so you can watch delivery/read confirmations
in real time.

Run locally (already wired into `python scripts/dev.py up`, port 2730):

    fastapi/.venv/bin/python -m uvicorn webhook_receiver.app:app \\
        --host 127.0.0.1 --port 2730

The engine posts to `WEBHOOK_URL` (dev.py wires it to
http://localhost:2730/webhook). If `WEBHOOK_SECRET` is set on both sides, the
engine signs the body (HMAC-SHA256 hex in `X-Webhook-Signature`) and the
receiver verifies it before accepting the event.

Endpoints:
    POST /webhook   receive, verify and persist one event
    GET  /events    recent events as JSON (?limit=)
    GET  /          auto-refreshing dashboard
    GET  /health    liveness probe
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse

app = FastAPI(title="WAPI Webhook Receiver", version="1.0.0", docs_url="/docs")

MAX_EVENTS = 500

# Badge colors per event type (dashboard).
BADGES: dict[str, str] = {
    "message": "#22c55e",
    "message.sent": "#3b82f6",
    "message.delivered": "#f59e0b",
    "message.read": "#8b5cf6",
    "connection.open": "#10b981",
    "connection.close": "#ef4444",
    "qr": "#eab308",
    "logout": "#f43f5e",
}


def _log_file() -> Path:
    return Path(os.environ.get("LOG_DIR", "logs")) / "webhooks.log"


def _secret() -> str:
    return os.environ.get("WEBHOOK_SECRET", "") or ""


def _verify(body: bytes, signature: str | None) -> bool:
    """Constant-time HMAC-SHA256 comparison (no-op when no secret is set)."""
    secret = _secret()
    if not secret:
        return True
    if not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.lower())


def _load_events(limit: int = 100) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    log = _log_file()
    if not log.exists():
        return events
    lines = log.read_text(errors="replace").splitlines()
    for line in reversed(lines[-5000:]):
        try:
            events.append(json.loads(line))
        except (json.JSONDecodeError, ValueError):
            continue
        if len(events) >= max(0, min(limit, MAX_EVENTS)):
            break
    return events


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/events")
async def events(limit: int = 100) -> dict[str, Any]:
    rows = _load_events(limit)
    return {"count": len(rows), "events": rows}


@app.post("/webhook")
async def webhook(
    request: Request,
    x_webhook_signature: str | None = Header(default=None),
) -> dict[str, Any]:
    """Receive one engine webhook, verify it, and append it to the log."""
    body = await request.body()
    if not _verify(body, x_webhook_signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    log = _log_file()
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload) + "\n")
    return {"received": True, "event": payload.get("event"), "session": payload.get("session")}


@app.get("/", response_class=HTMLResponse)
async def dashboard() -> str:
    events = _load_events(50)
    rows: list[str] = []
    for ev in events:
        event = str(ev.get("event", ""))
        data = ev.get("data") or {}
        summary = (
            data.get("content")
            or data.get("phone")
            or data.get("messageId")
            or data.get("reason")
            or data.get("from")
            or data.get("to")
            or ""
        )
        rows.append(
            f'<tr>'
            f'<td><span class="badge" style="background:{BADGES.get(event, "#64748b")}">{event}</span></td>'
            f'<td>{ev.get("session", "")}</td>'
            f'<td class="mono dim">{ev.get("timestamp", "")}</td>'
            f'<td class="mono">{str(summary)[:140]}</td>'
            f"</tr>"
        )
    table = "".join(rows) if rows else '<tr><td colspan="4" class="dim">No events yet — send a message and watch it appear.</td></tr>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>WAPI Webhook Receiver</title>
<style>
  body {{ font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 32px; }}
  h1 {{ font-size: 20px; margin: 0 0 4px; }}
  .sub {{ color: #94a3b8; font-size: 13px; margin-bottom: 20px; }}
  .links a {{ color: #38bdf8; text-decoration: none; margin-right: 16px; font-size: 13px; }}
  table {{ width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 10px; overflow: hidden; }}
  th {{ text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #94a3b8; padding: 10px 14px; border-bottom: 1px solid #334155; }}
  td {{ padding: 9px 14px; border-bottom: 1px solid #26344a; font-size: 13px; vertical-align: top; }}
  tr:last-child td {{ border-bottom: none; }}
  .badge {{ display: inline-block; color: #fff; border-radius: 999px; padding: 2px 10px; font-size: 11px; font-weight: 600; }}
  .mono {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
  .dim {{ color: #94a3b8; }}
</style>
</head>
<body>
  <h1>WAPI Webhook Receiver</h1>
  <p class="sub">WhatsApp events from the Baileys engine — auto-refreshes every 5s.</p>
  <p class="links">
    <a href="/events">JSON (/events)</a>
    <a href="/docs">Swagger</a>
    <a href="/health">Health</a>
  </p>
  <table>
    <thead><tr><th>Event</th><th>Session</th><th>Time</th><th>Details</th></tr></thead>
    <tbody>{table}</tbody>
  </table>
</body>
</html>"""
