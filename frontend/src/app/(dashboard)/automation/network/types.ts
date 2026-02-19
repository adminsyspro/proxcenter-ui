import * as firewallAPI from '@/lib/api/firewall'

export interface EditingRule {
  groupName: string
  rule: firewallAPI.FirewallRule
  index: number
}

export const GROUP_COLORS = [
  '#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#10b981', '#6366f1', '#f97316', '#14b8a6', '#a855f7',
  '#eab308', '#84cc16'
]

export const getGroupColor = (index: number): string => GROUP_COLORS[index % GROUP_COLORS.length]

export const monoStyle = { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace', fontSize: 13 }

export const DEFAULT_RULE: firewallAPI.CreateRuleRequest = {
  type: 'in', action: 'ACCEPT', enable: 1, proto: '', dport: '', sport: '', source: '', dest: '', macro: '', iface: '', log: 'nolog', comment: ''
}

// ── DFW Policy types ──

export type PolicyCategory = 'infrastructure' | 'application' | 'default'

export interface PolicySection {
  id: string                    // SG name or '__cluster__'
  category: PolicyCategory
  type: 'security-group' | 'cluster'
  name: string
  comment?: string
  rules: firewallAPI.FirewallRule[]
  appliedTo: { vmid: number; name: string; node: string }[]
  ruleCount: number
  activeRuleCount: number
}

export const INFRASTRUCTURE_PREFIXES = ['sg-base-', 'sg-pve-', 'sg-infra-', 'sg-mgmt-']

export function classifySG(name: string): PolicyCategory {
  const lower = name.toLowerCase()
  return INFRASTRUCTURE_PREFIXES.some(p => lower.startsWith(p)) ? 'infrastructure' : 'application'
}
