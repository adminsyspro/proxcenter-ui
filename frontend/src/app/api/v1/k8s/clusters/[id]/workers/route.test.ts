import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sPermissionMock = vi.fn()
const requireK8sProvisionMock = vi.fn()
const provisionTargetMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const syncMappingMock = vi.fn()
const getRunMock = vi.fn()
const changeWorkersMock = vi.fn()
const cordonStateMock = vi.fn()
const removeNodeObjectMock = vi.fn()
const checkNodeVmsMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_VIEW: 'k8s.view' } }))
vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/provisionAccess', () => ({ requireProvisionTarget: (...a: any[]) => provisionTargetMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({
  getClusterWithCredential: (...a: any[]) => getWithCredMock(...a),
  syncNodeMapping: (...a: any[]) => syncMappingMock(...a),
}))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({
  getProvisionRun: (...a: any[]) => getRunMock(...a),
  changeWorkers: (...a: any[]) => changeWorkersMock(...a),
}))
vi.mock('@/lib/k8s/orchestrator', () => ({
  nodeCordonState: (...a: any[]) => cordonStateMock(...a),
  removeNodeObject: (...a: any[]) => removeNodeObjectMock(...a),
}))
vi.mock('@/lib/k8s/server/destroyClusterNodes', () => ({ checkNodeVms: (...a: any[]) => checkNodeVmsMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const params = { id: 'c1' }
const cred = { apiServerUrl: 'https://10.42.0.87:6443', credentialType: 'token', credential: 'x', insecureSkipTlsVerify: false, contextName: 'default' }
const deployed = { row: { id: 'c1', name: 'dev', source: 'deployed', provisioningRunId: 'run-1', proxmoxConnectionId: 'conn-a', credentialVersion: 1 }, credential: cred }
const layout = {
  controlPlane: [{ name: 'dev-cp-1', ip: '10.42.0.87', vmid: 98511 }],
  workers: [{ name: 'dev-worker-1', ip: '10.42.0.88', vmid: 98512 }],
  gateway: '10.42.0.1', subnetPrefix: 24, workerCores: 2, workerMemory: 2048, workerDisk: 12, changeable: true,
}
const completed = (extra: Record<string, unknown> = {}) => ({ ok: true, value: { run: { id: 'run-1', status: 'completed', phase: 'bootstrap', progress: 100, clusterName: 'dev', layout, ...extra }, outputs: { kubeconfig: '', nodes: [{ name: 'dev-cp-1', role: 'server', vmid: 98511, ip: '10.42.0.87' }] } } })

beforeEach(() => {
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  provisionTargetMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue(deployed)
  syncMappingMock.mockReset().mockResolvedValue([])
  getRunMock.mockReset().mockResolvedValue(completed())
  changeWorkersMock.mockReset().mockResolvedValue({ ok: true, value: { runId: 'run-1', status: 'scaling' } })
  cordonStateMock.mockReset().mockResolvedValue({ ok: true, value: { exists: true, cordoned: true } })
  removeNodeObjectMock.mockReset().mockResolvedValue({ ok: true })
  checkNodeVmsMock.mockReset().mockResolvedValue([{ vmid: 98512, nodeName: 'dev-worker-1', refusal: null }])
  auditMock.mockReset().mockResolvedValue('a1')
})

const post = async (body: any) => callRoute((await import('./route')).POST, { params, body })
const get = async () => callRoute((await import('./route')).GET, { params })

describe('GET /api/v1/k8s/clusters/[id]/workers', () => {
  it('answers the run state and layout of a deployed cluster', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'completed', phase: 'bootstrap', progress: 100, error: null, layout })
  })
  it('syncs the node mapping and deletes the node objects of removed workers', async () => {
    syncMappingMock.mockResolvedValue(['dev-worker-1'])
    await get()
    expect(syncMappingMock).toHaveBeenCalledWith('c1', [{ name: 'dev-cp-1', vmid: 98511, connectionId: 'conn-a' }])
    expect(removeNodeObjectMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', nodeName: 'dev-worker-1' }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'kubernetesNode', resourceName: 'dev-worker-1', status: 'success' }))
  })
  it('does not touch the mapping while a change runs', async () => {
    getRunMock.mockResolvedValue({ ok: true, value: { run: { id: 'run-1', status: 'scaling', phase: 'workers', progress: 30, layout } } })
    await get()
    expect(syncMappingMock).not.toHaveBeenCalled()
  })
  it('404 not_deployed for an imported cluster', async () => {
    getWithCredMock.mockResolvedValue({ ...deployed, row: { ...deployed.row, source: 'imported', provisioningRunId: null } })
    const res = await get()
    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'not_deployed' })
  })
  it('passes an orchestrator failure on as a code', async () => {
    getRunMock.mockResolvedValue({ ok: false, error: 'Orchestrator 503: down' })
    expect((await get()).status).toBe(502)
  })
})

