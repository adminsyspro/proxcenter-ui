/* ═══════════════════════════════════════════════════════════════════════════
   Security Map — Types
═══════════════════════════════════════════════════════════════════════════ */

// ── Node Data (React Flow v12 requires index signature) ──

export interface SecurityZoneVM {
  vmid: number
  name: string
  status: string
  isIsolated: boolean
  firewallEnabled: boolean
  appliedSgs: string[]
  node: string
}

export interface SecurityZoneNodeData {
  [key: string]: unknown
  label: string
  cidr: string
  gateway: string
  hasGateway: boolean
  hasBaseSg: boolean
  zoneIndex: number
  vms: SecurityZoneVM[]
  width: number
  height: number
}

export interface InternetNodeData {
  [key: string]: unknown
  label: string
  width: number
  height: number
}

export interface ClusterFirewallNodeData {
  [key: string]: unknown
  label: string
  enabled: boolean
  policyIn: string
  policyOut: string
  ruleCount: number
  width: number
  height: number
}

// ── Sidebar ──

export interface EdgeFlowData {
  sourceZone: string
  targetZone: string
  status: FlowStatus
  rules: FirewallRule[]
  protocolSummary: string
}

export type SelectedMapItem =
  | { type: 'zone'; data: SecurityZoneNodeData }
  | { type: 'vm'; data: SecurityZoneVM & { zoneName: string; zoneCidr: string } }
  | { type: 'edge'; data: EdgeFlowData }
  | { type: 'internet'; data: InternetNodeData }
  | { type: 'clusterFirewall'; data: ClusterFirewallNodeData }

// ── Flow Matrix ──

export type FlowStatus = 'allowed' | 'blocked' | 'partial' | 'self'

export interface FlowMatrixCell {
  from: string
  to: string
  status: FlowStatus
  rules: FirewallRule[]
  summary: string
}

export interface FlowMatrixData {
  labels: string[]
  matrix: FlowMatrixCell[][]
}

// ── Filters ──

export interface SecurityMapFilters {
  hideInfraNetworks: boolean
  hideStoppedVms: boolean
}

// ── Re-exported from existing API types ──

export interface FirewallRule {
  pos?: number
  type: string
  action: string
  enable?: number
  comment?: string
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  iface?: string
  macro?: string
  log?: string
}

export interface NetworkInfo {
  name: string
  cidr: string
  comment: string
  gateway: string
  has_gateway: boolean
  has_base_sg: boolean
}

export interface MicrosegAnalysis {
  networks: NetworkInfo[]
  gateway_aliases: string[]
  base_sgs: string[]
  missing_gateways: any[]
  missing_base_sgs: any[]
  total_vms: number
  isolated_vms: number
  unprotected_vms: number
  segmentation_ready: boolean
}

export interface VMSegmentationSummary {
  vmid: number
  name: string
  node: string
  type: string
  status: string
  network: string
  networks: string[]
  firewall_enabled: boolean
  is_isolated: boolean
  missing_base_sgs: string[]
  applied_sgs: string[]
}

export interface VMListForSegmentation {
  total_vms: number
  isolated_vms: number
  unprotected_vms: number
  vms: VMSegmentationSummary[]
}
