// src/lib/firewall/pveDirect.ts
// Direct-PVE mirror of the Go orchestrator's firewall service
// (proxcenter-backend internal/firewall/service.go), used as the Community
// fallback when no orchestrator is running (#616).
//
// Contract: every function resolves to the exact body the matching
// orchestrator endpoint returns — BARE arrays/objects for reads (never
// `{ data: ... }`: the routes re-wrap with NextResponse.json and
// normalizeRules in components/firewall/shared.tsx does an Array.isArray
// check, so a wrapper would silently empty every list) and the
// handler-level `{ status: 'created' | 'updated' | 'deleted' }` object for
// writes. Every function takes the connection from getConnectionById(id)
// as its first argument.

import { pveFetch } from '@/lib/proxmox/client'
import { safeLog } from '@/lib/log/sanitize'

import type { PveConn } from '@/lib/connections/getConnection'
import type {
  Alias,
  IPSet,
  IPSetEntry,
  SecurityGroup,
  FirewallRule,
  ClusterOptions,
  NodeOptions,
  VMOptions,
  FirewallStatus,
  FirewallLogEntry,
  CreateAliasRequest,
  CreateIPSetRequest,
  AddIPSetEntryRequest,
  CreateSecurityGroupRequest,
  CreateRuleRequest,
  UpdateOptionsRequest,
} from '@/lib/api/firewall'

/** Mirrors the Go UpdateRuleRequest: a partial rule plus optional moveto. */
export interface UpdateRuleRequest {
  type?: string
  action?: string
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
  moveto?: number
}

export interface UpdateAliasRequest {
  cidr: string
  comment?: string
}

/** Body the orchestrator's write handlers respond with. */
export interface StatusBody {
  status: string
}

// ================================================================================
// REQUEST HELPERS
// Writes go as application/x-www-form-urlencoded (URLSearchParams), exactly
// like the Go client.RequestForm — pveFetch sets the content type for us.
// ================================================================================

async function postForm(conn: PveConn, path: string, form: URLSearchParams): Promise<StatusBody> {
  await pveFetch(conn, path, { method: 'POST', body: form })
  return { status: 'created' }
}

async function putForm(conn: PveConn, path: string, form: URLSearchParams): Promise<StatusBody> {
  await pveFetch(conn, path, { method: 'PUT', body: form })
  return { status: 'updated' }
}

async function del(conn: PveConn, path: string): Promise<StatusBody> {
  await pveFetch(conn, path, { method: 'DELETE' })
  return { status: 'deleted' }
}

/** Set a form field only when the value is a non-empty string (Go: `!= ""`). */
function setIf(form: URLSearchParams, key: string, value: string | undefined): void {
  if (value) form.set(key, value)
}

// ================================================================================
// FORM BUILDERS (mirror Go ruleToForm / updateRuleToForm / UpdateXxxOptions)
// ================================================================================

function ruleToForm(rule: CreateRuleRequest): URLSearchParams {
  const form = new URLSearchParams()

  form.set('type', rule.type ?? '')
  form.set('action', rule.action ?? '')

  // Intentional divergence from the Go service: its non-pointer `Enable int`
  // cannot tell "absent" from 0, so ruleToForm coerces enable: 0 to 1 and
  // creating a disabled rule is impossible there. Here we keep the contract
  // (absent → 1) but honour an explicit 0. No UI path sends 0 on create, so
  // this diverges in no case the product produces — do not "fix" it back.
  form.set('enable', String(rule.enable ?? 1))

  setIf(form, 'source', rule.source)
  setIf(form, 'dest', rule.dest)
  setIf(form, 'proto', rule.proto)
  setIf(form, 'dport', rule.dport)
  setIf(form, 'sport', rule.sport)
  setIf(form, 'macro', rule.macro)
  setIf(form, 'group', rule.group)
  setIf(form, 'iface', rule.iface)
  setIf(form, 'log', rule.log)
  setIf(form, 'comment', rule.comment)
  if ((rule.pos ?? 0) > 0) form.set('pos', String(rule.pos))

  return form
}

