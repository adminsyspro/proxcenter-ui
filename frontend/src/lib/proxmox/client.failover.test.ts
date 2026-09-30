import { createServer, type Server, type ServerResponse, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pveFetch } from './client'
import { setNodeIps, incrementFailures } from '../cache/nodeIpCache'

vi.mock('../connections/getConnection', () => ({ invalidateConnectionCache: vi.fn() }))

const servers: Server[] = []
async function listen(host: string, handler: RequestListener, port = 0) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(port, host, resolve))
  return (server.address() as AddressInfo).port
}
function answer(res: ServerResponse, data = { ticket: 'test-ticket', port: 5900 }) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data }))
}
let sequence = 0
function connection(port: number) {
  const conn = { id: `failover-test-${++sequence}`, baseUrl: `http://127.0.0.2:${port}`, apiToken: 'test-token' }
  setNodeIps(conn.id, ['127.0.0.2', '127.0.0.1'], port, 'http')
  incrementFailures(conn.id)
  return conn
}
function expire(connId: string) {
  ;(globalThis as any).__proxcenter_failover_url_cache__.get(connId).cachedAt = Date.now() - 61_000
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

describe('effective response endpoint', () => {
  it('reports the endpoint that returned the ticket without mutating the configured URL', async () => {
    const port = await listen('127.0.0.1', (_req, res) => answer(res))
    const conn = connection(port)
    await pveFetch(conn, '/version')
    let endpoint: string | undefined
    const result = await pveFetch(conn, '/nodes/pve2/qemu/100/vncproxy', { method: 'POST' }, {
      onResponse: url => { endpoint = url },
    })
    expect(result).toEqual({ ticket: 'test-ticket', port: 5900 })
    expect(endpoint).toBe(`http://127.0.0.1:${port}`)
    expect(conn.baseUrl).toBe(`http://127.0.0.2:${port}`)
  })

  it('reports independent endpoints for concurrent requests', async () => {
    const port = await listen('127.0.0.1', (_req, res) => answer(res))
    const conn = connection(port)
    await pveFetch(conn, '/version')
    const direct = { ...conn, id: undefined, baseUrl: `http://127.0.0.1:${port}` }
    const endpoints: string[] = []
    await Promise.all([conn, direct].map(c => pveFetch(c, '/version', {}, { onResponse: url => endpoints.push(url) })))
    expect(endpoints).toEqual([direct.baseUrl, direct.baseUrl])
  })
})

describe('primary recovery probe', () => {
  it('lets concurrent requests use the fallback while only one request probes the primary', async () => {
    const port = await listen('127.0.0.1', (_req, res) => answer(res))
    const conn = connection(port)
    await pveFetch(conn, '/version')
    let release!: () => void
    let seen!: () => void
    const received = new Promise<void>(resolve => { seen = resolve })
    const primaryHits: string[] = []
    await listen('127.0.0.2', (req, res) => {
      primaryHits.push(`${req.method} ${req.url}`)
      release = () => { res.writeHead(503); res.end('still down') }
      seen()
    }, port)
    expire(conn.id)
    const probing = pveFetch(conn, '/cluster/resources')
    await received
    const results = await Promise.race([
      Promise.all([pveFetch(conn, '/nodes'), pveFetch(conn, '/cluster/resources')]),
      new Promise(resolve => setTimeout(() => resolve('blocked'), 1000)),
    ])
    // Release every outstanding response even on the old broken implementation.
    for (const server of servers) if ((server.address() as AddressInfo)?.address === '127.0.0.2') server.closeAllConnections()
    release()
    await probing
    expect(results).not.toBe('blocked')
    expect(primaryHits).toEqual(['GET /api2/json/version'])
  })

  it('probes with a read and sends a write only once when the primary recovers', async () => {
    const port = await listen('127.0.0.1', (_req, res) => answer(res))
    const conn = connection(port)
    await pveFetch(conn, '/version')
    const primaryHits: string[] = []
    await listen('127.0.0.2', (req, res) => { primaryHits.push(`${req.method} ${req.url}`); answer(res) }, port)
    expire(conn.id)
    let endpoint: string | undefined
    await pveFetch(conn, '/nodes/pve2/termproxy', { method: 'POST' }, { onResponse: url => { endpoint = url } })
    expect(primaryHits).toEqual(['GET /api2/json/version', 'POST /api2/json/nodes/pve2/termproxy'])
    expect(endpoint).toBe(conn.baseUrl)
  })
})

it('keeps serving reads from fallback if the primary fails immediately after its liveness probe', async () => {
  const port = await listen('127.0.0.1', (_req, res) => answer(res))
  const conn = connection(port)
  await pveFetch(conn, '/version')
  await listen('127.0.0.2', (req, res) => {
    if (req.url === '/api2/json/version') answer(res)
    else req.socket.resetAndDestroy()
  }, port)
  expire(conn.id)
  let endpoint: string | undefined
  await expect(pveFetch(conn, '/nodes', {}, { onResponse: url => { endpoint = url } })).resolves.toBeDefined()
  expect(endpoint).toBe(`http://127.0.0.1:${port}`)
  expect((globalThis as any).__proxcenter_failover_url_cache__.get(conn.id).url).toBe(endpoint)
})


it('does not replay a failed write after a successful primary probe', async () => {
  const fallbackHits: string[] = []
  const port = await listen('127.0.0.1', (req, res) => { fallbackHits.push(req.method!); answer(res) })
  const conn = connection(port)
  await pveFetch(conn, '/version')
  fallbackHits.length = 0
  const primaryHits: string[] = []
  await listen('127.0.0.2', (req, res) => {
    primaryHits.push(`${req.method} ${req.url}`)
    if (req.url === '/api2/json/version') answer(res)
    else req.socket.resetAndDestroy()
  }, port)
  expire(conn.id)
  await expect(pveFetch(conn, '/nodes/pve2/termproxy', { method: 'POST' })).rejects.toThrow()
  expect(primaryHits).toEqual(['GET /api2/json/version', 'POST /api2/json/nodes/pve2/termproxy'])
  expect(fallbackHits).toEqual([])
  expect((globalThis as any).__proxcenter_failover_url_cache__.get(conn.id).url).toBe(`http://127.0.0.1:${port}`)
})

it('uses the replacement fallback when the cache changes during the primary probe', async () => {
  let oldHits = 0
  const port = await listen('127.0.0.1', (_req, res) => { oldHits++; answer(res) })
  const conn = connection(port)
  await pveFetch(conn, '/version')
  oldHits = 0
  const replacementPort = await listen('127.0.0.1', (_req, res) => answer(res))
  const replacement = { url: `http://127.0.0.1:${replacementPort}`, cachedAt: Date.now() }
  await listen('127.0.0.2', (_req, res) => {
    ;(globalThis as any).__proxcenter_failover_url_cache__.set(conn.id, replacement)
    res.writeHead(503); res.end('down')
  }, port)
  expire(conn.id)
  let endpoint: string | undefined
  await pveFetch(conn, '/nodes', {}, { onResponse: url => { endpoint = url } })
  expect(endpoint).toBe(replacement.url)
  expect(oldHits).toBe(0)
  expect((globalThis as any).__proxcenter_failover_url_cache__.get(conn.id)).toBe(replacement)
})

it('preserves and uses a newer fallback when an in-flight request to the old one fails', async () => {
  let fail = false
  let conn: ReturnType<typeof connection>
  const replacementPort = await listen('127.0.0.1', (_req, res) => answer(res))
  const replacement = { url: `http://127.0.0.1:${replacementPort}`, cachedAt: Date.now() }
  const port = await listen('127.0.0.1', (req, res) => {
    if (!fail) return answer(res)
    ;(globalThis as any).__proxcenter_failover_url_cache__.set(conn.id, replacement)
    req.socket.resetAndDestroy()
  })
  conn = connection(port)
  await pveFetch(conn, '/version')
  fail = true
  let endpoint: string | undefined
  await expect(pveFetch(conn, '/nodes', {}, { onResponse: url => { endpoint = url } })).resolves.toBeDefined()
  expect(endpoint).toBe(replacement.url)
  expect((globalThis as any).__proxcenter_failover_url_cache__.get(conn.id)).toBe(replacement)
})
