// CIDR validation shared by the connection schemas (server) and the
// connection dialog (browser). Pure string checks on purpose: node:net is not
// available in the client bundle, and the Go orchestrator re-parses the value
// anyway, so this only has to reject what net.ParseCIDR would reject.

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const HEXTET_RE = /^[0-9a-f]{1,4}$/i
// A prefix length is 1 to 3 digits, no sign and no leading zero.
const PREFIX_RE = /^(?:0|[1-9]\d{0,2})$/

function isIPv4Address(value: string): boolean {
  return IPV4_RE.test(value)
}

/**
 * RFC 4291 textual form: up to 8 hextets, a single "::" standing for one or
 * more zero groups, an optional embedded IPv4 in the last position. Zone ids
 * (fe80::1%eth0) are rejected: they never belong in a network prefix.
 */
function isIPv6Address(value: string): boolean {
  if (!value || /[^0-9a-f:.]/i.test(value)) return false
  const halves = value.split("::")
  if (halves.length > 2) return false
  const head = halves[0] === "" ? [] : halves[0].split(":")
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : []
  // An embedded IPv4 (::ffff:10.0.0.1) fills the last 32 bits, so it can only
  // close the address: the last group of the tail when "::" is present, the
  // last group of the head otherwise. "10.0.0.1::" would put zero groups
  // behind it, which net.ParseCIDR on the orchestrator rejects.
  const closing = halves.length === 2 ? tail : head
  let count = 0
  for (const groups of [head, tail]) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]
      if (group.includes(".")) {
        if (groups !== closing || i !== groups.length - 1) return false
        if (!isIPv4Address(group)) return false
        count += 2
      } else {
        if (!HEXTET_RE.test(group)) return false
        count += 1
      }
    }
  }
  return halves.length === 2 ? count <= 7 : count === 8
}

/**
 * Input mask for an IPv4 CIDR field: true when value is a prefix of some valid
 * IPv4 CIDR, so a keystroke that could never lead to one is refused as it is
 * typed. Up to four octets of at most 255 without zero padding, only the last
 * octet may still be empty, one slash once the fourth octet has started, a
 * prefix of at most 32.
 */
export function isPartialIPv4Cidr(value: string): boolean {
  if (typeof value !== "string") return false
  if (value === "") return true
  const m = /^(\d{1,3}(?:\.\d{0,3}){0,3})(\/\d{0,2})?$/.exec(value)
  if (!m) return false
  const octets = m[1].split(".")
  for (let i = 0; i < octets.length; i++) {
    const octet = octets[i]
    if (octet === "") {
      if (i !== octets.length - 1) return false
      continue
    }
    if (octet.length > 1 && octet.startsWith("0")) return false
    if (Number(octet) > 255) return false
  }
  if (m[2] !== undefined) {
    if (octets.length !== 4 || octets[3] === "") return false
    if (m[2].length > 1 && Number(m[2].slice(1)) > 32) return false
  }
  return true
}

/** True for `address/prefix` with an IPv4 (/0-32) or IPv6 (/0-128) address. */
export function isValidCidr(value: string): boolean {
  if (typeof value !== "string") return false
  const slash = value.indexOf("/")
  if (slash === -1) return false
  const address = value.slice(0, slash)
  const prefixStr = value.slice(slash + 1)
  if (!PREFIX_RE.test(prefixStr)) return false
  const prefix = Number(prefixStr)
  if (isIPv4Address(address)) return prefix <= 32
  if (isIPv6Address(address)) return prefix <= 128
  return false
}
