#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT_DIR/public/trace-service.tgz"

VERSION_FILE="$(tr -d '\r\n' < "$ROOT_DIR/VERSION")"

if [[ -z "$VERSION_FILE" ]]; then
  echo "[build-bundle] VERSION file is empty or missing" >&2
  exit 1
fi

mkdir -p "$ROOT_DIR/public"
rm -f "$OUT"

npm ci >/dev/null
npm run v2:build >/dev/null

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/trace-service/apps/server" "$TMP_DIR/trace-service/apps/web"
cp -r "$ROOT_DIR/apps/server/dist" "$TMP_DIR/trace-service/apps/server/dist"
cp -r "$ROOT_DIR/apps/web/dist" "$TMP_DIR/trace-service/apps/web/dist"
cp "$ROOT_DIR/apps/server/package.json" "$TMP_DIR/trace-service/apps/server/package.json"
cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/run.sh" "$ROOT_DIR/README.md" "$ROOT_DIR/VERSION" "$ROOT_DIR/claw-trace" "$ROOT_DIR/install.sh" "$ROOT_DIR/install-github.sh" "$ROOT_DIR/install-gitlab.sh" "$TMP_DIR/trace-service/"

tar -C "$TMP_DIR" -czf "$OUT" trace-service

echo "Bundle generated: $OUT"
