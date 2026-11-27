/**
 * Shared Proxmox VM config parsers.
 *
 * parseVmStaticIPs  - extract static IP addresses from a VM/LXC config record.
 * parseVmSmbiosUuid - extract and normalise the SMBIOS UUID from a QEMU config record.
 *
 * Both functions are pure (no I/O, no side-effects) and can be used by any
 * server-side code that has already fetched the raw PVE config object.
 */

// ── IPv4 / IPv6 validation ─────────────────────────────────────────────────

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6_RE = /^[0-9a-fA-F:]+$/

function isValidIp(addr: string): boolean {
  if (IPV4_RE.test(addr)) return true
  // Minimal IPv6 check: contains a colon and only hex + colon chars.
  return addr.includes(':') && IPV6_RE.test(addr)
}

// ── UUID validation ────────────────────────────────────────────────────────

// Standard 8-4-4-4-12 UUID shape.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── parseVmStaticIpForKey ──────────────────────────────────────────────────

/**
 * Parse the static IP (and CIDR prefix) for a single network interface key.
 *
 * This is the single authoritative parser for one net slot: it reads the
 * correct config field for the vmType, strips the CIDR, validates with
 * isValidIp, and returns null for dhcp/auto/missing/invalid values.
 *
 * QEMU: reads ipconfig{N} where N is the suffix of netKey.
 * LXC:  reads the ip= field embedded in the netKey value.
 *
 * Returns { ip: string | null, cidr: number | null }.
 * Never throws.
 */
export function parseVmStaticIpForKey(
  config: Record<string, unknown>,
  vmType: string,
  netKey: string,
): { ip: string | null; cidr: number | null } {
  const none = { ip: null, cidr: null }

  let rawIpField: string | null = null

  if (vmType === 'lxc') {
    const v = config[netKey]
    if (typeof v !== 'string') return none
    // Find ip= inside the comma-separated net value.
    for (const part of v.split(',')) {
      const eqIdx = part.indexOf('=')
      if (eqIdx < 0) continue
      if (part.substring(0, eqIdx) === 'ip') {
        rawIpField = part.substring(eqIdx + 1)
        break
      }
    }
  } else {
    // QEMU: ip is in ipconfig{N}.
    const idx = netKey.slice('net'.length)
    const ipconfigVal = config[`ipconfig${idx}`]
    if (typeof ipconfigVal !== 'string') return none
    for (const part of ipconfigVal.split(',')) {
      const eqIdx = part.indexOf('=')
      if (eqIdx < 0) continue
      if (part.substring(0, eqIdx) === 'ip') {
        rawIpField = part.substring(eqIdx + 1)
        break
      }
    }
  }

  if (!rawIpField || rawIpField === 'dhcp' || rawIpField === 'auto') return none

  const slashIdx = rawIpField.indexOf('/')
  const addr = slashIdx > 0 ? rawIpField.substring(0, slashIdx) : rawIpField
  if (!isValidIp(addr)) return none

  const cidr = slashIdx > 0 ? Number.parseInt(rawIpField.substring(slashIdx + 1), 10) : null
  return { ip: addr, cidr: Number.isFinite(cidr) ? cidr : null }
}

// ── parseVmStaticIPs ───────────────────────────────────────────────────────

/**
 * Extract all static IP addresses (CIDR prefix stripped) from a raw Proxmox
 * VM config record.
 *
 * QEMU: reads ipconfigN entries (ip=<addr>[/prefix][,gw=...]); skips "dhcp".
 * LXC:  reads the ip= field embedded in netN entries; skips "dhcp".
 *
 * Returns an ordered array of bare IP address strings for keys that have a
 * valid static assignment. Implemented via parseVmStaticIpForKey so both
 * callers share a single parse path.
 * Never throws.
 */
export function parseVmStaticIPs(config: Record<string, unknown>, vmType: string): string[] {
  const ips: string[] = []

  for (const [key] of Object.entries(config)) {
    if (!/^net\d+$/.test(key)) continue
    const { ip } = parseVmStaticIpForKey(config, vmType, key)
    if (ip !== null) ips.push(ip)
  }

  return ips
}

// ── parseVmSmbiosUuid ──────────────────────────────────────────────────────

const SMBIOS_UUID_RE = /uuid=([0-9a-fA-F-]{36})/

/**
 * Parse the UUID from a QEMU smbios1 config string.
 *
 * Returns the UUID lowercased when present and well-formed,
 * or null when the field is absent or does not contain a valid UUID.
 */
export function parseVmSmbiosUuid(config: Record<string, unknown>): string | null {
  const raw = config['smbios1']
  if (typeof raw !== 'string') return null

  const m = SMBIOS_UUID_RE.exec(raw)
  if (!m) return null

  const candidate = m[1].toLowerCase()
  if (!UUID_RE.test(candidate)) return null

  return candidate
}
