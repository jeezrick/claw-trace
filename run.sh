#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PORT="${PORT:-8787}"
export HOST="${HOST:-0.0.0.0}"
export SESSIONS_DIR="${SESSIONS_DIR:-/root/.openclaw/agents/main/sessions}"

exec node "$ROOT_DIR/server.js"
