package system

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type FirewallStatus struct {
	UFWAvailable      bool     `json:"ufwAvailable"`
	UFWStatus         string   `json:"ufwStatus"`
	IPTablesAvailable bool     `json:"iptablesAvailable"`
	IPTablesRules     []string `json:"iptablesRules"`
}

type UFWRequest struct {
	Operation string `json:"operation"`
	Port      int    `json:"port,omitempty"`
	Protocol  string `json:"protocol,omitempty"`
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
}

type IPTablesRequest struct {
	Operation string `json:"operation"`
	Chain     string `json:"chain"`
	Protocol  string `json:"protocol,omitempty"`
	DPort     int    `json:"dport,omitempty"`
	Source    string `json:"source,omitempty"`
	Target    string `json:"target"`
}

var safeAddress = regexp.MustCompile(`^[A-Za-z0-9_.:/-]+$`)

func Firewall(ctx context.Context, runner Runner) FirewallStatus {
	status := FirewallStatus{
		UFWAvailable:      commandExists("ufw"),
		IPTablesAvailable: commandExists("iptables"),
	}
	if status.UFWAvailable {
		result, _ := runner.Run(ctx, 10*time.Second, "ufw", "status", "verbose")
		status.UFWStatus = result.Output
	}
	if status.IPTablesAvailable {
		result, _ := runner.Run(ctx, 10*time.Second, "iptables-save")
		for _, line := range strings.Split(result.Output, "\n") {
			if strings.HasPrefix(line, "-A ") {
				status.IPTablesRules = append(status.IPTablesRules, line)
			}
		}
	}
	return status
}

func UFWAction(ctx context.Context, runner Runner, req UFWRequest) (CommandResult, error) {
	switch req.Operation {
	case "enable", "disable", "status":
		return runner.Run(ctx, 20*time.Second, "ufw", req.Operation)
	case "allow", "deny", "delete":
		if req.Port < 1 || req.Port > 65535 {
			return CommandResult{}, errors.New("invalid port")
		}
		if req.Protocol == "" {
			req.Protocol = "tcp"
		}
		if req.Protocol != "tcp" && req.Protocol != "udp" {
			return CommandResult{}, errors.New("invalid protocol")
		}
		args := []string{req.Operation}
		if req.Operation == "delete" {
			args = append(args, "allow")
		}
		if req.From != "" {
			if !safeAddress.MatchString(req.From) {
				return CommandResult{}, errors.New("invalid source address")
			}
			args = append(args, "from", req.From)
		}
		if req.To != "" {
			if !safeAddress.MatchString(req.To) {
				return CommandResult{}, errors.New("invalid destination address")
			}
			args = append(args, "to", req.To)
		}
		args = append(args, strconv.Itoa(req.Port)+"/"+req.Protocol)
		return runner.Run(ctx, 20*time.Second, "ufw", args...)
	default:
		return CommandResult{}, errors.New("unsupported ufw operation")
	}
}

func IPTablesAction(ctx context.Context, runner Runner, req IPTablesRequest) (CommandResult, error) {
	if req.Operation != "add" && req.Operation != "delete" {
		return CommandResult{}, errors.New("unsupported iptables operation")
	}
	if req.Chain != "INPUT" && req.Chain != "OUTPUT" && req.Chain != "FORWARD" {
		return CommandResult{}, errors.New("invalid chain")
	}
	if req.Target != "ACCEPT" && req.Target != "DROP" && req.Target != "REJECT" {
		return CommandResult{}, errors.New("invalid target")
	}
	args := []string{"-A", req.Chain}
	if req.Operation == "delete" {
		args[0] = "-D"
	}
	if req.Protocol != "" {
		if req.Protocol != "tcp" && req.Protocol != "udp" && req.Protocol != "icmp" {
			return CommandResult{}, errors.New("invalid protocol")
		}
		args = append(args, "-p", req.Protocol)
	}
	if req.Source != "" {
		if !safeAddress.MatchString(req.Source) {
			return CommandResult{}, errors.New("invalid source address")
		}
		args = append(args, "-s", req.Source)
	}
	if req.DPort > 0 {
		if req.DPort > 65535 {
			return CommandResult{}, errors.New("invalid destination port")
		}
		args = append(args, "--dport", strconv.Itoa(req.DPort))
	}
	args = append(args, "-j", req.Target)
	return runner.Run(ctx, 20*time.Second, "iptables", args...)
}
