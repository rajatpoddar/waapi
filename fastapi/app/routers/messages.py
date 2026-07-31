"""Message sending endpoints.

Media endpoints accept either:
  * multipart/form-data with a `file` field (plus session/number/caption/... fields), or
  * a JSON body with `base64` (optionally `mimetype`, `fileName`, `caption`, `ptt`).
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import verify_api_key
from ..baileys_client import get_client
from ..config import get_settings
from ..rate_limit import limiter
from ..schemas import (
    ContactsCheckRequest,
    MediaSendResponse,
    SendContactRequest,
    SendLocationRequest,
    SendResponse,
    SendTextRequest,
)

router = APIRouter(tags=["Messages"], dependencies=[Depends(verify_api_key)])


def _bad_request(message: str) -> HTTPException:
    return HTTPException(status_code=400, detail=message)


async def _parse_media(request: Request) -> dict:
    """Parse a media request body: multipart form fields or a JSON dict."""
    content_type = request.headers.get("content-type", "")
    if content_type.startswith("multipart/form-data") or content_type.startswith(
        "application/x-www-form-urlencoded"
    ):
        form = await request.form()
        data: dict = {k: v for k, v in form.items() if k != "file" and v is not None and v != ""}
        # Different starlette versions return different UploadFile implementations,
        # so detect files by duck-typing instead of isinstance().
        file = form.get("file")
        if file is not None and not isinstance(file, str) and hasattr(file, "read"):
            data["_file_bytes"] = await file.read()
            data["_file_name"] = file.filename or "upload.bin"
            data["_file_mime"] = file.content_type or "application/octet-stream"
        if isinstance(data.get("ptt"), str):
            data["ptt"] = data["ptt"].lower() in {"true", "1", "yes"}
        return data
    try:
        body = await request.json()
    except Exception:
        raise _bad_request("Invalid JSON body")
    if not isinstance(body, dict):
        raise _bad_request("Invalid JSON body")
    return body


async def _send_media(request: Request, endpoint: str) -> dict:
    """Shared logic for all media endpoints: forward multipart or base64 to the engine."""
    client = get_client()
    data = await _parse_media(request)
    data.setdefault("session", "default")

    if isinstance(data.get("number"), str) and data["number"].strip():
        data["number"] = data["number"].strip()
    else:
        raise _bad_request("Missing required field: number")

    file_bytes = data.pop("_file_bytes", None)
    if file_bytes is not None:
        fields = {k: v for k, v in data.items() if not k.startswith("_")}
        return await client.post_media(
            endpoint,
            fields,
            str(data.get("_file_name", "upload.bin")),
            file_bytes,
            str(data.get("_file_mime", "application/octet-stream")),
        )

    base64_value = data.get("base64")
    if not isinstance(base64_value, str) or not base64_value.strip():
        raise _bad_request("Missing file or base64 field")
    return await client.post_json(endpoint, data)


@router.post(
    "/contacts/check",
    summary="Check whether phone numbers are registered on WhatsApp (onWhatsApp)",
)
@limiter.limit(get_settings().rate_limit)
async def check_contacts(request: Request, payload: ContactsCheckRequest) -> dict:
    """Body: {session, numbers: ["919876543210", ...]}. Returns one result per number."""
    return await get_client().check_contacts(payload.session, payload.numbers)


@router.post("/send-text", summary="Send a text message", response_model=SendResponse)
@limiter.limit(get_settings().rate_limit)
async def send_text(request: Request, payload: SendTextRequest) -> dict:
    """Send a plain text message. Body: {session, number, message}."""
    return await get_client().post_json("send-text", payload.model_dump())


@router.post("/send-image", summary="Send an image (multipart `file` or JSON `base64`)", response_model=MediaSendResponse)
@limiter.limit(get_settings().rate_limit)
async def send_image(request: Request) -> dict:
    """multipart fields: session, number, file, caption | JSON: session, number, base64, caption, mimetype."""
    return await _send_media(request, "send-image")


@router.post(
    "/send-document",
    summary="Send a document/PDF/Excel (multipart `file` or JSON `base64`)",
    response_model=MediaSendResponse,
)
@limiter.limit(get_settings().rate_limit)
async def send_document(request: Request) -> dict:
    """multipart fields: session, number, file, fileName, caption | JSON: session, number, base64, fileName, mimetype."""
    return await _send_media(request, "send-document")


@router.post(
    "/send-audio",
    summary="Send audio or a voice note (multipart `file` or JSON `base64`)",
    response_model=MediaSendResponse,
)
@limiter.limit(get_settings().rate_limit)
async def send_audio(request: Request) -> dict:
    """multipart fields: session, number, file, ptt | JSON: session, number, base64, ptt, mimetype."""
    return await _send_media(request, "send-audio")


@router.post(
    "/send-video",
    summary="Send a video (multipart `file` or JSON `base64`)",
    response_model=MediaSendResponse,
)
@limiter.limit(get_settings().rate_limit)
async def send_video(request: Request) -> dict:
    """multipart fields: session, number, file, caption | JSON: session, number, base64, caption, mimetype."""
    return await _send_media(request, "send-video")


@router.post(
    "/send-sticker",
    summary="Send a sticker .webp (multipart `file` or JSON `base64`)",
    response_model=MediaSendResponse,
)
@limiter.limit(get_settings().rate_limit)
async def send_sticker(request: Request) -> dict:
    """multipart fields: session, number, file | JSON: session, number, base64."""
    return await _send_media(request, "send-sticker")


@router.post("/send-contact", summary="Send a contact card", response_model=SendResponse)
@limiter.limit(get_settings().rate_limit)
async def send_contact(request: Request, payload: SendContactRequest) -> dict:
    """Body: {session, number, name, phone}."""
    return await get_client().post_json("send-contact", payload.model_dump())


@router.post("/send-location", summary="Send a location pin", response_model=SendResponse)
@limiter.limit(get_settings().rate_limit)
async def send_location(request: Request, payload: SendLocationRequest) -> dict:
    """Body: {session, number, latitude, longitude, name?, address?}."""
    return await get_client().post_json("send-location", payload.model_dump())
