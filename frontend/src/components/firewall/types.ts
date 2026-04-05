export interface FirewallRule {
  pos: number
  type: string
  action: string
  enable?: number
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  macro?: string
  iface?: string
  log?: string
  comment?: string
}

export interface SecurityGroup {
  group: string
  name?: string
  comment?: string
  rules?: FirewallRule[]
}

export interface FirewallOptions {
  enable?: number
  dhcp?: number
  ipfilter?: number
  log_level_in?: string
  log_level_out?: string
  macfilter?: number
  ndp?: number
  policy_in?: string
  policy_out?: string
  radv?: number
  log_nf_conntrack?: number
  nf_conntrack_max?: number
  nosmurfs?: number
  protection_synflood?: number
  smurf_log_level?: string
  tcp_flags_log_level?: string
  tcpflags?: number
  log_ratelimit?: string
  ebtables?: number
}

export interface NicInfo {
  id: string
  bridge: string
  firewall: boolean
  mac?: string
  model?: string
}

export interface FirewallLogEntry {
  n: number
  t: string
}

/**
 * API adapter interface. Each scope (VM, Node, Cluster) provides its own implementation.
 */
export interface FirewallAPIAdapter {
  getOptions: () => Promise<any>
  getRules: () => Promise<any[]>
  getGroups: () => Promise<any[]>
  updateOptions: (data: any) => Promise<void>
  addRule: (data: any) => Promise<void>
  updateRule: (pos: number, data: any) => Promise<void>
  deleteRule: (pos: number) => Promise<void>
}

export interface SnackbarState {
  open: boolean
  message: string
  severity: 'success' | 'error'
}
