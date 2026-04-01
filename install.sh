#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="jeezrick/claw-trace"
INSTALL_SOURCE="${CLAW_TRACE_INSTALL_SOURCE:-github}"
REPO="${CLAW_TRACE_REPO:-$DEFAULT_REPO}"
GITLAB_BASE_URL="${CLAW_TRACE_GITLAB_BASE_URL:-}"
GITLAB_PACKAGE_NAME="${CLAW_TRACE_GITLAB_PACKAGE_NAME:-claw-trace}"
PROJECT_NAME="${REPO##*/}"
TAG="${1:-latest}"
INSTALL_DIR="${CLAW_TRACE_HOME:-$HOME/claw-trace}"
BIN_DIR="${CLAW_TRACE_BIN_DIR:-$HOME/.local/bin}"
EXISTING_CMD="$INSTALL_DIR/claw-trace"
WAS_RUNNING=0

path_has_bin_dir() {
  case ":${PATH:-}:" in
    *":$BIN_DIR:"*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

append_line_once() {
  local file="$1"
  local line="$2"

  mkdir -p "$(dirname "$file")"
  touch "$file"

  if ! grep -Fqx "$line" "$file" 2>/dev/null; then
    printf '\n%s\n' "$line" >> "$file"
  fi
}

ensure_shell_path() {
  local line="export PATH=\"$BIN_DIR:\$PATH\""
  local shell_name="$(basename "${SHELL:-}")"
  local targets=("$HOME/.profile")

  case "$shell_name" in
    bash)
      targets+=("$HOME/.bashrc" "$HOME/.bash_profile")
      ;;
    zsh)
      targets+=("$HOME/.zshrc" "$HOME/.zprofile")
      ;;
    *)
      if [[ -f "$HOME/.bashrc" ]]; then
        targets+=("$HOME/.bashrc")
      fi
      if [[ -f "$HOME/.bash_profile" ]]; then
        targets+=("$HOME/.bash_profile")
      fi
      if [[ -f "$HOME/.zshrc" ]]; then
        targets+=("$HOME/.zshrc")
      fi
      if [[ -f "$HOME/.zprofile" ]]; then
        targets+=("$HOME/.zprofile")
      fi
      ;;
  esac

  local file
  for file in "${targets[@]}"; do
    append_line_once "$file" "$line"
  done
}

repo_api_path() {
  printf '%s' "${REPO//\//%2F}"
}

normalize_gitlab_base_url() {
  GITLAB_BASE_URL="${GITLAB_BASE_URL%/}"
}

gitlab_bundle_url() {
  local tag="$1"
  normalize_gitlab_base_url
  printf '%s/api/v4/projects/%s/packages/generic/%s/%s/trace-service.tgz' \
    "$GITLAB_BASE_URL" \
    "$(repo_api_path)" \
    "$GITLAB_PACKAGE_NAME" \
    "$tag"
}

latest_tag() {
  case "$INSTALL_SOURCE" in
    github)
      curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep -m1 '"tag_name"' \
        | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/'
      ;;
    gitlab)
      if [[ -z "$GITLAB_BASE_URL" ]]; then
        echo "[claw-trace] CLAW_TRACE_GITLAB_BASE_URL is required when CLAW_TRACE_INSTALL_SOURCE=gitlab" >&2
        exit 1
      fi
      normalize_gitlab_base_url
      curl -fsSL "$GITLAB_BASE_URL/api/v4/projects/$(repo_api_path)/repository/tags?per_page=1" \
        | grep -o '"name":"[^"]*"' \
        | head -n1 \
        | sed -E 's/"name":"([^"]*)"/\1/'
      ;;
    *)
      echo "[claw-trace] unsupported install source: $INSTALL_SOURCE" >&2
      exit 1
      ;;
  esac
}

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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

write_install_source_file() {
  {
    printf 'SAVED_CLAW_TRACE_INSTALL_SOURCE=%q\n' "$INSTALL_SOURCE"
    printf 'SAVED_CLAW_TRACE_REPO=%q\n' "$REPO"
    printf 'SAVED_CLAW_TRACE_GITLAB_BASE_URL=%q\n' "${GITLAB_BASE_URL%/}"
    printf 'SAVED_CLAW_TRACE_GITLAB_PACKAGE_NAME=%q\n' "$GITLAB_PACKAGE_NAME"
  } > "$INSTALL_DIR/.install-source.env"
}

load_node_runtime() {
  # Load nvm directly so non-interactive installs can still find node/npm.
  # Sourcing ~/.bashrc is not enough on many machines because it returns early
  # when PS1 is empty.
  # shellcheck source=/dev/null
  [[ -s "$HOME/.nvm/nvm.sh" ]] && source "$HOME/.nvm/nvm.sh"
}

install_runtime() {
  load_node_runtime

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

if [[ "$TAG" == "latest" ]]; then
  TAG="$(latest_tag)"
fi

if [[ -z "$TAG" ]]; then
  echo "[claw-trace] failed to resolve release tag" >&2
  exit 1
fi

case "$INSTALL_SOURCE" in
  github)
    URL="https://github.com/$REPO/releases/download/$TAG/trace-service.tgz"
    echo "[claw-trace] downloading $URL"
    retry_download "$URL" "$TMP_DIR/trace-service.tgz"
    ;;
  gitlab)
    if [[ -z "$GITLAB_BASE_URL" ]]; then
      echo "[claw-trace] CLAW_TRACE_GITLAB_BASE_URL is required when CLAW_TRACE_INSTALL_SOURCE=gitlab" >&2
      exit 1
    fi
    URL="$(gitlab_bundle_url "$TAG")"
    echo "[claw-trace] downloading $URL"
    retry_download "$URL" "$TMP_DIR/trace-service.tgz"
    ;;
  *)
    echo "[claw-trace] unsupported install source: $INSTALL_SOURCE" >&2
    exit 1
    ;;
esac

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
write_install_source_file

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

SYSTEMD_MODE=""
if SYSTEMD_OUTPUT="$($INSTALL_DIR/claw-trace setup-service --auto 2>&1)"; then
  echo "$SYSTEMD_OUTPUT"
  SYSTEMD_MODE="$($INSTALL_DIR/claw-trace service-mode 2>/dev/null || true)"
else
  echo "$SYSTEMD_OUTPUT"
fi

# Always write the PATH export to shell startup files so that new login sessions
# (e.g. fresh SSH connections) can find the claw-trace command without manual setup.
ensure_shell_path

if [[ "$WAS_RUNNING" == "1" ]]; then
  echo "[claw-trace] restarting service on the freshly installed version"
  "$INSTALL_DIR/claw-trace" start
fi

echo "[claw-trace] installed to $INSTALL_DIR"
echo "[claw-trace] command linked: $BIN_DIR/claw-trace"
if [[ -n "$SYSTEMD_MODE" ]] && [[ "$SYSTEMD_MODE" != "nohup" ]]; then
  echo "[claw-trace] service manager: systemd-$SYSTEMD_MODE"
  echo "[claw-trace] enabled for auto-start on reboot"
else
  echo "[claw-trace] service manager: nohup fallback"
fi
if path_has_bin_dir; then
  echo "[claw-trace] start service: claw-trace start"
else
  echo "[claw-trace] added $BIN_DIR to common shell startup files for future terminals"
  echo "[claw-trace] start service now: $INSTALL_DIR/claw-trace start"
  echo "[claw-trace] after opening a new terminal, you can also run: claw-trace start"
fi
