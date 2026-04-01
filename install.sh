#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="jeezrick/claw-trace"
INSTALL_SOURCE="${CLAW_TRACE_INSTALL_SOURCE:-github}"
INSTALL_SERVICE_MODE="${CLAW_TRACE_INSTALL_SERVICE_MODE:-nohup}"
START_AFTER_INSTALL="${CLAW_TRACE_START_AFTER_INSTALL:-1}"
REPO="${CLAW_TRACE_REPO:-$DEFAULT_REPO}"
GITLAB_BASE_URL="${CLAW_TRACE_GITLAB_BASE_URL:-}"
GITLAB_PACKAGE_NAME="${CLAW_TRACE_GITLAB_PACKAGE_NAME:-claw-trace}"
NODE_VERSION_FALLBACK="${CLAW_TRACE_NODE_VERSION:-20}"
OPENCLAW_HOME="${CLAW_TRACE_OPENCLAW_HOME:-$HOME/.openclaw}"
OPENCLAW_DOCTOR_PLUGIN_ID="claw-trace-doctor-plugin"
OPENCLAW_DOCTOR_WITH_AI="${CLAW_TRACE_DOCTOR_WITH_AI:-0}"
PROJECT_NAME="${REPO##*/}"
TAG="${1:-latest}"
INSTALL_DIR="${CLAW_TRACE_HOME:-$HOME/claw-trace}"
BIN_DIR="${CLAW_TRACE_BIN_DIR:-$HOME/.local/bin}"
EXISTING_CMD="$INSTALL_DIR/claw-trace"
SYSTEMCTL_BIN="${CLAW_TRACE_SYSTEMCTL_BIN:-systemctl}"
SERVICE_NAME="${CLAW_TRACE_SERVICE_NAME:-claw-trace.service}"
SYSTEM_UNIT_PATH="${CLAW_TRACE_SYSTEMD_SYSTEM_UNIT_PATH:-/etc/systemd/system/$SERVICE_NAME}"
USER_UNIT_DIR="${CLAW_TRACE_SYSTEMD_USER_UNIT_DIR:-$HOME/.config/systemd/user}"
USER_UNIT_PATH="$USER_UNIT_DIR/$SERVICE_NAME"
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

current_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return 0
  fi

  node -p 'const major = Number.parseInt(process.versions.node.split(".")[0], 10); Number.isFinite(major) ? major : 0' 2>/dev/null || echo 0
}

use_fallback_node_version() {
  load_node_runtime

  if ! command -v nvm >/dev/null 2>&1; then
    return 1
  fi

  echo "[claw-trace] switching to Node ${NODE_VERSION_FALLBACK} via nvm"

  if ! nvm use "$NODE_VERSION_FALLBACK" >/dev/null 2>&1; then
    echo "[claw-trace] installing Node ${NODE_VERSION_FALLBACK} via nvm"
    nvm install "$NODE_VERSION_FALLBACK" >/dev/null
    nvm use "$NODE_VERSION_FALLBACK" >/dev/null
  fi

  hash -r
  return 0
}

ensure_supported_node_runtime() {
  load_node_runtime

  local major
  major="$(current_node_major)"

  if command -v npm >/dev/null 2>&1 && [[ "$major" -ge 18 ]] && [[ "$major" -le 22 ]]; then
    return 0
  fi

  if ! use_fallback_node_version; then
    if ! command -v npm >/dev/null 2>&1; then
      echo "[claw-trace] npm is required to install runtime dependencies" >&2
      exit 1
    fi

    echo "[claw-trace] unsupported Node version $(node -v 2>/dev/null || echo unknown); please switch to Node 18/20/22 or install nvm" >&2
    exit 1
  fi

  major="$(current_node_major)"
  if ! command -v npm >/dev/null 2>&1 || [[ "$major" -lt 18 ]] || [[ "$major" -gt 22 ]]; then
    echo "[claw-trace] failed to activate a supported Node runtime" >&2
    exit 1
  fi
}

gitlab_package_exists() {
  local url="$1"
  local status

  status="$(curl -sSIL -o /dev/null -w '%{http_code}' "$url" || true)"
  [[ "$status" == "200" || "$status" == "302" ]]
}

