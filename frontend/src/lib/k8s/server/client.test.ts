import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { CoreV1Api } from '@kubernetes/client-node'
import { parse as parseYaml } from 'yaml'
import { splitCertKeyPem, buildKubeClient, buildKubeconfigYaml, invalidateClusterClients, hasAgentSeam } from './client'
import { sanitizeKubeconfig } from '../kubeconfig'
import type { SanitizedCredential } from '../types'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIcert\nline2\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN EC PRIVATE KEY-----\nMIIkey\nline2\n-----END EC PRIVATE KEY-----'

describe('splitCertKeyPem', () => {
  it('separates multi-line cert and key blocks', () => {
    const { certPem, keyPem } = splitCertKeyPem(CERT + '\n' + KEY)
    expect(certPem).toContain('BEGIN CERTIFICATE')
    expect(certPem).toContain('line2')
    expect(certPem).not.toContain('PRIVATE KEY')
    expect(keyPem).toContain('EC PRIVATE KEY')
    expect(keyPem).toContain('line2')
  })
})

describe('buildKubeconfigYaml', () => {
  it('round-trips a client-cert credential back through sanitizeKubeconfig', () => {
    const cred: SanitizedCredential = {
      apiServerUrl: 'https://10.0.0.10:6443',
      caDataPem: '-----BEGIN CERTIFICATE-----\nMIIca\n-----END CERTIFICATE-----',
      insecureSkipTlsVerify: false,
      credentialType: 'client_cert',
      credential: `${CERT}\n${KEY}`,
      contextName: 'my-cluster',
    }
    const back = sanitizeKubeconfig(buildKubeconfigYaml(cred), 'my-cluster')
    expect(back.ok).toBe(true)
    expect(back.value).toMatchObject({
      apiServerUrl: 'https://10.0.0.10:6443',
      credentialType: 'client_cert',
      contextName: 'my-cluster',
    })
    // CA and cert/key survived the base64 round-trip intact.
    expect(back.value!.caDataPem).toContain('BEGIN CERTIFICATE')
    expect(back.value!.credential).toContain('BEGIN CERTIFICATE')
    expect(back.value!.credential).toContain('EC PRIVATE KEY')
  })

  it('emits a single token-user context with current-context set', () => {
    const cred: SanitizedCredential = {
      apiServerUrl: 'https://api.example:6443',
      insecureSkipTlsVerify: false,
      credentialType: 'token',
      credential: 's3cr3t-token',
      contextName: 'tok-ctx',
    }
    const doc: any = parseYaml(buildKubeconfigYaml(cred))
    expect(doc.kind).toBe('Config')
    expect(doc['current-context']).toBe('tok-ctx')
    expect(doc.clusters).toHaveLength(1)
    expect(doc.clusters[0].cluster.server).toBe('https://api.example:6443')
    expect(doc.users[0].user.token).toBe('s3cr3t-token')
    expect(doc.contexts[0].context.cluster).toBe('tok-ctx')
    expect(doc.contexts[0].context.user).toBe('tok-ctx-user')
  })

  it('sets insecure-skip-tls-verify and omits the CA for an insecure credential', () => {
    const cred: SanitizedCredential = {
      apiServerUrl: 'https://api.example:6443',
      insecureSkipTlsVerify: true,
      credentialType: 'token',
      credential: 't',
      contextName: 'c',
    }
    const cluster: any = parseYaml(buildKubeconfigYaml(cred)).clusters[0].cluster
    expect(cluster['insecure-skip-tls-verify']).toBe(true)
    expect(cluster['certificate-authority-data']).toBeUndefined()
  })
})

describe('buildKubeClient', () => {
  it('rejects a non-https server (SSRF url guard)', () => {
    const r = buildKubeClient({ clusterId: 'c1', credentialVersion: 1, server: 'http://x', cred: { type: 'token', value: 't' } })
    expect(r.ok).toBe(false)
  })
  it('builds and caches per credentialVersion', () => {
    const a = buildKubeClient({ clusterId: 'c1', credentialVersion: 1, server: 'https://k.example:6443', cred: { type: 'token', value: 't' } })
    const b = buildKubeClient({ clusterId: 'c1', credentialVersion: 1, server: 'https://k.example:6443', cred: { type: 'token', value: 't' } })
    expect(a.ok && b.ok).toBe(true)
    expect(a.api).toBe(b.api) // same cached instance
  })
  it('invalidation drops all versions for a cluster', () => {
    buildKubeClient({ clusterId: 'c1', credentialVersion: 1, server: 'https://k.example:6443', cred: { type: 'token', value: 't' } })
    invalidateClusterClients('c1')
    const c = buildKubeClient({ clusterId: 'c1', credentialVersion: 1, server: 'https://k.example:6443', cred: { type: 'token', value: 't' } })
    expect(c.ok).toBe(true) // rebuilt, no throw
  })
})

