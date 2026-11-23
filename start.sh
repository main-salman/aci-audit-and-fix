#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# start.sh — Starts or Restarts the Cisco ACI ChatOps-to-GitOps Application
# Automatically detects if the app is already running and restarts it cleanly.
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PID_FILE="$ROOT_DIR/.app.pid"
LOG_FILE="$ROOT_DIR/.app.log"

# Load APP_PORT from .env if configured, otherwise default to 3300
APP_PORT=3300
if [ -f "$ROOT_DIR/.env" ]; then
  ENV_PORT=$(grep -E '^APP_PORT=' "$ROOT_DIR/.env" | tail -n 1 | cut -d= -f2 | tr -d ' "\r' || true)
  if [ -n "$ENV_PORT" ]; then
    APP_PORT="$ENV_PORT"
  fi
fi

echo "=================================================================="
echo " Cisco ACI ChatOps-to-GitOps (Groq + MCP + Apache ECharts + OPA)"
echo "=================================================================="

# 1. If already running (by PID file or port), stop it first to perform a clean restart
EXISTING_PORT_PID=$(lsof -ti tcp:"$APP_PORT" 2>/dev/null || true)
if [ -f "$PID_FILE" ] || [ -n "$EXISTING_PORT_PID" ]; then
  echo "[start.sh] Existing instance detected on port $APP_PORT — restarting..."
  "$ROOT_DIR/stop.sh" || true
fi

# 2. Install node_modules if missing
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "[start.sh] Installing npm dependencies..."
  npm install
fi

# 3. Launch Next.js application in the background
echo "[start.sh] Launching application on http://localhost:$APP_PORT ..."
nohup npx next dev -p "$APP_PORT" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

# 4. Wait for port readiness
READY=0
for i in {1..30}; do
  if lsof -ti tcp:"$APP_PORT" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo "[start.sh] Application is RUNNING (PID: $NEW_PID)"
  echo "[start.sh] Dashboard URL: http://localhost:$APP_PORT"
  echo "[start.sh] Logs:          $LOG_FILE"
else
  echo "[start.sh] WARNING: Server process started (PID: $NEW_PID), still warming up. Check $LOG_FILE"
fi