describe('POST /api/v1/k8s/clusters/[id]/workers', () => {
  it('adds a worker named after the cluster, with vm.create on the connection', async () => {
    const res = await post({ add: [{ ip: '10.42.0.89', vmid: 98513 }] })
    expect(res.status).toBe(202)
    expect(provisionTargetMock).toHaveBeenCalledWith('t1', 'conn-a', 'create')
    expect(changeWorkersMock).toHaveBeenCalledWith('run-1', [layout.workers[0], { name: 'dev-worker-2', ip: '10.42.0.89', vmid: 98513 }])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'workers', status: 'success', details: { added: ['dev-worker-2'], removed: [] } }))
  })
  it('passes the size chosen for the new workers on', async () => {
    const res = await post({ add: [{ ip: '10.42.0.89', vmid: 98513, cores: 8, memory: 16384, disk: 100 }] })
    expect(res.status).toBe(202)
    expect(changeWorkersMock).toHaveBeenCalledWith('run-1', [layout.workers[0], { name: 'dev-worker-2', ip: '10.42.0.89', vmid: 98513, cores: 8, memory: 16384, disk: 100 }])
  })
  it('refuses a size below the floors or not a whole number', async () => {
    for (const size of [{ cores: 0 }, { memory: 1024 }, { disk: 5 }, { cores: 2.5 }, { memory: '4096' }, { disk: 999_999 }]) {
      const res = await post({ add: [{ ip: '10.42.0.89', vmid: 98513, ...size }] })
      expect(res.status).toBe(400)
    }
    expect(changeWorkersMock).not.toHaveBeenCalled()
  })
  it('removes a cordoned worker whose VM is still the node, with vm.delete', async () => {
    const res = await post({ remove: ['dev-worker-1'] })
    expect(res.status).toBe(202)
    expect(provisionTargetMock).toHaveBeenCalledWith('t1', 'conn-a', 'delete')
    expect(checkNodeVmsMock).toHaveBeenCalledWith('t1', [{ nodeName: 'dev-worker-1', connectionId: 'conn-a', vmid: 98512 }], 'dev')
    expect(changeWorkersMock).toHaveBeenCalledWith('run-1', [])
    // The node object goes once its VM is destroyed (GET), not before.
    expect(removeNodeObjectMock).not.toHaveBeenCalled()
  })
  it('refuses a worker still taking pods, or whose VM changed', async () => {
    cordonStateMock.mockResolvedValue({ ok: true, value: { exists: true, cordoned: false } })
    let res = await post({ remove: ['dev-worker-1'] })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'not_cordoned', node: 'dev-worker-1' })
    checkNodeVmsMock.mockResolvedValue([{ vmid: 98512, nodeName: 'dev-worker-1', refusal: 'renamed' }])
    res = await post({ remove: ['dev-worker-1'] })
    expect(res.status).toBe(409)
    expect(((await readJson(res)) as any).error).toBe('vm_not_node')
    expect(changeWorkersMock).not.toHaveBeenCalled()
  })
  it('502 when the node cannot be read', async () => {
    cordonStateMock.mockResolvedValue({ ok: false, error: 'unreachable' })
    expect((await post({ remove: ['dev-worker-1'] })).status).toBe(502)
  })
  it('refuses a control plane node, an empty change and bad input', async () => {
    expect(await readJson(await post({ remove: ['dev-cp-1'] }))).toEqual({ error: 'not_a_worker' })
    expect(await readJson(await post({}))).toEqual({ error: 'nothing_to_change' })
    expect((await post({ add: [{ ip: 'nope', vmid: 1 }] })).status).toBe(400)
    expect((await post({ remove: 'dev-worker-1' })).status).toBe(400)
  })
  it('409 while another operation runs, or on a cluster whose tokens were not kept', async () => {
    getRunMock.mockResolvedValue(completed({ status: 'scaling' }))
    expect(await readJson(await post({ add: [{ ip: '10.42.0.89', vmid: 98513 }] }))).toEqual({ error: 'run_not_changeable' })
    getRunMock.mockResolvedValue(completed({ layout: { ...layout, changeable: false } }))
    expect(await readJson(await post({ add: [{ ip: '10.42.0.89', vmid: 98513 }] }))).toEqual({ error: 'workers_not_changeable' })
  })
  it('refuses without the permissions', async () => {
    requireK8sProvisionMock.mockResolvedValue(new Response('no', { status: 403 }))
    expect((await post({ add: [] })).status).toBe(403)
    requireK8sProvisionMock.mockResolvedValue(null)
    provisionTargetMock.mockResolvedValue(new Response('no', { status: 403 }))
    expect((await post({ add: [{ ip: '10.42.0.89', vmid: 98513 }] })).status).toBe(403)
    expect(changeWorkersMock).not.toHaveBeenCalled()
  })
  it('audits and passes on an orchestrator refusal', async () => {
    changeWorkersMock.mockResolvedValue({ ok: false, error: 'Orchestrator 409: {"error":"busy","code":"connection_busy"}' })
    const res = await post({ add: [{ ip: '10.42.0.89', vmid: 98513 }] })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'connection_busy' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }))
  })
})
