"""Tests for the WAPI webhook receiver (FastAPI)."""
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from webhook_receiver.app import app

EVENT = {
    "event": "message.delivered",
    "session": "second",
    "timestamp": "2026-07-31T10:00:00.000Z",
    "data": {"messageId": "3EB0A16A", "to": "918603110817@s.whatsapp.net", "at": "2026-07-31T10:00:00.000Z"},
}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    monkeypatch.setenv("WEBHOOK_SECRET", "")
    with TestClient(app) as c:
        yield c


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_webhook_receives_and_persists(client):
    resp = client.post("/webhook", json=EVENT)
    assert resp.status_code == 200
    body = resp.json()
    assert body["received"] is True
    assert body["event"] == "message.delivered"

    events = client.get("/events").json()
    assert events["count"] == 1
    assert events["events"][0]["session"] == "second"
    assert events["events"][0]["data"]["messageId"] == "3EB0A16A"


def test_webhook_rejects_bad_json(client):
    resp = client.post("/webhook", content=b"not json", headers={"content-type": "application/json"})
    assert resp.status_code == 400


def test_webhook_hmac_when_secret_set(client, monkeypatch):
    monkeypatch.setenv("WEBHOOK_SECRET", "s3cret")
    # Missing signature -> 401
    assert client.post("/webhook", json=EVENT).status_code == 401
    # Wrong signature -> 401
    assert client.post("/webhook", json=EVENT, headers={"x-webhook-signature": "deadbeef"}).status_code == 401
    # Correct signature over the exact body bytes -> 200 + persisted
    body = json.dumps(EVENT, separators=(",", ":")).encode()
    sig = _sign(body, "s3cret")
    resp = client.post(
        "/webhook",
        content=body,
        headers={"content-type": "application/json", "x-webhook-signature": sig},
    )
    assert resp.status_code == 200
    assert client.get("/events").json()["count"] == 1


def test_webhook_hmac_optional_without_secret(client):
    # With no WEBHOOK_SECRET configured the receiver accepts unsigned events.
    resp = client.post("/webhook", json=EVENT)
    assert resp.status_code == 200


def test_dashboard_renders_events(client):
    client.post("/webhook", json=EVENT)
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert "WAPI Webhook Receiver" in resp.text
    assert "message.delivered" in resp.text
