import { useEffect, useSyncExternalStore } from 'react'

/**
 * Names for the ports flows are written with ("tcp/22" reads "SSH"). The full IANA table (wellKnownPorts, about
 * 11,000 entries) is a separate chunk loaded on first use; until it arrives the small table below answers, so the
 * first render already names the ports admins meet every day. The consistency of the two is tested.
 */

type Range = readonly [proto: string, from: number, to: number, name: string]

const T = ['tcp'], U = ['udp'], TU = ['tcp', 'udp']
const COMMON: ReadonlyArray<readonly [number | readonly [number, number], string, readonly string[]]> = [
  [20, 'FTP data', T], [21, 'FTP', T], [22, 'SSH', T], [23, 'Telnet', T], [25, 'SMTP', T], [53, 'DNS', TU], [67, 'DHCP', U], [68, 'DHCP', U], [69, 'TFTP', U],
  [80, 'HTTP', T], [88, 'Kerberos', TU], [110, 'POP3', T], [111, 'RPC', TU], [123, 'NTP', U], [135, 'MS RPC', T], [139, 'NetBIOS', T], [143, 'IMAP', T],
  [161, 'SNMP', U], [162, 'SNMP trap', U], [389, 'LDAP', TU], [443, 'HTTPS', T], [445, 'SMB', T], [465, 'SMTPS', T], [500, 'IPsec IKE', U], [514, 'Syslog', U],
  [587, 'SMTP submission', T], [636, 'LDAPS', T], [993, 'IMAPS', T], [995, 'POP3S', T], [1194, 'OpenVPN', TU], [1433, 'MSSQL', T], [1521, 'Oracle', T],
  [1883, 'MQTT', T], [2049, 'NFS', TU], [2375, 'Docker', T], [2376, 'Docker', T], [2379, 'etcd', T], [2380, 'etcd', T], [3000, 'Grafana', T],
  [3128, 'Proxy', T], [3300, 'Ceph MON', T], [3306, 'MySQL', T], [3389, 'RDP', TU], [4500, 'IPsec NAT-T', U], [4789, 'VXLAN', U], [5000, 'Docker registry', T],
  [5001, 'Docker registry', T], [5044, 'Beats', T], [5432, 'PostgreSQL', T], [5601, 'Kibana', T], [5671, 'AMQPS', T], [5672, 'AMQP', T],
  [[5900, 5999], 'VNC', T], [6379, 'Redis', T], [6443, 'Kubernetes API', T], [6789, 'Ceph MON', T], [[6800, 7300], 'Ceph OSD', T], [8006, 'Proxmox VE', T],
  [8007, 'Proxmox Backup', T], [8080, 'HTTP-alt', T], [8086, 'InfluxDB', T], [8443, 'HTTPS-alt', T], [8472, 'VXLAN', U], [8883, 'MQTT TLS', T],
  [9090, 'Prometheus', T], [9093, 'Alertmanager', T], [9100, 'node-exporter', T], [9200, 'Elasticsearch', T], [9300, 'Elasticsearch', T], [10250, 'kubelet', T],
  [27017, 'MongoDB', T], [51820, 'WireGuard', U],
]

type Table = { points: Readonly<Record<string, string>>; ranges: ReadonlyArray<Range> }

/** The table answering before the full one is loaded. */
export const COMMON_TABLE: Table = (() => {
  const points: Record<string, string> = {}
  const ranges: Range[] = []
  for (const [port, name, protos] of COMMON) {
    for (const proto of protos) {
      if (typeof port === 'number') points[`${proto}/${port}`] = name
      else ranges.push([proto, port[0], port[1], name])
    }
  }
  return { points, ranges }
})()

let full: Table | null = null
let loading: Promise<void> | null = null
let version = 0
const listeners = new Set<() => void>()

/** Loads the full table (once); resolves when it answers. A failed load leaves the common table in place. */
export function loadServiceNames(): Promise<void> {
  loading ??= import('./wellKnownPorts')
    .then(m => {
      full = { points: m.WELL_KNOWN_PORTS, ranges: m.WELL_KNOWN_RANGES }
      version++
      listeners.forEach(l => l())
    })
    .catch(() => undefined)
  return loading
}

/** For the tests: back to the common table. */
export function resetServiceNames(): void {
  full = null
  loading = null
  version = 0
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/**
 * Starts the load of the full table and returns a number that changes when it arrives: a component that shows
 * service names calls it (and lists the number in the deps of the memos that bake names into text).
 */
export function useServiceNames(): number {
  useEffect(() => { void loadServiceNames() }, [])
  return useSyncExternalStore(subscribe, () => version, () => 0)
}

/** The known name of a single port, else null. A range, a list, a non-number or a protocol other than tcp/udp has none. */
export function serviceName(proto: string, port: string | number | undefined): string | null {
  const p = proto.toLowerCase()
  const text = String(port ?? '').trim()
  if ((p !== 'tcp' && p !== 'udp') || !/^\d{1,5}$/.test(text)) return null
  const n = Number(text)
  if (n < 1 || n > 65535) return null
  const table = full ?? COMMON_TABLE
  return table.points[`${p}/${n}`] ?? table.ranges.find(([rp, from, to]) => rp === p && n >= from && n <= to)?.[3] ?? null
}

/** "SSH" for tcp/22, else the raw "tcp/9999" ("icmp" without port; a range stays "tcp/1000-2000"). */
export function serviceLabel(proto: string, port?: string | number): string {
  const text = String(port ?? '').trim()
  if (!text) return proto
  return serviceName(proto, text) ?? `${proto}/${text}`
}

/** "SSH (tcp/22)" for a tooltip, else the raw "tcp/9999". */
export function serviceTitle(proto: string, port?: string | number): string {
  const text = String(port ?? '').trim()
  const name = text ? serviceName(proto, text) : null
  return name ? `${name} (${proto}/${text})` : serviceLabel(proto, port)
}

function mapToken(token: string, one: (proto: string, port: string) => string): string {
  const slash = token.indexOf('/')
  if (slash < 0) return token
  const proto = token.slice(0, slash)
  const ports = token.slice(slash + 1).split(',').map(p => p.trim()).filter(Boolean)
  return ports.length ? ports.map(p => one(proto, p)).join(', ') : proto
}

/** serviceLabel of a "proto/port" token ("tcp/22" and "tcp/22,80" are tokens; so is "icmp"). */
export const serviceTokenLabel = (token: string): string => mapToken(token, serviceLabel)
/** serviceTitle of a token. */
export const serviceTokenTitle = (token: string): string => mapToken(token, serviceTitle)
/** The titles of tokens as one list: "SSH (tcp/22), HTTP-alt (tcp/8080)". */
export const serviceTokensTitle = (tokens: readonly string[]): string => tokens.map(serviceTokenTitle).join(', ')
