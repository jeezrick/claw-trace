#!/usr/bin/env bash
set -euo pipefail

REPO="${CLAW_TRACE_REPO:-jeezrick/claw-trace}"
TAG="${1:-latest}"
INSTALL_DIR="${CLAW_TRACE_HOME:-$HOME/claw-trace}"
BIN_DIR="${CLAW_TRACE_BIN_DIR:-$HOME/.local/bin}"
EXISTING_CMD="$INSTALL_DIR/claw-trace"
WAS_RUNNING=0

if [[ "$TAG" == "latest" ]]; then
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

if [[ -z "$TAG" ]]; then
  echo "[claw-trace] failed to resolve release tag" >&2
  exit 1
fi

URL="https://github.com/$REPO/releases/download/$TAG/trace-service.tgz"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

retry_download() {
  local url="$1"
  local out="$2"
  local tries=8
  local i
  for i in $(seq 1 "$tries"); do
    if curl -fsSL "$url" -o "$out"; then
      return 0
    fi
    echo "[claw-trace] download failed (try $i/$tries), retry in 5s..." >&2
    sleep 5
  done
  return 1
}

install_runtime() {
  if ! command -v npm >/dev/null 2>&1; then
    echo "[claw-trace] npm is required to install runtime dependencies" >&2
    exit 1
  fi

  echo "[claw-trace] installing runtime dependencies for this machine"
  (
    cd "$INSTALL_DIR"
    npm ci --omit=dev --workspace @claw-trace/server --include-workspace-root=false
  )
}

echo "[claw-trace] downloading $URL"
retry_download "$URL" "$TMP_DIR/trace-service.tgz"
tar -xzf "$TMP_DIR/trace-service.tgz" -C "$TMP_DIR"

SRC="$TMP_DIR/trace-service"
if [[ ! -f "$SRC/claw-trace" ]]; then
  echo "[claw-trace] invalid package: claw-trace command missing" >&2
  exit 1
fi

if [[ ! -f "$SRC/package-lock.json" ]]; then
  echo "[claw-trace] invalid package: package-lock.json missing" >&2
  exit 1
fi

if [[ -x "$EXISTING_CMD" ]] && "$EXISTING_CMD" status 2>/dev/null | grep -q ' running '; then
  WAS_RUNNING=1
  echo "[claw-trace] existing service is running; stopping before reinstall"
  "$EXISTING_CMD" stop
fi

mkdir -p "$INSTALL_DIR" "$BIN_DIR" "$INSTALL_DIR/apps/server"
rm -rf \
  "$INSTALL_DIR/apps/server/dist" \
  "$INSTALL_DIR/apps/web/dist" \
  "$INSTALL_DIR/node_modules" \
  "$INSTALL_DIR/public" \
  "$INSTALL_DIR/server.js"
cp -a "$SRC/." "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/claw-trace" "$INSTALL_DIR/run.sh" || true
ln -sf "$INSTALL_DIR/claw-trace" "$BIN_DIR/claw-trace"

if [[ ! -f "$INSTALL_DIR/apps/server/dist/index.js" ]]; then
  echo "[claw-trace] backend runtime missing after install" >&2
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/apps/web/dist/index.html" ]]; then
  echo "[claw-trace] web assets missing after install" >&2
  exit 1
fi

install_runtime

if [[ ! -d "$INSTALL_DIR/node_modules/better-sqlite3" ]]; then
  echo "[claw-trace] runtime dependencies missing after install" >&2
  exit 1
fi

if [[ "$WAS_RUNNING" == "1" ]]; then
  echo "[claw-trace] restarting service on the freshly installed version"
  "$INSTALL_DIR/claw-trace" start
fi

echo "[claw-trace] installed to $INSTALL_DIR"
echo "[claw-trace] command linked: $BIN_DIR/claw-trace"
echo "[claw-trace] if command not found, add to PATH: export PATH=\"$BIN_DIR:\$PATH\""
echo "[claw-trace] start service: claw-trace start"
