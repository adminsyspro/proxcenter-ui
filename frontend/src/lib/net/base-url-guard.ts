/**
 * Address guard for the base URL of a connection created or updated by a
 * customer tenant.
 *
 * The server opens that URL itself (PVE/PBS/vSphere/XO/Hyper-V API calls), so a
 * tenant could otherwise point a "connection" at this host's loopback, at the
 * link-local range where cloud metadata services live, or at the unspecified
 * address, and read the answers through the connection test and inventory.
 * Private ranges stay allowed: a tenant's clusters legitimately sit on them.
 * The provider tenant is not routed through this guard, since its admins point
 * at internal hosts on purpose.
 */
import { promises as dns } from "node:dns"
import net from "node:net"

export type HostResolver = (hostname: string) => Promise<string[]>

const resolveWithSystemDns: HostResolver = async hostname =>
  (await dns.lookup(hostname, { all: true, verbatim: true })).map(a => a.address)

/** Strip brackets and a zone id, map an IPv4-mapped IPv6 address to its IPv4 form, lowercase. */
function normalizeAddress(raw: string): string {
  let h = raw.trim().replace(/^\[|\]$/g, "").toLowerCase()
  const zone = h.indexOf("%")
  if (zone !== -1) h = h.slice(0, zone)
  const mapped = /^::ffff:(.+)$/.exec(h)
  if (mapped) {
    const tail = mapped[1]
    if (net.isIP(tail) === 4) return tail
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail)
    if (hex) {
      const hi = Number.parseInt(hex[1], 16)
      const lo = Number.parseInt(hex[2], 16)
      return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
    }
  }
  return h
}

/** Why `address` (an IP literal) may not be a tenant connection target, or null when it may. */
export function blockedAddressReason(address: string): string | null {
  const ip = normalizeAddress(address)
  const version = net.isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number)
    if (a === 127) return "loopback address"
    if (a === 0) return "unspecified address"
    if (a === 169 && b === 254) return "link-local address (cloud metadata range)"
    return null
  }
  if (version === 6) {
    if (ip === "::1") return "loopback address"
    if (ip === "::") return "unspecified address"
    if (/^fe[89ab]/.test(ip)) return "link-local address"
    if (ip === "fd00:ec2::254") return "cloud metadata address"
    return null
  }
  return null
}

/** Host names that always denote this machine or a metadata service. */
function blockedHostnameReason(hostname: string): string | null {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return "loopback address"
  if (hostname === "metadata.google.internal" || hostname === "metadata") return "cloud metadata address"
  return null
}

/**
 * The reason a customer tenant may not use `baseUrl`, or null when it is
 * acceptable. A host name is resolved once, here, and refused when it does not
 * resolve or when any of its addresses is blocked.
 */
export async function tenantBaseUrlRefusal(baseUrl: string, resolve: HostResolver = resolveWithSystemDns): Promise<string | null> {
  const text = baseUrl.trim()
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return `Connection address "${text}" is not a valid URL`
  }
  const hostname = normalizeAddress(url.hostname)
  if (!hostname) return `Connection address "${text}" has no host`

  const byName = blockedHostnameReason(hostname)
  if (byName) return `Connection address "${hostname}" is not allowed: ${byName}`

  if (net.isIP(hostname)) {
    const reason = blockedAddressReason(hostname)
    return reason ? `Connection address "${hostname}" is not allowed: ${reason}` : null
  }

  let addresses: string[]
  try {
    addresses = await resolve(hostname)
  } catch {
    return `Connection address "${hostname}" does not resolve from this server`
  }
  if (addresses.length === 0) return `Connection address "${hostname}" does not resolve from this server`
  for (const address of addresses) {
    const reason = blockedAddressReason(address)
    if (reason) return `Connection address "${hostname}" is not allowed: it resolves to ${address}, a ${reason}`
  }
  return null
}
