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
const requireK8sProvisionMock = vi.fn()
const provisionTargetMock = vi.fn()
const destroyClusterNodesMock = vi.fn()
const destroyRunMock = vi.fn()
const getNodeMappingMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/provisionAccess', () => ({ requireProvisionTarget: (...a: any[]) => provisionTargetMock(...a) }))
vi.mock('@/lib/k8s/server/destroyClusterNodes', () => ({ destroyClusterNodes: (...a: any[]) => destroyClusterNodesMock(...a) }))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({ destroyProvisionRun: (...a: any[]) => destroyRunMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({
  getClusterWithCredential: (...a: any[]) => getWithCredMock(...a),
  replaceCredential: (...a: any[]) => replaceCredMock(...a),
  updateMeta: (...a: any[]) => updateMetaMock(...a),
  persistHealth: (...a: any[]) => persistHealthMock(...a),
  deleteCluster: (...a: any[]) => deleteClusterMock(...a),
  deleteClusterNodes: (...a: any[]) => deleteClusterNodesMock(...a),
  getNodeMapping: (...a: any[]) => getNodeMappingMock(...a),
}))
vi.mock('@/lib/k8s/orchestrator', () => ({ fetchHealth: (...a: any[]) => fetchHealthMock(...a), invalidateClient: (...a: any[]) => invalidateMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const cred = { apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false, credentialType: 'token', credential: 't', contextName: 'ctx' }

beforeEach(() => {
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  provisionTargetMock.mockReset().mockResolvedValue(null)
  destroyClusterNodesMock.mockReset().mockResolvedValue({ results: [{ vmid: 9001, nodeName: 'dev-cp-1', status: 'destroyed' }], allOk: true })
  destroyRunMock.mockReset().mockResolvedValue({ ok: true, value: { status: 'destroying' } })
  getNodeMappingMock.mockReset().mockResolvedValue([{ nodeName: 'dev-cp-1', connectionId: 'conn-a', vmid: 9001 }, { nodeName: 'dev-w-1', connectionId: 'conn-a', vmid: 9002 }])
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

describe('DELETE with the VMs of a deployed cluster', () => {
  const deployed = { row: { id: 'c1', name: 'dev', credentialVersion: 1, source: 'deployed', provisioningRunId: 'run-7' }, credential: cred }
  const del = async () => callRoute((await import('./route')).DELETE, { params, searchParams: { destroyNodes: 'true' } })

  it('checks vm.delete on the connection, destroys the VMs by cluster name, then tears down the run', async () => {
    getWithCredMock.mockResolvedValue(deployed)
    const res = await del()
    expect(res.status).toBe(200)
    expect(provisionTargetMock).toHaveBeenCalledTimes(1)
    expect(provisionTargetMock).toHaveBeenCalledWith('t1', 'conn-a', 'delete')
    expect(destroyClusterNodesMock).toHaveBeenCalledWith('t1', 'c1', 'dev')
    expect(destroyRunMock).toHaveBeenCalledWith('run-7')
    expect(deleteClusterMock).toHaveBeenCalledWith('t1', 'c1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', details: { destroyedNodes: true, runTornDown: true } }))
  })

  it('refuses without vm.delete on the connection, and destroys nothing', async () => {
    getWithCredMock.mockResolvedValue(deployed)
    provisionTargetMock.mockResolvedValue(new Response('no', { status: 403 }))
    const res = await del()
    expect(res.status).toBe(403)
    expect(destroyClusterNodesMock).not.toHaveBeenCalled()
    expect(deleteClusterMock).not.toHaveBeenCalled()
  })

  it('keeps the cluster and the run when a VM could not be destroyed', async () => {
    getWithCredMock.mockResolvedValue(deployed)
    destroyClusterNodesMock.mockResolvedValue({ results: [{ vmid: 9002, nodeName: 'dev-w-1', status: 'error', error: 'vm 9002 is no longer node dev-w-1 of cluster dev' }], allOk: false })
    const res = await del()
    expect(res.status).toBe(409)
    expect(((await readJson(res)) as any).results[0].error).toContain('no longer node')
    expect(deleteClusterMock).not.toHaveBeenCalled()
    expect(destroyRunMock).not.toHaveBeenCalled()
  })

  it('ignores the flag on an imported cluster: no VM and no run touched', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(requireK8sProvisionMock).not.toHaveBeenCalled()
    expect(destroyClusterNodesMock).not.toHaveBeenCalled()
    expect(destroyRunMock).not.toHaveBeenCalled()
  })
})
