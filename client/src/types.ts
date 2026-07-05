export type Profile = {
  id: string;
  name: string;
  endpoint: string;
  token: string;
  sshUser: string;
  sshHost: string;
  sshPort: number;
};

export type Metrics = {
  hostname: string;
  os: string;
  uptimeSeconds: number;
  loadAverage: number[];
  cpu: { percent: number; cores: number };
  memory: { total: number; available: number; used: number; usedPercent: number };
  disk: { mount: string; total: number; free: number; used: number; usedPercent: number };
  network: Array<{ interface: string; rxBytes: number; txBytes: number }>;
  time: string;
};

export type Service = {
  name: string;
  loadState: string;
  activeState: string;
  subState: string;
  unitFileState?: string;
  description: string;
};

export type FirewallStatus = {
  ufwAvailable: boolean;
  ufwStatus: string;
  iptablesAvailable: boolean;
  iptablesRules: IPTablesRule[];
};

export type IPTablesRule = {
  table: "filter" | "nat" | "mangle" | "raw" | "security" | string;
  chain?: string;
  number?: number;
  rule: string;
};

export type Integration = {
  id: "caddy" | "xray";
  name: string;
  installed: boolean;
  binary?: string;
  serviceName: string;
  configPath?: string;
  service?: Service;
};

export type CommandResult = {
  output: string;
  error?: string;
};

export type ConfigFile = {
  path: string;
  content: string;
};
