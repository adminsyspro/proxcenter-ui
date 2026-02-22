// src/lib/api/firewall.ts

// ================================================================================
// TYPES
// ================================================================================

export type FirewallMode = 'cluster' | 'standalone'

export interface ConnectionFirewallInfo {
  mode: FirewallMode
  node_count: number
  primary_node: string
  cluster_name?: string
  has_cluster_fw: boolean
  has_node_fw: boolean
}

export interface Alias {
  name: string
  cidr: string
  comment?: string
  digest?: string
}

export interface IPSet {
  name: string
  comment?: string
  digest?: string
  members?: IPSetEntry[]
}

export interface IPSetEntry {
  cidr: string
  comment?: string
  nomatch?: boolean
  digest?: string
}

export interface SecurityGroup {
  group: string
  comment?: string
  digest?: string
  rules?: FirewallRule[]
}

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
  digest?: string
}

export interface ClusterOptions {
  enable?: number
  policy_in?: string
  policy_out?: string
  digest?: string
}

export interface NodeOptions {
  enable?: number
  policy_in?: string
  policy_out?: string
  log_level_in?: string
  log_level_out?: string
  digest?: string
}

export interface VMOptions {
  enable?: number
  policy_in?: string
  policy_out?: string
  log_level_in?: string
  log_level_out?: string
  digest?: string
}

export interface FirewallStatus {
  cluster_enabled: boolean
  status: string
  total_aliases: number
  total_ipsets: number
  total_groups: number
  total_cluster_rules: number
  protected_nodes: number
  total_nodes: number
  protected_vms: number
  total_vms: number
}

export interface CreateAliasRequest {
  name: string
  cidr: string
  comment?: string
}

export interface CreateIPSetRequest {
  name: string
  comment?: string
}

export interface AddIPSetEntryRequest {
  cidr: string
  comment?: string
  nomatch?: boolean
}

export interface CreateSecurityGroupRequest {
  group: string
  comment?: string
}

export interface CreateRuleRequest {
  type?: string
  action?: string
  enable?: number
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  macro?: string
  group?: string
  iface?: string
  log?: string
  comment?: string
  pos?: number
  moveto?: number  // For moving rules to new position
}

export interface UpdateOptionsRequest {
  enable?: number
  policy_in?: string
  policy_out?: string
  log_level_in?: string
  log_level_out?: string
}

// ================================================================================
// HELPER
// ================================================================================

async function fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))

    throw new Error(error.error || `HTTP ${response.status}`)
  }

  return response.json()
}

// ================================================================================
// CONNECTION INFO
// ================================================================================

export async function getConnectionFirewallInfo(connectionId: string): Promise<ConnectionFirewallInfo> {
  return fetchAPI<ConnectionFirewallInfo>(`/api/v1/firewall/info/${connectionId}`)
}

// ================================================================================
// STATUS
// ================================================================================

export async function getFirewallStatus(connectionId: string): Promise<FirewallStatus> {
  return fetchAPI<FirewallStatus>(`/api/v1/firewall?connectionId=${connectionId}`)
}

// ================================================================================
// ALIASES
// ================================================================================

export async function getAliases(connectionId: string): Promise<Alias[]> {
  return fetchAPI<Alias[]>(`/api/v1/firewall/aliases/${connectionId}`)
}

