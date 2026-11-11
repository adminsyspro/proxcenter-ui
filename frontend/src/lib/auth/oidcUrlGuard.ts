// src/lib/auth/oidcUrlGuard.ts
//
// SSRF guard of the OIDC connections a tenant may configure itself
// (issue #1289, lot 2). Discovery, token exchange, JWKS and userinfo are
// requests THIS server sends to the URLs of the connection: left open, a tenant
// admin could point them at the provider's own network (the orchestrator, a
// Proxmox API, a cloud metadata endpoint) and read the answers through the
// connection test. So those URLs must be https and reach public addresses only,
// checked twice: when they are saved, and when each connection is opened
// (strictLookup), since a name can be re-pointed after it was accepted.
//
// SonarCloud typescript:S1313 (hardcoded IPs) is suppressed on the ranges: the
// ranges ARE the policy, and making them configurable would hand the bypass to
// the very person the guard is for.

import dns from "node:dns"
import net from "node:net"

/** Refusal of a URL or a connection. The message never echoes a resolved address. */
export class OidcUrlRefused extends Error {
  constructor(message = "The identity provider must be reachable over https on a public address") {
    super(message)
    this.name = "OidcUrlRefused"
  }
}

const NON_PUBLIC = new net.BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8], // NOSONAR(typescript:S1313): "this network"
  ["10.0.0.0", 8], // NOSONAR(typescript:S1313): RFC 1918
  ["100.64.0.0", 10], // NOSONAR(typescript:S1313): carrier-grade NAT, Alibaba metadata
  ["127.0.0.0", 8], // NOSONAR(typescript:S1313): loopback
  ["169.254.0.0", 16], // NOSONAR(typescript:S1313): link-local, cloud metadata
  ["172.16.0.0", 12], // NOSONAR(typescript:S1313): RFC 1918
  ["192.0.0.0", 24], // NOSONAR(typescript:S1313): IETF assignments, Oracle metadata
  ["192.0.2.0", 24], // NOSONAR(typescript:S1313): documentation
  ["192.88.99.0", 24], // NOSONAR(typescript:S1313): 6to4 relay
  ["192.168.0.0", 16], // NOSONAR(typescript:S1313): RFC 1918
  ["198.18.0.0", 15], // NOSONAR(typescript:S1313): benchmarking
  ["198.51.100.0", 24], // NOSONAR(typescript:S1313): documentation
  ["203.0.113.0", 24], // NOSONAR(typescript:S1313): documentation
  ["224.0.0.0", 4], // NOSONAR(typescript:S1313): multicast
  ["240.0.0.0", 4], // NOSONAR(typescript:S1313): reserved, broadcast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4")
}
for (const [network, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["64:ff9b::", 96], // NAT64, would reach an IPv4 behind it
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local, AWS metadata over IPv6
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6")
}

/** True for a unicast address reachable on the internet, false for anything else. */
export function isPublicAddress(ip: string): boolean {
  const address = String(ip).trim().toLowerCase().replace(/^\[|\]$/g, "")
  const version = net.isIP(address)
  if (version === 4) return !NON_PUBLIC.check(address, "ipv4")
  if (version !== 6) return false
  // An IPv4-mapped IPv6 address reaches the IPv4 it carries.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address)
  if (mapped) return isPublicAddress(mapped[1])
  return !NON_PUBLIC.check(address, "ipv6")
}

type Resolve = (host: string) => Promise<string[]>

async function resolveAll(host: string): Promise<string[]> {
  try {
    const addresses = await dns.promises.lookup(host, { all: true, verbatim: true })
    return addresses.map(a => a.address)
  } catch {
    return []
  }
}

/**
 * Parse a URL a tenant entered for its IdP and make sure every address its host
 * resolves to is public. Throws OidcUrlRefused otherwise, including for a name
 * that does not resolve: the connection could not work, and a later answer
 * would not be checked here.
 */
export async function assertPublicHttpsUrl(input: string, resolve: Resolve = resolveAll): Promise<URL> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new OidcUrlRefused()
  }
  if (url.protocol !== "https:") throw new OidcUrlRefused()

  const host = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = net.isIP(host) ? [host] : await resolve(host)
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new OidcUrlRefused()
  return url
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: any, family?: number) => void
type LookupFn = (hostname: string, options: any, callback: LookupCallback) => void

/**
 * `lookup` for an HTTP agent: resolves like dns.lookup, then refuses the
 * connection when any resolved address is not public. Handles both the
 * single-address and the `all: true` forms Node may ask for.
 */
export function strictLookup(resolve: LookupFn = dns.lookup as unknown as LookupFn): LookupFn {
  return (hostname, options, callback) => {
    const opts = typeof options === "object" && options ? options : {}
    resolve(hostname, { ...opts, all: true }, (err, addresses: Array<{ address: string; family: number }>) => {
      if (err) return callback(err)
      const list = Array.isArray(addresses) ? addresses : []
      if (list.length === 0 || !list.every(a => isPublicAddress(a.address))) return callback(new OidcUrlRefused())
      if (opts.all) return callback(null, list)
      return callback(null, list[0].address, list[0].family)
    })
  }
}
