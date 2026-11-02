import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { $queryRaw: vi.fn<(...a: any[]) => Promise<any>>() } }))

import { prisma } from '@/lib/db/prisma'

import {
  classifyExporterError,
  clearNodeIpCache,
  ExporterError,
  fetchExporterMetrics,
  getExporterPort,
  getNodeIps,
  isScrapableIp,
  nodeIpsFromClusterStatus,
  parseAllOsdCounters,
  parseOsdCounters,
} from './exporter'

const FIXTURE = readFileSync(join(__dirname, '__fixtures__/exporter-metrics.txt'), 'utf8')
const queryRaw = (prisma as any).$queryRaw

describe('parseOsdCounters', () => {
  it('reads the four counters of an OSD and ignores other metrics', () => {
    expect(parseOsdCounters(FIXTURE, 0)).toEqual({ op_r: 2135449, op_w: 301519, op_r_out_bytes: 6270944348, op_w_in_bytes: 11259148746 })
  })

  it('is null when the OSD is absent or lacks a counter (osd.3 has no op_w)', () => {
    expect(parseOsdCounters(FIXTURE, 3)).toBeNull()
    expect(parseOsdCounters(FIXTURE, 9)).toBeNull()
    expect(parseOsdCounters('', 0)).toBeNull()
  })

  it('does not take osd.10 for osd.1', () => {
    expect(parseOsdCounters('ceph_osd_op_r{ceph_daemon="osd.10"} 1\n', 1)).toBeNull()
  })

  it('lists every complete OSD', () => {
    expect([...parseAllOsdCounters(FIXTURE).keys()]).toEqual([0])
  })

  it('ignores a non numeric value', () => {
    expect(parseAllOsdCounters('ceph_osd_op_r{ceph_daemon="osd.0"} NaNx\n').size).toBe(0)
  })
})

