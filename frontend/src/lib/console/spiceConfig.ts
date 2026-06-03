// frontend/src/lib/console/spiceConfig.ts
//
// Parses the Proxmox `spiceproxy` remote-viewer config into the fields
// the ws-proxy SPICE bridge needs. Proxmox returns `host` as a signed
// proxyticket (NOT a hostname) and `proxy` as `http://<node>:3128`; the
// spiceproxy daemon on 3128 routes the HTTP CONNECT to the VM's SPICE
// TLS port. See spiceproxy(8).

export type ParsedSpiceConfig = {
  proxyticket: string
  proxyHost: string
  proxyPort: number
  tlsPort: number
  password: string
  ca: string
  hostSubject: string
}

function deriveProxy(proxy: string | undefined, connBaseUrl: string): { host: string; port: number } {
  // Port: Proxmox's spiceproxy listens on 3128 by default; honour a custom
  // port if the `proxy` field carries one (e.g. "http://node:3129").
  let port = 3128
  const portMatch = proxy?.match(/:(\d+)\s*$/)
  if (portMatch) port = Number.parseInt(portMatch[1])

  // Host: ALWAYS the connection host, i.e. the address ProxCenter already
  // uses to reach Proxmox (where pveFetch works). Proxmox sets the `proxy`
  // field to the TARGET NODE's own hostname (e.g. "pve-3az-5-c"), which is
  // typically NOT resolvable from ProxCenter. The signed proxyticket lets
  // any cluster node's spiceproxy route the CONNECT to the right VM, so
  // connecting to the connection host is correct, mirroring how the VNC
  // relay uses baseUrl.host rather than the node name.
  let host = ''
  try {
    host = new URL(connBaseUrl).hostname
  } catch {
    const m = connBaseUrl.match(/^(?:https?:\/\/)?([^:/]+)/)
    host = m ? m[1] : ''
  }
  return { host, port }
}

export function parseSpiceConfig(cfg: Record<string, any>, connBaseUrl: string): ParsedSpiceConfig {
  const proxyticket = cfg.host
  const tlsPort = Number(cfg['tls-port'] ?? cfg.port)
  if (!proxyticket || !tlsPort || Number.isNaN(tlsPort)) {
    throw new Error('Invalid SPICE config: missing proxyticket or port')
  }
  const { host: proxyHost, port: proxyPort } = deriveProxy(cfg.proxy, connBaseUrl)
  // Proxmox escapes newlines in the ca as literal "\n"; turn them back
  // into a real PEM so Node's TLS layer accepts it.
  const ca = typeof cfg.ca === 'string' ? cfg.ca.replace(/\\n/g, '\n') : ''
  return {
    proxyticket,
    proxyHost,
    proxyPort,
    tlsPort,
    password: cfg.password ?? '',
    ca,
    hostSubject: cfg['host-subject'] ?? '',
  }
}
