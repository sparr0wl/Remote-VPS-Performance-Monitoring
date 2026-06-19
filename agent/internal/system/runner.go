package system

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var safeUnitName = regexp.MustCompile(`^[A-Za-z0-9_.@:-]+\.service$`)

type Runner struct {
	UseSudo bool
}

type CommandResult struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

func (r Runner) Run(ctx context.Context, timeout time.Duration, name string, args ...string) (CommandResult, error) {
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmdName := name
	cmdArgs := args
	if r.UseSudo {
		cmdName = "sudo"
		cmdArgs = append([]string{"-n", name}, args...)
	}

	cmd := exec.CommandContext(ctx, cmdName, cmdArgs...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	result := CommandResult{Output: strings.TrimSpace(out.String())}
	if ctx.Err() != nil {
		result.Error = ctx.Err().Error()
		return result, ctx.Err()
	}
	if err != nil {
		result.Error = err.Error()
		return result, fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return result, nil
}

func ValidateServiceName(name string) error {
	if !safeUnitName.MatchString(name) {
		return errors.New("invalid service name")
	}
	return nil
}

func commandExists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
