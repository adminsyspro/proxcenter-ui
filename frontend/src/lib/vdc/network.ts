// IPv4 helpers used to validate tenant subnet input client-side and
// server-side. Pure functions, no side effects, fully unit-tested. IPv6 is
// out of scope for the MVP — the regex below rejects anything non-IPv4.

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

export interface ParsedCidr {
  ip: string
  prefix: number
  networkInt: number
  broadcastInt: number

  /** First usable host (gateway-eligible). Equals network for /31 + /32. */
  firstUsableInt: number

  /** Last usable host. Equals broadcast for /31 + /32. */
  lastUsableInt: number
}

export function isValidIpv4(ip: string): boolean {
  return typeof ip === 'string' && IPV4_REGEX.test(ip)
}

export function ipToInt(ip: string): number | null {
  if (!isValidIpv4(ip)) return null
  const parts = ip.split('.').map(p => Number.parseInt(p, 10))


  // Use unsigned right-shift so bit 31 stays positive (>>> 0).
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

export function intToIp(n: number): string {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.')
}

export function parseCidr(cidr: string): ParsedCidr | null {
  if (typeof cidr !== 'string' || !cidr.includes('/')) return null
  const [ip, prefStr] = cidr.split('/')

  if (!isValidIpv4(ip)) return null
  const prefix = Number.parseInt(prefStr, 10)

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null

  const ipInt = ipToInt(ip)!

  // Mask = top `prefix` bits. /0 → 0, /32 → 0xffffffff.
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const networkInt = (ipInt & mask) >>> 0
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0

  // RFC 3021: /31 has two usable hosts, no network/broadcast convention.
  // /32 is a single-host route — treat the single IP as usable.
  let firstUsableInt: number
  let lastUsableInt: number

  if (prefix >= 31) {
    firstUsableInt = networkInt
    lastUsableInt = broadcastInt
  } else {
    firstUsableInt = (networkInt + 1) >>> 0
    lastUsableInt = (broadcastInt - 1) >>> 0
  }

  return { ip, prefix, networkInt, broadcastInt, firstUsableInt, lastUsableInt }
}

/** Number of usable host addresses in a CIDR. /24 → 254, /30 → 2, /31 → 2, /32 → 1, /0 → 4294967294. */
export function usableHostCount(cidr: string): number {
  const p = parseCidr(cidr)

  if (!p) return 0
  if (p.prefix === 32) return 1
  if (p.prefix === 31) return 2

  // 2^(32-prefix) - 2
  const total = Math.pow(2, 32 - p.prefix)


return Math.max(0, total - 2)
}

export function ipInCidrUsable(ip: string, cidr: string): boolean {
  const ipInt = ipToInt(ip)
  const p = parseCidr(cidr)

  if (ipInt === null || !p) return false

return ipInt >= p.firstUsableInt && ipInt <= p.lastUsableInt
}

/** Validate a candidate gateway: must be a usable host inside the CIDR. */
export function gatewayValidForCidr(gateway: string, cidr: string): boolean {
  return ipInCidrUsable(gateway, cidr)
}
