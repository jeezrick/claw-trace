#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT_DIR/public/trace-service.tgz"

mkdir -p "$ROOT_DIR/public"
rm -f "$OUT"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$TMP_DIR/trace-service"
cp -r "$ROOT_DIR/public" "$TMP_DIR/trace-service/public"
cp "$ROOT_DIR/server.js" "$ROOT_DIR/run.sh" "$ROOT_DIR/package.json" "$ROOT_DIR/README.md" "$TMP_DIR/trace-service/"

rm -f "$TMP_DIR/trace-service/public/trace-service.tgz"

tar -C "$TMP_DIR" -czf "$OUT" trace-service

echo "Bundle generated: $OUT"