prepare_gitlab_bundle() {
  local ref="$1"
  local out="$2"
  local package_url archive archive_url src_root src_dir

  if [[ -z "$GITLAB_BASE_URL" ]]; then
    echo "[claw-trace] CLAW_TRACE_GITLAB_BASE_URL is required when CLAW_TRACE_INSTALL_SOURCE=gitlab" >&2
    exit 1
  fi

  package_url="$(gitlab_bundle_url "$ref")"

  if gitlab_package_exists "$package_url"; then
    echo "[claw-trace] downloading $package_url"
    retry_download "$package_url" "$out"
    return 0
  fi

  echo "[claw-trace] GitLab package is not available yet; falling back to source build"
  ensure_supported_node_runtime

  archive="$TMP_DIR/${PROJECT_NAME}-${ref}.tar.gz"
  src_dir="$TMP_DIR/gitlab-source"

  normalize_gitlab_base_url
  archive_url="$GITLAB_BASE_URL/$REPO/-/archive/$ref/$PROJECT_NAME-$ref.tar.gz"

  echo "[claw-trace] downloading $archive_url"
  retry_download "$archive_url" "$archive"

  mkdir -p "$src_dir"
  tar -xzf "$archive" -C "$src_dir"
  src_root="$(find "$src_dir" -mindepth 1 -maxdepth 1 -type d | head -n1)"

  if [[ -z "$src_root" ]] || [[ ! -f "$src_root/build-bundle.sh" ]]; then
    echo "[claw-trace] invalid GitLab source archive: build-bundle.sh missing" >&2
    exit 1
  fi

  echo "[claw-trace] building bundle from GitLab source $ref"
  (
    cd "$src_root"
    npm ci --ignore-scripts >/dev/null
    npm run v2:build >/dev/null
  )

  local bundle_root="$TMP_DIR/gitlab-bundle"
  mkdir -p "$bundle_root/trace-service/apps/server" "$bundle_root/trace-service/apps/web"
  cp -r "$src_root/apps/server/dist" "$bundle_root/trace-service/apps/server/dist"
  cp -r "$src_root/apps/web/dist" "$bundle_root/trace-service/apps/web/dist"
  if [[ -d "$src_root/openclaw-plugin" ]]; then
    cp -r "$src_root/openclaw-plugin" "$bundle_root/trace-service/openclaw-plugin"
  fi
  cp "$src_root/apps/server/package.json" "$bundle_root/trace-service/apps/server/package.json"
  cp "$src_root/package.json" "$src_root/package-lock.json" "$src_root/run.sh" "$src_root/README.md" "$src_root/VERSION" "$src_root/claw-trace" "$src_root/install.sh" "$bundle_root/trace-service/"

  if [[ -f "$src_root/install-github.sh" ]]; then
    cp "$src_root/install-github.sh" "$bundle_root/trace-service/install-github.sh"
  fi

  if [[ -f "$src_root/install-gitlab.sh" ]]; then
    cp "$src_root/install-gitlab.sh" "$bundle_root/trace-service/install-gitlab.sh"
  fi

  tar -C "$bundle_root" -czf "$out" trace-service
}

install_runtime() {
  ensure_supported_node_runtime

  echo "[claw-trace] installing runtime dependencies for this machine"
  (
    cd "$INSTALL_DIR"
    npm ci --omit=dev --workspace @claw-trace/server --include-workspace-root=false
  )
}

