# Remote VPS Performance Monitoring

Desktop app and Linux agent for monitoring and managing VPS instances.

## Stack

- **Agent:** Go, Linux-only, single static-style binary, managed by `systemd`.
- **Desktop client:** Tauri 2, React, TypeScript, Vite.
- **Transport:** HTTP JSON API protected by a bearer token. The code is structured so HTTPS/mTLS can be added at the reverse-proxy or agent layer.

## Features Included

- Live VPS metrics: CPU, memory, disk, network, load average, uptime.
- Power actions: reboot and shutdown.
- `systemd` service manager: list, start, stop, restart, reload, enable, disable, logs.
- Firewall manager:
  - UFW status and rule operations.
  - iptables list/add/delete with typed allowlisted fields.
- Separate Caddy and Xray panels:
  - Installed/present detection.
  - Status, restart, reload where supported.
  - Log viewing and download endpoint.
  - Config viewing/editing.
  - Automatic timestamped backups before config writes.
  - Validation before applying changes.
- SSH quick connect from the desktop client using the system terminal.

## Repository Layout

```text
agent/       Linux VPS agent in Go
client/      Tauri + React desktop client
```

## Agent Quick Start

Install Go 1.22+ on the VPS, then:

```bash
cd agent
go build -o bin/vps-monitor-agent ./cmd/vps-agent
sudo install -m 0755 bin/vps-monitor-agent /usr/local/bin/vps-monitor-agent
sudo install -d -m 0750 /etc/vps-monitor
sudo install -m 0640 config.example.yaml /etc/vps-monitor/config.yaml
sudo install -m 0644 install/vps-monitor-agent.service /etc/systemd/system/vps-monitor-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now vps-monitor-agent
```

Edit `/etc/vps-monitor/config.yaml` and replace the default token before exposing the API.

## Desktop Quick Start

Install Node.js 20+, pnpm, Rust, and Tauri prerequisites for your OS, then:

```bash
cd client
pnpm install
pnpm tauri dev
```

## Security Notes

The agent does not expose a shell endpoint. Every privileged operation is represented as typed JSON and validated before any command is executed. For non-root deployments, grant only the specific commands required by your deployment through `/etc/sudoers.d/vps-monitor-agent` and set `use_sudo: true` in the agent config.

Do not expose the agent directly to the public Internet without TLS and a strong token. A production deployment should use HTTPS at minimum, and mTLS is recommended.
