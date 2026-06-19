package system

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
)

type Service struct {
	Name          string `json:"name"`
	LoadState     string `json:"loadState"`
	ActiveState   string `json:"activeState"`
	SubState      string `json:"subState"`
	UnitFileState string `json:"unitFileState"`
	Description   string `json:"description"`
}

func ListServices(ctx context.Context, runner Runner) ([]Service, error) {
	result, err := runner.Run(ctx, 15*time.Second, "systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager")
	if err != nil {
		return nil, err
	}
	var services []Service
	for _, line := range strings.Split(result.Output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		desc := ""
		if len(fields) > 4 {
			desc = strings.Join(fields[4:], " ")
		}
		services = append(services, Service{
			Name:        fields[0],
			LoadState:   fields[1],
			ActiveState: fields[2],
			SubState:    fields[3],
			Description: desc,
		})
	}
	return services, nil
}

func ServiceStatus(ctx context.Context, runner Runner, name string) (Service, error) {
	if err := ValidateServiceName(name); err != nil {
		return Service{}, err
	}
	result, err := runner.Run(ctx, 10*time.Second, "systemctl", "show", name, "--no-page",
		"-p", "Id",
		"-p", "LoadState",
		"-p", "ActiveState",
		"-p", "SubState",
		"-p", "UnitFileState",
		"-p", "Description",
	)
	if err != nil {
		return Service{}, err
	}
	values := parseKeyValues(result.Output)
	return Service{
		Name:          values["Id"],
		LoadState:     values["LoadState"],
		ActiveState:   values["ActiveState"],
		SubState:      values["SubState"],
		UnitFileState: values["UnitFileState"],
		Description:   values["Description"],
	}, nil
}

func ServiceAction(ctx context.Context, runner Runner, name, action string) (CommandResult, error) {
	if err := ValidateServiceName(name); err != nil {
		return CommandResult{}, err
	}
	switch action {
	case "start", "stop", "restart", "reload", "enable", "disable":
		return runner.Run(ctx, 20*time.Second, "systemctl", action, name)
	default:
		return CommandResult{}, errors.New("unsupported service action")
	}
}

func ServiceLogs(ctx context.Context, runner Runner, name string, lines int) (string, error) {
	if err := ValidateServiceName(name); err != nil {
		return "", err
	}
	if lines < 1 || lines > 5000 {
		lines = 300
	}
	result, err := runner.Run(ctx, 20*time.Second, "journalctl", "-u", name, "-n", strconv.Itoa(lines), "--no-pager", "--output=short-iso")
	return result.Output, err
}

func parseKeyValues(input string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(input, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			out[key] = value
		}
	}
	return out
}
