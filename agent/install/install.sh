#!/usr/bin/env sh
set -eu

BIN_SOURCE="${1:-./bin/vps-monitor-agent}"
CONFIG_TARGET="/etc/vps-monitor/config.yaml"
SERVICE_TARGET="/etc/systemd/system/vps-monitor-agent.service"

if [ ! -f "$BIN_SOURCE" ]; then
  echo "Agent binary not found: $BIN_SOURCE" >&2
  echo "Build it first: go build -o bin/vps-monitor-agent ./cmd/vps-agent" >&2
  exit 1
fi

install -m 0755 "$BIN_SOURCE" /usr/local/bin/vps-monitor-agent
install -d -m 0750 /etc/vps-monitor

if [ ! -f "$CONFIG_TARGET" ]; then
  install -m 0640 ./config.example.yaml "$CONFIG_TARGET"
  echo "Created $CONFIG_TARGET"
  echo "Edit api_token before exposing the agent."
fi

install -m 0644 ./install/vps-monitor-agent.service "$SERVICE_TARGET"
systemctl daemon-reload
systemctl enable --now vps-monitor-agent
systemctl status --no-pager vps-monitor-agent
