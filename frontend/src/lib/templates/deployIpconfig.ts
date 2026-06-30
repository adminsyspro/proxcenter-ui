/**
 * Build the cloud-init `ipconfig0` value for a template deployment from the
 * Deploy wizard's network fields.
 *
 * The wizard has two layouts depending on whether the selected bridge carries
 * an IPAM subnet:
 *
 *   - With a subnet, the user types only a bare host IP (e.g. `10.0.1.4`); the
 *     prefix + gateway come from the subnet, and an empty field means
 *     "auto-allocate" (the backend's IPAM hook injects the static config
 *     server-side, so we return an empty string here).
 *
 *   - Without a subnet, the user fills structured fields: a DHCP toggle, an
 *     `IP/CIDR` field and an editable gateway. Before #526 this section only
 *     accepted a raw `ipconfig0` string and silently dropped it.
 */

export interface DeploySubnet {
  cidr: string
  gateway: string
  dnsServers: string[]
  subnetId: string
}

export interface DeployIpconfigInput {
  /** The selected bridge's IPAM subnet, or null when the bridge has none. */
  subnet: DeploySubnet | null | undefined
  /** Subnet branch: the bare host IP the user typed (empty = auto-allocate). */
  ipOverride: string
  /** No-subnet branch: an IPv4 address with CIDR, e.g. `10.0.1.4/25`. */
  manualIpCidr: string
  /** No-subnet branch: an optional IPv4 gateway. */
  manualGateway: string
  /** No-subnet branch: request DHCP instead of a static address. */
  useDhcp: boolean
}

export interface ParsedIpconfig0 {
  /** true when the value requests DHCP (ip=dhcp) */
  useDhcp: boolean
  /** static IPv4 with CIDR, e.g. "10.0.1.4/24" (empty if none) */
  manualIpCidr: string
  /** IPv4 gateway, e.g. "10.0.1.1" (empty if none) */
  manualGateway: string
  /** bare host IPv4 without prefix, e.g. "10.0.1.4" (empty if none) — used by the wizard's IPAM/subnet layout */
  host: string
}

export function parseIpconfig0(cfg: string): ParsedIpconfig0 {
  const s = String(cfg ?? '')
  const useDhcp = /(?:^|,)\s*ip=dhcp\b/i.test(s)
  const manualIpCidr = s.match(/(?:^|,)\s*ip=([0-9.]+\/\d+)/)?.[1] ?? ''
  const manualGateway = s.match(/(?:^|,)\s*gw=([0-9.]+)/)?.[1] ?? ''
  const host = s.match(/(?:^|,)\s*ip=([0-9.]+)(?:\/\d+)?/)?.[1] ?? ''
  return { useDhcp, manualIpCidr, manualGateway, host }
}

export function buildDeployIpconfig0(input: DeployIpconfigInput): string {
  const { subnet, ipOverride, manualIpCidr, manualGateway, useDhcp } = input

  // Subnet (IPAM) branch: compose from the bare host IP + the subnet's
  // prefix/gateway. The DHCP toggle is not offered here, so it is ignored.
  if (subnet) {
    if (!ipOverride) return ''
    const prefix = subnet.cidr.match(/\/(\d+)$/)?.[1] ?? '24'
    return `ip=${ipOverride}/${prefix},gw=${subnet.gateway}`
  }

  // No subnet: structured manual entry.
  if (useDhcp) return 'ip=dhcp'

  const ip = manualIpCidr.trim()
  if (!ip) return ''
  const gw = manualGateway.trim()
  return gw ? `ip=${ip},gw=${gw}` : `ip=${ip}`
}
