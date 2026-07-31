"""Session management endpoints (start/stop/logout/delete, status, QR)."""
from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response

from fastapi import Body

from ..auth import verify_api_key
from ..baileys_client import get_client
from ..schemas import LogoutRequest

router = APIRouter(tags=["Sessions"], dependencies=[Depends(verify_api_key)])


@router.post("/sessions/{name}/rename", summary="Rename a session")
async def rename_session(name: str, new_name: str = Body(..., embed=True)) -> dict:
    """Rename a session. Moves credentials and updates the session name."""
    return await get_client().rename_session(name, new_name)


@router.post("/sessions/{name}/start", summary="Create/start a WhatsApp session")
async def start_session(name: str, request: Request) -> dict:
    """Create the session if needed and connect it. Returns the session status."""
    return await get_client().start_session(name)


@router.post("/sessions/{name}/stop", summary="Stop a session (keep credentials)")
async def stop_session(name: str, request: Request) -> dict:
    """Disconnect without deleting credentials; the session resumes on the next start."""
    return await get_client().stop_session(name)


@router.post("/sessions/{name}/logout", summary="Log out and delete credentials")
async def logout_session(name: str, request: Request) -> dict:
    """Log out from WhatsApp and remove local credentials. Pair again with a new QR."""
    return await get_client().logout_session(name)


@router.delete("/sessions/{name}", summary="Stop and delete a session")
async def delete_session(name: str, request: Request) -> dict:
    """Stop the session and remove its credentials from disk."""
    return await get_client().delete_session(name)


@router.get("/sessions/{name}/status", summary="Status of a single session")
async def session_status(name: str, request: Request) -> dict:
    """Current state (connecting/open/closed) of one session."""
    return await get_client().session_status(name)


@router.get("/sessions/{name}/qr", summary="QR code as JSON to pair the session")
async def session_qr(name: str, request: Request) -> dict:
    """Returns the raw QR string (render it with any QR library) while pairing."""
    return await get_client().session_qr(name)


@router.get("/sessions/{name}/qr.png", summary="QR code as a PNG image")
async def session_qr_image(name: str, request: Request) -> Response:
    """Returns a scannable PNG. Open http://<host>:8000/sessions/<name>/qr.png in a browser."""
    png = await get_client().session_qr_image(name)
    return Response(content=png, media_type="image/png")


@router.get("/qr", summary="QR code for the default session (alias)")
async def qr_default(request: Request, session: str = Query(default="default")) -> dict:
    """Alias for GET /sessions/{session}/qr, auto-creating the session if needed."""
    return await get_client().session_qr(session)


@router.get("/qr.png", summary="QR code image for the default session (alias)")
async def qr_image_default(request: Request, session: str = Query(default="default")) -> Response:
    """Alias for GET /sessions/{session}/qr.png."""
    png = await get_client().session_qr_image(session)
    return Response(content=png, media_type="image/png")


@router.post("/logout", summary="Log out the default session (alias)")
async def logout_default(request: Request, payload: LogoutRequest | None = None) -> dict:
    """Alias for POST /sessions/{session}/logout. Session from body or ?session=."""
    name = payload.session if payload else (request.query_params.get("session") or "default")
    return await get_client().logout_session(name)
