import net from "node:net"
import { extractHostFromUrl } from "@/lib/proxmox/urlUtils"

/** Strip IPv6 brackets + zone id, map IPv4-mapped IPv6 (dotted or hex form) to IPv4, lowercase. */
function normalizeIp(host: string): string {
  let h = host.trim().replace(/^\[|\]$/g, "")
  const pct = h.indexOf("%")
  if (pct !== -1) h = h.slice(0, pct)
  // IPv4-mapped IPv6 -> IPv4: handles both ::ffff:10.0.0.5 and ::ffff:0a00:0005.
  // (6to4 / NAT64 embeddings are intentionally out of scope.)
  const mapped = /^::ffff:(.+)$/i.exec(h)
  if (mapped) {
    const tail = mapped[1]
    if (net.isIP(tail) === 4) {
      h = tail
    } else {
      const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail)
      if (hex) {
        const hi = parseInt(hex[1], 16)
        const lo = parseInt(hex[2], 16)
        h = `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
      }
    }
  }
  return h.toLowerCase()
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number)
  if (p.length !== 4 || p.some(n => Number.isNaN(n) || n < 0 || n > 255)) return false
  const [a, b] = p
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
  if (a === 127) return true                          // loopback
  if (a === 169 && b === 254) return true             // link-local
  if (a === 0) return true                            // this-network 0.0.0.0/8
  return false
}

function isPrivateV6(ip: string): boolean {
  if (ip === "::1") return true                       // loopback
  if (ip === "::") return true                         // unspecified / wildcard
  if (/^ff/.test(ip)) return true                      // multicast ff00::/8 (never a unicast SSH target)
  if (/^fe[89ab]/.test(ip)) return true               // fe80::/10 link-local
  if (/^f[cd]/.test(ip)) return true                  // fc00::/7 unique-local
  return false
}

/**
 * True when `host` is an IP literal that is NOT a routable public unicast
 * address, i.e. unreachable from the WAN. Hostnames and non-IP strings
 * return false (they may resolve to anything; identity is verified separately
 * on the destructive path).
 */
export function isPrivateIp(host: string): boolean {
  if (!host) return false
  const h = normalizeIp(host)
  const v = net.isIP(h)
  if (v === 4) return isPrivateV4(h)
  if (v === 6) return isPrivateV6(h)
  return false
}

/** Extract a bare hostname/IP from a URL or a raw host[:port] string. */
export function extractHostname(hostOrUrl: string): string {
  if (!hostOrUrl) return ""
  const fromUrl = extractHostFromUrl(hostOrUrl) // new URL(u).hostname (strips userinfo + port)
  if (fromUrl) return fromUrl.replace(/^\[|\]$/g, "")
  const h = hostOrUrl.trim()
  if (h.startsWith("[")) {
    const end = h.indexOf("]")
    if (end !== -1) return h.slice(1, end)
  }
  const m = /^(.*):(\d+)$/.exec(h)
  if (m && !m[1].includes(":")) return m[1] // host:port, but not a bare IPv6 literal
  return h
}
