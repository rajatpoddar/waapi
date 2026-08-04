"""Shared fixtures: a FastAPI TestClient backed by a fake Baileys engine."""
import pytest
from fastapi.testclient import TestClient

from app import baileys_client
from app.config import get_settings
from app.main import create_app


class FakeBaileys:
    """In-memory stand-in for the Baileys engine."""

    def __init__(self) -> None:
        self.base_url = "http://test-baileys:2729"
        self.api_key = "test-key"
        self.last_endpoint: str | None = None
        self.last_payload: dict | None = None
        self.last_fields: dict | None = None
        self.last_file: tuple | None = None
        self.error: baileys_client.BaileysError | None = None

    async def health(self) -> dict:
        return {"success": True, "service": "wapi-baileys", "status": "ok", "sessions": 1}

    async def status(self) -> dict:
        return {"success": True, "sessions": {"default": {"state": "open"}}}

    async def list_sessions(self) -> dict:
        return {"success": True, "sessions": []}

    async def start_session(self, name: str) -> dict:
        return {"success": True, "session": {"name": name, "state": "connecting"}}

    async def stop_session(self, name: str) -> dict:
        return {"success": True, "session": {"name": name, "state": "closed"}}

    async def logout_session(self, name: str) -> dict:
        return {"success": True, "session": {"name": name, "state": "closed"}}

    async def delete_session(self, name: str) -> dict:
        return {"success": True, "deleted": name}

    async def session_status(self, name: str) -> dict:
        return {"success": True, "session": {"name": name, "state": "open"}}

    async def session_qr(self, name: str) -> dict:
        return {"success": True, "session": {"name": name, "state": "connecting"}, "qr": "QRDATA"}

    async def session_qr_image(self, name: str) -> bytes:
        return b"\x89PNG-fake"

    async def check_contacts(self, name: str, numbers: list[str]) -> dict:
        self.last_endpoint = "contacts/check"
        self.last_payload = {"session": name, "numbers": numbers}
        return {
            "success": True,
            "session": name,
            "count": len(numbers),
            "results": [{"number": n, "jid": f"{n}@s.whatsapp.net", "exists": True} for n in numbers],
        }

    async def post_json(self, endpoint: str, payload: dict) -> dict:
        self.last_endpoint = endpoint
        self.last_payload = payload
        if self.error:
            raise self.error
        return {
            "success": True,
            "session": payload.get("session", "default"),
            "number": payload.get("number"),
            "messageId": "SOME-ID",
            "timestamp": "2026-01-01T00:00:00Z",
            "status": "sent",
        }

    async def post_media(self, endpoint: str, fields: dict, filename: str, content: bytes, content_type: str) -> dict:
        self.last_endpoint = endpoint
        self.last_fields = fields
        self.last_file = (filename, content, content_type)
        if self.error:
            raise self.error
        return {
            "success": True,
            "session": fields.get("session", "default"),
            "number": fields.get("number"),
            "messageId": "SOME-ID",
            "timestamp": "2026-01-01T00:00:00Z",
            "status": "sent",
            "filePath": "image/x.png",
        }

    async def close(self) -> None:
        return None


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("API_KEY", "test-key")
    monkeypatch.setenv("JWT_SECRET", "")
    monkeypatch.setenv("BAILEYS_URL", "http://test-baileys:2729")
    monkeypatch.setenv("RATE_LIMIT", "100/minute")
    monkeypatch.setenv("LOG_DIR", "/tmp/wapi-test-logs")
    # Webhook receiver unreachable by design in tests: /admin-api/webhooks must degrade.
    monkeypatch.setenv("WEBHOOK_RECEIVER_URL", "http://127.0.0.1:1")
    get_settings.cache_clear()

    fake = FakeBaileys()
    monkeypatch.setattr(baileys_client, "_client", fake)

    app = create_app()
    with TestClient(app) as test_client:
        test_client.fake = fake
        yield test_client

    monkeypatch.setattr(baileys_client, "_client", None)
    get_settings.cache_clear()
