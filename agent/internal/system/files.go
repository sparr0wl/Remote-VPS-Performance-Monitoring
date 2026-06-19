package system

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type ConfigFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type ConfigWriteResult struct {
	Path       string        `json:"path"`
	Backup    string        `json:"backup"`
	Validation CommandResult `json:"validation"`
}

func ReadConfigFile(path string) (ConfigFile, error) {
	clean := filepath.Clean(path)
	if clean == "/" || clean == "." || strings.Contains(clean, "\x00") {
		return ConfigFile{}, errors.New("invalid config path")
	}
	data, err := os.ReadFile(clean)
	if err != nil {
		return ConfigFile{}, err
	}
	return ConfigFile{Path: clean, Content: string(data)}, nil
}

func WriteValidatedConfig(ctx context.Context, runner Runner, path, backupDir, content string, validate func(context.Context, Runner, string) (CommandResult, error)) (ConfigWriteResult, error) {
	clean := filepath.Clean(path)
	if clean == "/" || clean == "." || strings.Contains(clean, "\x00") {
		return ConfigWriteResult{}, errors.New("invalid config path")
	}
	if len(content) > 2*1024*1024 {
		return ConfigWriteResult{}, errors.New("config content is too large")
	}
	if err := os.MkdirAll(backupDir, 0750); err != nil {
		return ConfigWriteResult{}, err
	}

	oldData, err := os.ReadFile(clean)
	if err != nil {
		return ConfigWriteResult{}, err
	}
	stamp := time.Now().UTC().Format("20060102T150405Z")
	backupPath := filepath.Join(backupDir, filepath.Base(clean)+"."+stamp+".bak")
	if err := os.WriteFile(backupPath, oldData, 0640); err != nil {
		return ConfigWriteResult{}, err
	}

	tmp := clean + ".vps-monitor.tmp"
	if err := os.WriteFile(tmp, []byte(content), 0640); err != nil {
		return ConfigWriteResult{}, err
	}
	validation, err := validate(ctx, runner, tmp)
	if err != nil {
		_ = os.Remove(tmp)
		return ConfigWriteResult{Path: clean, Backup: backupPath, Validation: validation}, fmt.Errorf("validation failed: %w", err)
	}
	if err := os.Rename(tmp, clean); err != nil {
		_ = os.Remove(tmp)
		return ConfigWriteResult{}, err
	}
	return ConfigWriteResult{Path: clean, Backup: backupPath, Validation: validation}, nil
}
