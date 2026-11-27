import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const replaceCredMock = vi.fn()
const updateMetaMock = vi.fn()
const persistHealthMock = vi.fn()
const deleteClusterMock = vi.fn()
const deleteClusterNodesMock = vi.fn()
const fetchHealthMock = vi.fn()
const invalidateMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_VIEW: 'k8s.view', K8S_MANAGE: 'k8s.manage' } }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({
  getClusterWithCredential: (...a: any[]) => getWithCredMock(...a),
  replaceCredential: (...a: any[]) => replaceCredMock(...a),
  updateMeta: (...a: any[]) => updateMetaMock(...a),
  persistHealth: (...a: any[]) => persistHealthMock(...a),
  deleteCluster: (...a: any[]) => deleteClusterMock(...a),
  deleteClusterNodes: (...a: any[]) => deleteClusterNodesMock(...a),
}))
vi.mock('@/lib/k8s/orchestrator', () => ({ fetchHealth: (...a: any[]) => fetchHealthMock(...a), invalidateClient: (...a: any[]) => invalidateMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const cred = { apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false, credentialType: 'token', credential: 't', contextName: 'ctx' }

beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue({ row: { id: 'c1', name: 'dev', credentialVersion: 1 }, credential: cred })
  fetchHealthMock.mockReset().mockResolvedValue({ ok: true, value: { state: 'healthy', version: 'v1.30.0' } })
  auditMock.mockReset().mockResolvedValue('a1')
  deleteClusterMock.mockReset().mockResolvedValue(undefined)
  deleteClusterNodesMock.mockReset().mockResolvedValue(0)
})

const params = { id: 'c1' }

describe('GET [id]', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(403)
  })
  it('404 when not in tenant', async () => {
    getWithCredMock.mockResolvedValue(null)
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
  })
  it('returns cluster (no credential field)', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params })
    const json: any = await readJson(res)
    expect(json.cluster.name).toBe('dev')
    expect(JSON.stringify(json)).not.toContain('"credential"')
  })
  it('?refresh=1 runs and persists health', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params, searchParams: { refresh: '1' } })
    const json: any = await readJson(res)
    expect(json.cluster.healthState ?? json.health.state).toBe('healthy')
    expect(persistHealthMock).toHaveBeenCalled()
  })
  it('?refresh=1 returns the post-persist cluster row, not the stale pre-persist snapshot', async () => {
    // Never-checked cluster: the row read before the probe is stale.
    getWithCredMock.mockResolvedValue({
      row: { id: 'c1', name: 'dev', credentialVersion: 1, healthState: 'unknown', lastHealthAt: null },
      credential: cred,
    })
    persistHealthMock.mockResolvedValue({
      id: 'c1', name: 'dev', credentialVersion: 1,
      healthState: 'healthy', version: 'v1.30.0',
      lastHealthAt: '2026-07-04T00:00:00.000Z',
      healthDetail: { nodesReady: 3, nodesTotal: 3 },
    })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params, searchParams: { refresh: '1' } })
    const json: any = await readJson(res)
    expect(json.cluster.healthState).toBe('healthy')
    expect(json.cluster.lastHealthAt).toBeTruthy()
    expect(json.health.state).toBe('healthy')
    expect(JSON.stringify(json)).not.toContain('credentialEnc')
  })
})

describe('PATCH [id]', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const PATCH = (await import('./route')).PATCH
    const res = await callRoute(PATCH, { params, body: { name: 'new-name' } })
    expect(res.status).toBe(403)
  })
  it('replacing credential bumps version + invalidates cache', async () => {
    const PATCH = (await import('./route')).PATCH
    const kc = `apiVersion: v1\nkind: Config\ncurrent-context: ctx\nclusters:\n- name: c1\n  cluster:\n    server: https://10.0.0.1:6443\ncontexts:\n- name: ctx\n  context: { cluster: c1, user: u1 }\nusers:\n- name: u1\n  user:\n    token: new`
    const res = await callRoute(PATCH, { params, body: { kubeconfig: kc, context: 'ctx' } })
    expect(res.status).toBe(200)
    expect(replaceCredMock).toHaveBeenCalled()
    expect(invalidateMock).toHaveBeenCalledWith('c1')
  })
})

describe('DELETE [id]', () => {
  it('403 when gate denies', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const DELETE = (await import('./route')).DELETE
    const res = await callRoute(DELETE, { params })
    expect(res.status).toBe(403)
  })
  it('deletes + invalidates + audits', async () => {
    const DELETE = (await import('./route')).DELETE
    const res = await callRoute(DELETE, { params })
    expect(res.status).toBe(200)
    expect(deleteClusterMock).toHaveBeenCalledWith('t1', 'c1')
    expect(invalidateMock).toHaveBeenCalledWith('c1')
    expect(auditMock).toHaveBeenCalled()
  })
  it('delete also cleans the node-mapping rows', async () => {
    const DELETE = (await import('./route')).DELETE
    const res = await callRoute(DELETE, { params })
    expect(res.status).toBe(200)
    expect(deleteClusterNodesMock).toHaveBeenCalledWith('c1')
    expect(deleteClusterMock).toHaveBeenCalledWith('t1', 'c1')
  })
})
