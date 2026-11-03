#!/usr/bin/env node
// Usage: node scripts/generate-well-known-ports.mjs [iana.csv path or URL] > src/lib/network/wellKnownPorts.ts
import { readFileSync } from 'node:fs'

const IANA_URL_DEFAULT = 'https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv'
const source = process.argv[2] || IANA_URL_DEFAULT

// How admins say the IANA service names.
const ALIASES = {
  ssh: 'SSH', telnet: 'Telnet', ftp: 'FTP', 'ftp-data': 'FTP data', smtp: 'SMTP', submission: 'SMTP submission', smtps: 'SMTPS',
  domain: 'DNS', http: 'HTTP', https: 'HTTPS', 'http-alt': 'HTTP-alt', pop3: 'POP3', pop3s: 'POP3S', imap2: 'IMAP', imap: 'IMAP', imaps: 'IMAPS',
  ntp: 'NTP', snmp: 'SNMP', 'snmp-trap': 'SNMP trap', snmptrap: 'SNMP trap', syslog: 'Syslog', 'syslog-conn': 'Syslog TLS', ldap: 'LDAP', ldaps: 'LDAPS',
  'ms-wbt-server': 'RDP', 'microsoft-ds': 'SMB', 'netbios-ssn': 'NetBIOS', nfs: 'NFS', sunrpc: 'RPC', mysql: 'MySQL', postgresql: 'PostgreSQL',
  redis: 'Redis', amqp: 'AMQP', amqps: 'AMQPS', kerberos: 'Kerberos', 'kerberos-adm': 'Kerberos admin', kpasswd: 'Kerberos passwd', bootps: 'DHCP', bootpc: 'DHCP',
  tftp: 'TFTP', rsync: 'rsync', 'git': 'Git', 'ms-sql-s': 'MSSQL', 'ms-sql-m': 'MSSQL', mongodb: 'MongoDB', 'x11': 'X11', 'ipp': 'IPP', 'ipsec-nat-t': 'IPsec NAT-T',
  isakmp: 'IPsec IKE', 'openvpn': 'OpenVPN', 'wireguard': 'WireGuard', 'rtsp': 'RTSP', 'sip': 'SIP', 'sips': 'SIPS', 'afpovertcp': 'AFP', 'epmap': 'MS RPC',
}

// What the table keeps: every IANA entry of the well-known range (port below 1024), and above it only the services
// admins recognise (this list, which also overrides the IANA name of a port below 1024). Ports from 49152 up (the
// dynamic range) are never named. [port or [from, to], name, protocols]
const T = ['tcp'], U = ['udp'], TU = ['tcp', 'udp']
const WELL_KNOWN_LIMIT = 1024
const DYNAMIC_FROM = 49152
const CURATED = [
  [20, 'FTP data', T], [21, 'FTP', T], [22, 'SSH', T], [23, 'Telnet', T], [25, 'SMTP', T], [53, 'DNS', TU], [67, 'DHCP', U], [68, 'DHCP', U], [69, 'TFTP', U],
  [80, 'HTTP', T], [88, 'Kerberos', TU], [110, 'POP3', T], [111, 'RPC', TU], [123, 'NTP', U], [135, 'MS RPC', T], [139, 'NetBIOS', T], [143, 'IMAP', T],
  [161, 'SNMP', U], [162, 'SNMP trap', U], [389, 'LDAP', TU], [443, 'HTTPS', T], [445, 'SMB', T], [465, 'SMTPS', T], [500, 'IPsec IKE', U], [514, 'Syslog', U],
  [587, 'SMTP submission', T], [636, 'LDAPS', T], [993, 'IMAPS', T], [995, 'POP3S', T],
  [1194, 'OpenVPN', TU], [1433, 'MSSQL', T], [1521, 'Oracle', T], [1812, 'RADIUS', U], [1813, 'RADIUS', U], [1883, 'MQTT', T], [2049, 'NFS', TU],
  [2181, 'ZooKeeper', T], [2222, 'SSH-alt', T], [2375, 'Docker', T], [2376, 'Docker', T], [2379, 'etcd', T], [2380, 'etcd', T], [3000, 'Grafana', T],
  [3128, 'Proxy', T], [3260, 'iSCSI', T], [3268, 'LDAP GC', T], [3269, 'LDAP GC TLS', T], [3300, 'Ceph MON', T], [3306, 'MySQL', T], [3389, 'RDP', TU],
  [3478, 'STUN', TU], [4369, 'EPMD', T], [4500, 'IPsec NAT-T', U], [4789, 'VXLAN', U], [5000, 'Docker registry', T], [5001, 'Docker registry', T],
  [5044, 'Beats', T], [5060, 'SIP', TU], [5222, 'XMPP', T], [5353, 'mDNS', U], [5432, 'PostgreSQL', T], [5601, 'Kibana', T], [5671, 'AMQPS', T], [5672, 'AMQP', T],
  [5984, 'CouchDB', T], [5985, 'WinRM', T], [5986, 'WinRM TLS', T], [[5900, 5999], 'VNC', T], [6000, 'X11', T], [6379, 'Redis', T], [6443, 'Kubernetes API', T],
  [6789, 'Ceph MON', T], [[6800, 7300], 'Ceph OSD', T], [8000, 'HTTP-alt', T], [8006, 'Proxmox VE', T], [8007, 'Proxmox Backup', T], [8008, 'HTTP-alt', T],
  [8080, 'HTTP-alt', T], [8081, 'HTTP-alt', T], [8082, 'HTTP-alt', T], [8086, 'InfluxDB', T], [8140, 'Puppet', T], [8200, 'Vault', T], [[8300, 8302], 'Consul', T],
  [8443, 'HTTPS-alt', T], [8472, 'VXLAN', U], [8500, 'Consul', T], [8600, 'Consul DNS', TU], [8883, 'MQTT TLS', T], [8888, 'HTTP-alt', T], [9000, 'HTTP-alt', T],
  [9042, 'Cassandra', T], [9090, 'Prometheus', T], [9092, 'Kafka', T], [9093, 'Alertmanager', T], [9100, 'node-exporter', T], [9200, 'Elasticsearch', T],
  [9300, 'Elasticsearch', T], [9418, 'Git', T], [10000, 'Webmin', T], [10250, 'kubelet', T], [11211, 'Memcached', TU], [15672, 'RabbitMQ management', T],
  [16509, 'libvirt', T], [[27017, 27019], 'MongoDB', T],
]

