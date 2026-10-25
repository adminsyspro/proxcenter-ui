// src/lib/tls/dns/propagation.ts
//
// Waiting until a freshly published TXT value is visible BEFORE the CA is told
// to look. A failed validation costs one of the five failures Let's Encrypt
// allows per hour, and a recursive resolver is the wrong witness: it caches
// the NXDOMAIN it got a second before the record existed for as long as the
// zone's negative TTL. So the question goes to every authoritative server of
// the zone, directly, and the answer counts only when all of them agree.

import { promises as dns } from 'node:dns'

import { DnsProviderError } from '@/lib/tls/dns/types'
import { zoneCandidates } from '@/lib/tls/dns/util'

export interface DnsLookup {
  cname(name: string): Promise<string[]>
  ns(name: string): Promise<string[]>
  addresses(host: string): Promise<string[]>
  /** TXT values at `name` asked of one server, each value's chunks joined. */
  txtAt(server: string, name: string): Promise<string[]>
}

const LOOKUP_TIMEOUT_MS = 5_000

export const systemDnsLookup: DnsLookup = {
  cname: name => dns.resolveCname(name),
  ns: name => dns.resolveNs(name),
  async addresses(host) {
    const [v4, v6] = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)])
    const found = [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])]

    if (found.length === 0) throw new Error(`no address for ${host}`)

    return found
  },
  async txtAt(server, name) {
    const resolver = new dns.Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 })

    resolver.setServers([server])

    return (await resolver.resolveTxt(name)).map(chunks => chunks.join(''))
  },
}

const NO_DATA = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN'])

/** The name the CA will actually read: `_acme-challenge` delegated by CNAME (acme-dns, alias zones) is followed. */
async function followCnames(name: string, lookup: DnsLookup): Promise<string> {
  let current = name

  for (let hop = 0; hop < 8; hop++) {
    try {
      const [target] = await lookup.cname(current)

      if (!target) return current
      current = target.replace(/\.$/, '')
    } catch {
      return current
    }
  }

  throw new DnsProviderError(`CNAME chain too long from ${name}`)
}

async function authoritativeServers(name: string, lookup: DnsLookup): Promise<{ host: string; address: string }[]> {
  for (const zone of zoneCandidates(name)) {
    let hosts: string[]

    try {
      hosts = await lookup.ns(zone)
    } catch {
      continue
    }

    if (hosts.length === 0) continue

    const servers: { host: string; address: string }[] = []

    for (const host of hosts) {
      try {
        const [address] = await lookup.addresses(host)

        servers.push({ host, address })
      } catch {
        // An NS name that does not resolve is the zone's problem, not a
        // reason to give up on the others.
      }
    }

    if (servers.length > 0) return servers
  }

  return []
}

export interface PropagationOptions {
  timeoutMs?: number
  intervalMs?: number
  lookup?: DnsLookup
  sleep?: (ms: number) => Promise<void>
}

export type PropagationOutcome = 'confirmed' | 'unverifiable'

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Resolves `confirmed` once every authoritative server serves `value` at
 * `fqdn`, and `unverifiable` when no authoritative server can be asked at
 * all: an install whose firewall only lets DNS out through an internal
 * resolver must still be able to order, it simply relies on the validation
 * delay the operator set. Throws when the servers answer but keep missing the
 * value past the timeout, naming the ones that do.
 */
export async function waitForTxtPropagation(fqdn: string, value: string, options: PropagationOptions = {}): Promise<PropagationOutcome> {
  const { timeoutMs = 10 * 60_000, intervalMs = 10_000, lookup = systemDnsLookup, sleep = defaultSleep } = options
  const target = await followCnames(fqdn, lookup)
  const servers = await authoritativeServers(target, lookup)

  if (servers.length === 0) return 'unverifiable'

  const deadline = Date.now() + timeoutMs
  let lagging: string[] = []

  for (;;) {
    lagging = []
    let unreachable = 0

    for (const server of servers) {
      try {
        if (!(await lookup.txtAt(server.address, target)).includes(value)) lagging.push(server.host)
      } catch (err: any) {
        lagging.push(server.host)
        if (!NO_DATA.has(err?.code)) unreachable++
      }
    }

    if (lagging.length === 0) return 'confirmed'
    // Not one server could be asked: port 53 is filtered on the way out.
    if (unreachable === servers.length) return 'unverifiable'
    if (Date.now() + intervalMs > deadline) break

    await sleep(intervalMs)
  }

  throw new DnsProviderError(
    `the TXT record ${target} is still missing on ${lagging.join(', ')} after ${Math.round(timeoutMs / 60_000)} min`,
  )
}
