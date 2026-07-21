#!/usr/bin/env bash
# Launch Home Hub from the repo root (Pi or Mac).
# Usage:
#   ./start.sh
#   ./start.sh --bg          # background with nohup
#   KAP_WATCHLIST=THYAO ./start.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BG=0
if [[ "${1:-}" == "--bg" || "${1:-}" == "-d" ]]; then
  BG=1
fi

# Optional local overrides (gitignored)
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

# Defaults (same-machine Pi + pi-llm)
export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
export KAP_LANGUAGE="${KAP_LANGUAGE:-tr}"
export KAP_PROMPT_PATH="${KAP_PROMPT_PATH:-../pi-llm/prompts/kap_sentiment.txt}"
# KAP_WATCHLIST — set in .env, e.g. THYAO,ASELS

mkdir -p "$ROOT/logs" "$ROOT/data"

if [[ ! -d "$ROOT/node_modules" ]]; then
  echo "[start] Installing dependencies..."
  npm install
fi

# Free port 3000 if a stale home-hub is still bound
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${PIDS}" ]]; then
    echo "[start] Port 3000 in use — stopping: ${PIDS}"
    # shellcheck disable=SC2086
    kill ${PIDS} 2>/dev/null || true
    sleep 1
  fi
fi

echo "[start] OLLAMA_BASE_URL=${OLLAMA_BASE_URL}"
echo "[start] OLLAMA_MODEL=${OLLAMA_MODEL}"
echo "[start] KAP_WATCHLIST=${KAP_WATCHLIST:-"(not set)"}"
echo "[start] KAP_LANGUAGE=${KAP_LANGUAGE}"
echo "[start] http://0.0.0.0:3000  (or http://ev.local )"

if [[ "$BG" -eq 1 ]]; then
  nohup npm start >>"$ROOT/logs/server.out" 2>&1 &
  echo "[start] Background PID $!  — logs: logs/server.out"
  echo "[start] Stop with: kill $!"
else
  exec npm start
fi
