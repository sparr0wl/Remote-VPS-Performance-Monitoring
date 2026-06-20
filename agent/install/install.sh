#!/usr/bin/env bash
set -euo pipefail

BIN_NAME="vps-monitor-agent"
BIN_TARGET="/usr/local/bin/${BIN_NAME}"
CONFIG_DIR="/etc/vps-monitor"
CONFIG_TARGET="${CONFIG_DIR}/config.yaml"
SERVICE_TARGET="/etc/systemd/system/vps-monitor-agent.service"
BACKUP_DIR="/var/backups/vps-monitor"

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_SOURCE="${1:-${SOURCE_ROOT}/bin/${BIN_NAME}}"

usage() {
  cat <<EOF
Usage: sudo ./install/install.sh [path-to-vps-monitor-agent]

If no binary path is provided, the script uses ${SOURCE_ROOT}/bin/${BIN_NAME}.
If that file does not exist and Go is installed, the script builds it automatically.
EOF
}

need_root() {
  if [ "${EUID}" -ne 0 ]; then
    echo "Run this installer as root: sudo ./install/install.sh" >&2
    exit 1
  fi
}

is_installed_and_running() {
  [ -x "${BIN_TARGET}" ] && systemctl is-active --quiet vps-monitor-agent.service
}

generate_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 64
}

build_binary_if_needed() {
  if [ -f "${BIN_SOURCE}" ]; then
    return
  fi

  if ! command -v go >/dev/null 2>&1; then
    echo "Agent binary not found: ${BIN_SOURCE}" >&2
    echo "Go is not installed, so the installer cannot build it automatically." >&2
    usage
    exit 1
  fi

  echo "Agent binary not found, building it with Go..."
  mkdir -p "${SOURCE_ROOT}/bin"
  (cd "${SOURCE_ROOT}" && go build -o "${BIN_SOURCE}" ./cmd/vps-agent)
}

pick_file() {
  local title="$1"
  shift
  local candidates=()
  local path

  shopt -s nullglob
  for path in "$@"; do
    if [ -f "${path}" ]; then
      candidates+=("${path}")
    fi
  done
  shopt -u nullglob

  if [ "${#candidates[@]}" -eq 0 ]; then
    echo ""
    return
  fi

  if [ ! -t 0 ]; then
    echo "${candidates[0]}"
    return
  fi

  echo "${title}" >&2
  local i
  for i in "${!candidates[@]}"; do
    printf '  %d) %s\n' "$((i + 1))" "${candidates[$i]}" >&2
  done
  printf 'Choose file [1]: ' >&2

  local choice
  read -r choice
  choice="${choice:-1}"
  if ! [[ "${choice}" =~ ^[0-9]+$ ]] || [ "${choice}" -lt 1 ] || [ "${choice}" -gt "${#candidates[@]}" ]; then
    echo "Invalid choice, using ${candidates[0]}" >&2
    echo "${candidates[0]}"
    return
  fi

  echo "${candidates[$((choice - 1))]}"
}

detect_service_name() {
  local fallback="$1"
  shift
  local unit

  for unit in "$@"; do
    if systemctl list-unit-files "${unit}" --no-legend 2>/dev/null | grep -q "${unit}"; then
      echo "${unit}"
      return
    fi
  done

  echo "${fallback}"
}

write_config_if_missing() {
  if [ -f "${CONFIG_TARGET}" ]; then
    echo "Config already exists: ${CONFIG_TARGET}"
    echo "Keeping the existing API token and config paths."
    return
  fi

  local caddy_config xray_config xray_config_alt caddy_service xray_service api_token
  caddy_config="$(pick_file "Caddy config candidates:" \
    /etc/caddy/Caddyfile \
    /etc/caddy/*.caddy \
    /etc/caddy/conf.d/* \
    /etc/caddy/sites-enabled/*)"

  xray_config="$(pick_file "Xray config candidates:" \
    /usr/local/etc/xray/config.json \
    /usr/local/etc/xray/*.json \
    /etc/xray/config.json \
    /etc/xray/*.json \
    /opt/xray/*.json)"

  xray_config_alt="/etc/xray/config.json"
  if [ "${xray_config}" = "${xray_config_alt}" ]; then
    xray_config_alt="/usr/local/etc/xray/config.json"
  fi

  caddy_config="${caddy_config:-/etc/caddy/Caddyfile}"
  xray_config="${xray_config:-/usr/local/etc/xray/config.json}"

  caddy_service="$(detect_service_name caddy.service caddy.service)"
  xray_service="$(detect_service_name xray.service xray.service xray@.service)"
  api_token="$(generate_token)"

  install -d -m 0750 "${CONFIG_DIR}"
  cat >"${CONFIG_TARGET}" <<EOF
listen: 127.0.0.1:8790
api_token: ${api_token}
use_sudo: false
log_lines_default: 300
backup_dir: ${BACKUP_DIR}

caddy_service: ${caddy_service}
caddy_config: ${caddy_config}

xray_service: ${xray_service}
xray_config: ${xray_config}
xray_config_alt: ${xray_config_alt}
EOF
  chmod 0640 "${CONFIG_TARGET}"

  echo
  echo "Agent API token. Save it now; it is shown only once:"
  echo "${api_token}"
  echo
}

install_agent() {
  build_binary_if_needed

  install -m 0755 "${BIN_SOURCE}" "${BIN_TARGET}"
  install -d -m 0750 "${CONFIG_DIR}"
  install -m 0644 "${SOURCE_ROOT}/install/vps-monitor-agent.service" "${SERVICE_TARGET}"

  write_config_if_missing

  systemctl daemon-reload
  systemctl enable --now vps-monitor-agent.service
}

need_root

if is_installed_and_running; then
  echo "vps-monitor-agent is already installed and running."
  systemctl status --no-pager vps-monitor-agent.service
  exit 0
fi

if [ -x "${BIN_TARGET}" ]; then
  echo "vps-monitor-agent binary is already installed, but the service is not running. Reinstalling service files and starting it..."
fi

install_agent

if systemctl is-active --quiet vps-monitor-agent.service; then
  echo "vps-monitor-agent installed and running."
  systemctl status --no-pager vps-monitor-agent.service
else
  echo "vps-monitor-agent was installed, but the service is not active." >&2
  systemctl status --no-pager vps-monitor-agent.service || true
  exit 1
fi
