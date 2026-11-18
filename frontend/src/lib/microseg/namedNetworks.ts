// src/lib/microseg/namedNetworks.ts
//
// The networks the admin named in the settings of a policy ("VPN" for 192.168.72.0/24): an address of one of them
// that talks to a zone from outside every zone is that network. The orchestrator records such a flow with the CIDR
// of the network as its source key; the interface names it and draws its addresses as one box.

export type NamedNetwork = { name: string; cidr: string }

/** The bounds the orchestrator applies (internal/microseg/named_networks.go). */
export const MAX_NAMED_NETWORKS = 64
export const MAX_NETWORK_NAME = 40

/** An address as 16-bit words: 2 of them for IPv4, 8 for IPv6. */
type Words = number[]

function ipv4Words(text: string): Words | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    bytes.push(Number(part))
  }
  return [bytes[0] * 256 + bytes[1], bytes[2] * 256 + bytes[3]]
}

function ipv6Words(text: string): Words | null {
  if (!/^[0-9a-f:]+$/i.test(text) || (text.match(/::/g) ?? []).length > 1) return null
  const [head, tail] = text.includes('::') ? text.split('::') : [text, null]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  if (tail === null ? missing !== 0 : missing < 1) return null
  const groups = [...left, ...Array.from({ length: tail === null ? 0 : missing }, () => '0'), ...right]
  if (groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) return null
  return groups.map(group => Number.parseInt(group, 16))
}

/** The words of an address ("10.0.0.5", "2001:db8::1"), a mask and a zone index left out; null for anything else. */
function addressWords(ip: string): Words | null {
  const text = ip.trim().replace(/\/\d+$/, '').replace(/%.*$/, '')
  return text.includes(':') ? ipv6Words(text) : ipv4Words(text)
}

/** The first `length` bits of an address, the others zeroed. */
function masked(words: Words, length: number): Words {
  return words.map((word, i) => {
    const kept = Math.min(16, Math.max(0, length - i * 16))
    return kept === 16 ? word : word - (word % 2 ** (16 - kept))
  })
}

type Network = { base: Words; length: number }

/** A CIDR that names a network: an address and a prefix length of 1 or more, in range for its family. */
export function parseNetwork(cidr: string): Network | null {
  const match = /^(.+)\/(\d{1,3})$/.exec(cidr.trim())
  if (!match) return null
  const words = addressWords(match[1])
  const length = Number(match[2])
  if (!words || length < 1 || length > words.length * 16) return null
  return { base: masked(words, length), length }
}

/** The named network that holds `ip`: the most specific one, null when none does (or `ip` is no address). */
export function networkOf(ip: string | undefined, networks: readonly NamedNetwork[] | undefined): NamedNetwork | null {
  if (!ip || !networks?.length) return null
  const words = addressWords(ip)
  if (!words) return null
  let best: { network: NamedNetwork; length: number } | null = null
  for (const network of networks) {
    const parsed = parseNetwork(network.cidr)
    if (!parsed || parsed.base.length !== words.length) continue
    if (!masked(words, parsed.length).every((word, i) => word === parsed.base[i])) continue
    if (!best || parsed.length > best.length) best = { network, length: parsed.length }
  }
  return best?.network ?? null
}

/** The named network a source key stands for: the key is its CIDR. */
export function networkByCidr(key: string | undefined, networks: readonly NamedNetwork[] | undefined): NamedNetwork | null {
  if (!key?.includes('/')) return null
  return networks?.find(n => n.cidr === key) ?? null
}

/** A source key that stands for many sources: the aggregate row of an address family. */
export const isManySources = (key: string | undefined) => key === '0.0.0.0/0' || key === '::/0'

export type NetworkProblem = { key: 'networkName' | 'networkCidr' | 'networkNameTwice' | 'networkTwice' | 'networkTooMany'; values?: Record<string, string | number> }

/** What is wrong with the networks of the form, the first problem only; null when they can be saved. */
export function networksProblem(rows: readonly NamedNetwork[]): NetworkProblem | null {
  if (rows.length > MAX_NAMED_NETWORKS) return { key: 'networkTooMany', values: { max: MAX_NAMED_NETWORKS } }
  const names = new Set<string>()
  const cidrs = new Set<string>()
  for (const row of rows) {
    const name = row.name.trim()
    if (!name || [...name].length > MAX_NETWORK_NAME) return { key: 'networkName', values: { max: MAX_NETWORK_NAME } }
    const parsed = parseNetwork(row.cidr)
    if (!parsed) return { key: 'networkCidr', values: { name } }
    if (names.has(name.toLowerCase())) return { key: 'networkNameTwice', values: { name } }
    const canon = `${parsed.base.join(':')}/${parsed.length}`
    if (cidrs.has(canon)) return { key: 'networkTwice', values: { name } }
    names.add(name.toLowerCase())
    cidrs.add(canon)
  }
  return null
}
