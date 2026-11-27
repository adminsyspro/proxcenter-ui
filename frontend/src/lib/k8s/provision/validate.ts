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
function cloudImageErrors(state: WizardState): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  if (!state.snippetDatastore) errors.push(issue('snippetRequired'))
  if (!state.osImageUrl) errors.push(issue('osImageUrlRequired'))
  if (!state.osImageChecksum) {
    errors.push(issue('osImageChecksumRequired'))
  } else if (!isSha256Hex(state.osImageChecksum)) {
    errors.push(issue('osImageChecksumFormat'))
  }
  return errors
}

/**
 * One problem with the wizard state: a key under
 * kubernetes.provision.validation and the values its message takes.
 */
export interface ValidationIssue { key: string; values?: Record<string, string | number> }

function issue(key: string, values?: Record<string, string | number>): ValidationIssue {
  return values ? { key, values } : { key }
}

export function validateProvision(state: WizardState): ValidationIssue[] {
  const errors: ValidationIssue[] = []

  if (!state.clusterName) {
    errors.push(issue('clusterNameRequired'))
  } else if (!isValidClusterName(state.clusterName)) {
    errors.push(issue('clusterNameFormat'))
  }

  if (!state.connectionId) errors.push(issue('connectionRequired'))
  if (!state.pveNode) errors.push(issue('nodeRequired'))
  if (!state.imageDatastore) errors.push(issue('imageDatastoreRequired'))
  if (!state.vmDatastore) errors.push(issue('vmDatastoreRequired'))
  if (!state.bridge) errors.push(issue('bridgeRequired'))
  if (!state.gateway) errors.push(issue('gatewayRequired'))
  if (!state.dns || state.dns.length === 0) errors.push(issue('dnsRequired'))
  // Distro dispatch on a plain string (never a discriminated union; the
  // repo tsconfig has strict:false where union narrowing is unreliable).
  if (state.distro === 'talos') {
    if (!state.talosVersion) errors.push(issue('talosVersionRequired'))
    if (!state.kubernetesVersion) errors.push(issue('kubernetesVersionRequired'))
    if (!state.schematicId) errors.push(issue('schematicRequired'))
  } else if (state.distro === 'k3s') {
    if (!state.k3sVersion) errors.push(issue('k3sVersionRequired'))
    errors.push(...cloudImageErrors(state))
  } else if (state.distro === 'rke2') {
    if (!state.rke2Version) errors.push(issue('rke2VersionRequired'))
    errors.push(...cloudImageErrors(state))
  } else if (state.distro === 'kubeadm') {
    if (!state.kubeadmVersion) {
      errors.push(issue('kubernetesVersionRequired'))
    } else if (state.kubeadmVersion.startsWith('v') || state.kubeadmVersion.startsWith('V')) {
      // The backend handler rejects a v-prefixed version outright (kubeadm
      // package versions are bare, e.g. 1.34.9), so surface it here too.
      errors.push(issue('kubernetesVersionPrefix'))
    }
    // An empty CNI is allowed: the backend defaults it to calico.
    if (state.cni && state.cni !== 'calico' && state.cni !== 'cilium') {
      errors.push(issue('cniInvalid'))
    }
    if (!state.controlPlaneVip) {
      errors.push(issue('vipRequired'))
    } else if (!isValidIPv4(state.controlPlaneVip)) {
      errors.push(issue('vipInvalid'))
    }
    errors.push(...cloudImageErrors(state))
  } else {
    errors.push(issue('distroRequired'))
  }

  const cpCount = state.controlPlane.length
  if (cpCount < 1) {
    errors.push(issue('controlPlaneRequired'))
  } else if (cpCount !== 1 && cpCount % 2 === 0) {
    errors.push(issue('controlPlaneCount'))
  }

  // CP sizing mirrors the backend's orDefault(v, def) rule: an omitted (zero)
  // field is backfilled with the CP default BEFORE the floor check, so
  // cpCores: 0 is accepted (backend substitutes the default), while an
  // explicit positive value below the floor is still rejected.
  if ((state.cpCores || DEFAULT_CP_CORES) < MIN_CORES) errors.push(issue('controlPlaneCores'))
  if ((state.cpMemory || DEFAULT_CP_MEMORY) < MIN_MEMORY) errors.push(issue('controlPlaneMemory'))
  if ((state.cpDisk || DEFAULT_CP_DISK) < MIN_DISK) errors.push(issue('controlPlaneDisk'))

  // Worker sizing is validated with RAW values (no backfill) and only when
  // workers are present, matching the backend's Validate().
  if (state.workers.length > 0) {
    if (state.workerCores < MIN_CORES) errors.push(issue('workerCores'))
    if (state.workerMemory < MIN_MEMORY) errors.push(issue('workerMemory'))
    if (state.workerDisk < MIN_DISK) errors.push(issue('workerDisk'))
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
    if (e.code === 'cidrInvalid') errors.push(issue(e.field === 'pod' ? 'podCidrInvalid' : 'serviceCidrInvalid'))
    else if (e.code === 'cidrOverlapNodes') errors.push(issue(e.field === 'pod' ? 'podCidrOverlapNodes' : 'serviceCidrOverlapNodes', { cidr: e.cidr, nodes: e.nodes }))
    else errors.push(issue('rangesOverlap'))
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

  if (hasMissingIp) errors.push(issue('nodeIpMissing'))
  if (hasInvalidIp) errors.push(issue('nodeIpInvalid'))
  if (hasIpEqualsGateway) errors.push(issue('nodeIpGateway'))
  if (duplicateIps.size > 0) errors.push(issue('nodeIpDuplicate'))
  if (duplicateVmids.size > 0) errors.push(issue('vmidDuplicate'))

  // kubeadm only: the VIP must be a FREE address. Same safe subset as the
  // node-IP checks above (no CIDR-containment math): not the gateway, not
  // any node IP. Well-formedness is already checked in the distro branch.
  if (state.distro === 'kubeadm' && state.controlPlaneVip) {
    if (state.gateway && state.controlPlaneVip === state.gateway) {
      errors.push(issue('vipGateway'))
    }
    if (allNodes.some(n => n.ip === state.controlPlaneVip)) {
      errors.push(issue('vipNodeIp'))
    }
  }

  return errors
}
