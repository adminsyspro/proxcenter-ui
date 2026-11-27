/**
 * TDD tests for logs.ts:
 *   - Unit: default-first-container selection, tail/byte caps, previous flag.
 *   - Integration: real HTTPS fixture server -> buildKubeClient -> getPodLogs.
 */
import { describe, it, expect, afterAll } from 'vitest'
import * as https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { getPodLogs, buildLogParams, type LogFetcher } from './logs'

// ── constants (must match logs.ts) ────────────────────────────────────────

const DEFAULT_TAIL = 200
const MAX_TAIL = 5000
const LOG_BYTE_CAP = 1 << 20 // 1 MiB

// ── buildLogParams unit tests ──────────────────────────────────────────────

describe('buildLogParams', () => {
  it('defaults tailLines to 200 when not set', () => {
    const p = buildLogParams('mycontainer', {})
    expect(p.tailLines).toBe(DEFAULT_TAIL)
  })

  it('defaults tailLines to 200 when 0', () => {
    const p = buildLogParams('c1', { tailLines: 0 })
    expect(p.tailLines).toBe(DEFAULT_TAIL)
  })

  it('clamps tailLines at 5000', () => {
    const p = buildLogParams('c1', { tailLines: 99999 })
    expect(p.tailLines).toBe(MAX_TAIL)
  })

  it('passes through tail within range', () => {
    const p = buildLogParams('c1', { tailLines: 500 })
    expect(p.tailLines).toBe(500)
  })

  it('sets limitBytes to LOG_BYTE_CAP always', () => {
    const p = buildLogParams('c1', {})
    expect(p.limitBytes).toBe(LOG_BYTE_CAP)
  })

  it('sets previous flag correctly', () => {
    expect(buildLogParams('c1', { previous: true }).previous).toBe(true)
    expect(buildLogParams('c1', { previous: false }).previous).toBe(false)
    expect(buildLogParams('c1', {}).previous).toBe(false)
  })

  it('passes container name through', () => {
    const p = buildLogParams('special-sidecar', {})
    expect(p.container).toBe('special-sidecar')
  })
})

// ── getPodLogs unit tests with mock LogFetcher ─────────────────────────────

describe('getPodLogs with mock LogFetcher', () => {
  const makeInput = () => ({
    clusterId: 'c1',
    credentialVersion: 1,
    server: 'https://unused',
    cred: { type: 'token' as const, value: 'tok' },
  })

  it('uses default-first container when container not specified', async () => {
    let capturedContainer: string | undefined
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'first-container',
      fetchLogs: async (ns, pod, params) => {
        capturedContainer = params.container
        return 'log output'
      },
    }
    const result = await getPodLogs(makeInput() as any, 'default', 'mypod', {}, mockFetcher)
    expect(result.ok).toBe(true)
    expect(capturedContainer).toBe('first-container')
    expect(result.value?.logs).toBe('log output')
  })

  it('uses supplied container name without fetching pod spec', async () => {
    let specFetched = false
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => {
        specFetched = true
        return 'should-not-be-called'
      },
      fetchLogs: async (_ns, _pod, params) => {
        return `logs for ${params.container}`
      },
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', { container: 'explicit-container' }, mockFetcher)
    expect(result.ok).toBe(true)
    expect(specFetched).toBe(false)
    expect(result.value?.logs).toBe('logs for explicit-container')
  })

  it('passes previous=true to fetchLogs', async () => {
    let capturedPrevious = false
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'c1',
      fetchLogs: async (_ns, _pod, params) => {
        capturedPrevious = params.previous
        return ''
      },
    }
    await getPodLogs(makeInput() as any, 'ns', 'pod', { previous: true }, mockFetcher)
    expect(capturedPrevious).toBe(true)
  })

  it('truncates logs exceeding LOG_BYTE_CAP', async () => {
    const bigLog = 'a'.repeat(LOG_BYTE_CAP + 100)
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'c1',
      fetchLogs: async () => bigLog,
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', {}, mockFetcher)
    expect(result.ok).toBe(true)
    expect(result.value!.logs.length).toBeLessThanOrEqual(LOG_BYTE_CAP)
  })

  it('sets truncated=true when raw log exceeds LOG_BYTE_CAP', async () => {
    const bigLog = 'x'.repeat(LOG_BYTE_CAP + 1)
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'ctr',
      fetchLogs: async () => bigLog,
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', { container: 'ctr' }, mockFetcher)
    expect(result.ok).toBe(true)
    expect(result.value!.truncated).toBe(true)
  })

  it('sets truncated=false for a small log', async () => {
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'ctr',
      fetchLogs: async () => 'small log',
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', { container: 'ctr' }, mockFetcher)
    expect(result.ok).toBe(true)
    expect(result.value!.truncated).toBe(false)
  })

  it('returns resolved first-container name when container is omitted', async () => {
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'resolved-first',
      fetchLogs: async () => 'log data',
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', {}, mockFetcher)
    expect(result.ok).toBe(true)
    expect(result.value!.container).toBe('resolved-first')
  })

  it('returns supplied container name in result', async () => {
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'should-not-be-returned',
      fetchLogs: async () => 'log data',
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', { container: 'explicit' }, mockFetcher)
    expect(result.ok).toBe(true)
    expect(result.value!.container).toBe('explicit')
  })

  it('returns errorCode on getFirstContainerName failure', async () => {
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => {
        const err: any = new Error('not found')
        err.code = 404
        throw err
      },
      fetchLogs: async () => '',
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', {}, mockFetcher)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('not_found')
  })

  it('returns errorCode on fetchLogs failure', async () => {
    const mockFetcher: LogFetcher = {
      getFirstContainerName: async () => 'c1',
      fetchLogs: async () => {
        const err: any = new Error('forbidden')
        err.code = 403
        throw err
      },
    }
    const result = await getPodLogs(makeInput() as any, 'ns', 'pod', { container: 'c1' }, mockFetcher)
    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('forbidden')
  })
})

