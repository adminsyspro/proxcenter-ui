import { describe, it, expect, vi, afterEach } from 'vitest'
import { postNodeOp } from './nodeOpsClient'

afterEach(() => { vi.unstubAllGlobals() })

describe('postNodeOp', () => {
  it('POSTs JSON to the op route and returns the parsed body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ unschedulable: true }) })
    vi.stubGlobal('fetch', fetchMock)
    const data = await postNodeOp('c1', 'node-1', 'cordon', { unschedulable: true })
    expect(data).toEqual({ unschedulable: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/k8s/clusters/c1/nodes/node-1/cordon')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ unschedulable: true })
  })

  it('URL-encodes the node name in the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await postNodeOp('c1', 'weird/name', 'drain', { dryRun: true })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/k8s/clusters/c1/nodes/weird%2Fname/drain')
  })

  it('throws the server error message on !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: 'boom' }) }))
    await expect(postNodeOp('c1', 'n', 'cordon', {})).rejects.toThrow('boom')
  })

  it('falls back to HTTP <status> when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('not json') } }))
    await expect(postNodeOp('c1', 'n', 'drain', {})).rejects.toThrow('HTTP 500')
  })
})
