import { describe, it, expect } from 'vitest'
import { listKubeconfigContexts, sanitizeKubeconfig } from './kubeconfig'

const tokenKubeconfig = `
apiVersion: v1
kind: Config
current-context: ctx
clusters:
- name: c1
  cluster:
    server: https://10.0.0.1:6443
    certificate-authority-data: ${Buffer.from('CA').toString('base64')}
contexts:
- name: ctx
  context: { cluster: c1, user: u1 }
users:
- name: u1
  user:
    token: abc.def.ghi
`

function withUser(userBlock: string) {
  return tokenKubeconfig.replace(/users:[\s\S]*$/, `users:\n- name: u1\n  user:\n${userBlock}`)
}

describe('listKubeconfigContexts', () => {
  it('lists context names', () => {
    const r = listKubeconfigContexts(tokenKubeconfig)
    expect(r.ok).toBe(true)
    expect(r.value).toEqual(['ctx'])
  })
  it('fails on garbage', () => {
    const r = listKubeconfigContexts(':::not yaml:::')
    expect(r.ok).toBe(false)
  })
})

describe('sanitizeKubeconfig accept', () => {
  it('accepts a token context to minimal DTO', () => {
    const r = sanitizeKubeconfig(tokenKubeconfig, 'ctx')
    expect(r.ok).toBe(true)
    expect(r.value?.apiServerUrl).toBe('https://10.0.0.1:6443')
    expect(r.value?.credentialType).toBe('token')
    expect(r.value?.credential).toBe('abc.def.ghi')
    expect(r.value?.caDataPem).toContain('CA')
    expect(r.value?.insecureSkipTlsVerify).toBe(false)
  })
  it('accepts client-cert context', () => {
    const cfg = withUser(`    client-certificate-data: ${Buffer.from('CERT').toString('base64')}\n    client-key-data: ${Buffer.from('KEY').toString('base64')}`)
    const r = sanitizeKubeconfig(cfg, 'ctx')
    expect(r.ok).toBe(true)
    expect(r.value?.credentialType).toBe('client_cert')
    expect(r.value?.credential).toContain('CERT')
    expect(r.value?.credential).toContain('KEY')
  })
})

describe('sanitizeKubeconfig reject', () => {
  const cases: Array<[string, string]> = [
    ['exec', '    exec:\n      command: aws'],
    ['auth-provider', '    auth-provider:\n      name: oidc'],
    ['token file ref', '    tokenFile: /var/run/secrets/token'],
    ['client-key file ref', '    client-key: /home/u/key.pem'],
    ['ca file ref', '    client-certificate: /home/u/cert.pem'],
    ['basic auth', '    username: admin\n    password: hunter2'],
    ['impersonation', '    as: system:admin'],
  ]
  for (const [label, block] of cases) {
    it(`rejects ${label}`, () => {
      const r = sanitizeKubeconfig(withUser(block), 'ctx')
      expect(r.ok).toBe(false)
      expect(r.rejections && r.rejections.length).toBeGreaterThan(0)
    })
  }
  it('rejects proxy-url on the cluster', () => {
    const cfg = tokenKubeconfig.replace('server: https://10.0.0.1:6443', 'server: https://10.0.0.1:6443\n    proxy-url: http://proxy:3128')
    const r = sanitizeKubeconfig(cfg, 'ctx')
    expect(r.ok).toBe(false)
  })
  it('rejects insecure-skip-tls-verify unless allowed', () => {
    const cfg = tokenKubeconfig.replace('certificate-authority-data', 'insecure-skip-tls-verify: true\n    certificate-authority-data')
    expect(sanitizeKubeconfig(cfg, 'ctx').ok).toBe(false)
    const allowed = sanitizeKubeconfig(cfg, 'ctx', { allowInsecure: true })
    expect(allowed.ok).toBe(true)
    expect(allowed.value?.insecureSkipTlsVerify).toBe(true)
  })
  it('rejects oversized input', () => {
    const big = 'x'.repeat(600_000)
    const r = sanitizeKubeconfig(big, 'ctx')
    expect(r.ok).toBe(false)
  })
  it('rejects unknown context name', () => {
    const r = sanitizeKubeconfig(tokenKubeconfig, 'nope')
    expect(r.ok).toBe(false)
  })
  it('rejects non-https server', () => {
    const cfg = tokenKubeconfig.replace('https://10.0.0.1:6443', 'http://10.0.0.1:6443')
    expect(sanitizeKubeconfig(cfg, 'ctx').ok).toBe(false)
  })
  it('rejects an unknown user auth field', () => {
    const cfg = withUser(`    token: abc.def.ghi\n    someFutureAuth: xyz`)
    const r = sanitizeKubeconfig(cfg, 'ctx')
    expect(r.ok).toBe(false)
    expect(r.rejections?.some(msg => msg.includes('someFutureAuth'))).toBe(true)
  })
  it('omits caDataPem when insecure-skip-tls-verify is true', () => {
    const cfg = tokenKubeconfig.replace(
      'certificate-authority-data',
      'insecure-skip-tls-verify: true\n    certificate-authority-data',
    )
    const r = sanitizeKubeconfig(cfg, 'ctx', { allowInsecure: true })
    expect(r.ok).toBe(true)
    expect(r.value?.insecureSkipTlsVerify).toBe(true)
    expect(r.value?.caDataPem).toBeUndefined()
  })
})
