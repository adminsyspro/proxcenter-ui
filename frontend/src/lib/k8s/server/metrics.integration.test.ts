/**
 * Integration tests for getNodeMetrics:
 * Real HTTPS fixture server -> real buildKubeClient -> real Metrics class.
 * No module mocks - runs against actual @kubernetes/client-node.
 */
import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { getNodeMetrics } from './metrics'

function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-metrics-integ-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-metrics-integ-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  return {
    caPem: readFileSync(certFile, 'utf8'),
    certPem: readFileSync(certFile, 'utf8'),
    keyPem: readFileSync(keyFile, 'utf8'),
    dir,
  }
}

describe('getNodeMetrics: real client integration', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach(c => c()))

  it('fetches real NodeMetricsList + NodeList, joins and sorts correctly', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const nodeListWire = {
      apiVersion: 'v1', kind: 'NodeList',
      metadata: { resourceVersion: '1' },
      items: [
        {
          metadata: { name: 'worker-1', uid: 'uid-w1', creationTimestamp: '2024-01-01T00:00:00Z', labels: {} },
          status: { allocatable: { cpu: '4', memory: '8Gi' } },
        },
        {
          metadata: { name: 'worker-2', uid: 'uid-w2', creationTimestamp: '2024-01-01T00:00:00Z', labels: {} },
          status: { allocatable: { cpu: '4', memory: '8Gi' } },
        },
      ],
    }

    const metricsWire = {
      kind: 'NodeMetricsList', apiVersion: 'metrics.k8s.io/v1beta1',
      metadata: { selfLink: '' },
      items: [
        { metadata: { name: 'worker-2', selfLink: '', creationTimestamp: '' }, timestamp: '2024-06-01T09:00:00Z', window: '1m', usage: { cpu: '2000m', memory: '4Gi' } },
        { metadata: { name: 'worker-1', selfLink: '', creationTimestamp: '' }, timestamp: '2024-06-01T10:00:00Z', window: '1m', usage: { cpu: '1000m', memory: '2Gi' } },
      ],
    }

    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url?.startsWith('/api/v1/nodes')) {
        res.writeHead(200)
        res.end(JSON.stringify(nodeListWire))
      } else if (req.url?.startsWith('/apis/metrics.k8s.io/v1beta1/nodes')) {
        res.writeHead(200)
        res.end(JSON.stringify(metricsWire))
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ message: 'not found' }))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const r = await getNodeMetrics({
      clusterId: 'metrics-integ',
      credentialVersion: 99,
      server: `https://127.0.0.1:${port}`,
      cred: { type: 'token', value: 'test-token' },
      caData: caPem,
      skipCache: true,
      allowLoopbackForTest: true,
    } as any)

    expect(r.ok).toBe(true)
    expect(r.value?.totalNodes).toBe(2)
    expect(r.value?.reportingNodes).toBe(2)
    // sorted by name: worker-1 before worker-2
    expect(r.value?.nodes.map(n => n.name)).toEqual(['worker-1', 'worker-2'])
    expect(r.value?.nodes[0].cpuUsedMilli).toBe(1000)
    expect(r.value?.nodes[0].cpuAllocMilli).toBe(4000)
    expect(r.value?.nodes[0].memUsedBytes).toBe(2 * 1024 ** 3)
    expect(r.value?.nodes[0].memAllocBytes).toBe(8 * 1024 ** 3)
    expect(r.value?.nodes[1].cpuUsedMilli).toBe(2000)
    // oldest timestamp = worker-2 at 09:00
    expect(r.value?.sampleTime).toBe('2024-06-01T09:00:00Z')
  })

  it('returns metrics_unavailable when metrics endpoint returns 404', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url?.startsWith('/api/v1/nodes')) {
        res.writeHead(200)
        res.end(JSON.stringify({ apiVersion: 'v1', kind: 'NodeList', metadata: {}, items: [] }))
      } else {
        // metrics-server not installed -> 404
        res.writeHead(404)
        res.end(JSON.stringify({
          kind: 'Status', apiVersion: 'v1',
          status: 'Failure', message: 'not found', reason: 'NotFound', code: 404,
        }))
      }
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const r = await getNodeMetrics({
      clusterId: 'metrics-404',
      credentialVersion: 98,
      server: `https://127.0.0.1:${port}`,
      cred: { type: 'token', value: 'test-token' },
      caData: caPem,
      skipCache: true,
      allowLoopbackForTest: true,
    } as any)

    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('metrics_unavailable')
  })
})