function updateRuleToForm(rule: UpdateRuleRequest): URLSearchParams {
  const form = new URLSearchParams()

  setIf(form, 'type', rule.type)
  setIf(form, 'action', rule.action)
  // Pointer semantics in Go: only send enable when the caller provided it,
  // and send an explicit 0 as-is.
  if (rule.enable != null) form.set('enable', String(rule.enable))
  setIf(form, 'source', rule.source)
  setIf(form, 'dest', rule.dest)
  setIf(form, 'proto', rule.proto)
  setIf(form, 'dport', rule.dport)
  setIf(form, 'sport', rule.sport)
  setIf(form, 'macro', rule.macro)
  setIf(form, 'iface', rule.iface)
  setIf(form, 'log', rule.log)
  setIf(form, 'comment', rule.comment)
  if (rule.moveto != null) form.set('moveto', String(rule.moveto))

  return form
}

function optionsToForm(req: UpdateOptionsRequest): URLSearchParams {
  const form = new URLSearchParams()

  // Pointer semantics in Go: send only the fields present in the body,
  // including explicit zero/empty values.
  if (req.enable != null) form.set('enable', String(req.enable))
  if (req.policy_in != null) form.set('policy_in', req.policy_in)
  if (req.policy_out != null) form.set('policy_out', req.policy_out)
  if (req.log_level_in != null) form.set('log_level_in', req.log_level_in)
  if (req.log_level_out != null) form.set('log_level_out', req.log_level_out)

  return form
}

// ================================================================================
// CLUSTER-LEVEL ALIASES
// ================================================================================

export async function getAliases(conn: PveConn): Promise<Alias[]> {
  return (await pveFetch<Alias[]>(conn, '/cluster/firewall/aliases')) ?? []
}

export async function createAlias(conn: PveConn, req: CreateAliasRequest): Promise<StatusBody> {
  const form = new URLSearchParams()

  form.set('name', req.name)
  form.set('cidr', req.cidr)
  setIf(form, 'comment', req.comment)

  return postForm(conn, '/cluster/firewall/aliases', form)
}

export async function updateAlias(conn: PveConn, name: string, req: UpdateAliasRequest): Promise<StatusBody> {
  const form = new URLSearchParams()

  form.set('cidr', req.cidr)
  setIf(form, 'comment', req.comment)

  return putForm(conn, `/cluster/firewall/aliases/${encodeURIComponent(name)}`, form)
}

export async function deleteAlias(conn: PveConn, name: string): Promise<StatusBody> {
  return del(conn, `/cluster/firewall/aliases/${encodeURIComponent(name)}`)
}

// ================================================================================
// CLUSTER-LEVEL IPSETS
// ================================================================================

async function getIPSetMembers(conn: PveConn, name: string): Promise<IPSetEntry[]> {
  return (await pveFetch<IPSetEntry[]>(conn, `/cluster/firewall/ipset/${encodeURIComponent(name)}`)) ?? []
}

export async function getIPSets(conn: PveConn): Promise<IPSet[]> {
  const ipsets = (await pveFetch<IPSet[]>(conn, '/cluster/firewall/ipset')) ?? []

  // Load members for each IP set; a failing set is returned without members
  // (mirrors the Go warn-and-continue).
  for (const ipset of ipsets) {
    try {
      ipset.members = await getIPSetMembers(conn, ipset.name)
    } catch (e) {
      console.warn(`[firewall/pve] failed to get IP set members for ${safeLog(ipset.name)}:`, e)
    }
  }

  return ipsets
}

export async function createIPSet(conn: PveConn, req: CreateIPSetRequest): Promise<StatusBody> {
  const form = new URLSearchParams()

  form.set('name', req.name)
  setIf(form, 'comment', req.comment)

  return postForm(conn, '/cluster/firewall/ipset', form)
}

export async function deleteIPSet(conn: PveConn, name: string): Promise<StatusBody> {
  return del(conn, `/cluster/firewall/ipset/${encodeURIComponent(name)}`)
}

