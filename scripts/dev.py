#!/usr/bin/env python3
"""
Run WAPI locally WITHOUT Docker (for development and testing).

Usage:
    python scripts/dev.py up        start engine (baileys) + API (fastapi) + webhook receiver
    python scripts/dev.py status    show running state + health
    python scripts/dev.py logs      tail the last lines of the service logs
    python scripts/dev.py down      stop all services

Prerequisites:
    - baileys built:  cd baileys && npm install && npm run build
    - fastapi venv:   cd fastapi && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

Notes:
    - The dev API key is fixed: local-test-key-123 (send requests with X-API-Key).
    - Sessions are stored in ./auth, uploads in ./uploads (the same folders Docker uses), logs in /tmp/wapi-logs.
    - A webhook receiver runs on http://localhost:2730 (dashboard + /events) and the
      engine is wired to it (WEBHOOK_URL). Set WEBHOOK_SECRET to enable HMAC signing.
    - Outgoing messages are spaced 2s apart (SEND_DELAY_MS=2000) so automated sends
      don't trip WhatsApp's anti-spam throttling.
    - The engine prints the QR code to its log while pairing; you can also open
      http://localhost:2728/qr.png in a browser (after `up`).
"""

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = Path("/tmp/wapi-logs")
STATE_FILE = Path("/tmp/wapi-dev-state.json")
API_KEY = "local-test-key-123"
BAILEYS_PORT = 2729
FASTAPI_PORT = 2728
WEBHOOK_PORT = 2730

BAILEYS_CMD = ["node", "dist/server.js"]
FASTAPI_CMD = [
    str(ROOT / "fastapi/.venv/bin/python"),
    "-m",
    "uvicorn",
    "app.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    str(FASTAPI_PORT),
]
WEBHOOK_CMD = [
    str(ROOT / "fastapi/.venv/bin/python"),
    "-m",
    "uvicorn",
    "webhook_receiver.app:app",
    "--host",
    "127.0.0.1",
    "--port",
    str(WEBHOOK_PORT),
]

SERVICES = ("baileys", "fastapi", "webhook")


def _base_env() -> dict:
    env = os.environ.copy()
    env["API_KEY"] = API_KEY
    env["LOG_DIR"] = str(LOG_DIR)
    env["PRINT_QR_IN_TERMINAL"] = "true"
    # Signed webhooks by default: the receiver verifies the same secret.
    env.setdefault("WEBHOOK_SECRET", "local-test-secret")
    return env


def _baileys_env() -> dict:
    env = _base_env()
    env["PORT"] = str(BAILEYS_PORT)
    env["AUTH_DIR"] = str(ROOT / "auth")
    env["UPLOAD_DIR"] = str(ROOT / "uploads")
    # 2s gap between outgoing messages - WhatsApp anti-spam friendliness.
    env.setdefault("SEND_DELAY_MS", "2000")
    # The local receiver is the default webhook target for dev; an exported
    # WEBHOOK_URL (e.g. a real ERP endpoint) overrides it.
    env.setdefault("WEBHOOK_URL", f"http://localhost:{WEBHOOK_PORT}/webhook")
    return env


def _fastapi_env() -> dict:
    env = _base_env()
    env["BAILEYS_URL"] = f"http://localhost:{BAILEYS_PORT}"
    env["CORS_ORIGINS"] = "*"
    env["RATE_LIMIT"] = "100/minute"
    return env


def _port_free(port: int) -> bool:
    """True when nothing accepts connections on 127.0.0.1:<port>.

    A connect() succeeds only when a real listener is accepting, so this probe
    sees through TIME_WAIT sockets left by recent connections (e.g. monitoring
    polls) - they refuse new connections - without ever colliding with a live
    listener, which a bind()-based probe (even with SO_REUSEADDR) can
    mis-detect as free on macOS.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        try:
            sock.connect(("127.0.0.1", port))
            return False  # a real listener accepted our connection
        except OSError:
            return True   # connection refused -> nothing is listening


def _spawn(cmd: list, cwd: Path, env: dict, name: str) -> int:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    # The child inherits the file descriptor; the parent closes its own copy.
    with open(LOG_DIR / f"{name}.log", "ab") as log:
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # survive the calling shell / terminal
        )
    return proc.pid


def _read_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _write_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def _alive(pid: int | None) -> bool:
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _port_for(name: str) -> int:
    return {"baileys": BAILEYS_PORT, "fastapi": FASTAPI_PORT, "webhook": WEBHOOK_PORT}.get(name, 0)


def _wait_port_free(port: int, timeout: float = 10.0) -> bool:
    """Wait until nothing listens on the port (graceful shutdown may lag)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_free(port):
            return True
        time.sleep(0.5)
    return False