describe('node addresses', () => {
  beforeEach(() => clearNodeIpCache())

  it('keeps only node entries with a usable address', () => {
    const ips = nodeIpsFromClusterStatus([
      { type: 'cluster', name: 'c' },
      { type: 'node', name: 'pve1', ip: '10.0.0.1' },
      { type: 'node', name: 'pve2', ip: '127.0.0.1' },
      { type: 'node', name: 'pve3', ip: 'evil.example.com' },
      { type: 'node', name: 'pve4' },
    ])
    expect([...ips]).toEqual([['pve1', '10.0.0.1']])
    expect(nodeIpsFromClusterStatus(null).size).toBe(0)
  })

  it('refuses unspecified, loopback, link-local and multicast', () => {
    for (const bad of ['0.0.0.0', '127.0.0.1', '169.254.1.1', '224.0.0.1', '::', '::1', 'fe80::1', 'name', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.1.1', '::ffff:a9fe:101', '::ffff:0.0.0.0', '0:0:0:0:0:ffff:127.0.0.1']) expect(isScrapableIp(bad), bad).toBe(false)
    for (const ok of ['10.0.0.1', '192.168.1.5', 'fd00::5', '::ffff:10.0.0.1', '::ffff:a00:1']) expect(isScrapableIp(ok), ok).toBe(true)
  })

  it('asks PVE once per 5 minutes', async () => {
    const load = vi.fn<() => Promise<unknown>>().mockResolvedValue([{ type: 'node', name: 'pve1', ip: '10.0.0.1' }])
    await getNodeIps('c1', load, 1000)
    await getNodeIps('c1', load, 1000 + 299_000)
    expect(load).toHaveBeenCalledTimes(1)
    await getNodeIps('c1', load, 1000 + 301_000)
    expect(load).toHaveBeenCalledTimes(2)
    await getNodeIps('c2', load, 1000)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('shares ONE load between concurrent readers on a cold cache', async () => {
    let release!: (v: unknown) => void
    const load = vi.fn<() => Promise<unknown>>().mockImplementation(() => new Promise(r => { release = r }))
    const readers = [getNodeIps('c1', load), getNodeIps('c1', load), getNodeIps('c1', load)]
    release([{ type: 'node', name: 'pve1', ip: '10.0.0.1' }])
    const results = await Promise.all(readers)
    expect(load).toHaveBeenCalledTimes(1)
    expect(results.every(m => m.get('pve1') === '10.0.0.1')).toBe(true)
  })

  it('a failed load is not remembered: the next reader loads again', async () => {
    const load = vi.fn<() => Promise<unknown>>().mockRejectedValueOnce(new Error('pve down')).mockResolvedValue([{ type: 'node', name: 'pve1', ip: '10.0.0.1' }])
    await expect(getNodeIps('c1', load)).rejects.toThrow('pve down')
    expect((await getNodeIps('c1', load)).get('pve1')).toBe('10.0.0.1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clearNodeIpCache(id) forgets that connection only', async () => {
    const load = vi.fn<() => Promise<unknown>>().mockResolvedValue([])
    await getNodeIps('c1', load)
    await getNodeIps('c2', load)
    clearNodeIpCache('c1')
    await getNodeIps('c1', load)
    await getNodeIps('c2', load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('a read purged while in flight neither fills the cache nor drops the newer read', async () => {
    let releaseOld: (v: unknown) => void = () => {}
    const oldLoad = vi.fn<() => Promise<unknown>>(() => new Promise(resolve => { releaseOld = resolve }))
    const oldRead = getNodeIps('c1', oldLoad)

    clearNodeIpCache('c1')

    let releaseNew: (v: unknown) => void = () => {}
    const newLoad = vi.fn<() => Promise<unknown>>(() => new Promise(resolve => { releaseNew = resolve }))
    const newRead = getNodeIps('c1', newLoad)

    releaseOld([{ type: 'node', name: 'pve1', ip: '10.0.0.1' }])
    await oldRead

    // The newer read is still the one shared in flight.
    const sharedLoad = vi.fn<() => Promise<unknown>>().mockResolvedValue([])
    const joined = getNodeIps('c1', sharedLoad)

    releaseNew([{ type: 'node', name: 'pve1', ip: '10.0.0.2' }])
    expect((await newRead).get('pve1')).toBe('10.0.0.2')
    expect((await joined).get('pve1')).toBe('10.0.0.2')
    expect(sharedLoad).not.toHaveBeenCalled()

    const cached = await getNodeIps('c1', sharedLoad)
    expect(cached.get('pve1')).toBe('10.0.0.2')
    expect(sharedLoad).not.toHaveBeenCalled()
  })

  it('a load that throws synchronously is not cached', async () => {
    const boom = vi.fn<() => Promise<unknown>>(() => { throw new Error('x') })
    await expect(getNodeIps('c1', boom)).rejects.toThrow()
    const load = vi.fn<() => Promise<unknown>>().mockResolvedValue([])
    await getNodeIps('c1', load)
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('getExporterPort', () => {
  it('reads the connection column', async () => {
    queryRaw.mockResolvedValueOnce([{ port: 9100 }])
    expect(await getExporterPort('c1')).toBe(9100)
  })

  it('falls back to 9926 when the column is missing or invalid', async () => {
    queryRaw.mockRejectedValueOnce(new Error('column "cephExporterPort" does not exist'))
    expect(await getExporterPort('c1')).toBe(9926)
    queryRaw.mockResolvedValueOnce([{ port: 70000 }])
    expect(await getExporterPort('c1')).toBe(9926)
    queryRaw.mockResolvedValueOnce([])
    expect(await getExporterPort('c1')).toBe(9926)
  })
})

describe('fetchExporterMetrics', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs /metrics on the given address, without following redirects', async () => {
    const fetchMock = vi.fn<(...a: any[]) => Promise<Response>>().mockImplementation(async () => new Response('ok 1\n'))
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchExporterMetrics('10.0.0.1', 9926)).toBe('ok 1\n')
    expect(fetchMock.mock.calls[0][0]).toBe('http://10.0.0.1:9926/metrics')
    expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    await fetchExporterMetrics('fd00::5', 9926)
    expect(fetchMock.mock.calls[1][0]).toBe('http://[fd00::5]:9926/metrics')
  })

  it('throws on a non 200 answer', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response('no', { status: 302 })))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toThrow()
  })

  it('throws a typed error: invalid for a non 200 answer and an oversized body', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response('no', { status: 500 })))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toMatchObject({ failure: 'invalid' })
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response('x'.repeat(5 * 1024 * 1024 + 1))))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toMatchObject({ failure: 'invalid' })
  })

  it('throws refused for a refused connection and timeout for a timed out one, without the raw message', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockRejectedValue(new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:9926'), { code: 'ECONNREFUSED' }) })))
    const refused = await fetchExporterMetrics('10.0.0.1', 9926).catch(e => e)
    expect(refused).toBeInstanceOf(ExporterError)
    expect(refused.failure).toBe('refused')
    expect(refused.message).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/)
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toMatchObject({ failure: 'timeout' })
  })

  it('a connection reset while the body is read is invalid (the node did answer), a timeout there stays a timeout', async () => {
    const stream = (err: unknown) => new ReadableStream({ pull(c) { c.error(err) } })
    const reset = new TypeError('terminated', { cause: { code: 'ECONNRESET' } })
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response(stream(reset))))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toMatchObject({ failure: 'invalid' })
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response(stream(new DOMException('timeout', 'TimeoutError')))))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toMatchObject({ failure: 'timeout' })
  })

  it('throws when the body passes 5 MB, declared or not', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response('x', { headers: { 'content-length': String(6 * 1024 * 1024) } })))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toThrow(/too large/)
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockResolvedValue(new Response('x'.repeat(5 * 1024 * 1024 + 1))))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toThrow(/too large/)
  })

  it('passes a network error up', async () => {
    vi.stubGlobal('fetch', vi.fn<(...a: any[]) => Promise<Response>>().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(fetchExporterMetrics('10.0.0.1', 9926)).rejects.toThrow()
  })
})

