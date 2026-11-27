// src/lib/k8s/provision/validate.ts
// Client-side validation for the provisioning wizard. Mirrors the backend's
// Validate() rules (wire-contract.md "Validate() rules") so the user sees
// the same errors before submitting, PLUS stricter UI-level checks (DNS-1123
// cluster name, syntactic IPv4 checks) that make the review step trustworthy.
// Distro-specific rules (talos / k3s / rke2 / kubeadm) are gated on
// state.distro; shared rules run for every distro.
//
// Subnet-membership note: we deliberately do NOT implement a CIDR
// containment check (e.g. "is this IP inside gateway/subnetPrefix?"). Per
// the FT4 spec, a full CIDR calculation is easy to get subtly wrong (prefix
// 0/32 edge cases, non-numeric input) for limited benefit. Instead we
// enforce the safer, always-correct subset: every node IP is a
// syntactically valid IPv4 address, all node IPs are pairwise distinct, and
// no node IP equals the gateway. This catches the practical mistakes
// (typos, copy-paste duplicates, reusing the gateway) without risking a
// false rejection from a subnet edge case.

import type { WizardState } from './types'
import { rangeErrors } from './networks'
import { DEFAULT_CP_CORES, DEFAULT_CP_MEMORY, DEFAULT_CP_DISK, MIN_CORES, MIN_MEMORY, MIN_DISK } from './types'

const DNS_1123_LABEL_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

function isValidIPv4(value: string): boolean {
  const parts = value.split('.')
  if (parts.length !== 4) return false
  return parts.every(part => {
    if (!/^\d{1,3}$/.test(part)) return false
    if (part.length > 1 && part.startsWith('0')) return false // reject leading zeros (e.g. "01")
    const n = Number(part)
    return n >= 0 && n <= 255
  })
}

function isValidClusterName(name: string): boolean {
  return name.length > 0 && name.length <= 63 && DNS_1123_LABEL_RE.test(name)
}

// sha256 = exactly 64 hex chars. Checked with a character loop, not a
// regex: Sonar S5852 has flagged anchored quantified regexes in this repo.
function isSha256Hex(value: string): boolean {
  if (value.length !== 64) return false
  for (const ch of value.toLowerCase()) {
    if (!'0123456789abcdef'.includes(ch)) return false
  }
  return true
}

// Shared by the k3s / rke2 / kubeadm branches: all three boot the same
// generic cloud image via a cloud-init snippet and differ only in their
// version field (extracted so the third copy does not trip the Sonar
// new-code duplication gate). Push order preserved from the original
// branches: snippet datastore, image URL, checksum.
function cloudImageErrors(state: WizardState): string[] {
  const errors: string[] = []
  if (!state.snippetDatastore) errors.push('Snippet datastore is required')
  if (!state.osImageUrl) errors.push('OS image URL is required')
  if (!state.osImageChecksum) {
    errors.push('OS image checksum is required')
  } else if (!isSha256Hex(state.osImageChecksum)) {
    errors.push('OS image checksum must be a 64-character SHA-256 hex string')
  }
  return errors
}

