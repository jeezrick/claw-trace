#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT_DIR/public/trace-service.tgz"

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
cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$ROOT_DIR/run.sh" "$ROOT_DIR/README.md" "$ROOT_DIR/VERSION" "$ROOT_DIR/claw-trace" "$ROOT_DIR/install.sh" "$TMP_DIR/trace-service/"

cd "$TMP_DIR/trace-service"
npm ci --omit=dev --workspace @claw-trace/server --include-workspace-root=false >/dev/null
rm -f package-lock.json

tar -C "$TMP_DIR" -czf "$OUT" trace-service

echo "Bundle generated: $OUT"
