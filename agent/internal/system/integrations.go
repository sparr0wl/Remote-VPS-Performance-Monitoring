package system

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type Integration struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Installed   bool    `json:"installed"`
	Binary      string  `json:"binary,omitempty"`
	ServiceName string  `json:"serviceName"`
	ConfigPath  string  `json:"configPath,omitempty"`
	Service     Service `json:"service,omitempty"`
}

type IntegrationSpec struct {
	ID          string
	Name        string
	Binary      string
	ServiceName string
	ConfigPath  string
	ConfigAlt   string
	Validate    func(ctx context.Context, runner Runner, path string) (CommandResult, error)
	Reload      bool
}

func DetectIntegration(ctx context.Context, runner Runner, spec IntegrationSpec) Integration {
	item := Integration{
		ID:          spec.ID,
		Name:        spec.Name,
		Installed:   commandExists(spec.Binary),
		Binary:      spec.Binary,
		ServiceName: spec.ServiceName,
		ConfigPath:  firstExisting(spec.ConfigPath, spec.ConfigAlt),
	}
	if item.Installed {
		status, err := ServiceStatus(ctx, runner, spec.ServiceName)
		if err == nil {
			item.Service = status
		}
	}
	return item
}

func IntegrationAction(ctx context.Context, runner Runner, spec IntegrationSpec, action string) (CommandResult, error) {
	if !commandExists(spec.Binary) {
		return CommandResult{}, errors.New("integration is not installed")
	}
	switch action {
	case "restart":
		return ServiceAction(ctx, runner, spec.ServiceName, "restart")
	case "reload":
		if !spec.Reload {
			return CommandResult{}, errors.New("reload is not supported for this integration")
		}
		return ServiceAction(ctx, runner, spec.ServiceName, "reload")
	case "validate":
		configPath := firstExisting(spec.ConfigPath, spec.ConfigAlt)
		if configPath == "" {
			return CommandResult{}, errors.New("config file not found")
		}
		return spec.Validate(ctx, runner, configPath)
	default:
		return CommandResult{}, errors.New("unsupported integration action")
	}
}

func CaddyValidate(ctx context.Context, runner Runner, path string) (CommandResult, error) {
	return runner.Run(ctx, 20*time.Second, "caddy", "validate", "--config", path)
}

func XrayValidate(ctx context.Context, runner Runner, path string) (CommandResult, error) {
	return runner.Run(ctx, 20*time.Second, "xray", "test", "-config", path)
}

func ResolveIntegrationConfig(spec IntegrationSpec) string {
	return firstExisting(spec.ConfigPath, spec.ConfigAlt)
}

func firstExisting(paths ...string) string {
	for _, path := range paths {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			return path
		}
	}
	for _, path := range paths {
		if path != "" {
			return filepath.Clean(path)
		}
	}
	return ""
}
