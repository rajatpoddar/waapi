"""Small shared helpers."""
import time


def utc_now() -> str:
    """Current UTC time as an ISO-8601 string."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