export function validateProvision(state: WizardState): string[] {
  const errors: string[] = []

  if (!state.clusterName) {
    errors.push('Cluster name is required')
  } else if (!isValidClusterName(state.clusterName)) {
    errors.push(
      'Cluster name must be a valid DNS-1123 label (lowercase letters, digits, and hyphens; ' +
        'must start and end with a letter or digit; max 63 characters)',
    )
  }

  if (!state.connectionId) errors.push('Proxmox connection is required')
  if (!state.pveNode) errors.push('Proxmox node is required')
  if (!state.imageDatastore) errors.push('Image datastore is required')
  if (!state.vmDatastore) errors.push('VM datastore is required')
  if (!state.bridge) errors.push('Network bridge is required')
  if (!state.gateway) errors.push('Gateway is required')
  if (!state.dns || state.dns.length === 0) errors.push('At least one DNS server is required')
  // Distro dispatch on a plain string (never a discriminated union; the
  // repo tsconfig has strict:false where union narrowing is unreliable).
  if (state.distro === 'talos') {
    if (!state.talosVersion) errors.push('Talos version is required')
    if (!state.kubernetesVersion) errors.push('Kubernetes version is required')
    if (!state.schematicId) errors.push('Schematic ID is required')
  } else if (state.distro === 'k3s') {
    if (!state.k3sVersion) errors.push('k3s version is required')
    errors.push(...cloudImageErrors(state))
  } else if (state.distro === 'rke2') {
    if (!state.rke2Version) errors.push('rke2 version is required')
    errors.push(...cloudImageErrors(state))
  } else if (state.distro === 'kubeadm') {
    if (!state.kubeadmVersion) {
      errors.push('Kubernetes version is required')
    } else if (state.kubeadmVersion.startsWith('v') || state.kubeadmVersion.startsWith('V')) {
      // The backend handler rejects a v-prefixed version outright (kubeadm
      // package versions are bare, e.g. 1.34.9), so surface it here too.
      errors.push('Kubernetes version must not start with "v" (e.g. 1.34.9)')
    }
    // An empty CNI is allowed: the backend defaults it to calico.
    if (state.cni && state.cni !== 'calico' && state.cni !== 'cilium') {
      errors.push('CNI must be Calico or Cilium')
    }
    if (!state.controlPlaneVip) {
      errors.push('Control-plane VIP is required')
    } else if (!isValidIPv4(state.controlPlaneVip)) {
      errors.push('Control-plane VIP must be a valid IPv4 address')
    }
    errors.push(...cloudImageErrors(state))
  } else {
    errors.push('A Kubernetes distribution must be selected')
  }

  const cpCount = state.controlPlane.length
  if (cpCount < 1) {
    errors.push('At least one control-plane node is required')
  } else if (cpCount !== 1 && cpCount % 2 === 0) {
    errors.push('Control-plane count must be 1 or an odd number >= 3')
  }

  // CP sizing mirrors the backend's orDefault(v, def) rule: an omitted (zero)
  // field is backfilled with the CP default BEFORE the floor check, so
  // cpCores: 0 is accepted (backend substitutes the default), while an
  // explicit positive value below the floor is still rejected.
  if ((state.cpCores || DEFAULT_CP_CORES) < MIN_CORES) errors.push('Control-plane cores must be at least 1')
  if ((state.cpMemory || DEFAULT_CP_MEMORY) < MIN_MEMORY) errors.push('Control-plane memory must be at least 2048 MiB')
  if ((state.cpDisk || DEFAULT_CP_DISK) < MIN_DISK) errors.push('Control-plane disk must be at least 10 GiB')

  // Worker sizing is validated with RAW values (no backfill) and only when
  // workers are present, matching the backend's Validate().
  if (state.workers.length > 0) {
    if (state.workerCores < MIN_CORES) errors.push('Worker cores must be at least 1')
    if (state.workerMemory < MIN_MEMORY) errors.push('Worker memory must be at least 2048 MiB')
    if (state.workerDisk < MIN_DISK) errors.push('Worker disk must be at least 10 GiB')
  }

  // Pod and service ranges: valid, apart from each other and from the node
  // network (same refusals as the orchestrator).
  for (const e of rangeErrors({
    distro: state.distro,
    podCIDR: state.podCIDR ?? '',
    serviceCIDR: state.serviceCIDR ?? '',
    subnetPrefix: state.subnetPrefix,
    nodeIps: [...state.controlPlane, ...state.workers].map(n => n.ip).filter(Boolean),
  })) {
    const label = e.field === 'pod' ? 'Pod network' : 'Service network'
    if (e.code === 'cidrInvalid') errors.push(`${label} CIDR must be a valid IPv4 CIDR (e.g. 10.244.0.0/16)`)
    else if (e.code === 'cidrOverlapNodes') errors.push(`${label} ${e.cidr} overlaps the node network ${e.nodes}`)
    else errors.push('Pod and service networks overlap')
  }

  const allNodes = [...state.controlPlane, ...state.workers]
  const seenIps = new Set<string>()
  const duplicateIps = new Set<string>()
  const seenVmids = new Set<number>()
  const duplicateVmids = new Set<number>()
  let hasMissingIp = false
  let hasInvalidIp = false
  let hasIpEqualsGateway = false

  for (const node of allNodes) {
    if (!node.ip) {
      hasMissingIp = true
      continue
    }
    if (!isValidIPv4(node.ip)) hasInvalidIp = true
    if (state.gateway && node.ip === state.gateway) hasIpEqualsGateway = true
    if (seenIps.has(node.ip)) duplicateIps.add(node.ip)
    seenIps.add(node.ip)
    if (seenVmids.has(node.vmid)) duplicateVmids.add(node.vmid)
    seenVmids.add(node.vmid)
  }

  if (hasMissingIp) errors.push('Every control-plane and worker node must have an IP address')
  if (hasInvalidIp) errors.push('Every node IP address must be a valid IPv4 address')
  if (hasIpEqualsGateway) errors.push('A node IP address cannot be the same as the gateway')
  if (duplicateIps.size > 0) errors.push('Node IP addresses must be unique')
  if (duplicateVmids.size > 0) errors.push('Node vmid values must be unique')

  // kubeadm only: the VIP must be a FREE address. Same safe subset as the
  // node-IP checks above (no CIDR-containment math): not the gateway, not
  // any node IP. Well-formedness is already checked in the distro branch.
  if (state.distro === 'kubeadm' && state.controlPlaneVip) {
    if (state.gateway && state.controlPlaneVip === state.gateway) {
      errors.push('Control-plane VIP cannot be the same as the gateway')
    }
    if (allNodes.some(n => n.ip === state.controlPlaneVip)) {
      errors.push('Control-plane VIP cannot be one of the node IP addresses')
    }
  }

  return errors
}
