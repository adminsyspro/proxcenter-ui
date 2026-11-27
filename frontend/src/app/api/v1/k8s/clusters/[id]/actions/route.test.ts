import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const restartMock = vi.fn()
const scaleMock = vi.fn()
const rollbackMock = vi.fn()
const deletePodMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ getClusterWithCredential: (...a: any[]) => getWithCredMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({
  restartWorkload: (...a: any[]) => restartMock(...a),
  scaleWorkload: (...a: any[]) => scaleMock(...a),
  rollbackDeployment: (...a: any[]) => rollbackMock(...a),
  deletePod: (...a: any[]) => deletePodMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const cred = { apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false, credentialType: 'token', credential: 't', contextName: 'ctx' }
const params = { id: 'c1' }

beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue({ row: { id: 'c1', name: 'dev', credentialVersion: 4 }, credential: cred })
  restartMock.mockReset().mockResolvedValue({ ok: true, value: { restartedAt: 'now' } })
  scaleMock.mockReset().mockResolvedValue({ ok: true, value: { replicas: 3 } })
  rollbackMock.mockReset().mockResolvedValue({ ok: true, value: { revision: 2 } })
  deletePodMock.mockReset().mockResolvedValue({ ok: true, value: { deleted: true } })
  auditMock.mockReset().mockResolvedValue('a1')
})

const post = async (body: Record<string, unknown>) => callRoute((await import('./route')).POST, { params, body })

describe('POST actions', () => {
  it('403 when the gate denies, without touching the cluster', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const res = await post({ action: 'restart', kind: 'deployment', namespace: 'shop', name: 'web' })
    expect(res.status).toBe(403)
    expect(restartMock).not.toHaveBeenCalled()
  })
  it('400 on an action the kind does not offer', async () => {
    const res = await post({ action: 'delete', kind: 'deployment', namespace: 'shop', name: 'web' })
    expect(res.status).toBe(400)
    expect(getWithCredMock).not.toHaveBeenCalled()
  })
  it('404 when the cluster is not in the tenant', async () => {
    getWithCredMock.mockResolvedValue(null)
    const res = await post({ action: 'restart', kind: 'deployment', namespace: 'shop', name: 'web' })
    expect(res.status).toBe(404)
    expect(getWithCredMock).toHaveBeenCalledWith('t1', 'c1')
  })
  it('restarts a workload and audits it', async () => {
    const res = await post({ action: 'restart', kind: 'statefulset', namespace: 'shop', name: 'db' })
    expect(res.status).toBe(200)
    expect(restartMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', credentialVersion: 4, kind: 'statefulset', namespace: 'shop', name: 'db' }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'restart', category: 'k8s', resourceType: 'kubernetesWorkload', resourceName: 'db', status: 'success' }))
  })
  it('scales and records the replica count', async () => {
    const res = await post({ action: 'scale', kind: 'deployment', namespace: 'shop', name: 'web', replicas: 3 })
    expect(await readJson(res)).toEqual({ replicas: 3 })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'scale', details: { kind: 'deployment', namespace: 'shop', replicas: 3 } }))
  })
  it('rolls back and maps a conflict to 409 with a failure row', async () => {
    rollbackMock.mockResolvedValue({ ok: false, error: 'conflict' })
    const res = await post({ action: 'rollback', kind: 'deployment', namespace: 'shop', name: 'web', revision: 3 })
    expect(res.status).toBe(409)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'rollback', status: 'failure', details: { kind: 'deployment', namespace: 'shop', revision: 3, error: 'conflict' } }))
  })
  it('deletes a pod as a pod resource', async () => {
    const res = await post({ action: 'delete', kind: 'pod', namespace: 'shop', name: 'web-1' })
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', resourceType: 'kubernetesPod', resourceId: 'c1/shop/pod/web-1' }))
  })
  it('502 when the cluster cannot be reached', async () => {
    restartMock.mockResolvedValue({ ok: false, error: 'unreachable' })
    const res = await post({ action: 'restart', kind: 'deployment', namespace: 'shop', name: 'web' })
    expect(res.status).toBe(502)
  })
})