export async function addIPSetEntry(conn: PveConn, ipsetName: string, req: AddIPSetEntryRequest): Promise<StatusBody> {
  const form = new URLSearchParams()

  form.set('cidr', req.cidr)
  setIf(form, 'comment', req.comment)
  if (req.nomatch) form.set('nomatch', '1')

  return postForm(conn, `/cluster/firewall/ipset/${encodeURIComponent(ipsetName)}`, form)
}

export async function deleteIPSetEntry(conn: PveConn, ipsetName: string, cidr: string): Promise<StatusBody> {
  // The CIDR contains a slash — encode it like the Go url.PathEscape
  return del(conn, `/cluster/firewall/ipset/${encodeURIComponent(ipsetName)}/${encodeURIComponent(cidr)}`)
}

// ================================================================================
// SECURITY GROUPS
// ================================================================================

async function getSecurityGroupRules(conn: PveConn, groupName: string): Promise<FirewallRule[]> {
  return (await pveFetch<FirewallRule[]>(conn, `/cluster/firewall/groups/${encodeURIComponent(groupName)}`)) ?? []
}

export async function getSecurityGroups(conn: PveConn): Promise<SecurityGroup[]> {
  const groups = (await pveFetch<SecurityGroup[]>(conn, '/cluster/firewall/groups')) ?? []

  // Load rules for each group; a failing group is returned without rules
  // (mirrors the Go warn-and-continue).
  for (const group of groups) {
    try {
      group.rules = await getSecurityGroupRules(conn, group.group)
    } catch (e) {
      console.warn(`[firewall/pve] failed to get security group rules for ${safeLog(group.group)}:`, e)
    }
  }

  return groups
}

export async function createSecurityGroup(conn: PveConn, req: CreateSecurityGroupRequest): Promise<StatusBody> {
  const form = new URLSearchParams()

  form.set('group', req.group)
  setIf(form, 'comment', req.comment)

  return postForm(conn, '/cluster/firewall/groups', form)
}

export async function deleteSecurityGroup(conn: PveConn, name: string): Promise<StatusBody> {
  return del(conn, `/cluster/firewall/groups/${encodeURIComponent(name)}`)
}

export async function addSecurityGroupRule(conn: PveConn, groupName: string, req: CreateRuleRequest): Promise<StatusBody> {
  return postForm(conn, `/cluster/firewall/groups/${encodeURIComponent(groupName)}`, ruleToForm(req))
}

export async function updateSecurityGroupRule(conn: PveConn, groupName: string, pos: number | string, req: UpdateRuleRequest): Promise<StatusBody> {
  return putForm(conn, `/cluster/firewall/groups/${encodeURIComponent(groupName)}/${pos}`, updateRuleToForm(req))
}

export async function deleteSecurityGroupRule(conn: PveConn, groupName: string, pos: number | string): Promise<StatusBody> {
  return del(conn, `/cluster/firewall/groups/${encodeURIComponent(groupName)}/${pos}`)
}

// ================================================================================
// CLUSTER-LEVEL RULES & OPTIONS
// ================================================================================

export async function getClusterRules(conn: PveConn): Promise<FirewallRule[]> {
  return (await pveFetch<FirewallRule[]>(conn, '/cluster/firewall/rules')) ?? []
}

export async function addClusterRule(conn: PveConn, req: CreateRuleRequest): Promise<StatusBody> {
  return postForm(conn, '/cluster/firewall/rules', ruleToForm(req))
}

export async function updateClusterRule(conn: PveConn, pos: number | string, req: UpdateRuleRequest): Promise<StatusBody> {
  return putForm(conn, `/cluster/firewall/rules/${pos}`, updateRuleToForm(req))
}

export async function deleteClusterRule(conn: PveConn, pos: number | string): Promise<StatusBody> {
  return del(conn, `/cluster/firewall/rules/${pos}`)
}

export async function getClusterOptions(conn: PveConn): Promise<ClusterOptions> {
  return await pveFetch<ClusterOptions>(conn, '/cluster/firewall/options')
}

export async function updateClusterOptions(conn: PveConn, req: UpdateOptionsRequest): Promise<StatusBody> {
  return putForm(conn, '/cluster/firewall/options', optionsToForm(req))
}

// ================================================================================
// NODE-LEVEL FIREWALL
// ================================================================================

