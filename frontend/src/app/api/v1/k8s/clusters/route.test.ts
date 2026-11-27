import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const listClustersMock = vi.fn()
const createClusterMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_VIEW: 'k8s.view', K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ listClusters: (...a: any[]) => listClustersMock(...a), createCluster: (...a: any[]) => createClusterMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const tokenKubeconfig = `apiVersion: v1\nkind: Config\ncurrent-context: ctx\nclusters:\n- name: c1\n  cluster:\n    server: https://10.0.0.1:6443\ncontexts:\n- name: ctx\n  context: { cluster: c1, user: u1 }\nusers:\n- name: u1\n  user:\n    token: abc`

beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  listClustersMock.mockReset().mockResolvedValue([{ id: 'c1', name: 'dev' }])
  createClusterMock.mockReset().mockResolvedValue('new-id')
  auditMock.mockReset().mockResolvedValue('a1')
})

describe('GET /api/v1/k8s/clusters', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const GET = (await import('./route')).GET
    const res = await callRoute(GET)
    expect(res.status).toBe(403)
  })
  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET)
    expect(res.status).toBe(403)
  })
  it('lists for tenant', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).clusters[0].name).toBe('dev')
    expect(listClustersMock).toHaveBeenCalledWith('t1')
  })
})

describe('POST /api/v1/k8s/clusters', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: { name: 'dev', kubeconfig: tokenKubeconfig, context: 'ctx' } })
    expect(res.status).toBe(403)
  })
  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: { name: 'dev', kubeconfig: tokenKubeconfig, context: 'ctx' } })
    expect(res.status).toBe(403)
  })
  it('creates, audits, returns 201 id', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: { name: 'dev', kubeconfig: tokenKubeconfig, context: 'ctx', distro: 'k3s' } })
    expect(res.status).toBe(201)
    expect(((await readJson(res)) as any).id).toBe('new-id')
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'dev', distro: 'k3s' }))
    expect(auditMock).toHaveBeenCalled()
  })
  it('400 + audit failure on disallowed auth', async () => {
    const POST = (await import('./route')).POST
    const bad = tokenKubeconfig.replace('token: abc', 'exec:\n      command: aws')
    const res = await callRoute(POST, { body: { name: 'dev', kubeconfig: bad, context: 'ctx' } })
    expect(res.status).toBe(400)
    expect(createClusterMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', category: 'k8s' }))
  })
})
