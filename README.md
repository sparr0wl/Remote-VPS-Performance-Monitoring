# Remote VPS Performance Monitoring

Desktop app and Linux agent for monitoring and managing up to 10 VPS instances.

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
- Mobile-friendly web layout for the client UI.
- Local profile storage for up to 10 VPS servers.

## Agent Installer

The agent includes a Bash installer for Linux VPS hosts. It:

- builds the agent automatically when Go is installed and no binary is provided;
- installs `/usr/local/bin/vps-monitor-agent`;
- installs and enables `vps-monitor-agent.service`;
- checks whether the agent is already installed and running before reinstalling;
- creates `/etc/vps-monitor/config.yaml` only when it does not exist;
- generates a random API token on first install;
- prints the generated token once during installation;
- stores the token only in `/etc/vps-monitor/config.yaml`;
- detects and offers a choice of existing Caddy and Xray config files when several are present.

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
sudo ./install/install.sh bin/vps-monitor-agent
```

If `bin/vps-monitor-agent` does not exist and Go is installed, the installer can build it automatically:

```bash
cd agent
sudo ./install/install.sh
```

Save the API token printed by the installer. It is shown only once. If `/etc/vps-monitor/config.yaml` already exists, the installer keeps the existing token and config paths.

The service can be checked with:

```bash
systemctl status --no-pager vps-monitor-agent
```

## Desktop Quick Start

Install Node.js 20+, pnpm, Rust, and Tauri prerequisites for your OS, then:

```bash
cd client
pnpm install
pnpm tauri dev
```

On Linux, the desktop client now prefers Wayland automatically when `WAYLAND_DISPLAY` is present and falls back to X11 when only `DISPLAY` is available. SSH quick connect also recognizes common Wayland-native terminals such as `ptyxis`, `kgx`, `foot`, `kitty`, `wezterm`, and `alacritty`.

If `pnpm tauri dev` keeps waiting for the frontend server on Linux, make sure the Vite dev server and Tauri `devUrl` both use the same loopback address. This project uses `127.0.0.1:1420` to avoid `localhost` IPv4/IPv6 resolution mismatches.

For web-only development:

```bash
cd client
pnpm install
pnpm dev
```

The client stores VPS profiles locally in the browser/app storage. Use the server picker to add, remove, and switch between up to 10 servers.

## Security Notes

The agent does not expose a shell endpoint. Every privileged operation is represented as typed JSON and validated before any command is executed. For non-root deployments, grant only the specific commands required by your deployment through `/etc/sudoers.d/vps-monitor-agent` and set `use_sudo: true` in the agent config.

Do not expose the agent directly to the public Internet without TLS and a strong token. A production deployment should use HTTPS at minimum, and mTLS is recommended.
