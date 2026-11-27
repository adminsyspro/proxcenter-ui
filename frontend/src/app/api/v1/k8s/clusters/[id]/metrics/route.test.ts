import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: vi.fn() }))
vi.mock('@/lib/k8s/orchestrator', () => ({ fetchNodeMetrics: vi.fn() }))

import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { fetchNodeMetrics } from '@/lib/k8s/orchestrator'
import { GET } from './route'

function ctx(id: string) { return { params: Promise.resolve({ id }) } }

describe('GET /api/v1/k8s/clusters/[id]/metrics', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the gate response through when the gate fails', async () => {
    ;(requireK8sViewCluster as any).mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const res = await GET(new Request('http://t/'), ctx('c1'))
    expect(res.status).toBe(403)
    expect(fetchNodeMetrics).not.toHaveBeenCalled()
  })

  it('returns 502 when the orchestrator call fails', async () => {
    ;(requireK8sViewCluster as any).mockResolvedValue({ ok: true, tenantId: 't', cluster: { credentialVersion: 1 }, credential: {} })
    ;(fetchNodeMetrics as any).mockResolvedValue({ ok: false, error: 'boom' })
    const res = await GET(new Request('http://t/'), ctx('c1'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'orchestrator unreachable' })
  })

  it('passes the envelope through with 200 on success', async () => {
    ;(requireK8sViewCluster as any).mockResolvedValue({ ok: true, tenantId: 't', cluster: { credentialVersion: 2 }, credential: {} })
    const value = { nodes: [], totalNodes: 1, reportingNodes: 0 }
    ;(fetchNodeMetrics as any).mockResolvedValue({ ok: true, value })
    const res = await GET(new Request('http://t/'), ctx('c1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(value)
    expect(fetchNodeMetrics).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', credentialVersion: 2 }))
  })
})
