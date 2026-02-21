/* ═══════════════════════════════════════════════════════════════════════════
   Flow Matrix — Types
═══════════════════════════════════════════════════════════════════════════ */

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
