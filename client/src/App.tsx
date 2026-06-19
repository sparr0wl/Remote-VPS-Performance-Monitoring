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
  Network,
  Plus,
  PlugZap,
  Power,
  RefreshCw,
  Save,
  Search,
  Server,
  Shield,
  SquareTerminal,
  Trash2,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [nextMetrics, nextServices, nextFirewall, nextIntegrations] = await Promise.all([
        api.metrics(),
        api.services(),
        api.firewall(),
        api.integrations()
      ]);
      setMetrics(nextMetrics);
      setServices(nextServices);
      setFirewall(nextFirewall);
      setIntegrations(nextIntegrations);
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      setStatus(message);
      await refresh();
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
      "SSH opened"
    );
  };

  const testConnection = async () => {
    await run(() => api.health(), "Connection OK");
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

        <details className="connection-card" open>
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
            <button className="secondary" onClick={refresh} disabled={busy} title="Refresh">
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
              <div className="search">
                <Search size={16} />
                <input placeholder="Filter services" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} />
              </div>
            </div>
            <div className="service-list">
              {filteredServices.slice(0, 160).map((service) => (
                <ServiceRow key={service.name} service={service} api={api} run={run} setSelectedLog={setSelectedLog} />
              ))}
            </div>
          </section>
        )}

        {tab === "firewall" && (
          <FirewallPanel firewall={firewall} api={api} run={run} />
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
      <div>
        <div className="integration-title">
          <PlugZap size={18} />
          <h2>{item.name}</h2>
        </div>
        <p>{item.serviceName}</p>
      </div>
      <StatusPill active={item.service?.activeState === "active"} label={item.service?.activeState ?? "unknown"} />
      <div className="button-row">
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
  run
}: {
  firewall: FirewallStatus | null;
  api: AgentApi;
  run: (action: () => Promise<unknown>, message: string) => Promise<void>;
}) {
  const [port, setPort] = useState(443);
  return (
    <section className="firewall-grid">
      <article className="panel">
        <div className="panel-head">
          <h2>UFW</h2>
          <StatusPill active={Boolean(firewall?.ufwAvailable)} label={firewall?.ufwAvailable ? "available" : "missing"} />
        </div>
        <div className="rule-form">
          <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} />
          <button onClick={() => run(() => api.ufw("allow", port), "UFW rule added")}>Allow</button>
          <button className="secondary" onClick={() => run(() => api.ufw("delete", port), "UFW rule deleted")}>Delete</button>
        </div>
        <pre className="logs compact">{firewall?.ufwStatus || "UFW status unavailable"}</pre>
      </article>

      <article className="panel">
        <div className="panel-head">
          <h2>iptables</h2>
          <StatusPill active={Boolean(firewall?.iptablesAvailable)} label={firewall?.iptablesAvailable ? "available" : "missing"} />
        </div>
        <div className="rule-form">
          <button
            onClick={() =>
              run(
                () => api.iptables({ operation: "add", chain: "INPUT", protocol: "tcp", dport: port, target: "ACCEPT" }),
                "iptables rule added"
              )
            }
          >
            Accept TCP
          </button>
          <button
            className="secondary"
            onClick={() =>
              run(
                () => api.iptables({ operation: "delete", chain: "INPUT", protocol: "tcp", dport: port, target: "ACCEPT" }),
                "iptables rule deleted"
              )
            }
          >
            Delete TCP
          </button>
        </div>
        <pre className="logs compact">{firewall?.iptablesRules.join("\n") || "iptables rules unavailable"}</pre>
      </article>
    </section>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return <span className={`pill ${active ? "ok" : "muted"}`}>{label}</span>;
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

export default App;
