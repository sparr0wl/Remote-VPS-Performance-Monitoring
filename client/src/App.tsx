import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Bolt,
  Download,
  FileText,
  Gauge,
  HardDrive,
  Menu,
  MemoryStick,
  Monitor,
  Moon,
  Network,
  Plus,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
  Sun,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentApi } from "./api";
import type { FirewallStatus, Integration, Metrics, Profile, Service } from "./types";
import type { ReactNode } from "react";

const defaultProfile: Profile = {
  id: "primary",
  name: "Primary VPS",
  endpoint: "http://127.0.0.1:8790",
  token: "change-this-token",
  sshUser: "root",
  sshHost: "127.0.0.1",
  sshPort: 22
};

type Tab = "overview" | "services" | "firewall";
type ThemeMode = "auto" | "light" | "dark";
const maxProfiles = 10;

function createProfile(index: number): Profile {
  return {
    ...defaultProfile,
    id: `server-${Date.now()}-${index}`,
    name: `VPS ${index + 1}`,
    endpoint: "http://127.0.0.1:8790",
    sshHost: "127.0.0.1"
  };
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    const savedProfiles = localStorage.getItem("vps-monitor-profiles");
    if (savedProfiles) {
      const parsed = JSON.parse(savedProfiles) as Partial<Profile>[];
      const restored = parsed.slice(0, maxProfiles).map((item, index) => ({
        ...defaultProfile,
        ...item,
        id: item.id ?? `server-${index}`,
        name: item.name ?? `VPS ${index + 1}`
      }));
      return restored.length > 0 ? restored : [defaultProfile];
    }
    const oldProfile = localStorage.getItem("vps-monitor-profile");
    if (oldProfile) {
      return [{ ...defaultProfile, ...JSON.parse(oldProfile), id: "primary" }];
    }
    return [defaultProfile];
  });
  const [activeProfileId, setActiveProfileId] = useState(() => localStorage.getItem("vps-monitor-active-profile") ?? "primary");
  const [tab, setTab] = useState<Tab>("overview");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [firewall, setFirewall] = useState<FirewallStatus | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedLog, setSelectedLog] = useState("");
  const [configEditor, setConfigEditor] = useState<{ id: string; path: string; content: string } | null>(null);
  const [serviceFilter, setServiceFilter] = useState("");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);
  const [servicesBusy, setServicesBusy] = useState(false);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("vps-monitor-theme");
    return saved === "light" || saved === "dark" || saved === "auto" ? saved : "auto";
  });
  const overviewInFlight = useRef(false);
  const servicesInFlight = useRef(false);
  const firewallInFlight = useRef(false);

  const profile = profiles.find((item) => item.id === activeProfileId) ?? profiles[0];
  const api = useMemo(() => new AgentApi(profile), [profile]);

  useEffect(() => {
    if (!profiles.some((item) => item.id === activeProfileId)) {
      setActiveProfileId(profiles[0].id);
    }
  }, [activeProfileId, profiles]);

  useEffect(() => {
    localStorage.setItem("vps-monitor-profiles", JSON.stringify(profiles));
    localStorage.setItem("vps-monitor-active-profile", profile.id);
  }, [profile.id, profiles]);

  useEffect(() => {
    const applyTheme = () => {
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const resolved = themeMode === "auto" ? (systemDark ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.dataset.themeMode = themeMode;
      localStorage.setItem("vps-monitor-theme", themeMode);
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  const updateProfile = (patch: Partial<Profile>) => {
    setProfiles((current) => current.map((item) => (item.id === profile.id ? { ...item, ...patch } : item)));
  };

  const saveProfile = () => {
    localStorage.setItem("vps-monitor-profiles", JSON.stringify(profiles));
    localStorage.setItem("vps-monitor-active-profile", profile.id);
    setStatus("Profile saved");
  };

  const addProfile = () => {
    if (profiles.length >= maxProfiles) {
      setStatus("Server limit reached");
      return;
    }
    const next = createProfile(profiles.length);
    setProfiles((current) => [...current, next]);
    setActiveProfileId(next.id);
    setMetrics(null);
    setServices([]);
    setFirewall(null);
    setIntegrations([]);
    setStatus("Server added");
  };

  const removeProfile = () => {
    if (profiles.length === 1) {
      setStatus("Keep at least one server");
      return;
    }
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    const nextProfiles = profiles.filter((item) => item.id !== profile.id);
    setProfiles(nextProfiles);
    setActiveProfileId(nextProfiles[Math.max(0, currentIndex - 1)].id);
    setMetrics(null);
    setServices([]);
    setFirewall(null);
    setIntegrations([]);
    setStatus("Server removed");
  };

  const refreshOverview = useCallback(async () => {
    if (overviewInFlight.current) {
      return;
    }
    overviewInFlight.current = true;
    setBusy(true);
    try {
      const [nextMetrics, nextIntegrations] = await Promise.all([
        api.metrics(),
        api.integrations()
      ]);
      setMetrics(nextMetrics);
      setIntegrations(nextIntegrations);
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBusy(false);
      overviewInFlight.current = false;
    }
  }, [api]);

  const loadServices = useCallback(async () => {
    if (servicesInFlight.current) {
      return;
    }
    servicesInFlight.current = true;
    setServicesBusy(true);
    try {
      setServices(await api.services());
      setStatus(`Services updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Services load failed");
    } finally {
      setServicesBusy(false);
      servicesInFlight.current = false;
    }
  }, [api]);

  const loadFirewall = useCallback(async () => {
    if (firewallInFlight.current) {
      return;
    }
    firewallInFlight.current = true;
    setFirewallBusy(true);
    try {
      setFirewall(await api.firewall());
      setStatus(`Firewall updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Firewall load failed");
    } finally {
      setFirewallBusy(false);
      firewallInFlight.current = false;
    }
  }, [api]);

  useEffect(() => {
    refreshOverview();
    const timer = window.setInterval(refreshOverview, 12000);
    return () => window.clearInterval(timer);
  }, [refreshOverview]);

  useEffect(() => {
    if (tab === "services" && services.length === 0) {
      loadServices();
    }
    if (tab === "firewall" && !firewall) {
      loadFirewall();
    }
  }, [firewall, loadFirewall, loadServices, services.length, tab]);

  const run = async (action: () => Promise<unknown>, message: string, refreshAfter = true) => {
    setBusy(true);
    try {
      await action();
      setStatus(message);
      if (refreshAfter) {
        if (tab === "services") {
          await loadServices();
        } else if (tab === "firewall") {
          await loadFirewall();
        } else {
          await refreshOverview();
        }
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const openSsh = async () => {
    await run(
      () =>
        invoke("open_ssh", {
          profile: { user: profile.sshUser, host: profile.sshHost, port: Number(profile.sshPort) }
        }),
      "SSH opened",
      false
    );
  };

  const testConnection = async () => {
    await run(() => api.health(), "Connection OK", false);
  };

  const filteredServices = services.filter((service) => {
    const text = `${service.name} ${service.description} ${service.activeState}`.toLowerCase();
    return text.includes(serviceFilter.toLowerCase());
  });

  const selectTab = (nextTab: Tab) => {
    setTab(nextTab);
    setSidebarOpen(false);
  };

  return (
    <main className="shell">
      <header className="mobile-bar">
        <div>
          <strong>{profile.name}</strong>
          <span>{status}</span>
        </div>
        <button className="icon-button secondary" onClick={() => setSidebarOpen(true)} title="Open settings">
          <Menu size={18} />
        </button>
      </header>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close settings" />}

      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Server size={20} />
          </div>
          <div>
            <strong>VPS Monitor</strong>
            <span>{profiles.length}/{maxProfiles} servers</span>
          </div>
          <button className="icon-button secondary sidebar-close" onClick={() => setSidebarOpen(false)} title="Close settings">
            <X size={16} />
          </button>
        </div>

        <section className="server-picker">
          <div className="server-picker-head">
            <label>
              Server
              <select value={profile.id} onChange={(event) => setActiveProfileId(event.target.value)}>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="icon-button secondary" onClick={addProfile} disabled={profiles.length >= maxProfiles} title="Add server">
              <Plus size={16} />
            </button>
          </div>
          <button className="secondary full-button" onClick={removeProfile} disabled={profiles.length === 1} title="Remove server">
            <Trash2 size={16} /> Remove
          </button>
        </section>

        <nav className="tabs">
          <button className={tab === "overview" ? "active" : ""} onClick={() => selectTab("overview")}>
            <Gauge size={18} /> Overview
          </button>
          <button className={tab === "services" ? "active" : ""} onClick={() => selectTab("services")}>
            <Bolt size={18} /> Services
          </button>
          <button className={tab === "firewall" ? "active" : ""} onClick={() => selectTab("firewall")}>
            <Shield size={18} /> Firewall
          </button>
        </nav>

        <section className="theme-card">
          <span>Theme</span>
          <div className="theme-toggle">
            <button className={themeMode === "auto" ? "active" : ""} onClick={() => setThemeMode("auto")} title="Auto theme">
              <Monitor size={16} /> Auto
            </button>
            <button className={themeMode === "light" ? "active" : ""} onClick={() => setThemeMode("light")} title="Light theme">
              <Sun size={16} /> Light
            </button>
            <button className={themeMode === "dark" ? "active" : ""} onClick={() => setThemeMode("dark")} title="Dark theme">
              <Moon size={16} /> Dark
            </button>
          </div>
        </section>

        <details className="connection-card">
          <summary>Connection</summary>
          <section className="profile">
            <label>
              Name
              <input value={profile.name} onChange={(event) => updateProfile({ name: event.target.value })} />
            </label>
            <label>
              Endpoint
              <input value={profile.endpoint} onChange={(event) => updateProfile({ endpoint: event.target.value })} />
            </label>
            <label>
              Token
              <input
                value={profile.token}
                type="password"
                onChange={(event) => updateProfile({ token: event.target.value })}
              />
            </label>
            <div className="split">
              <label>
                SSH user
                <input value={profile.sshUser} onChange={(event) => updateProfile({ sshUser: event.target.value })} />
              </label>
              <label>
                Port
                <input
                  value={profile.sshPort}
                  type="number"
                  min={1}
                  max={65535}
                  onChange={(event) => updateProfile({ sshPort: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              SSH host
              <input value={profile.sshHost} onChange={(event) => updateProfile({ sshHost: event.target.value })} />
            </label>
            <div className="button-row connection-actions">
              <button className="secondary" onClick={saveProfile} title="Save profile">
                <Save size={17} /> Save
              </button>
              <button className="secondary" onClick={testConnection} title="Test API connection">
                <Activity size={17} /> Test
              </button>
              <button onClick={openSsh} title="Open SSH">
                <SquareTerminal size={17} /> SSH
              </button>
            </div>
          </section>
        </details>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <h1>{metrics?.hostname ?? "Remote VPS"}</h1>
            <p>{status}</p>
          </div>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() => {
                if (tab === "services") {
                  loadServices();
                } else if (tab === "firewall") {
                  loadFirewall();
                } else {
                  refreshOverview();
                }
              }}
              disabled={busy || servicesBusy || firewallBusy}
              title="Refresh"
            >
              <RefreshCw size={17} className={busy ? "spin" : ""} /> Refresh
            </button>
            <button className="danger" onClick={() => run(() => api.power("reboot"), "Reboot requested")} title="Reboot">
              <Power size={17} /> Reboot
            </button>
          </div>
        </header>

        {tab === "overview" && (
          <>
            <section className="metrics-grid">
              <MetricCard icon={<Activity />} label="CPU" value={`${metrics?.cpu.percent ?? 0}%`} sub={`${metrics?.cpu.cores ?? 0} cores`} />
              <MetricCard
                icon={<MemoryStick />}
                label="Memory"
                value={`${metrics?.memory.usedPercent ?? 0}%`}
                sub={metrics ? `${formatBytes(metrics.memory.used)} used` : "No data"}
              />
              <MetricCard
                icon={<HardDrive />}
                label="Disk"
                value={`${metrics?.disk.usedPercent ?? 0}%`}
                sub={metrics ? `${formatBytes(metrics.disk.free)} free` : "No data"}
              />
              <MetricCard
                icon={<Network />}
                label="Network"
                value={metrics?.network[0]?.interface ?? "n/a"}
                sub={metrics?.network[0] ? `${formatBytes(metrics.network[0].rxBytes)} in` : "No data"}
              />
            </section>

            <section className="integrations">
              {integrations
                .filter((item) => item.installed)
                .map((item) => (
                  <IntegrationPanel
                    key={item.id}
                    item={item}
                    api={api}
                    run={run}
                    setSelectedLog={setSelectedLog}
                    setConfigEditor={setConfigEditor}
                  />
                ))}
            </section>
          </>
        )}

        {tab === "services" && (
          <section className="panel">
            <div className="panel-head">
              <h2>systemd</h2>
              <button className="secondary" onClick={loadServices} disabled={servicesBusy} title="Refresh services">
                <RefreshCw size={16} className={servicesBusy ? "spin" : ""} /> Refresh
              </button>
              <div className="search">
                <Search size={16} />
                <input placeholder="Filter services" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} />
              </div>
            </div>
            <div className="service-list">
              {servicesBusy && services.length === 0 && <div className="empty-state">Loading services...</div>}
              {!servicesBusy && filteredServices.length === 0 && <div className="empty-state">No services loaded</div>}
              {filteredServices.slice(0, 160).map((service) => (
                <ServiceRow key={service.name} service={service} api={api} run={run} setSelectedLog={setSelectedLog} />
              ))}
            </div>
          </section>
        )}

        {tab === "firewall" && (
          <FirewallPanel firewall={firewall} api={api} run={run} busy={firewallBusy} refresh={loadFirewall} />
        )}
      </section>

      {selectedLog && (
        <Modal title="Logs" onClose={() => setSelectedLog("")}>
          <pre className="logs">{selectedLog}</pre>
        </Modal>
      )}

      {configEditor && (
        <Modal title={configEditor.path} onClose={() => setConfigEditor(null)}>
          <textarea
            className="editor"
            value={configEditor.content}
            onChange={(event) => setConfigEditor({ ...configEditor, content: event.target.value })}
          />
          <div className="modal-actions">
            <button
              onClick={() =>
                run(
                  () => api.saveIntegrationConfig(configEditor.id, configEditor.content),
                  "Config saved with backup"
                ).then(() => setConfigEditor(null))
              }
            >
              <Save size={17} /> Save config
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function MetricCard({ icon, label, value, sub }: { icon: JSX.Element; label: string; value: string; sub: string }) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}

function ServiceRow({
  service,
  api,
  run,
  setSelectedLog
}: {
  service: Service;
  api: AgentApi;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  setSelectedLog: (value: string) => void;
}) {
  const active = service.activeState === "active";
  return (
    <article className="service-row">
      <div>
        <strong>{service.name}</strong>
        <span>{service.description || service.subState}</span>
      </div>
      <StatusPill active={active} label={service.activeState} />
      <div className="row-actions">
        <button className="icon-button" title="Start" onClick={() => run(() => api.serviceAction(service.name, "start"), "Service started")}>
          <Power size={16} />
        </button>
        <button className="icon-button" title="Restart" onClick={() => run(() => api.serviceAction(service.name, "restart"), "Service restarted")}>
          <RefreshCw size={16} />
        </button>
        <button
          className="icon-button"
          title="Logs"
          onClick={() => api.serviceLogs(service.name).then((data) => setSelectedLog(data.logs))}
        >
          <FileText size={16} />
        </button>
      </div>
    </article>
  );
}

function IntegrationPanel({
  item,
  api,
  run,
  setSelectedLog,
  setConfigEditor
}: {
  item: Integration;
  api: AgentApi;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  setSelectedLog: (value: string) => void;
  setConfigEditor: (value: { id: string; path: string; content: string }) => void;
}) {
  return (
    <article className="integration-panel">
      <div className="integration-main">
        <div className="integration-title">
          <PlugZap size={18} />
          <div>
            <h2>{item.name}</h2>
            <p>{item.serviceName}</p>
          </div>
        </div>
        <div className="integration-meta">
          <span>{item.configPath ?? "Config path unavailable"}</span>
        </div>
      </div>
      <StatusPill active={item.service?.activeState === "active"} label={item.service?.activeState ?? "unknown"} />
      <div className="integration-actions">
        <button className="secondary" onClick={() => run(() => api.integrationAction(item.id, "restart"), `${item.name} restarted`)}>
          <RefreshCw size={17} /> Restart
        </button>
        {item.id === "caddy" && (
          <button className="secondary" onClick={() => run(() => api.integrationAction(item.id, "reload"), "Caddy reloaded")}>
            <Bolt size={17} /> Reload
          </button>
        )}
        <button onClick={() => api.integrationLogs(item.id).then((data) => setSelectedLog(data.logs))}>
          <Download size={17} /> Logs
        </button>
        <button
          onClick={() =>
            api.integrationConfig(item.id).then((file) =>
              setConfigEditor({ id: item.id, path: file.path, content: file.content })
            )
          }
        >
          <FileText size={17} /> Config
        </button>
      </div>
    </article>
  );
}

function FirewallPanel({
  firewall,
  api,
  run,
  busy,
  refresh
}: {
  firewall: FirewallStatus | null;
  api: AgentApi;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const [activeTool, setActiveTool] = useState<"ufw" | "iptables" | null>(null);
  const showUfw = Boolean(firewall?.ufwAvailable);
  const showIptables = Boolean(firewall?.iptablesAvailable);

  return (
    <>
      <section className={`firewall-grid ${showUfw !== showIptables ? "single-tool" : ""}`}>
        {showUfw && (
          <article className="panel">
            <div className="panel-head">
              <h2>UFW</h2>
              <button className="secondary" onClick={refresh} disabled={busy} title="Refresh firewall">
                <RefreshCw size={16} className={busy ? "spin" : ""} /> Refresh
              </button>
              <StatusPill active label="available" />
            </div>
            <div className="firewall-summary">
              <pre className="logs compact">{firewall?.ufwStatus}</pre>
              <button onClick={() => setActiveTool("ufw")}>
                <Shield size={17} /> Manage UFW
              </button>
            </div>
          </article>
        )}

        {showIptables && (
          <article className="panel">
            <div className="panel-head">
              <h2>iptables</h2>
              <button className="secondary" onClick={refresh} disabled={busy} title="Refresh firewall">
                <RefreshCw size={16} className={busy ? "spin" : ""} /> Refresh
              </button>
              <StatusPill active label="available" />
            </div>
            <div className="firewall-summary">
              <pre className="logs compact">{firewall?.iptablesRules.join("\n")}</pre>
              <button onClick={() => setActiveTool("iptables")}>
                <Shield size={17} /> Manage iptables
              </button>
            </div>
          </article>
        )}

        {!busy && !showUfw && !showIptables && <div className="empty-state">No firewall tools detected</div>}
      </section>

      {activeTool === "ufw" && <UfwDialog api={api} run={run} onClose={() => setActiveTool(null)} />}
      {activeTool === "iptables" && <IPTablesDialog api={api} run={run} onClose={() => setActiveTool(null)} />}
    </>
  );
}

function UfwDialog({
  api,
  run,
  onClose
}: {
  api: AgentApi;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<"allow" | "deny" | "reject" | "limit" | "delete">("allow");
  const [ruleAction, setRuleAction] = useState<"allow" | "deny" | "reject" | "limit">("allow");
  const [protocol, setProtocol] = useState<"tcp" | "udp">("tcp");
  const [port, setPort] = useState(443);
  const [ruleNumber, setRuleNumber] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [policy, setPolicy] = useState<"allow" | "deny" | "reject">("deny");
  const [direction, setDirection] = useState<"incoming" | "outgoing" | "routed">("incoming");

  const submitRule = () =>
    run(
      () =>
        api.ufw({
          operation,
          ruleAction: operation === "delete" ? ruleAction : undefined,
          ruleNumber: operation === "delete" && ruleNumber ? Number(ruleNumber) : undefined,
          port: operation === "delete" && ruleNumber ? undefined : port,
          protocol,
          from: from || undefined,
          to: to || undefined
        }),
      "UFW rule applied"
    );

  return (
    <Modal title="UFW Manager" onClose={onClose}>
      <div className="firewall-manager">
        <section className="manager-section">
          <h3>Service</h3>
          <div className="action-grid">
            <button onClick={() => run(() => api.ufw({ operation: "enable" }), "UFW enabled")}>Enable</button>
            <button className="secondary" onClick={() => run(() => api.ufw({ operation: "disable" }), "UFW disabled")}>Disable</button>
            <button className="secondary" onClick={() => run(() => api.ufw({ operation: "reload" }), "UFW reloaded")}>Reload</button>
            <button className="danger" onClick={() => window.confirm("Reset all UFW rules?") && run(() => api.ufw({ operation: "reset" }), "UFW reset")}>Reset</button>
          </div>
        </section>

        <section className="manager-section">
          <h3>Default policy</h3>
          <div className="form-grid three">
            <label>
              Policy
              <select value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="reject">Reject</option>
              </select>
            </label>
            <label>
              Direction
              <select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}>
                <option value="incoming">Incoming</option>
                <option value="outgoing">Outgoing</option>
                <option value="routed">Routed</option>
              </select>
            </label>
            <button onClick={() => run(() => api.ufw({ operation: "default", policy, direction }), "UFW default policy changed")}>
              Apply
            </button>
          </div>
        </section>

        <section className="manager-section">
          <h3>Rule</h3>
          <div className="form-grid">
            <label>
              Operation
              <select value={operation} onChange={(event) => setOperation(event.target.value as typeof operation)}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
                <option value="reject">Reject</option>
                <option value="limit">Limit</option>
                <option value="delete">Delete</option>
              </select>
            </label>
            {operation === "delete" && (
              <label>
                Delete type
                <select value={ruleAction} onChange={(event) => setRuleAction(event.target.value as typeof ruleAction)}>
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                  <option value="reject">Reject</option>
                  <option value="limit">Limit</option>
                </select>
              </label>
            )}
            {operation === "delete" && (
              <label>
                Rule number
                <input placeholder="Optional" value={ruleNumber} type="number" min={1} onChange={(event) => setRuleNumber(event.target.value)} />
              </label>
            )}
            <label>
              Protocol
              <select value={protocol} onChange={(event) => setProtocol(event.target.value as typeof protocol)}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </label>
            <label>
              Port
              <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
            </label>
            <label>
              From
              <input placeholder="Any source" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              To
              <input placeholder="Any destination" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </div>
          <div className="modal-actions">
            <button onClick={submitRule}>Apply rule</button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function IPTablesDialog({
  api,
  run,
  onClose
}: {
  api: AgentApi;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<"append" | "insert" | "delete" | "policy" | "flush" | "zero">("append");
  const [table, setTable] = useState<"filter" | "nat" | "mangle" | "raw" | "security">("filter");
  const [chain, setChain] = useState<"INPUT" | "OUTPUT" | "FORWARD" | "PREROUTING" | "POSTROUTING">("INPUT");
  const [protocol, setProtocol] = useState<"" | "tcp" | "udp" | "icmp">("tcp");
  const [target, setTarget] = useState<"ACCEPT" | "DROP" | "REJECT" | "LOG" | "RETURN" | "MASQUERADE" | "DNAT" | "SNAT">("ACCEPT");
  const [sport, setSport] = useState("");
  const [dport, setDport] = useState("443");
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [inInterface, setInInterface] = useState("");
  const [outInterface, setOutInterface] = useState("");

  const submit = () =>
    (operation !== "flush" && operation !== "zero" || window.confirm(`Apply iptables ${operation} to ${table}/${chain}?`)) &&
    run(
      () =>
        api.iptables({
          operation,
          table,
          chain,
          protocol: protocol || undefined,
          sport: sport ? Number(sport) : undefined,
          dport: dport ? Number(dport) : undefined,
          source: source || undefined,
          destination: destination || undefined,
          inInterface: inInterface || undefined,
          outInterface: outInterface || undefined,
          target
        }),
      "iptables command applied"
    );

  return (
    <Modal title="iptables Manager" onClose={onClose}>
      <div className="firewall-manager">
        <section className="manager-section">
          <h3>Command</h3>
          <div className="form-grid three">
            <label>
              Operation
              <select value={operation} onChange={(event) => setOperation(event.target.value as typeof operation)}>
                <option value="append">Append rule</option>
                <option value="insert">Insert rule</option>
                <option value="delete">Delete rule</option>
                <option value="policy">Set policy</option>
                <option value="flush">Flush chain</option>
                <option value="zero">Zero counters</option>
              </select>
            </label>
            <label>
              Table
              <select value={table} onChange={(event) => setTable(event.target.value as typeof table)}>
                <option value="filter">filter</option>
                <option value="nat">nat</option>
                <option value="mangle">mangle</option>
                <option value="raw">raw</option>
                <option value="security">security</option>
              </select>
            </label>
            <label>
              Chain
              <select value={chain} onChange={(event) => setChain(event.target.value as typeof chain)}>
                <option value="INPUT">INPUT</option>
                <option value="OUTPUT">OUTPUT</option>
                <option value="FORWARD">FORWARD</option>
                <option value="PREROUTING">PREROUTING</option>
                <option value="POSTROUTING">POSTROUTING</option>
              </select>
            </label>
          </div>
        </section>

        <section className="manager-section">
          <h3>Match</h3>
          <div className="form-grid">
            <label>
              Protocol
              <select value={protocol} onChange={(event) => setProtocol(event.target.value as typeof protocol)}>
                <option value="">Any</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
              </select>
            </label>
            <label>
              Source port
              <input value={sport} type="number" min={1} max={65535} onChange={(event) => setSport(event.target.value)} />
            </label>
            <label>
              Destination port
              <input value={dport} type="number" min={1} max={65535} onChange={(event) => setDport(event.target.value)} />
            </label>
            <label>
              Source
              <input placeholder="0.0.0.0/0" value={source} onChange={(event) => setSource(event.target.value)} />
            </label>
            <label>
              Destination
              <input placeholder="0.0.0.0/0" value={destination} onChange={(event) => setDestination(event.target.value)} />
            </label>
            <label>
              Input interface
              <input placeholder="eth0" value={inInterface} onChange={(event) => setInInterface(event.target.value)} />
            </label>
            <label>
              Output interface
              <input placeholder="eth0" value={outInterface} onChange={(event) => setOutInterface(event.target.value)} />
            </label>
            <label>
              Target
              <select value={target} onChange={(event) => setTarget(event.target.value as typeof target)}>
                <option value="ACCEPT">ACCEPT</option>
                <option value="DROP">DROP</option>
                <option value="REJECT">REJECT</option>
                <option value="LOG">LOG</option>
                <option value="RETURN">RETURN</option>
                <option value="MASQUERADE">MASQUERADE</option>
                <option value="DNAT">DNAT</option>
                <option value="SNAT">SNAT</option>
              </select>
            </label>
          </div>
          <div className="modal-actions">
            <button className={operation === "flush" || operation === "zero" ? "danger" : ""} onClick={submit}>
              Apply command
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return <span className={`pill ${active ? "ok" : "muted"}`}>{formatStatusLabel(label)}</span>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="modal">
        <header>
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} title="Close">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next.toFixed(next >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatStatusLabel(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default App;