/** RFC 4180 rows (quoted fields may hold commas, quotes and line breaks). */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

const csv = /^https?:/.test(source) ? await (await fetch(source)).text() : readFileSync(source, 'utf8')
const [, ...rows] = parseCsv(csv)
const points = new Map() // "tcp/22" -> name
let fileDate = ''
for (const [name, port, proto, description, , , , modified] of rows) {
  if (modified && modified > fileDate) fileDate = modified
  if (!name || !/^\d+$/.test(port || '') || !['tcp', 'udp'].includes(proto)) continue
  if (/^(reserved|unassigned|de-registered)/i.test((description || '').trim())) continue
  const key = `${proto}/${Number(port)}`
  if (!points.has(key)) points.set(key, ALIASES[name.toLowerCase()] || name)
}

const ranges = []
for (const key of [...points.keys()]) if (Number(key.split('/')[1]) >= WELL_KNOWN_LIMIT) points.delete(key)
for (const [port, name, protos] of CURATED) {
  for (const proto of protos) {
    if (Array.isArray(port)) ranges.push([proto, port[0], port[1], name])
    else if (port < DYNAMIC_FROM) points.set(`${proto}/${port}`, name)
  }
}

const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const keys = [...points.keys()].sort((a, b) => {
  const [pa, na] = a.split('/'), [pb, nb] = b.split('/')
  return Number(na) - Number(nb) || (pa < pb ? -1 : 1)
})

const out = []
out.push(`// Generated by scripts/generate-well-known-ports.mjs from the IANA service names and port numbers registry (file date ${fileDate}): its entries below 1024 and the curated services above, ${keys.length} single-port entries and ${ranges.length} ranges. Do not edit by hand.`)
out.push('')
out.push('/** "tcp/22" -> "SSH". */')
out.push('export const WELL_KNOWN_PORTS: Readonly<Record<string, string>> = {')
for (const k of keys) out.push(`  '${k}': ${quote(points.get(k))},`)
out.push('}')
out.push('')
out.push('/** Port ranges that name one service: [protocol, from, to, name]. */')
out.push('export const WELL_KNOWN_RANGES: ReadonlyArray<readonly [string, number, number, string]> = [')
for (const [proto, from, to, name] of ranges) out.push(`  ['${proto}', ${from}, ${to}, ${quote(name)}],`)
out.push(']')
out.push('')
process.stdout.write(out.join('\n'))
