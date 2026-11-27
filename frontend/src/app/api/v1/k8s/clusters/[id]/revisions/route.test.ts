import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const gateMock = vi.fn()
const revisionsMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: (...a: any[]) => gateMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ listDeploymentRevisions: (...a: any[]) => revisionsMock(...a) }))

const params = { id: 'c1' }
beforeEach(() => {
  gateMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1', cluster: { credentialVersion: 2 }, credential: {} })
  revisionsMock.mockReset().mockResolvedValue({ ok: true, value: { revisions: [{ revision: 2 }] } })
})

describe('GET revisions', () => {
  it('returns the gate response when the caller cannot view the cluster', async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const res = await callRoute((await import('./route')).GET, { params, searchParams: { namespace: 'shop', name: 'web' } })
    expect(res.status).toBe(403)
    expect(revisionsMock).not.toHaveBeenCalled()
  })
  it('400 without a valid namespace and name', async () => {
    const res = await callRoute((await import('./route')).GET, { params, searchParams: { namespace: 'shop' } })
    expect(res.status).toBe(400)
  })
  it('lists the revisions of the Deployment', async () => {
    const res = await callRoute((await import('./route')).GET, { params, searchParams: { namespace: 'shop', name: 'web' } })
    expect(await readJson(res)).toEqual({ revisions: [{ revision: 2 }] })
    expect(revisionsMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', credentialVersion: 2, namespace: 'shop', name: 'web' }))
  })
  it('maps a missing Deployment to 404', async () => {
    revisionsMock.mockResolvedValue({ ok: false, error: 'not_found' })
    const res = await callRoute((await import('./route')).GET, { params, searchParams: { namespace: 'shop', name: 'web' } })
    expect(res.status).toBe(404)
  })
})
