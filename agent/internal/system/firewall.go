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
	Operation  string `json:"operation"`
	RuleAction string `json:"ruleAction,omitempty"`
	RuleNumber int    `json:"ruleNumber,omitempty"`
	Port       int    `json:"port,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
	From       string `json:"from,omitempty"`
	To         string `json:"to,omitempty"`
	Policy     string `json:"policy,omitempty"`
	Direction  string `json:"direction,omitempty"`
}

type IPTablesRequest struct {
	Operation    string `json:"operation"`
	Table        string `json:"table,omitempty"`
	Chain        string `json:"chain"`
	Protocol     string `json:"protocol,omitempty"`
	SPort        int    `json:"sport,omitempty"`
	DPort        int    `json:"dport,omitempty"`
	Source       string `json:"source,omitempty"`
	Destination  string `json:"destination,omitempty"`
	InInterface  string `json:"inInterface,omitempty"`
	OutInterface string `json:"outInterface,omitempty"`
	Target       string `json:"target"`
}

var safeAddress = regexp.MustCompile(`^[A-Za-z0-9_.:/-]+$`)
var safeInterface = regexp.MustCompile(`^[A-Za-z0-9_.:-]+$`)

func Firewall(ctx context.Context, runner Runner) FirewallStatus {
	status := FirewallStatus{
		UFWAvailable:      commandExists("ufw"),
		IPTablesAvailable: commandExists("iptables"),
	}
	if status.UFWAvailable {
		result, _ := runner.Run(ctx, 10*time.Second, "ufw", "status", "numbered")
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
	case "enable":
		return runner.Run(ctx, 20*time.Second, "ufw", "--force", "enable")
	case "disable", "status", "reload":
		return runner.Run(ctx, 20*time.Second, "ufw", req.Operation)
	case "reset":
		return runner.Run(ctx, 20*time.Second, "ufw", "--force", "reset")
	case "default":
		if req.Policy != "allow" && req.Policy != "deny" && req.Policy != "reject" {
			return CommandResult{}, errors.New("invalid ufw default policy")
		}
		if req.Direction != "incoming" && req.Direction != "outgoing" && req.Direction != "routed" {
			return CommandResult{}, errors.New("invalid ufw default direction")
		}
		return runner.Run(ctx, 20*time.Second, "ufw", "default", req.Policy, req.Direction)
	case "allow", "deny", "reject", "limit", "delete":
		if req.Operation == "delete" && req.RuleNumber > 0 {
			return runner.Run(ctx, 20*time.Second, "ufw", "--force", "delete", strconv.Itoa(req.RuleNumber))
		}
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
			if req.RuleAction == "" {
				req.RuleAction = "allow"
			}
			if req.RuleAction != "allow" && req.RuleAction != "deny" && req.RuleAction != "reject" && req.RuleAction != "limit" {
				return CommandResult{}, errors.New("invalid ufw rule action")
			}
			args = append(args, req.RuleAction)
		}
		if req.From == "" && req.To == "" {
			args = append(args, strconv.Itoa(req.Port)+"/"+req.Protocol)
			return runner.Run(ctx, 20*time.Second, "ufw", args...)
		}
		if req.From != "" {
			if !safeAddress.MatchString(req.From) {
				return CommandResult{}, errors.New("invalid source address")
			}
			args = append(args, "from", req.From)
		} else {
			args = append(args, "from", "any")
		}
		if req.To != "" {
			if !safeAddress.MatchString(req.To) {
				return CommandResult{}, errors.New("invalid destination address")
			}
			args = append(args, "to", req.To)
		} else {
			args = append(args, "to", "any")
		}
		args = append(args, "port", strconv.Itoa(req.Port), "proto", req.Protocol)
		return runner.Run(ctx, 20*time.Second, "ufw", args...)
	default:
		return CommandResult{}, errors.New("unsupported ufw operation")
	}
}

func IPTablesAction(ctx context.Context, runner Runner, req IPTablesRequest) (CommandResult, error) {
	if req.Table == "" {
		req.Table = "filter"
	}
	if !validIPTablesTable(req.Table) {
		return CommandResult{}, errors.New("invalid iptables table")
	}
	if !validIPTablesChain(req.Chain) {
		return CommandResult{}, errors.New("invalid chain")
	}

	switch req.Operation {
	case "append", "add", "insert", "delete":
	case "policy":
		if !validIPTablesTarget(req.Target) {
			return CommandResult{}, errors.New("invalid target")
		}
		return runner.Run(ctx, 20*time.Second, "iptables", "-t", req.Table, "-P", req.Chain, req.Target)
	case "flush":
		return runner.Run(ctx, 20*time.Second, "iptables", "-t", req.Table, "-F", req.Chain)
	case "zero":
		return runner.Run(ctx, 20*time.Second, "iptables", "-t", req.Table, "-Z", req.Chain)
	default:
		return CommandResult{}, errors.New("unsupported iptables operation")
	}
	if !validIPTablesTarget(req.Target) {
		return CommandResult{}, errors.New("invalid target")
	}
	action := "-A"
	if req.Operation == "insert" {
		action = "-I"
	}
	if req.Operation == "delete" {
		action = "-D"
	}
	args := []string{"-t", req.Table, action, req.Chain}
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
	if req.Destination != "" {
		if !safeAddress.MatchString(req.Destination) {
			return CommandResult{}, errors.New("invalid destination address")
		}
		args = append(args, "-d", req.Destination)
	}
	if req.InInterface != "" {
		if !safeInterface.MatchString(req.InInterface) {
			return CommandResult{}, errors.New("invalid input interface")
		}
		args = append(args, "-i", req.InInterface)
	}
	if req.OutInterface != "" {
		if !safeInterface.MatchString(req.OutInterface) {
			return CommandResult{}, errors.New("invalid output interface")
		}
		args = append(args, "-o", req.OutInterface)
	}
	if req.SPort > 0 {
		if req.SPort > 65535 {
			return CommandResult{}, errors.New("invalid source port")
		}
		args = append(args, "--sport", strconv.Itoa(req.SPort))
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

func validIPTablesTable(value string) bool {
	switch value {
	case "filter", "nat", "mangle", "raw", "security":
		return true
	default:
		return false
	}
}

func validIPTablesChain(value string) bool {
	switch value {
	case "INPUT", "OUTPUT", "FORWARD", "PREROUTING", "POSTROUTING":
		return true
	default:
		return false
	}
}

func validIPTablesTarget(value string) bool {
	switch value {
	case "ACCEPT", "DROP", "REJECT", "LOG", "RETURN", "MASQUERADE", "DNAT", "SNAT":
		return true
	default:
		return false
	}
}
