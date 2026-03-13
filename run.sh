#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8787}"
export HOST="${HOST:-0.0.0.0}"
export SESSIONS_DIR="${SESSIONS_DIR:-/root/.openclaw/agents/main/sessions}"
export RAW_STREAM_FILE="${RAW_STREAM_FILE:-$HOME/.openclaw/logs/raw-stream.jsonl}"
export DATABASE_FILE="${DATABASE_FILE:-$ROOT_DIR/apps/server/data/claw-trace-v2.sqlite}"

exec node "$ROOT_DIR/apps/server/dist/index.js"