describe('classifyExporterError', () => {
  const undici = (code: string) => new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code}`), { code }) })

  it('refused: nothing listens (ECONNREFUSED) or the peer reset before any answer (ECONNRESET)', () => {
    expect(classifyExporterError(new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } }))).toBe('refused')
    expect(classifyExporterError(undici('ECONNREFUSED'))).toBe('refused')
    expect(classifyExporterError(undici('ECONNRESET'))).toBe('refused')
  })

  it('timeout: AbortSignal.timeout, an abort, or an unreachable network', () => {
    expect(classifyExporterError(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe('timeout')
    expect(classifyExporterError(new DOMException('This operation was aborted', 'AbortError'))).toBe('timeout')
    for (const code of ['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']) expect(classifyExporterError(undici(code)), code).toBe('timeout')
  })

  it('reads the codes of an AggregateError cause (dual stack attempts)', () => {
    const aggregate = Object.assign(new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }], 'x'), { code: undefined })
    expect(classifyExporterError(new TypeError('fetch failed', { cause: aggregate }))).toBe('refused')
    const mixed = new AggregateError([{ code: 'ETIMEDOUT' }, { code: 'ECONNREFUSED' }], 'x')
    expect(classifyExporterError(new TypeError('fetch failed', { cause: mixed }))).toBe('refused')
    const mixedReversed = new AggregateError([{ code: 'ECONNREFUSED' }, { code: 'ETIMEDOUT' }], 'x')
    expect(classifyExporterError(new TypeError('fetch failed', { cause: mixedReversed }))).toBe('refused')
    const timedOut = new AggregateError([{ code: 'ETIMEDOUT' }], 'x')
    expect(classifyExporterError(new TypeError('fetch failed', { cause: timedOut }))).toBe('timeout')
  })

  it('invalid: any other failure, a non error and an unknown code', () => {
    expect(classifyExporterError(new Error('exporter answered 500'))).toBe('invalid')
    expect(classifyExporterError(undici('ECONNABORTED'))).toBe('invalid')
    expect(classifyExporterError(new Error('connect ECONNREFUSED 10.0.0.1:9926'))).toBe('invalid')
    expect(classifyExporterError(null)).toBe('invalid')
    expect(classifyExporterError('boom')).toBe('invalid')
    expect(classifyExporterError(undefined)).toBe('invalid')
  })

  it('keeps the reason of an error it already typed', () => {
    expect(classifyExporterError(new ExporterError('timeout', 'x'))).toBe('timeout')
    expect(classifyExporterError(new ExporterError('invalid', 'x'))).toBe('invalid')
  })
})

describe('fetchExporterMetrics against a real local socket', () => {
  it('a closed port is refused (real undici error: TypeError with cause.code ECONNREFUSED)', async () => {
    const server = createServer()

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    await new Promise<void>(resolve => server.close(() => resolve()))
    const error = await fetchExporterMetrics('127.0.0.1', port).catch(e => e)

    expect(error).toBeInstanceOf(ExporterError)
    expect(error.failure).toBe('refused')
    expect(error.message).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/)
  })

  it('a server that answers 404 is invalid', async () => {
    const server = createServer((_req, res) => {
      res.statusCode = 404
      res.end('nope')
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    try {
      await expect(fetchExporterMetrics('127.0.0.1', port)).rejects.toMatchObject({ failure: 'invalid' })
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
