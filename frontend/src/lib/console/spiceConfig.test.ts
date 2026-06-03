// frontend/src/lib/console/spiceConfig.test.ts
import { describe, expect, it } from 'vitest'
import { parseSpiceConfig } from './spiceConfig'

const base = {
  type: 'spice',
  host: 'pvespiceproxy:57bf...ticket',
  // Proxmox sets `proxy` to the TARGET NODE's own hostname, which is often
  // NOT resolvable from ProxCenter. The parser must ignore this host and
  // use the connection host instead.
  proxy: 'http://pve-3az-5-c:3128',
  'tls-port': 61000,
  password: 'SPICE-TICKET',
  ca: '-----BEGIN CERTIFICATE-----\\nMIIA\\n-----END CERTIFICATE-----\\n',
  'host-subject': 'OU=PVE Cluster Node,O=Proxmox Virtual Environment,CN=pve1',
}

describe('parseSpiceConfig', () => {
  it('uses the connection host (NOT the proxy node name) and parses ticket/tls/ca/host-subject', () => {
    const r = parseSpiceConfig(base, 'https://pve1.example:8006')
    expect(r).toMatchObject({
      proxyticket: 'pvespiceproxy:57bf...ticket',
      proxyHost: 'pve1.example', // the connection host, not "pve-3az-5-c"
      proxyPort: 3128,
      tlsPort: 61000,
      password: 'SPICE-TICKET',
      hostSubject: 'OU=PVE Cluster Node,O=Proxmox Virtual Environment,CN=pve1',
    })
    // Regression guard: never connect to the unresolvable node name.
    expect(r.proxyHost).not.toBe('pve-3az-5-c')
    // \n escape sequences unescaped into a real PEM
    expect(r.ca).toContain('\n')
    expect(r.ca).not.toContain('\\n')
  })

  it('honours a custom spiceproxy port from the proxy field (host still the connection host)', () => {
    const r = parseSpiceConfig({ ...base, proxy: 'http://pve-3az-5-c:3129' }, 'https://pve1.example:8006')
    expect(r.proxyHost).toBe('pve1.example')
    expect(r.proxyPort).toBe(3129)
  })

  it('defaults the port to 3128 when the proxy field is absent', () => {
    const cfg = { ...base }
    delete (cfg as any).proxy
    const r = parseSpiceConfig(cfg, 'https://pve1.example:8006')
    expect(r.proxyHost).toBe('pve1.example')
    expect(r.proxyPort).toBe(3128)
  })

  it('falls back to "port" when "tls-port" is absent', () => {
    const cfg: any = { ...base }
    delete cfg['tls-port']
    cfg.port = 5901
    expect(parseSpiceConfig(cfg, 'https://pve1.example:8006').tlsPort).toBe(5901)
  })

  it('throws when no usable port or proxyticket is present', () => {
    expect(() => parseSpiceConfig({} as any, 'https://pve1.example:8006')).toThrow()
  })

  it('defaults password/ca/host-subject to empty strings when absent', () => {
    const r = parseSpiceConfig({ host: 'pt', 'tls-port': 61000 } as any, 'https://pve1.example:8006')
    expect(r.password).toBe('')
    expect(r.ca).toBe('')
    expect(r.hostSubject).toBe('')
    expect(r.proxyPort).toBe(3128)
  })

  it('extracts the host from a scheme-less connBaseUrl (new URL throws -> regex fallback)', () => {
    // '192.168.1.1:8006' has no scheme so new URL() throws; the regex must
    // still extract the host. ('pve1.example:8006' would NOT throw because
    // Node parses "pve1.example" as a scheme, hence the IP form here.)
    const r = parseSpiceConfig(base, '192.168.1.1:8006')
    expect(r.proxyHost).toBe('192.168.1.1')
    expect(r.proxyPort).toBe(3128)
  })
})
