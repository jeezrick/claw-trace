#!/usr/bin/env bash
set -euo pipefail

REPO="${CLAW_TRACE_REPO:-jeezrick/claw-trace}"
BRANCH="${CLAW_TRACE_INSTALL_BRANCH:-main}"
RAW_URL="https://raw.githubusercontent.com/$REPO/$BRANCH/install.sh"

curl -fsSL "$RAW_URL" | env \
  CLAW_TRACE_INSTALL_SOURCE=github \
  CLAW_TRACE_REPO="$REPO" \
  bash -s -- "$@"