export async function createAlias(connectionId: string, data: CreateAliasRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/aliases/${connectionId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateAlias(connectionId: string, name: string, data: { cidr: string; comment?: string }): Promise<void> {
  await fetchAPI(`/api/v1/firewall/aliases/${connectionId}/${name}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteAlias(connectionId: string, name: string): Promise<void> {
  await fetchAPI(`/api/v1/firewall/aliases/${connectionId}/${name}`, {
    method: 'DELETE',
  })
}

// ================================================================================
// IP SETS
// ================================================================================

export async function getIPSets(connectionId: string): Promise<IPSet[]> {
  return fetchAPI<IPSet[]>(`/api/v1/firewall/ipsets/${connectionId}`)
}

export async function createIPSet(connectionId: string, data: CreateIPSetRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/ipsets/${connectionId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteIPSet(connectionId: string, name: string): Promise<void> {
  await fetchAPI(`/api/v1/firewall/ipsets/${connectionId}/${name}`, {
    method: 'DELETE',
  })
}

export async function addIPSetEntry(connectionId: string, ipsetName: string, data: AddIPSetEntryRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/ipsets/${connectionId}/${ipsetName}/entries`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteIPSetEntry(connectionId: string, ipsetName: string, cidr: string): Promise<void> {
  await fetchAPI(`/api/v1/firewall/ipsets/${connectionId}/${ipsetName}/entries/${encodeURIComponent(cidr)}`, {
    method: 'DELETE',
  })
}

// ================================================================================
// SECURITY GROUPS
// ================================================================================

export async function getSecurityGroups(connectionId: string): Promise<SecurityGroup[]> {
  return fetchAPI<SecurityGroup[]>(`/api/v1/firewall/groups/${connectionId}`)
}

export async function createSecurityGroup(connectionId: string, data: CreateSecurityGroupRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/groups/${connectionId}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteSecurityGroup(connectionId: string, name: string): Promise<void> {
  await fetchAPI(`/api/v1/firewall/groups/${connectionId}/${name}`, {
    method: 'DELETE',
  })
}

export async function addSecurityGroupRule(connectionId: string, groupName: string, data: CreateRuleRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/groups/${connectionId}/${groupName}/rules`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteSecurityGroupRule(connectionId: string, groupName: string, pos: number): Promise<void> {
  await fetchAPI(`/api/v1/firewall/groups/${connectionId}/${groupName}/rules/${pos}`, {
    method: 'DELETE',
  })
}

export async function updateSecurityGroupRule(connectionId: string, groupName: string, pos: number, data: CreateRuleRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/groups/${connectionId}/${groupName}/rules/${pos}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ================================================================================
// CLUSTER OPTIONS
// ================================================================================

export async function getClusterOptions(connectionId: string): Promise<ClusterOptions> {
  return fetchAPI<ClusterOptions>(`/api/v1/firewall/cluster/${connectionId}?type=options`)
}

export async function getClusterRules(connectionId: string): Promise<FirewallRule[]> {
  return fetchAPI<FirewallRule[]>(`/api/v1/firewall/cluster/${connectionId}?type=rules`)
}

export async function updateClusterOptions(connectionId: string, data: UpdateOptionsRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/cluster/${connectionId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function addClusterRule(connectionId: string, data: CreateRuleRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/cluster/${connectionId}/rules`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteClusterRule(connectionId: string, pos: number): Promise<void> {
  await fetchAPI(`/api/v1/firewall/cluster/${connectionId}/rules/${pos}`, {
    method: 'DELETE',
  })
}

// ================================================================================
// NODE OPTIONS
// ================================================================================

export async function getNodeOptions(connectionId: string, node: string): Promise<NodeOptions> {
  return fetchAPI<NodeOptions>(`/api/v1/firewall/nodes/${connectionId}/${node}?type=options`)
}

export async function getNodeRules(connectionId: string, node: string): Promise<FirewallRule[]> {
  return fetchAPI<FirewallRule[]>(`/api/v1/firewall/nodes/${connectionId}/${node}?type=rules`)
}

export async function updateNodeOptions(connectionId: string, node: string, data: UpdateOptionsRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/nodes/${connectionId}/${node}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function addNodeRule(connectionId: string, node: string, data: CreateRuleRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/nodes/${connectionId}/${node}/rules`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deleteNodeRule(connectionId: string, node: string, pos: number): Promise<void> {
  await fetchAPI(`/api/v1/firewall/nodes/${connectionId}/${node}/rules/${pos}`, {
    method: 'DELETE',
  })
}

// ================================================================================
// VM OPTIONS
// ================================================================================

export async function getVMOptions(connectionId: string, node: string, vmType: string, vmid: number): Promise<VMOptions> {
  return fetchAPI<VMOptions>(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}?type=options`)
}

export async function updateVMOptions(connectionId: string, node: string, vmType: string, vmid: number, data: UpdateOptionsRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function toggleVMNICFirewall(connectionId: string, node: string, vmType: string, vmid: number, enable: boolean): Promise<void> {
  await fetchAPI(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/nic-firewall`, {
    method: 'PUT',
    body: JSON.stringify({ enable }),
  })
}

// ================================================================================
// VM FIREWALL LOGS
// ================================================================================

export interface FirewallLogEntry {
  n: number
  t: string
}

export async function getVMFirewallLog(connectionId: string, node: string, vmType: string, vmid: number, limit = 50): Promise<FirewallLogEntry[]> {
  return fetchAPI<FirewallLogEntry[]>(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/log?limit=${limit}`)
}

export async function getVMRules(connectionId: string, node: string, vmType: string, vmid: number): Promise<FirewallRule[]> {
  return fetchAPI<FirewallRule[]>(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}?type=rules`)
}

export async function addVMRule(connectionId: string, node: string, vmType: string, vmid: number, data: CreateRuleRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateVMRule(connectionId: string, node: string, vmType: string, vmid: number, pos: number, data: CreateRuleRequest): Promise<void> {
  await fetchAPI(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules/${pos}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteVMRule(connectionId: string, node: string, vmType: string, vmid: number, pos: number): Promise<void> {
  await fetchAPI(`/api/v1/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules/${pos}`, {
    method: 'DELETE',
  })
}
