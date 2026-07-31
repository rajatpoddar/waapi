"""FastAPI application factory for WAPI."""
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .auth import verify_api_key
from .baileys_client import BaileysError, get_client
from .logging_config import setup_logging
from .rate_limit import limiter
from .routers import messages, sessions, system
from .utils import utc_now

setup_logging()
logger = logging.getLogger(__name__)

# Built admin dashboard (built with: cd dashboard && npm install && npm run build).
def _resolve_dashboard_dist() -> Path | None:
    """Locate the built admin dashboard for the current layout.

    Local dev:  <project_root>/dashboard/dist  (repo layout: fastapi/app/main.py)
    Docker:     /app/dashboard/dist           (image layout: app/main.py)
    """
    module_dir = Path(__file__).resolve().parent
    candidates = [
        module_dir.parent.parent / "dashboard" / "dist",  # local dev
        Path("/app/dashboard/dist"),  # container
    ]
    return next((p for p in candidates if p.is_dir()), None)


DASHBOARD_DIST = _resolve_dashboard_dist()


async def baileys_error_handler(request: Request, exc: BaileysError) -> JSONResponse:
    logger.error("Baileys error on %s %s: %s", request.method, request.url.path, exc.message)
    return JSONResponse(
        status_code=exc.status,
        content={
            "success": False,
            "message": exc.message,
            "code": exc.code or "BAILEYS_ERROR",
            "timestamp": utc_now(),
        },
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    details = [
        {"field": ".".join(str(x) for x in err["loc"] if x != "body"), "message": err["msg"]}
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={"success": False, "message": "Validation error", "details": details, "timestamp": utc_now()},
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "Internal server error", "code": "INTERNAL", "timestamp": utc_now()},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await get_client().close()


def create_app() -> FastAPI:
    from .config import get_settings

    settings = get_settings()

    app = FastAPI(
        title="WAPI - Self-Hosted WhatsApp API",
        version="1.0.0",
        description=(
            "Self-hosted WhatsApp automation API powered by Baileys + FastAPI.\n\n"
            "Authenticate every request with the **X-API-Key** header (or the `apikey` query parameter). "
            "If `JWT_SECRET` is configured, `Authorization: Bearer <jwt>` (HS256) is also accepted.\n\n"
            "Interactive docs: `/docs` (Swagger) and `/redoc`."
        ),
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_exception_handler(BaileysError, baileys_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    origins = settings.cors_origin_list
    allow_all = "*" in origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if allow_all else origins,
        allow_credentials=not allow_all,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        duration_ms = (time.perf_counter() - start) * 1000
        logger.info("%s %s -> %s (%.1f ms)", request.method, request.url.path, response.status_code, duration_ms)
        return response

    app.include_router(system.router)
    app.include_router(sessions.router)
    app.include_router(messages.router)

    @app.get(
        "/admin-api/webhooks",
        include_in_schema=False,
        dependencies=[Depends(verify_api_key)],
    )
    async def admin_webhooks(limit: int = Query(default=60, ge=1, le=500)) -> dict:
        """Proxy recent webhook events from the local receiver for the dashboard."""
        receiver = settings.webhook_receiver_url.rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{receiver}/events", params={"limit": limit})
                if resp.status_code == 200:
                    return resp.json()
        except httpx.HTTPError:
            pass
        return {"count": 0, "events": []}

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {
            "success": True,
            "service": "wapi-fastapi",
            "docs": "/docs",
            "health": "/health",
            "admin": "/admin" if DASHBOARD_DIST is not None else None,
        }

    # Serve the built React dashboard (built dashboard/dist) when present.
    if DASHBOARD_DIST is not None:
        app.mount("/admin", StaticFiles(directory=str(DASHBOARD_DIST), html=True), name="admin")

    return app


app = create_app()
