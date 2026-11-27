/**
 * TDD tests for getResource.ts:
 *   - Unit: unknown kind returns not_found errorCode
 *   - Integration: real HTTPS fixture server -> getResourceDetail
 *     - Pod: full ResourceDetail with sections + redacted YAML
 *     - ConfigMap: data values replaced with [hidden] in YAML
 *     - 404 -> not_found errorCode
 */
import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { getResourceDetail } from './getResource'

// ── helpers ────────────────────────────────────────────────────────────────

function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-getres-integ-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-getres-integ-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  const certPem = readFileSync(certFile, 'utf8')
  const keyPem = readFileSync(keyFile, 'utf8')
  return { caPem: certPem, certPem, keyPem, dir }
}

// Pod fixture with a secret env var (to test YAML redaction)
function podFixture() {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: 'app-pod',
      namespace: 'default',
      uid: 'pod-uid-1',
      creationTimestamp: '2024-06-01T00:00:00Z',
      labels: { app: 'web' },
    },
    spec: {
      nodeName: 'node-1',
      serviceAccountName: 'default',
      containers: [
        {
          name: 'app',
          image: 'nginx:1.25',
          env: [
            { name: 'DB_PASSWORD', value: 'super-secret-db-pass' },
            { name: 'LOG_LEVEL', value: 'info' },
          ],
          resources: {
            requests: { cpu: '100m', memory: '128Mi' },
            limits: { cpu: '500m', memory: '256Mi' },
          },
        },
      ],
      initContainers: [],
      volumes: [],
    },
    status: {
      phase: 'Running',
      podIP: '10.0.0.5',
      hostIP: '10.0.1.1',
      qosClass: 'Burstable',
      containerStatuses: [
        { name: 'app', ready: true, restartCount: 0, state: { running: { startedAt: '2024-06-01T00:00:01Z' } } },
      ],
      conditions: [
        { type: 'Ready', status: 'True', reason: '' },
      ],
    },
  }
}

// ConfigMap fixture with data values that must be hidden in YAML
function configMapFixture() {
  return {
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name: 'app-config',
      namespace: 'default',
      uid: 'cm-uid-1',
      creationTimestamp: '2024-06-01T00:00:00Z',
    },
    data: {
      'database.url': 'postgres://admin:topSecret99@db:5432/app',
      'log.level': 'info',
    },
  }
}

// ── unit tests ─────────────────────────────────────────────────────────────

describe('getResourceDetail - unit', () => {
  it('returns not_found for unknown kind', async () => {
    const input: any = {
      clusterId: 'c1', credentialVersion: 1,
      server: 'https://127.0.0.1:9999',
      cred: { type: 'token', value: 'tok' },
    }
    const r = await getResourceDetail(input, 'event' as any, undefined, 'foo')
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('not_found')
  })
})

// ── integration tests ──────────────────────────────────────────────────────

describe('getResourceDetail - real client integration', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach((c) => c()))

  it('pod: returns full ResourceDetail with sections; YAML redacts env var secrets', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const fixture = podFixture()
    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      // GET /api/v1/namespaces/default/pods/app-pod
      if (req.url && req.url.includes('/namespaces/default/pods/app-pod')) {
        res.writeHead(200)
        res.end(JSON.stringify(fixture))
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ kind: 'Status', code: 404, message: 'not found' }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const result = await getResourceDetail(
      {
        clusterId: 'getres-pod-integ',
        credentialVersion: 1,
        server: `https://127.0.0.1:${port}`,
        cred: { type: 'token', value: 'test-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'pod',
      'default',
      'app-pod',
    )

    expect(result.ok).toBe(true)
    expect(result.value).toBeDefined()

    const detail = result.value!
    expect(detail.ref.kind).toBe('pod')
    expect(detail.ref.name).toBe('app-pod')
    expect(detail.ref.namespace).toBe('default')
    expect(detail.ref.uid).toBe('pod-uid-1')

    // sections built by detailPod
    expect(detail.sections).toBeDefined()
    const infoSec = detail.sections!.find(s => s.title === 'info')
    expect(infoSec).toBeDefined()
    expect(infoSec!.rows!.find(r => r.label === 'QoS Class')!.value).toBe('Burstable')

    // containers populated
    expect(detail.containers).toBeDefined()
    expect(detail.containers![0].name).toBe('app')
    expect(detail.containers![0].ready).toBe(true)

    // YAML is non-empty
    expect(detail.yaml.length).toBeGreaterThan(50)

    // KEY ASSERTION: secret env var value must not appear in yaml
    expect(detail.yaml).not.toContain('super-secret-db-pass')
    // redacted marker should be present
    expect(detail.yaml).toContain('[redacted]')
  })

  it('configmap: YAML data values replaced with [hidden]; real data absent', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const fixture = configMapFixture()
    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url && req.url.includes('/namespaces/default/configmaps/app-config')) {
        res.writeHead(200)
        res.end(JSON.stringify(fixture))
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ kind: 'Status', code: 404, message: 'not found' }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const result = await getResourceDetail(
      {
        clusterId: 'getres-cm-integ',
        credentialVersion: 1,
        server: `https://127.0.0.1:${port}`,
        cred: { type: 'token', value: 'test-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'configmap',
      'default',
      'app-config',
    )

    expect(result.ok).toBe(true)
    const detail = result.value!
    expect(detail.ref.kind).toBe('configmap')
    expect(detail.yaml.length).toBeGreaterThan(10)
    // Secret data value must not be in YAML
    expect(detail.yaml).not.toContain('topSecret99')
    expect(detail.yaml).not.toContain('postgres://admin')
    // [hidden] marker present
    expect(detail.yaml).toContain('[hidden]')
    // dataKeys section from detailConfigMap
    expect(detail.sections).toBeDefined()
    const dataKeys = detail.sections!.find(s => s.title === 'dataKeys')
    expect(dataKeys).toBeDefined()
  })

  it('returns not_found errorCode on 404', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(404)
      res.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', status: 'Failure', message: 'not found', reason: 'NotFound', code: 404 }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const result = await getResourceDetail(
      {
        clusterId: 'getres-404',
        credentialVersion: 1,
        server: `https://127.0.0.1:${port}`,
        cred: { type: 'token', value: 'bad-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'pod',
      'default',
      'missing-pod',
    )

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('not_found')
  })

  it('returns forbidden errorCode on 403', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(403)
      res.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', status: 'Failure', message: 'forbidden', reason: 'Forbidden', code: 403 }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const result = await getResourceDetail(
      {
        clusterId: 'getres-403',
        credentialVersion: 1,
        server: `https://127.0.0.1:${port}`,
        cred: { type: 'token', value: 'bad-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'node',
      undefined,
      'node-1',
    )

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('forbidden')
  })
})
