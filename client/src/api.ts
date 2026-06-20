import { invoke } from "@tauri-apps/api/core";
import type {
  CommandResult,
  ConfigFile,
  FirewallStatus,
  Integration,
  Metrics,
  Profile,
  Service
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export class AgentApi {
  private profile: Profile;

  constructor(profile: Profile) {
    this.profile = profile;
  }

  health() {
    return this.request<{ ok: boolean; time: string }>("/api/health");
  }

  metrics() {
    return this.request<Metrics>("/api/metrics");
  }

  services() {
    return this.request<Service[]>("/api/services");
  }

  serviceAction(name: string, action: string) {
    return this.request<CommandResult>(`/api/services/${encodeURIComponent(name)}/action`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
  }

  serviceLogs(name: string, lines = 300) {
    return this.request<{ logs: string }>(`/api/services/${encodeURIComponent(name)}/logs?lines=${lines}`);
  }

  firewall() {
    return this.request<FirewallStatus>("/api/firewall");
  }

  ufw(body: {
    operation: "enable" | "disable" | "status" | "reload" | "reset" | "default" | "allow" | "deny" | "reject" | "limit" | "delete";
    ruleAction?: "allow" | "deny" | "reject" | "limit";
    ruleNumber?: number;
    port?: number;
    protocol?: "tcp" | "udp";
    from?: string;
    to?: string;
    policy?: "allow" | "deny" | "reject";
    direction?: "incoming" | "outgoing" | "routed";
  }) {
    return this.request<CommandResult>("/api/firewall/ufw", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  iptables(body: {
    operation: "append" | "add" | "insert" | "delete" | "deleteExisting" | "policy" | "flush" | "zero";
    table?: "filter" | "nat" | "mangle" | "raw" | "security";
    chain: "INPUT" | "OUTPUT" | "FORWARD" | "PREROUTING" | "POSTROUTING";
    protocol?: "tcp" | "udp" | "icmp";
    sport?: number;
    dport?: number;
    source?: string;
    destination?: string;
    inInterface?: string;
    outInterface?: string;
    target: "ACCEPT" | "DROP" | "REJECT" | "LOG" | "RETURN" | "MASQUERADE" | "DNAT" | "SNAT";
    rule?: string;
  }) {
    return this.request<CommandResult>("/api/firewall/iptables", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  integrations() {
    return this.request<Integration[]>("/api/integrations");
  }

  integrationAction(id: string, action: string) {
    return this.request<CommandResult>(`/api/integrations/${id}/action`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
  }

  integrationLogs(id: string, lines = 300) {
    return this.request<{ logs: string }>(`/api/integrations/${id}/logs?lines=${lines}`);
  }

  integrationConfig(id: string) {
    return this.request<ConfigFile>(`/api/integrations/${id}/config`);
  }

  saveIntegrationConfig(id: string, content: string) {
    return this.request<{ path: string; backup: string; validation: CommandResult }>(`/api/integrations/${id}/config`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
  }

  power(action: "reboot" | "shutdown") {
    return this.request<CommandResult>("/api/power", {
      method: "POST",
      body: JSON.stringify({ action })
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const endpoint = this.profile.endpoint.replace(/\/$/, "");
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? init.body : undefined;

    if (window.__TAURI_INTERNALS__) {
      const response = await invoke<{ status: number; body: string }>("agent_request", {
        request: {
          endpoint,
          token: this.profile.token,
          method,
          path,
          body
        }
      });
      const data = response.body ? JSON.parse(response.body) : {};
      return data as T;
    }

    const response = await fetch(endpoint + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.profile.token}`,
        ...(init.headers ?? {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    return data as T;
  }
}
