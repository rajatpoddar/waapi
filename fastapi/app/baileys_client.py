"""Async HTTP client for the Baileys engine (internal service)."""
import logging
from urllib.parse import quote

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)


class BaileysError(Exception):
    """Error returned by (or while reaching) the Baileys engine."""

    def __init__(self, status: int, message: str, code: str | None = None) -> None:
        self.status = status
        self.message = message
        self.code = code
        super().__init__(message)


_client: "BaileysClient | None" = None


def get_client() -> "BaileysClient":
    """Return a (cached) client for the current settings."""
    global _client
    settings = get_settings()
    if (
        _client is None
        or getattr(_client, "base_url", None) != settings.baileys_url
        or getattr(_client, "api_key", None) != settings.api_key
    ):
        _client = BaileysClient(settings.baileys_url, settings.api_key)
    return _client


class BaileysClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = 60.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self._http: httpx.AsyncClient | None = None

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None or self._http.is_closed:
            self._http = httpx.AsyncClient(base_url=self.base_url, timeout=self.timeout)
        return self._http

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        try:
            resp = await self.http.request(method, path, headers=self._headers(), **kwargs)
        except httpx.HTTPError as exc:
            raise BaileysError(502, f"Baileys engine unreachable ({type(exc).__name__})", "BAILEYS_UNREACHABLE") from exc
        if resp.status_code >= 400:
            try:
                body = resp.json()
                message = str(body.get("message") or resp.text)
                code = body.get("code")
            except ValueError:
                message, code = resp.text, None
            raise BaileysError(resp.status_code, message, code)
        try:
            return resp.json()
        except ValueError:
            return {"success": True, "raw": resp.text}

    async def _request_bytes(self, path: str) -> bytes:
        try:
            resp = await self.http.get(path, headers=self._headers())
        except httpx.HTTPError as exc:
            raise BaileysError(502, f"Baileys engine unreachable ({type(exc).__name__})", "BAILEYS_UNREACHABLE") from exc
        if resp.status_code >= 400:
            try:
                body = resp.json()
                message = str(body.get("message") or resp.text)
            except ValueError:
                message = resp.text
            raise BaileysError(resp.status_code, message)
        return resp.content

    # ---- system ----
    async def health(self) -> dict:
        return await self._request("GET", "/health")

    async def status(self) -> dict:
        return await self._request("GET", "/status")

    async def list_sessions(self) -> dict:
        return await self._request("GET", "/sessions")

    # ---- session management ----
    async def start_session(self, name: str) -> dict:
        return await self._request("POST", f"/sessions/{quote(name, safe='')}/start")

    async def stop_session(self, name: str) -> dict:
        return await self._request("POST", f"/sessions/{quote(name, safe='')}/stop")

    async def logout_session(self, name: str) -> dict:
        return await self._request("POST", f"/sessions/{quote(name, safe='')}/logout")

    async def delete_session(self, name: str) -> dict:
        return await self._request("DELETE", f"/sessions/{quote(name, safe='')}")

    async def session_status(self, name: str) -> dict:
        return await self._request("GET", f"/sessions/{quote(name, safe='')}/status")

    async def session_qr(self, name: str) -> dict:
        return await self._request("GET", f"/sessions/{quote(name, safe='')}/qr")

    async def session_qr_image(self, name: str) -> bytes:
        return await self._request_bytes(f"/sessions/{quote(name, safe='')}/qr.png")

    # ---- messaging ----
    async def check_contacts(self, name: str, numbers: list[str]) -> dict:
        return await self._request("POST", "/contacts/check", json={"session": name, "numbers": numbers})

    async def post_json(self, endpoint: str, payload: dict) -> dict:
        return await self._request("POST", f"/{endpoint}", json=payload)

    async def post_media(
        self,
        endpoint: str,
        fields: dict,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> dict:
        files = {"file": (filename, content, content_type)}
        return await self._request("POST", f"/{endpoint}", data=fields, files=files)

    async def close(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None
