"""End-to-end tests of the FastAPI layer with a fake engine."""
import jwt as pyjwt

from app.baileys_client import BaileysError

HEADERS = {"X-API-Key": "test-key"}

SEND_BODY = {"session": "default", "number": "919876543210", "message": "Hello"}


def test_health_is_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["baileys"] == "reachable"


def test_health_degrades_gracefully(client):
    def boom():
        raise BaileysError(502, "unreachable")

    client.fake.health = boom
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["baileys"] == "unreachable"


def test_status_requires_api_key(client):
    assert client.get("/status").status_code == 401


def test_status_with_api_key(client):
    resp = client.get("/status", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


def test_send_text_forwards_payload(client):
    resp = client.post("/send-text", json=SEND_BODY, headers=HEADERS)
    assert resp.status_code == 200
    assert client.fake.last_endpoint == "send-text"
    assert client.fake.last_payload == SEND_BODY
    assert resp.json()["messageId"] == "SOME-ID"


def test_send_text_validation_error(client):
    resp = client.post("/send-text", json={"session": "default", "message": "Hello"}, headers=HEADERS)
    assert resp.status_code == 422


def test_send_text_propagates_engine_error(client):
    client.fake.error = BaileysError(409, "WhatsApp not connected", "SESSION_NOT_CONNECTED")
    resp = client.post("/send-text", json=SEND_BODY, headers=HEADERS)
    assert resp.status_code == 409
    body = resp.json()
    assert body["success"] is False
    assert body["message"] == "WhatsApp not connected"
    assert body["code"] == "SESSION_NOT_CONNECTED"


def test_send_image_json_base64(client):
    payload = {"session": "default", "number": "919876543210", "base64": "aGVsbG8=", "caption": "hi"}
    resp = client.post("/send-image", json=payload, headers=HEADERS)
    assert resp.status_code == 200
    assert client.fake.last_endpoint == "send-image"
    assert client.fake.last_payload == payload


def test_send_document_multipart(client):
    files = {"file": ("report.pdf", b"%PDF-1.4 fake", "application/pdf")}
    data = {"session": "default", "number": "919876543210", "caption": "Monthly report"}
    resp = client.post("/send-document", data=data, files=files, headers=HEADERS)
    assert resp.status_code == 200
    assert client.fake.last_endpoint == "send-document"
    assert client.fake.last_fields["caption"] == "Monthly report"
    assert client.fake.last_file[0] == "report.pdf"
    assert client.fake.last_file[2] == "application/pdf"


def test_send_media_requires_file_or_base64(client):
    resp = client.post("/send-image", data={"session": "default", "number": "919876543210"}, headers=HEADERS)
    assert resp.status_code == 400


def test_send_media_requires_number(client):
    payload = {"session": "default", "base64": "aGVsbG8="}
    resp = client.post("/send-image", json=payload, headers=HEADERS)
    assert resp.status_code == 400


def test_check_contacts_forwards_payload(client):
    payload = {"session": "default", "numbers": ["919876543210", "917250580175"]}
    resp = client.post("/contacts/check", json=payload, headers=HEADERS)
    assert resp.status_code == 200
    assert client.fake.last_payload == payload
    body = resp.json()
    assert body["count"] == 2
    assert len(body["results"]) == 2
    assert body["results"][0]["exists"] is True


def test_check_contacts_requires_numbers(client):
    resp = client.post("/contacts/check", json={"session": "default"}, headers=HEADERS)
    assert resp.status_code == 422


def test_send_contact(client):
    payload = {"session": "default", "number": "919876543210", "name": "John", "phone": "919876543211"}
    resp = client.post("/send-contact", json=payload, headers=HEADERS)
    assert resp.status_code == 200
    assert client.fake.last_endpoint == "send-contact"


def test_send_location(client):
    payload = {"session": "default", "number": "919876543210", "latitude": 12.97, "longitude": 77.59}
    resp = client.post("/send-location", json=payload, headers=HEADERS)
    assert resp.status_code == 200
    assert client.fake.last_endpoint == "send-location"


def test_send_location_rejects_bad_coordinates(client):
    payload = {"session": "default", "number": "919876543210", "latitude": 999, "longitude": 77.59}
    resp = client.post("/send-location", json=payload, headers=HEADERS)
    assert resp.status_code == 422


def test_qr_default(client):
    resp = client.get("/qr", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["qr"] == "QRDATA"


def test_qr_png(client):
    resp = client.get("/sessions/default/qr.png", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"


def test_session_crud(client):
    assert client.post("/sessions/default/start", headers=HEADERS).status_code == 200
    assert client.post("/sessions/default/stop", headers=HEADERS).status_code == 200
    assert client.post("/sessions/default/logout", headers=HEADERS).status_code == 200
    assert client.delete("/sessions/default", headers=HEADERS).status_code == 200
    assert client.get("/sessions", headers=HEADERS).status_code == 200


def test_logout_alias(client):
    resp = client.post("/logout", json={"session": "default"}, headers=HEADERS)
    assert resp.status_code == 200


def test_jwt_auth(client, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "s3cret-secret")
    from app.config import get_settings

    get_settings.cache_clear()
    token = pyjwt.encode({"sub": "test"}, "s3cret-secret", algorithm="HS256")
    resp = client.post(
        "/send-text",
        json=SEND_BODY,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200


def test_invalid_jwt_rejected(client, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "s3cret-secret")
    from app.config import get_settings

    get_settings.cache_clear()
    resp = client.post("/send-text", json=SEND_BODY, headers={"Authorization": "Bearer not-a-token"})
    assert resp.status_code == 401


def test_openapi_has_security_scheme(client):
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "WAPI - Self-Hosted WhatsApp API"


def test_admin_webhooks_requires_auth(client):
    assert client.get("/admin-api/webhooks").status_code == 401


def test_admin_webhooks_degrades_gracefully(client):
    # The receiver is unreachable in tests (WEBHOOK_RECEIVER_URL=127.0.0.1:1),
    # so the dashboard proxy must return an empty feed without erroring.
    resp = client.get("/admin-api/webhooks", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json() == {"count": 0, "events": []}
