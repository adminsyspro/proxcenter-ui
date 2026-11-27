/**
 * Happy-path integration test: proves that getClusterHealth drives the REAL
 * @kubernetes/client-node shapes end to end (no .body wrapper, VersionApi for
 * version, CoreV1Api for nodes). Stands up a local HTTPS fixture server so the
 * real client code (including the guarded transport) handles a real TLS dial.
 *
 * Uses the same allowLoopbackForTest escape hatch as transport.integration.test.ts
 * to bypass the SSRF loopback block for test fixtures.
 */
import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { getClusterHealth } from './health'

function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-health-integ-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-health-integ-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  const certPem = readFileSync(certFile, 'utf8')
  const keyPem = readFileSync(keyFile, 'utf8')
  return { caPem: certPem, certPem, keyPem, dir }
}

const VERSION_INFO = {
  major: '1',
  minor: '30',
  gitVersion: 'v1.30.0',
  gitCommit: 'abc123',
  gitTreeState: 'clean',
  buildDate: '2024-01-01T00:00:00Z',
  goVersion: 'go1.21.0',
  compiler: 'gc',
  platform: 'linux/amd64',
}

const NODE_LIST = {
  apiVersion: 'v1',
  kind: 'NodeList',
  metadata: { resourceVersion: '1' },
  items: [
    {
      metadata: { name: 'node-1' },
      status: {
        conditions: [
          { type: 'Ready', status: 'True', lastTransitionTime: '2024-01-01T00:00:00Z', message: '', reason: 'KubeletReady' },
        ],
      },
    },
    {
      metadata: { name: 'node-2' },
      status: {
        conditions: [
          { type: 'Ready', status: 'False', lastTransitionTime: '2024-01-01T00:00:00Z', message: 'kubelet not ready', reason: 'KubeletNotReady' },
        ],
      },
    },
  ],
}

describe('getClusterHealth - real client integration', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach((c) => c()))

  it('asserts state:degraded, version:v1.30.0, nodesTotal:2, nodesReady:1 against a fixture server', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/version') {
        res.writeHead(200)
        res.end(JSON.stringify(VERSION_INFO))
      } else if (req.url === '/api/v1/nodes') {
        res.writeHead(200)
        res.end(JSON.stringify(NODE_LIST))
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ message: 'not found' }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port
    const serverUrl = `https://127.0.0.1:${port}`

    // allowLoopbackForTest flows through GetClusterHealthInput -> BuildKubeClientInput ->
    // transportOpts spread in client.ts -> buildGuardedTransport, bypassing the SSRF
    // loopback block for this test fixture. Cast as any: the field is intentionally
    // absent from the production type.
    const health = await getClusterHealth({
      clusterId: 'health-integ',
      credentialVersion: 1,
      server: serverUrl,
      cred: { type: 'token', value: 'test-token' },
      caData: caPem,
      skipCache: true,
      allowLoopbackForTest: true,
    } as any)

    expect(health.ok).toBe(true)
    expect(health.value?.version).toBe('v1.30.0')
    expect(health.value?.nodesTotal).toBe(2)
    expect(health.value?.nodesReady).toBe(1)
    // 1 of 2 nodes ready -> degraded
    expect(health.value?.state).toBe('degraded')
  })
})
