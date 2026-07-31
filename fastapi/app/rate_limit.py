"""SlowAPI rate limiter shared by the application and the routers."""
from fastapi import Request
from slowapi import Limiter


def client_ip(request: Request) -> str:
    """Rate-limit by client IP, honouring X-Forwarded-For (reverse proxies)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=client_ip)