// ── real-client integration test ──────────────────────────────────────────

function makeSelfSignedPem(): { caPem: string; certPem: string; keyPem: string; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'k8s-logs-integ-'))
  const keyFile = path.join(dir, 'tls.key')
  const certFile = path.join(dir, 'tls.crt')
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2',
    '-subj', '/CN=k8s-logs-integ-test',
    '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' })
  const certPem = readFileSync(certFile, 'utf8')
  const keyPem = readFileSync(keyFile, 'utf8')
  return { caPem: certPem, certPem, keyPem, dir }
}

describe('getPodLogs - real client integration', () => {
  const cleanups: Array<() => void> = []
  afterAll(() => cleanups.forEach((c) => c()))

  it('reads log body from real HTTPS fixture via buildKubeClient->makeApiClient', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const podFixture = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'my-pod', namespace: 'default', uid: 'uid-1' },
      spec: {
        containers: [{ name: 'app', image: 'nginx' }, { name: 'sidecar', image: 'envoy' }],
      },
      status: { phase: 'Running' },
    }
    const logBody = 'line 1\nline 2\nline 3\n'

    const server = https.createServer({ key: keyPem, cert: certPem }, (req, res) => {
      res.setHeader('Content-Type', 'application/json')
      if (req.url && req.url.startsWith('/api/v1/namespaces/default/pods/my-pod/log')) {
        // Log endpoint returns plain text
        res.setHeader('Content-Type', 'text/plain')
        res.writeHead(200)
        res.end(logBody)
      } else if (req.url && req.url.startsWith('/api/v1/namespaces/default/pods/my-pod')) {
        // Pod GET for default container detection
        res.writeHead(200)
        res.end(JSON.stringify(podFixture))
      } else {
        res.writeHead(404)
        res.end(JSON.stringify({ message: 'not found' }))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port
    const serverUrl = `https://127.0.0.1:${port}`

    // No container specified: should fetch pod spec, pick 'app', then fetch logs
    const result = await getPodLogs(
      {
        clusterId: 'logs-integ',
        credentialVersion: 1,
        server: serverUrl,
        cred: { type: 'token', value: 'test-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'default',
      'my-pod',
      {},
    )

    expect(result.ok).toBe(true)
    expect(result.value?.logs).toBe(logBody)
  })

  it('returns errorCode on 403 from log endpoint', async () => {
    const { caPem, certPem, keyPem, dir } = makeSelfSignedPem()
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    const server = https.createServer({ key: keyPem, cert: certPem }, (_req, res) => {
      res.setHeader('Content-Type', 'application/json')
      res.writeHead(403)
      res.end(JSON.stringify({ kind: 'Status', status: 'Failure', reason: 'Forbidden', code: 403 }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => server.close())
    const port = (server.address() as any).port

    const result = await getPodLogs(
      {
        clusterId: 'logs-integ-403',
        credentialVersion: 1,
        server: `https://127.0.0.1:${port}`,
        cred: { type: 'token', value: 'bad-token' },
        caData: caPem,
        skipCache: true,
        allowLoopbackForTest: true,
      } as any,
      'default',
      'mypod',
      { container: 'app' },
    )

    expect(result.ok).toBe(false)
    expect(result.errorCode).toBe('forbidden')
  })
})
