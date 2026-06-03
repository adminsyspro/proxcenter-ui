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
  if (proxy) {
    // proxy looks like "http://10.0.0.5:3128"
    try {
      const u = new URL(proxy)
      return { host: u.hostname, port: u.port ? Number.parseInt(u.port) : 3128 }
    } catch {
      const m = proxy.match(/^(?:https?:\/\/)?([^:/]+)(?::(\d+))?/)
      if (m) return { host: m[1], port: m[2] ? Number.parseInt(m[2]) : 3128 }
    }
  }
  // Fallback: the connection host on the default spiceproxy port.
  try {
    const u = new URL(connBaseUrl)
    return { host: u.hostname, port: 3128 }
  } catch {
    const m = connBaseUrl.match(/^(?:https?:\/\/)?([^:/]+)/)
    return { host: m ? m[1] : '', port: 3128 }
  }
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
