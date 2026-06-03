// frontend/src/lib/console/spiceConfig.test.ts
import { describe, expect, it } from 'vitest'
import { parseSpiceConfig } from './spiceConfig'

const base = {
  type: 'spice',
  host: 'pvespiceproxy:57bf...ticket',
  proxy: 'http://10.0.0.5:3128',
  'tls-port': 61000,
  password: 'SPICE-TICKET',
  ca: '-----BEGIN CERTIFICATE-----\\nMIIA\\n-----END CERTIFICATE-----\\n',
  'host-subject': 'OU=PVE Cluster Node,O=Proxmox Virtual Environment,CN=pve1',
}

describe('parseSpiceConfig', () => {
  it('extracts proxyticket, 3128 address, tls port, ca (unescaped), host-subject', () => {
    const r = parseSpiceConfig(base, 'https://pve1.example:8006')
    expect(r).toMatchObject({
      proxyticket: 'pvespiceproxy:57bf...ticket',
      proxyHost: '10.0.0.5',
      proxyPort: 3128,
      tlsPort: 61000,
      password: 'SPICE-TICKET',
      hostSubject: 'OU=PVE Cluster Node,O=Proxmox Virtual Environment,CN=pve1',
    })
    // \n escape sequences unescaped into a real PEM
    expect(r.ca).toContain('\n')
    expect(r.ca).not.toContain('\\n')
  })

  it('falls back to the connection host on 3128 when proxy is absent', () => {
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

  it('regex-fallback: scheme-less proxy string (new URL throws) extracts host+port', () => {
    // '10.0.0.5:3128' has no scheme so new URL() throws; regex must extract host+port.
    const cfg = { ...base, proxy: '10.0.0.5:3128' }
    const r = parseSpiceConfig(cfg, 'https://pve1.example:8006')
    expect(r.proxyHost).toBe('10.0.0.5')
    expect(r.proxyPort).toBe(3128)
  })

  it('regex-fallback: scheme-less connBaseUrl (new URL throws) extracts host when proxy absent', () => {
    // '192.168.1.1:8006' has no scheme so new URL() throws; regex must extract the host.
    const cfg = { ...base }
    delete (cfg as any).proxy
    const r = parseSpiceConfig(cfg, '192.168.1.1:8006')
    expect(r.proxyHost).toBe('192.168.1.1')
    expect(r.proxyPort).toBe(3128)
  })
})