export async function getNodeOptions(conn: PveConn, node: string): Promise<NodeOptions> {
  return await pveFetch<NodeOptions>(conn, `/nodes/${node}/firewall/options`)
}

export async function updateNodeOptions(conn: PveConn, node: string, req: UpdateOptionsRequest): Promise<StatusBody> {
  return putForm(conn, `/nodes/${node}/firewall/options`, optionsToForm(req))
}

export async function getNodeRules(conn: PveConn, node: string): Promise<FirewallRule[]> {
  return (await pveFetch<FirewallRule[]>(conn, `/nodes/${node}/firewall/rules`)) ?? []
}

export async function addNodeRule(conn: PveConn, node: string, req: CreateRuleRequest): Promise<StatusBody> {
  return postForm(conn, `/nodes/${node}/firewall/rules`, ruleToForm(req))
}

export async function updateNodeRule(conn: PveConn, node: string, pos: number | string, req: UpdateRuleRequest): Promise<StatusBody> {
  return putForm(conn, `/nodes/${node}/firewall/rules/${pos}`, updateRuleToForm(req))
}

export async function deleteNodeRule(conn: PveConn, node: string, pos: number | string): Promise<StatusBody> {
  return del(conn, `/nodes/${node}/firewall/rules/${pos}`)
}

// ================================================================================
// VM/CT-LEVEL FIREWALL
// vmType is 'qemu' or 'lxc', straight from the route path — same segment PVE
// uses, so the paths below cover both guest types.
// ================================================================================

export async function getVMOptions(conn: PveConn, node: string, vmType: string, vmid: number | string): Promise<VMOptions> {
  return await pveFetch<VMOptions>(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/options`)
}

export async function updateVMOptions(conn: PveConn, node: string, vmType: string, vmid: number | string, req: UpdateOptionsRequest): Promise<StatusBody> {
  return putForm(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/options`, optionsToForm(req))
}