describe('buildKubeClient - skipCache', () => {
  it('skipCache:true returns distinct api instances and does not populate the cache', () => {
    const key = '_validate'
    // Ensure no leftover entry from a prior run.
    invalidateClusterClients(key)

    const a = buildKubeClient({ clusterId: key, credentialVersion: 0, server: 'https://a.example:6443', cred: { type: 'token', value: 'token-a' }, skipCache: true })
    const b = buildKubeClient({ clusterId: key, credentialVersion: 0, server: 'https://b.example:6443', cred: { type: 'token', value: 'token-b' }, skipCache: true })

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    // Two different inputs must produce distinct api instances - no cache collision.
    expect(a.api).not.toBe(b.api)

    // Nothing should have been stored: a non-skipCache call now must build fresh.
    const c = buildKubeClient({ clusterId: key, credentialVersion: 0, server: 'https://a.example:6443', cred: { type: 'token', value: 'token-a' }, skipCache: false })
    expect(c.ok).toBe(true)
    // c was built fresh (cache was empty), so it is distinct from both a and b.
    expect(c.api).not.toBe(a.api)
    expect(c.api).not.toBe(b.api)

    // Clean up the entry written by c.
    invalidateClusterClients(key)
  })
})

// ---------------------------------------------------------------------------
// hasAgentSeam + buildKubeClient fail-closed when the private seam is absent
// ---------------------------------------------------------------------------

describe('hasAgentSeam', () => {
  it('returns true for an object with a createAgent function', () => {
    expect(hasAgentSeam({ createAgent: () => null })).toBe(true)
  })
  it('returns false when createAgent is missing', () => {
    expect(hasAgentSeam({})).toBe(false)
  })
  it('returns false when createAgent is not a function', () => {
    expect(hasAgentSeam({ createAgent: 'notAFunction' })).toBe(false)
  })
})

describe('buildKubeClient - fail-closed when transport seam absent', () => {
  it('returns { ok: false } when KubeConfig has no createAgent method', () => {
    // Simulate the scenario where a future @kubernetes/client-node upgrade removes
    // the private createAgent seam. We do this by deleting the property from the
    // KubeConfig prototype before construction, then restoring it.
    const { KubeConfig } = require('@kubernetes/client-node') as typeof import('@kubernetes/client-node')
    const proto = KubeConfig.prototype as any
    const original = proto.createAgent
    delete proto.createAgent
    try {
      const r = buildKubeClient({
        clusterId: 'seam-test',
        credentialVersion: 1,
        server: 'https://k.example:6443',
        cred: { type: 'token', value: 't' },
      })
      expect(r.ok).toBe(false)
      expect(r.error).toBe('k8s client transport seam unavailable')
    } finally {
      proto.createAgent = original
    }
  })
})

// ---------------------------------------------------------------------------
// HARD GATE: prove the guarded agent is actually used by the @kubernetes/
// client-node API client (not just constructed). Build a client whose server
// resolves / IS a blocked IP, call an API method, and assert the call FAILS
// CLOSED - the SSRF guard blocks the dial, meaning the agent IS in the request
// path, not merely attached.
// ---------------------------------------------------------------------------

function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-client-gate-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-client-gate-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  const certPem = readFileSync(certFile, 'utf8')
  const keyPem = readFileSync(keyFile, 'utf8')
  return { caPem: certPem, certPem, keyPem, dir }
}

describe('buildKubeClient - fail-closed gate (guard is in the API client request path)', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach((c) => c()))

  it('API client call to a blocked literal-IP server fails with SSRF guard error', async () => {
    // Stand up a real HTTPS server on loopback. Absent the guard, the dial would
    // succeed (we verify this with a raw https.Agent call first). The guard must
    // refuse it because 127.0.0.1 is a blocked loopback address. If the error
    // message comes from the SSRF guard, that proves the guarded agent is wired
    // into the k8s API client request path - not just constructed but discarded.
    const { keyPem, certPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ kind: 'APIVersions' }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port
    const serverUrl = `https://127.0.0.1:${port}`

    // Sanity: without the guard the server is reachable via a raw Agent with
    // rejectUnauthorized:false, confirming it is the SSRF guard (not TLS mismatch
    // or a down server) causing the rejection below.
    const ungatedAgent = new https.Agent({ rejectUnauthorized: false })
    const { default: nodeFetch } = await import('node-fetch')
    const sanity = await nodeFetch(`${serverUrl}/api`, { agent: ungatedAgent } as any)
    expect(sanity.status).toBe(200)

    // Build the k8s API client. The server is a blocked literal IP (127.0.0.1),
    // so when the API client tries to dial it, the guarded agent must refuse.
    // insecure:true isolates the SSRF check from TLS: if the call fails with the
    // SSRF guard message, it is the guard refusing, not a cert error.
    const result = buildKubeClient({
      clusterId: 'gate-test',
      credentialVersion: 99,
      server: serverUrl,
      cred: { type: 'token', value: 'test-token' },
      insecure: true,
    })
    expect(result.ok).toBe(true)
    expect(result.api).toBeDefined()

    // listNode via makeApiClient(CoreV1Api) triggers an actual HTTP request through
    // the k8s API client. The guarded agent must intercept the dial and throw with
    // the SSRF message. Using makeApiClient proves the factory is the real request path.
    await expect(result.makeApiClient!(CoreV1Api).listNode()).rejects.toThrow(/SSRF guard.*blocked IP 127\.0\.0\.1/)
  })
})
