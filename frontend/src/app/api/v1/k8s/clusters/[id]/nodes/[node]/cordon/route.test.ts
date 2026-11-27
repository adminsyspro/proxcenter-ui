import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const cordonNodeMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ getClusterWithCredential: (...a: any[]) => getWithCredMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ cordonNode: (...a: any[]) => cordonNodeMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const cred = { apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false, credentialType: 'token', credential: 't', contextName: 'ctx' }
beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue({ row: { id: 'c1', name: 'dev', credentialVersion: 1 }, credential: cred })
  cordonNodeMock.mockReset().mockResolvedValue({ ok: true, value: { unschedulable: true } })
  auditMock.mockReset().mockResolvedValue('a1')
})
const params = { id: 'c1', node: 'node-1' }

describe('POST cordon', () => {
  it('403 when the gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { unschedulable: true } })
    expect(res.status).toBe(403)
    // The route wrapper leaves a failure row for a refused action (ui#1105).
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'cordon', category: 'k8s', status: 'failure' }))
  })
  it('400 when the node name is not DNS-1123', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { id: 'c1', node: 'Bad_Name!' }, body: { unschedulable: true } })
    expect(res.status).toBe(400)
    expect(cordonNodeMock).not.toHaveBeenCalled()
  })

  it('400 when the node name exceeds the 253-char DNS cap', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { id: 'c1', node: 'a'.repeat(254) }, body: { unschedulable: true } })
    expect(res.status).toBe(400)
    expect(cordonNodeMock).not.toHaveBeenCalled()
  })
  it('400 when unschedulable is not a boolean', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { unschedulable: 'yes' } })
    expect(res.status).toBe(400)
    expect(cordonNodeMock).not.toHaveBeenCalled()
  })
  it('404 when the cluster is not in the tenant', async () => {
    getWithCredMock.mockResolvedValue(null)
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { unschedulable: true } })
    expect(res.status).toBe(404)
  })
  it('502 + failure audit when the orchestrator fails', async () => {
    cordonNodeMock.mockResolvedValue({ ok: false, error: 'boom' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { unschedulable: true } })
    expect(res.status).toBe(502)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'cordon', status: 'failure', details: expect.objectContaining({ error: 'boom' }) }))
  })
  it('cordons and audits success', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { unschedulable: true } })
    expect(res.status).toBe(200)
    expect(cordonNodeMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', nodeName: 'node-1', unschedulable: true }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'cordon', status: 'success' }))
  })
})