export async function getVMRules(conn: PveConn, node: string, vmType: string, vmid: number | string): Promise<FirewallRule[]> {
  return (await pveFetch<FirewallRule[]>(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/rules`)) ?? []
}

export async function addVMRule(conn: PveConn, node: string, vmType: string, vmid: number | string, req: CreateRuleRequest): Promise<StatusBody> {
  return postForm(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/rules`, ruleToForm(req))
}

export async function updateVMRule(conn: PveConn, node: string, vmType: string, vmid: number | string, pos: number | string, req: UpdateRuleRequest): Promise<StatusBody> {
  return putForm(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/rules/${pos}`, updateRuleToForm(req))
}

export async function deleteVMRule(conn: PveConn, node: string, vmType: string, vmid: number | string, pos: number | string): Promise<StatusBody> {
  return del(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/rules/${pos}`)
}

export async function getVMFirewallLog(conn: PveConn, node: string, vmType: string, vmid: number | string, limit = 50): Promise<FirewallLogEntry[]> {
  return (await pveFetch<FirewallLogEntry[]>(conn, `/nodes/${node}/${vmType}/${vmid}/firewall/log?limit=${limit}`)) ?? []
}

// ================================================================================
// VM NIC FIREWALL TOGGLE (mirrors the Go config read/rewrite of netX)
// ================================================================================

const PRIMARY_NIC_KEYS = new Set(['virtio', 'e1000', 'rtl8139', 'vmxnet3', 'name', 'hwaddr'])

function splitNicConfig(config: string): Map<string, string> {
  const parts = new Map<string, string>()

  for (const part of config.split(',')) {
    const idx = part.indexOf('=')
    if (idx >= 0) parts.set(part.slice(0, idx), part.slice(idx + 1))
  }

  return parts
}

/** Rebuild a NIC config string, primary keys (driver, name, hwaddr) first. */
function rebuildNicConfig(parts: Map<string, string>): string {
  const primary: string[] = []
  const rest: string[] = []

  for (const [k, v] of parts) {
    if (PRIMARY_NIC_KEYS.has(k)) primary.push(`${k}=${v}`)
    else rest.push(`${k}=${v}`)
  }

  return [...primary, ...rest].join(',')
}

/**
 * Toggles firewall=0/1 on every NIC (net0..net31) of a VM/CT config. This is
 * the second level of the guest firewall: the guest `enable` option arms it,
 * `firewall=1` per NIC actually filters the traffic.
 */
export async function toggleVMNICFirewall(conn: PveConn, node: string, vmType: string, vmid: number | string, enable: boolean): Promise<StatusBody> {
  const configPath = `/nodes/${node}/${vmType}/${vmid}/config`
  const vmConfig = await pveFetch<Record<string, unknown>>(conn, configPath)

  const firewallVal = enable ? '1' : '0'
  const form = new URLSearchParams()
  let modified = false

  for (let i = 0; i < 32; i++) {
    const netKey = `net${i}`
    const configStr = vmConfig?.[netKey]

    if (typeof configStr !== 'string') continue

    const parts = splitNicConfig(configStr)

    parts.set('firewall', firewallVal)
    form.set(netKey, rebuildNicConfig(parts))
    modified = true
  }

  // No NICs — nothing to rewrite, mirror the Go no-op success
  if (!modified) return { status: 'updated' }

  return putForm(conn, configPath, form)
}

// ================================================================================
// STATUS
// ================================================================================

async function countProtectedNodes(conn: PveConn): Promise<{ total: number; enabled: number }> {
  const nodes = (await pveFetch<Array<{ node: string }>>(conn, '/nodes')) ?? []
  let enabled = 0

  for (const node of nodes) {
    try {
      const opts = await getNodeOptions(conn, node.node)
      if (opts?.enable === 1) enabled++
    } catch {
      // mirror Go: a node failing its options read is simply not counted
    }
  }

  return { total: nodes.length, enabled }
}

async function countProtectedVMs(conn: PveConn): Promise<{ total: number; enabled: number }> {
  const vms = (await pveFetch<Array<{ vmid: number; node: string; type?: string }>>(conn, '/cluster/resources?type=vm')) ?? []
  let enabled = 0

  for (const vm of vms) {
    const vmType = vm.type === 'lxc' ? 'lxc' : 'qemu'

    try {
      const opts = await getVMOptions(conn, vm.node, vmType, vm.vmid)
      if (opts?.enable === 1) enabled++
    } catch {
      // mirror Go: a guest failing its options read is simply not counted
    }
  }

  return { total: vms.length, enabled }
}

/**
 * Overall firewall status. Like the Go service, every sub-fetch failure is
 * tolerated and leaves its counter at zero — status never throws for a
 * partially reachable cluster.
 */
export async function getFirewallStatus(conn: PveConn): Promise<FirewallStatus> {
  const status: FirewallStatus = {
    cluster_enabled: false,
    status: 'disabled',
    total_aliases: 0,
    total_ipsets: 0,
    total_groups: 0,
    total_cluster_rules: 0,
    protected_nodes: 0,
    total_nodes: 0,
    protected_vms: 0,
    total_vms: 0,
  }

  try {
    const clusterOpts = await getClusterOptions(conn)
    status.cluster_enabled = clusterOpts?.enable === 1
  } catch {
    // mirror Go: keep the default on failure
  }

  try {
    status.total_aliases = (await getAliases(conn)).length
  } catch {
    // mirror Go: keep the default on failure
  }

  try {
    status.total_ipsets = (await getIPSets(conn)).length
  } catch {
    // mirror Go: keep the default on failure
  }

  try {
    status.total_groups = (await getSecurityGroups(conn)).length
  } catch {
    // mirror Go: keep the default on failure
  }

  try {
    status.total_cluster_rules = (await getClusterRules(conn)).length
  } catch {
    // mirror Go: keep the default on failure
  }

  try {
    const nodes = await countProtectedNodes(conn)

    status.total_nodes = nodes.total
    status.protected_nodes = nodes.enabled
  } catch {
    // mirror Go: keep the defaults on failure
  }

  try {
    const vms = await countProtectedVMs(conn)

    status.total_vms = vms.total
    status.protected_vms = vms.enabled
  } catch {
    // mirror Go: keep the defaults on failure
  }

  status.status = status.cluster_enabled ? 'enabled/running' : 'disabled'

  return status
}
