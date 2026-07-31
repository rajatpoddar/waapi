"""Authentication for the REST API: API key (header or query) and optional JWT bearer."""
import logging

import jwt as pyjwt
from fastapi import Header, HTTPException, Query, Request, status

from .config import get_settings

logger = logging.getLogger(__name__)


def verify_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None),
    apikey: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> None:
    """FastAPI dependency. Raises 401 unless a valid API key or JWT is presented."""
    settings = get_settings()

    if settings.api_key and (x_api_key == settings.api_key or (apikey and apikey == settings.api_key)):
        return

    if settings.jwt_secret and authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            try:
                pyjwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
                return
            except pyjwt.PyJWTError:
                logger.warning("Invalid JWT presented for %s %s", request.method, request.url.path)

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")
