package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Listen          string
	APIToken        string
	UseSudo         bool
	LogLinesDefault int
	BackupDir       string

	CaddyService string
	CaddyConfig  string

	XrayService   string
	XrayConfig    string
	XrayConfigAlt string
}

func Default() Config {
	return Config{
		Listen:          "127.0.0.1:8790",
		LogLinesDefault: 300,
		BackupDir:       "/var/backups/vps-monitor",
		CaddyService:    "caddy.service",
		CaddyConfig:     "/etc/caddy/Caddyfile",
		XrayService:     "xray.service",
		XrayConfig:      "/usr/local/etc/xray/config.json",
		XrayConfigAlt:   "/etc/xray/config.json",
	}
}

func Load(path string) (Config, error) {
	cfg := Default()
	if path == "" {
		return cfg, nil
	}

	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return cfg, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineNo := 0
	for scanner.Scan() {
		lineNo++
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			return cfg, fmt.Errorf("config line %d: expected key: value", lineNo)
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)

		switch key {
		case "listen":
			cfg.Listen = value
		case "api_token":
			cfg.APIToken = value
		case "use_sudo":
			cfg.UseSudo = value == "true" || value == "yes" || value == "1"
		case "log_lines_default":
			n, err := strconv.Atoi(value)
			if err != nil || n < 1 {
				return cfg, fmt.Errorf("config line %d: invalid log_lines_default", lineNo)
			}
			cfg.LogLinesDefault = n
		case "backup_dir":
			cfg.BackupDir = value
		case "caddy_service":
			cfg.CaddyService = value
		case "caddy_config":
			cfg.CaddyConfig = value
		case "xray_service":
			cfg.XrayService = value
		case "xray_config":
			cfg.XrayConfig = value
		case "xray_config_alt":
			cfg.XrayConfigAlt = value
		default:
			return cfg, fmt.Errorf("config line %d: unknown key %q", lineNo, key)
		}
	}
	if err := scanner.Err(); err != nil {
		return cfg, err
	}
	if cfg.APIToken == "" {
		return cfg, errors.New("api_token is required")
	}
	return cfg, nil
}
