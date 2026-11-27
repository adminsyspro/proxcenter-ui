/**
 * K8s node to Proxmox VM correlation cascade.
 *
 * Pure function: no I/O, no side-effects. Builds reverse indexes over the
 * VmIdentity list and tries match keys in priority order. Ambiguous matches
 * (more than one candidate for a given key) halt the cascade immediately
 * rather than falling through to a weaker key.
 */

import type { VmIdentity } from './vmIdentity'

// ---------------------------------------------------------------------------
// Exported types (consumed by the topology DTO + route in later tasks)
// ---------------------------------------------------------------------------

/** Keys in descending priority order used during node-VM correlation. */
export type K8sMatchKey = 'authoritative' | 'uuid' | 'providerID' | 'ip' | 'name'

/** Reason a node could not be correlated to exactly one VM. */
export type K8sUnmatchedReason = 'none' | 'ambiguous' | 'out_of_scope' | 'scan_failed'

/** Normalized K8s node fields used as correlation inputs (empty string = absent). */
export interface K8sNodeIdentity {
  name: string
  systemUUID: string
  providerID: string
  internalIP: string
}

/** Result of correlating one K8s node. */
export interface CorrelatedNode {
  name: string
  match?: {
    key: K8sMatchKey
    vmid: number
    vmName: string
    host: string
    connectionId: string
    clusterName?: string
    confidence: 'high' | 'medium' | 'low'
  }
  unmatchedReason?: K8sUnmatchedReason
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * UUID shape validation: strict RFC-4122 format check applied after lowercasing.
 * Accepts only values matching the canonical 8-4-4-4-12 hex pattern.
 * Rejects blank strings, shorthand identifiers, and any value that does not
 * conform to the full 32-hex-digit segmented structure.
 */
function isValidUuid(value: string): boolean {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
}

/**
 * Parse the trailing numeric VMID from a providerID URI.
 * Accepts the canonical form produced by the Proxmox CCM: proxmox://pve/107
 * Returns the VMID as a number, or null when the input is blank or unparseable.
 */
function parseProviderVmid(providerID: string): number | null {
  if (!providerID) return null
  const last = providerID.split('/').pop()
  if (!last) return null
  const n = Number(last)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Build a match result from a single VmIdentity and the key/confidence that
 * produced it.
 */
function makeMatch(
  vm: VmIdentity,
  key: K8sMatchKey,
  confidence: 'high' | 'medium' | 'low',
): CorrelatedNode['match'] {
  return {
    key,
    vmid: vm.vmid,
    vmName: vm.name,
    host: vm.host,
    connectionId: vm.connectionId,
    ...(vm.clusterName !== undefined ? { clusterName: vm.clusterName } : {}),
    confidence,
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Correlate each K8s node to at most one Proxmox VM using a priority cascade.
 *
 * Key priority (highest to lowest):
 *   authoritative - node.name is present in the persisted node mapping
 *                   (kubernetes_cluster_nodes) AND the mapped VM is still
 *                   present in scope (confidence: high)
 *   uuid          - node.systemUUID matches a VM's SMBIOS UUID (confidence: high)
 *   providerID    - parsed VMID from node.providerID exists in VM map (confidence: high)
 *   ip            - node.internalIP matches a VM's static IP (confidence: medium)
 *   name          - node.name matches a VM name case-insensitively (confidence: low)
 *
 * Ambiguity rule: if a key resolves to MORE THAN ONE candidate the node is
 * marked ambiguous and the cascade stops (does not try weaker keys).
 *
 * The authoritative key is the exception to that rule: when the mapped VM
 * cannot be found in the current `vms` scope (deleted, or out of the
 * caller's visibility filter), the node simply falls through to the
 * heuristic cascade below rather than being marked unmatched.
 */
export function correlateNodes(
  nodes: K8sNodeIdentity[],
  vms: VmIdentity[],
  authoritative?: Map<string, { connectionId: string; vmid: number }>,
): CorrelatedNode[] {
  // Build reverse indexes once, shared across all nodes.
  // Each map stores VmIdentity objects directly to avoid a secondary byVmid
  // lookup that would be wrong when multiple connections share a vmid number.
  const byVmidNum = new Map<number, VmIdentity[]>()  // vmid number -> all VMs across connections
  const byUuid = new Map<string, VmIdentity[]>()
  const byIp = new Map<string, VmIdentity[]>()
  const byName = new Map<string, VmIdentity[]>()

  for (const vm of vms) {
    const vmidList = byVmidNum.get(vm.vmid) ?? []
    vmidList.push(vm)
    byVmidNum.set(vm.vmid, vmidList)

    if (vm.uuid) {
      const key = vm.uuid.toLowerCase()
      const list = byUuid.get(key) ?? []
      list.push(vm)
      byUuid.set(key, list)
    }

    for (const ip of vm.ips) {
      if (!ip) continue
      const list = byIp.get(ip) ?? []
      list.push(vm)
      byIp.set(ip, list)
    }

    const nameShort = vm.name.toLowerCase().split('.')[0]
    const nameList = byName.get(nameShort) ?? []
    nameList.push(vm)
    byName.set(nameShort, nameList)
  }

  return nodes.map((node): CorrelatedNode => {
    // --- authoritative (persisted node mapping, highest priority) ---
    const authEntry = authoritative?.get(node.name)
    if (authEntry) {
      const target = vms.find(v => v.connectionId === authEntry.connectionId && v.vmid === authEntry.vmid)
      if (target) {
        return { name: node.name, match: makeMatch(target, 'authoritative', 'high') }
      }
      // Mapped VM not present in scope (deleted / out of scope): fall
      // through to the heuristic cascade below instead of marking unmatched.
    }

    // --- uuid ---
    const uuidRaw = node.systemUUID ? node.systemUUID.toLowerCase() : ''
    if (uuidRaw && isValidUuid(uuidRaw)) {
      const candidates = byUuid.get(uuidRaw) ?? []
      if (candidates.length === 1) {
        return { name: node.name, match: makeMatch(candidates[0], 'uuid', 'high') }
      }
      if (candidates.length > 1) {
        return { name: node.name, unmatchedReason: 'ambiguous' }
      }
      // 0 candidates: fall through
    }

    // --- providerID ---
    // providerID yields a vmid number only, NOT a connection id. When multiple
    // connections share that vmid the match is ambiguous and we stop.
    const parsedVmid = parseProviderVmid(node.providerID)
    if (parsedVmid !== null) {
      const candidates = byVmidNum.get(parsedVmid) ?? []
      if (candidates.length === 1) {
        return { name: node.name, match: makeMatch(candidates[0], 'providerID', 'high') }
      }
      if (candidates.length > 1) {
        return { name: node.name, unmatchedReason: 'ambiguous' }
      }
      // 0 candidates: fall through
    }

    // --- ip ---
    if (node.internalIP) {
      const candidates = byIp.get(node.internalIP) ?? []
      if (candidates.length === 1) {
        return { name: node.name, match: makeMatch(candidates[0], 'ip', 'medium') }
      }
      if (candidates.length > 1) {
        return { name: node.name, unmatchedReason: 'ambiguous' }
      }
    }

    // --- name (case-insensitive, short-name normalized: strip domain suffix) ---
    const nodeName = node.name ? node.name.toLowerCase().split('.')[0] : ''
    if (nodeName) {
      const candidates = byName.get(nodeName) ?? []
      if (candidates.length === 1) {
        return { name: node.name, match: makeMatch(candidates[0], 'name', 'low') }
      }
      if (candidates.length > 1) {
        return { name: node.name, unmatchedReason: 'ambiguous' }
      }
    }

    return { name: node.name, unmatchedReason: 'none' }
  })
}