def _wait_healthy(timeout: float = 25.0) -> bool:
    """Poll until the API and the webhook receiver both report healthy."""
    import json as _json
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        api_ok = False
        web_ok = False
        try:
            with urllib.request.urlopen(f"http://localhost:{FASTAPI_PORT}/health", timeout=2) as resp:
                if _json.loads(resp.read().decode()).get("baileys") == "reachable":
                    api_ok = True
        except Exception:
            pass
        try:
            with urllib.request.urlopen(f"http://localhost:{WEBHOOK_PORT}/health", timeout=2) as resp:
                if _json.loads(resp.read().decode()).get("status") == "ok":
                    web_ok = True
        except Exception:
            pass
        if api_ok and web_ok:
            return True
        time.sleep(1)
    return False


def cmd_up() -> None:
    state = _read_state()
    services = {
        "baileys": (BAILEYS_CMD, ROOT / "baileys", _baileys_env()),
        "fastapi": (FASTAPI_CMD, ROOT / "fastapi", _fastapi_env()),
        "webhook": (WEBHOOK_CMD, ROOT, _base_env()),
    }
    for name, (cmd, cwd, env) in services.items():
        port = _port_for(name)
        if _alive(state.get(name)) and not _port_free(port):
            print(f"[{name}] already running (pid {state[name]})")
            continue
        if not _port_free(port):
            # A previous instance may still be shutting down gracefully.
            if not _wait_port_free(port):
                print(f"[{name}] port {port} is in use by another process - free it first")
                continue
        try:
            pid = _spawn(cmd, cwd, env, name)
        except FileNotFoundError as exc:
            print(f"[{name}] failed to start: {exc}")
            print("  -> did you build?  cd baileys && npm install && npm run build")
            print("  -> did you create the venv?  cd fastapi && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")
            _write_state(state)
            sys.exit(1)
        state[name] = pid
        _write_state(state)  # persist after each spawn so partial starts stay cleanable
        print(f"[{name}] started (pid {pid}) -> log: {LOG_DIR / (name + '.log')}")
    print(f"Dev API key: {API_KEY}")
    if not _wait_healthy():
        print("WARNING: services did not become healthy in time - 'python scripts/dev.py logs' to inspect")
    cmd_status()


def cmd_status() -> None:
    state = _read_state()
    for name in SERVICES:
        port = _port_for(name)
        pid = state.get(name)
        running = _alive(pid) and not _port_free(port)
        print(f"[{name}] {'RUNNING (pid %s)' % pid if running else 'stopped'}")
    try:
        import urllib.request

        with urllib.request.urlopen(f"http://localhost:{FASTAPI_PORT}/health", timeout=3) as resp:
            print("health:", resp.read().decode()[:220])
    except Exception as exc:
        print(f"health: unreachable ({type(exc).__name__})")
    try:
        import urllib.request

        with urllib.request.urlopen(f"http://localhost:{WEBHOOK_PORT}/health", timeout=3) as resp:
            print("webhook:", resp.read().decode()[:120])
    except Exception as exc:
        print(f"webhook: unreachable ({type(exc).__name__})")


def cmd_logs() -> None:
    for name in SERVICES:
        log = LOG_DIR / f"{name}.log"
        print(f"--- {name} ---")
        if log.exists():
            print(log.read_text(errors="replace")[-4000:])
        else:
            print("(no log yet)")


def cmd_down() -> None:
    state = _read_state()
    for name in SERVICES:
        pid = state.get(name)
        # Only stop when our process actually holds the port - this guards
        # against PID reuse killing an unrelated process after a crash.
        if _alive(pid) and not _port_free(_port_for(name)):
            os.kill(pid, signal.SIGTERM)
            print(f"[{name}] stopped (pid {pid})")
            _wait_port_free(_port_for(name))
        else:
            print(f"[{name}] not running")
    _write_state({})


COMMANDS = {"up": cmd_up, "status": cmd_status, "logs": cmd_logs, "down": cmd_down}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        print(__doc__)
        sys.exit(1)
    COMMANDS[sys.argv[1]]()
