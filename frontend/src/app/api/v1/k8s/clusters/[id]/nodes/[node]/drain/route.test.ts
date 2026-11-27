import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const drainNodeMock = vi.fn()
const auditMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ getClusterWithCredential: (...a: any[]) => getWithCredMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ drainNode: (...a: any[]) => drainNodeMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const cred = { apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false, credentialType: 'token', credential: 't', contextName: 'ctx' }
const result = { cordoned: true, evicted: 1, skipped: 0, remaining: [], blockedByPdb: [], evictionFailures: [], refusedEmptyDir: [], refusedUnmanaged: [], done: true }
beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue({ row: { id: 'c1', name: 'dev', credentialVersion: 1 }, credential: cred })
  drainNodeMock.mockReset().mockResolvedValue({ ok: true, value: result })
  auditMock.mockReset().mockResolvedValue('a1')
})
const params = { id: 'c1', node: 'node-1' }

describe('POST drain', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const POST = (await import('./route')).POST
    expect((await callRoute(POST, { params, body: {} })).status).toBe(403)
  })
  it('400 when force/dryRun are not booleans', async () => {
    const POST = (await import('./route')).POST
    expect((await callRoute(POST, { params, body: { force: 'x' } })).status).toBe(400)
    expect(drainNodeMock).not.toHaveBeenCalled()
  })
  it('400 when the node name is not DNS-1123', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { id: 'c1', node: 'Bad_Name!' }, body: { force: false } })
    expect(res.status).toBe(400)
    expect(drainNodeMock).not.toHaveBeenCalled()
  })

  it('400 when the node name exceeds the 253-char DNS cap', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { id: 'c1', node: 'a'.repeat(254) }, body: { force: false } })
    expect(res.status).toBe(400)
    expect(drainNodeMock).not.toHaveBeenCalled()
  })
  it('404 when the cluster is not in the tenant', async () => {
    getWithCredMock.mockResolvedValue(null)
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { force: false } })
    expect(res.status).toBe(404)
    expect(drainNodeMock).not.toHaveBeenCalled()
  })
  it('502 + failure audit when the orchestrator fails', async () => {
    drainNodeMock.mockResolvedValue({ ok: false, error: 'boom' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { force: false } })
    expect(res.status).toBe(502)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'drain', status: 'failure', details: expect.objectContaining({ error: 'boom' }) }))
  })
  it('drains and audits success', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params, body: { force: false } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(result)
    expect(drainNodeMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', nodeName: 'node-1', force: false }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'drain', status: 'success' }))
  })
  it('dryRun does not audit (read-only preview)', async () => {
    drainNodeMock.mockResolvedValue({ ok: true, value: { ...result, cordoned: false } })
    const POST = (await import('./route')).POST
    await callRoute(POST, { params, body: { dryRun: true } })
    expect(drainNodeMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
    expect(auditMock).not.toHaveBeenCalled()
  })
})
