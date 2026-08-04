#!/usr/bin/env bash
#
# WAPI — one-command local setup & run
#
#   ./run-local.sh            setup (if needed), start services, open admin panel
#   ./run-local.sh --down     stop all services
#
# Requirements: Node.js 20+, npm, python3, and a phone with WhatsApp for pairing.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="${1:-up}"

if [[ "$MODE" == "--down" || "$MODE" == "down" || "$MODE" == "stop" ]]; then
  echo "→ Stopping WAPI services..."
  python3 scripts/dev.py down
  echo "Done. All services stopped."
  exit 0
fi

echo ""
echo "┌──────────────────────────────────┐"
echo "│   WAPI — Local Runner            │"
echo "└──────────────────────────────────┘"
echo ""

# ── 1. Prerequisites ─────────────────────────────────────────────
command -v node >/dev/null 2>&1 || { echo "✗ Node.js not found. Install Node 20+: https://nodejs.org"; exit 1; }
command -v npm >/dev/null 2>&1  || { echo "✗ npm not found."; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "✗ python3 not found."; exit 1; }

# ── 2. Baileys engine ────────────────────────────────────────────
if [[ ! -f baileys/dist/server.js ]]; then
  echo "[1/4] Building baileys engine (npm install + build)..."
  (cd baileys && npm install && npm run build)
else
  echo "[1/4] baileys engine already built ✓"
fi

# ── 3. Python venv (fastapi + webhook receiver) ──────────────────
if [[ ! -x fastapi/.venv/bin/python ]]; then
  echo "[2/4] Creating Python virtualenv + installing deps..."
  python3 -m venv fastapi/.venv
  fastapi/.venv/bin/pip install -q --upgrade pip
  fastapi/.venv/bin/pip install -q -r fastapi/requirements.txt
  fastapi/.venv/bin/pip install -q -r webhook_receiver/requirements.txt
else
  echo "[2/4] Python venv ready ✓"
fi

# ── 4. Admin dashboard ───────────────────────────────────────────
if [[ ! -d dashboard/dist ]]; then
  echo "[3/4] Building admin dashboard (npm install + build)..."
  (cd dashboard && npm install && npm run build)
else
  echo "[3/4] Admin dashboard already built ✓"
fi

# ── 5. Start services ────────────────────────────────────────────
echo "[4/4] Starting services (baileys engine + API + webhook receiver)..."
python3 scripts/dev.py up

# ── 6. Wait for health, then open the admin panel ────────────────
echo "→ Waiting for services to become healthy..."
HEALTHY=0
for _ in $(seq 1 30); do
  if curl -sf http://localhost:2728/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 1
done

if [[ "$HEALTHY" != "1" ]]; then
  echo ""
  echo "✗ Services did not become healthy in time."
  echo "  → Inspect the logs:    python3 scripts/dev.py logs"
  echo "  → Check the status:    python3 scripts/dev.py status"
  exit 1
fi

echo ""
echo "✅  WAPI is running!"
echo ""
echo "    Admin panel : http://localhost:2728/admin"
echo "    API docs    : http://localhost:2728/docs"
echo "    Dev API key : local-test-key-123"
echo ""
echo "    → Enter the API key on the login page to open the dashboard."
echo "    → To add a WhatsApp number: click 'Add Session' and scan the QR."
echo ""

# Open the admin panel in the default browser.
if command -v open >/dev/null 2>&1; then
  open http://localhost:2728/admin || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:2728/admin >/dev/null 2>&1 || true
else
  echo "→ Open http://localhost:2728/admin in your browser."
fi
