"""System endpoints: health, status, session listing."""
from fastapi import APIRouter, Depends, Request

from ..auth import verify_api_key
from ..baileys_client import get_client
from ..utils import utc_now

router = APIRouter(tags=["System"])


@router.get("/health", summary="Liveness probe (no auth required)")
async def health(request: Request) -> dict:
    """Liveness probe used by Docker and monitoring. Always 200 when the API is up."""
    client = get_client()
    try:
        engine = await client.health()
        baileys_status = "reachable"
        sessions = engine.get("sessions", 0)
    except Exception:
        baileys_status = "unreachable"
        sessions = 0
    return {
        "success": True,
        "service": "wapi-fastapi",
        "status": "ok",
        "baileys": baileys_status,
        "sessions": sessions,
        "timestamp": utc_now(),
    }


@router.get("/status", summary="Overall status of all sessions", dependencies=[Depends(verify_api_key)])
async def status(request: Request) -> dict:
    """Detailed status of every session, proxied from the engine."""
    return await get_client().status()


@router.get("/sessions", summary="List all sessions", dependencies=[Depends(verify_api_key)])
async def list_sessions(request: Request) -> dict:
    """List every session with its current state."""
    return await get_client().list_sessions()
