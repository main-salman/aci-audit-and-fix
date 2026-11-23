#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# stop.sh — Cleanly stops the Cisco ACI ChatOps-to-GitOps Application
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/.app.pid"

APP_PORT=3300
if [ -f "$ROOT_DIR/.env" ]; then
  ENV_PORT=$(grep -E '^APP_PORT=' "$ROOT_DIR/.env" | tail -n 1 | cut -d= -f2 | tr -d ' "\r' || true)
  if [ -n "$ENV_PORT" ]; then
    APP_PORT="$ENV_PORT"
  fi
fi

STOPPED=0

# 1. Stop by PID file if present
if [ -f "$PID_FILE" ]; then
  TARGET_PID=$(cat "$PID_FILE" || true)
  if [ -n "$TARGET_PID" ] && kill -0 "$TARGET_PID" 2>/dev/null; then
    echo "[stop.sh] Stopping process PID $TARGET_PID..."
    kill "$TARGET_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$TARGET_PID" 2>/dev/null || true
    STOPPED=1
  fi
  rm -f "$PID_FILE"
fi

# 2. Also ensure any child process bound to APP_PORT is terminated
PORT_PIDS=$(lsof -ti tcp:"$APP_PORT" 2>/dev/null || true)
if [ -n "$PORT_PIDS" ]; then
  echo "[stop.sh] Releasing port $APP_PORT (PIDs: $PORT_PIDS)..."
  for pid in $PORT_PIDS; do
    kill "$pid" 2>/dev/null || true
    sleep 0.5
    kill -9 "$pid" 2>/dev/null || true
  done
  STOPPED=1
fi

if [ "$STOPPED" -eq 1 ]; then
  echo "[stop.sh] Application stopped cleanly."
else
  echo "[stop.sh] No running instance found on port $APP_PORT."
fi
