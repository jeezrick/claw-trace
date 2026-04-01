#!/usr/bin/env bash
set -euo pipefail

GITLAB_BASE_URL="${CLAW_TRACE_GITLAB_BASE_URL:-http://192.168.16.6}"
REPO="${CLAW_TRACE_REPO:-wonderful/claw-trace}"
BRANCH="${CLAW_TRACE_INSTALL_BRANCH:-main}"
RAW_URL="${GITLAB_BASE_URL%/}/$REPO/-/raw/$BRANCH/install.sh"

curl -fsSL "$RAW_URL" | env \
  CLAW_TRACE_INSTALL_SOURCE=gitlab \
  CLAW_TRACE_GITLAB_BASE_URL="${GITLAB_BASE_URL%/}" \
  CLAW_TRACE_REPO="$REPO" \
  bash -s -- "$@"
