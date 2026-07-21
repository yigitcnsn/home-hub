#!/usr/bin/env bash
# Launch Home Hub from the repo root (Pi or Mac).
#
# Usage:
#   ./start.sh              # foreground
#   ./start.sh --bg         # background once
#   ./start.sh --watch      # auto git fetch/pull + restart (home deploy)
#   ./start.sh --watch --bg # watch loop in background
#
# Env:
#   HOMEHUB_WATCH_SECONDS=60   # poll interval for --watch (default 60)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

BG=0
WATCH=0
for arg in "$@"; do
  case "$arg" in
    --bg|-d) BG=1 ;;
    --watch|-w) WATCH=1 ;;
  esac
done

WATCH_SECONDS="${HOMEHUB_WATCH_SECONDS:-60}"
NODE_PID=""
LOG_FILE="$ROOT/logs/server.out"
PULL_FLAG="$ROOT/data/pull-now.flag"

load_env() {
  if [[ -f "$ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT/.env"
    set +a
  fi
  export OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
  export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:3b}"
  export KAP_LANGUAGE="${KAP_LANGUAGE:-tr}"
  export KAP_PROMPT_PATH="${KAP_PROMPT_PATH:-../pi-llm/prompts/kap_sentiment.txt}"
}

ensure_deps() {
  if [[ ! -d "$ROOT/node_modules" ]]; then
    echo "[start] Installing dependencies..."
    npm install
  fi
}

free_port() {
  if command -v lsof >/dev/null 2>&1; then
    local PIDS
    PIDS="$(lsof -ti tcp:3000 -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${PIDS}" ]]; then
      echo "[start] Port 3000 in use — stopping: ${PIDS}"
      # shellcheck disable=SC2086
      kill ${PIDS} 2>/dev/null || true
      sleep 1
      # shellcheck disable=SC2086
      kill -9 ${PIDS} 2>/dev/null || true
    fi
  fi
}

stop_node() {
  if [[ -n "${NODE_PID}" ]] && kill -0 "${NODE_PID}" 2>/dev/null; then
    echo "[start] Stopping Node PID ${NODE_PID}"
    kill "${NODE_PID}" 2>/dev/null || true
    wait "${NODE_PID}" 2>/dev/null || true
  fi
  NODE_PID=""
  free_port
}

start_node() {
  free_port
  echo "[start] OLLAMA_BASE_URL=${OLLAMA_BASE_URL}"
  echo "[start] OLLAMA_MODEL=${OLLAMA_MODEL}"
  echo "[start] KAP_WATCHLIST=${KAP_WATCHLIST:-"(not set)"}"
  echo "[start] KAP_LANGUAGE=${KAP_LANGUAGE}"
  echo "[start] http://0.0.0.0:3000  (or http://ev.local )"

  if [[ "$WATCH" -eq 1 || "$BG" -eq 1 ]]; then
    nohup npm start >>"$LOG_FILE" 2>&1 &
    NODE_PID=$!
    echo "[start] Node PID ${NODE_PID} — logs: logs/server.out"
  else
    exec npm start
  fi
}

remote_ahead() {
  # Returns 0 if origin has commits we don't (safe to ff-only pull)
  git rev-parse --abbrev-ref HEAD >/dev/null 2>&1 || return 1
  local branch remote behind
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  remote="origin/${branch}"

  git fetch origin --prune >/dev/null 2>&1 || {
    echo "[watch] git fetch failed (will retry)"
    return 1
  }

  if ! git rev-parse --verify "$remote" >/dev/null 2>&1; then
    echo "[watch] remote branch ${remote} not found"
    return 1
  fi

  behind="$(git rev-list --count HEAD.."$remote" 2>/dev/null || echo 0)"
  [[ "${behind}" -gt 0 ]]
}

pull_update() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
  echo "[watch] Update found on origin/${branch} — pulling"
  if ! git pull --ff-only origin "$branch"; then
    echo "[watch] git pull --ff-only failed — leaving current build running"
    return 1
  fi
  # Refresh deps if lock/package changed (safe even if unchanged)
  npm install --no-fund --no-audit >/dev/null 2>&1 || npm install
  return 0
}

wait_for_tick() {
  # Sleep up to WATCH_SECONDS, but wake early if UI requested an update
  local remaining="$WATCH_SECONDS"
  while [[ "$remaining" -gt 0 ]]; do
    if [[ -f "$PULL_FLAG" ]]; then
      echo "[watch] Update requested from UI"
      return 0
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  return 0
}

consume_pull_flag() {
  if [[ -f "$PULL_FLAG" ]]; then
    rm -f "$PULL_FLAG"
    return 0
  fi
  return 1
}

run_update_cycle() {
  local forced=0
  if consume_pull_flag; then
    forced=1
  fi

  if remote_ahead; then
    stop_node
    if pull_update; then
      load_env
      start_node
      echo "[watch] Restarted on $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    else
      start_node
    fi
  else
    if [[ "$forced" -eq 1 ]]; then
      echo "[watch] Already up to date — no pull needed"
    fi
    if [[ -n "${NODE_PID}" ]] && ! kill -0 "${NODE_PID}" 2>/dev/null; then
      echo "[watch] Node died — restarting"
      start_node
    fi
  fi
}

cleanup() {
  echo "[start] Shutting down..."
  stop_node
  exit 0
}

mkdir -p "$ROOT/logs" "$ROOT/data"
load_env
ensure_deps

if [[ "$WATCH" -eq 1 ]]; then
  trap cleanup INT TERM

  echo "[watch] Auto-update enabled (every ${WATCH_SECONDS}s, or via Update button)"
  echo "[watch] Pi should stay clean — no local commits/edits"

  if [[ "$BG" -eq 1 ]]; then
    # Re-enter watch in background without --bg to avoid recursion weirdness
    nohup "$ROOT/start.sh" --watch >>"$ROOT/logs/watch.out" 2>&1 &
    echo "[watch] Supervisor PID $! — logs: logs/watch.out"
    exit 0
  fi

  start_node

  while true; do
    wait_for_tick
    run_update_cycle
  done
fi

# Non-watch modes
if [[ "$BG" -eq 1 ]]; then
  start_node
  echo "[start] Stop with: kill ${NODE_PID}"
else
  free_port
  echo "[start] OLLAMA_BASE_URL=${OLLAMA_BASE_URL}"
  echo "[start] OLLAMA_MODEL=${OLLAMA_MODEL}"
  echo "[start] KAP_WATCHLIST=${KAP_WATCHLIST:-"(not set)"}"
  echo "[start] KAP_LANGUAGE=${KAP_LANGUAGE}"
  echo "[start] http://0.0.0.0:3000  (or http://ev.local )"
  exec npm start
fi