inject_openclaw_doctor_plugin() {
  local openclaw_config="$OPENCLAW_HOME/openclaw.json"
  local template_dir="$INSTALL_DIR/openclaw-plugin/$OPENCLAW_DOCTOR_PLUGIN_ID"
  local plugin_dir="$OPENCLAW_HOME/extensions/$OPENCLAW_DOCTOR_PLUGIN_ID"
  local doctor_command="$INSTALL_DIR/claw-trace"
  local version_no_v
  local escaped_command

  if [[ ! -f "$openclaw_config" ]]; then
    return 0
  fi

  if [[ ! -d "$template_dir" ]]; then
    echo "[claw-trace] OpenClaw doctor plugin template missing at $template_dir" >&2
    return 1
  fi

  ensure_supported_node_runtime

  version_no_v="${TAG#v}"
  escaped_command="$(printf '%s' "$doctor_command" | sed 's/[\\/&]/\\&/g')"

  mkdir -p "$plugin_dir"
  cp "$template_dir/openclaw.plugin.json" "$plugin_dir/openclaw.plugin.json"
  sed \
    -e "s/__CLAW_TRACE_VERSION__/$version_no_v/g" \
    "$template_dir/package.json" > "$plugin_dir/package.json"
  sed \
    -e "s/__CLAW_TRACE_COMMAND__/$escaped_command/g" \
    -e "s/__CLAW_TRACE_WITH_AI__/$OPENCLAW_DOCTOR_WITH_AI/g" \
    "$template_dir/index.js" > "$plugin_dir/index.js"

  node - "$openclaw_config" "$OPENCLAW_DOCTOR_PLUGIN_ID" "$plugin_dir" "$version_no_v" <<'NODE'
const fs = require('fs');

const [configPath, pluginId, pluginDir, version] = process.argv.slice(2);
const now = new Date().toISOString();
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

config.plugins = config.plugins ?? {};
config.plugins.entries = config.plugins.entries ?? {};
config.plugins.installs = config.plugins.installs ?? {};
config.plugins.allow = Array.isArray(config.plugins.allow) ? config.plugins.allow : [];

const prevEntry = config.plugins.entries[pluginId] ?? {};
config.plugins.entries[pluginId] = {
  ...prevEntry,
  enabled: true,
};

const prevInstall = config.plugins.installs[pluginId] ?? {};
config.plugins.installs[pluginId] = {
  source: 'path',
  spec: pluginDir,
  installPath: pluginDir,
  version,
  resolvedName: pluginId,
  resolvedVersion: version,
  resolvedSpec: pluginDir,
  resolvedAt: prevInstall.resolvedAt ?? now,
  installedAt: now,
};

if (!config.plugins.allow.includes(pluginId)) {
  config.plugins.allow.push(pluginId);
}

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

  echo "[claw-trace] injected OpenClaw plugin: $plugin_dir"
}

restart_openclaw_gateway() {
  local openclaw_config="$OPENCLAW_HOME/openclaw.json"

  if [[ ! -f "$openclaw_config" ]]; then
    return 0
  fi

  if ! command -v openclaw >/dev/null 2>&1; then
    echo "[claw-trace] openclaw command not found; skip gateway restart" >&2
    return 1
  fi

  if openclaw gateway restart >/dev/null 2>&1; then
    echo "[claw-trace] restarted OpenClaw gateway to load /doctor"
    return 0
  fi

  echo "[claw-trace] failed to restart OpenClaw gateway automatically; restart it manually to load /doctor" >&2
  return 1
}

cleanup_systemd_units() {
  local reloaded=0

  if command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1; then
    "$SYSTEMCTL_BIN" stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    "$SYSTEMCTL_BIN" disable "$SERVICE_NAME" >/dev/null 2>&1 || true
  fi

  if [[ -f "$SYSTEM_UNIT_PATH" ]]; then
    rm -f "$SYSTEM_UNIT_PATH"
    reloaded=1
  fi

  if [[ -f "$USER_UNIT_PATH" ]]; then
    rm -f "$USER_UNIT_PATH"
    reloaded=1
  fi

  if [[ "$reloaded" == "1" ]] && command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1; then
    "$SYSTEMCTL_BIN" daemon-reload >/dev/null 2>&1 || true
    "$SYSTEMCTL_BIN" --user daemon-reload >/dev/null 2>&1 || true
  fi
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
    prepare_gitlab_bundle "$TAG" "$TMP_DIR/trace-service.tgz"
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

inject_openclaw_doctor_plugin
restart_openclaw_gateway || true

if [[ ! -d "$INSTALL_DIR/node_modules/better-sqlite3" ]]; then
  echo "[claw-trace] runtime dependencies missing after install" >&2
  exit 1
fi

SYSTEMD_MODE=""
case "$INSTALL_SERVICE_MODE" in
  nohup)
    cleanup_systemd_units
    ;;
  auto|system|user)
    if SYSTEMD_OUTPUT="$($INSTALL_DIR/claw-trace setup-service --$INSTALL_SERVICE_MODE 2>&1)"; then
      echo "$SYSTEMD_OUTPUT"
      SYSTEMD_MODE="$($INSTALL_DIR/claw-trace service-mode 2>/dev/null || true)"
    else
      echo "$SYSTEMD_OUTPUT"
    fi
    ;;
  *)
    echo "[claw-trace] unsupported install service mode: $INSTALL_SERVICE_MODE" >&2
    exit 1
    ;;
esac

# Always write the PATH export to shell startup files so that new login sessions
# (e.g. fresh SSH connections) can find the claw-trace command without manual setup.
ensure_shell_path

if [[ "$START_AFTER_INSTALL" == "1" ]]; then
  if [[ "$WAS_RUNNING" == "1" ]]; then
    echo "[claw-trace] restarting service on the freshly installed version"
  else
    echo "[claw-trace] starting service"
  fi
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
