#!/usr/bin/env bash
# Smoke-check Home Hub HTTP endpoints (health + version).
set -euo pipefail

BASE_URL="${HOMEHUB_URL:-http://127.0.0.1:3000}"
BASE_URL="${BASE_URL%/}"

fail() {
  echo "smoke-check failed: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

need_cmd curl

echo "Checking ${BASE_URL}/api/health"
health="$(curl -fsS --max-time 5 "${BASE_URL}/api/health")" || fail "GET /api/health"
echo "${health}" | grep -q '"ok":true' || fail "/api/health missing ok:true"
echo "${health}" | grep -q '"status":"ok"' || fail "/api/health missing status:ok"

echo "Checking ${BASE_URL}/api/version"
version="$(curl -fsS --max-time 5 "${BASE_URL}/api/version")" || fail "GET /api/version"
echo "${version}" | grep -q '"buildId"' || fail "/api/version missing buildId"

echo "smoke-check ok"
