import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sProvisionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getWithCredMock = vi.fn()
const getRunMock = vi.fn()
const upgradeMock = vi.fn()
const auditMock = vi.fn()
const releasesMock = vi.fn()
const requireK8sPermissionMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ getClusterWithCredential: (...a: any[]) => getWithCredMock(...a) }))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({
  getProvisionRun: (...a: any[]) => getRunMock(...a),
  upgradeCluster: (...a: any[]) => upgradeMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_VIEW: 'k8s.view' } }))
vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/k8s/server/releaseTags', async (orig) => ({ ...(await orig<any>()), releasesOf: (...a: any[]) => releasesMock(...a) }))

const params = { id: 'c1' }
const deployed = { row: { id: 'c1', name: 'dev', source: 'deployed', provisioningRunId: 'run-1', proxmoxConnectionId: 'conn-a', credentialVersion: 1 }, credential: {} }
const layout = {
  controlPlane: [{ name: 'dev-cp-1', ip: '10.42.0.87', vmid: 98511 }], workers: [],
  gateway: '10.42.0.1', subnetPrefix: 24, workerCores: 2, workerMemory: 2048, workerDisk: 12, changeable: true,
  version: 'v1.36.6+k3s1', upgradable: true,
}
const run = (extra: Record<string, unknown> = {}) => ({ ok: true, value: { run: { id: 'run-1', status: 'completed', phase: 'bootstrap', progress: 100, layout, ...extra } } })

beforeEach(() => {
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getWithCredMock.mockReset().mockResolvedValue(deployed)
  getRunMock.mockReset().mockResolvedValue(run())
  upgradeMock.mockReset().mockResolvedValue({ ok: true, value: { runId: 'run-1', status: 'scaling' } })
  auditMock.mockReset().mockResolvedValue('a1')
  requireK8sPermissionMock.mockReset().mockResolvedValue(null)
  releasesMock.mockReset().mockResolvedValue(['v1.36.6+k3s1', 'v1.36.7+k3s1', 'v1.37.2+k3s1', 'v1.38.1+k3s1'])
})

const get = async () => callRoute((await import('./route')).GET, { params })
const post = async (body: any) => callRoute((await import('./route')).POST, { params, body })

describe('POST /api/v1/k8s/clusters/[id]/upgrade', () => {
  it('starts the upgrade and audits it', async () => {
    const res = await post({ version: 'v1.37.2+k3s1' })
    expect(res.status).toBe(202)
    expect(upgradeMock).toHaveBeenCalledWith('run-1', 'v1.37.2+k3s1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'upgrade', status: 'success', details: { from: 'v1.36.6+k3s1', to: 'v1.37.2+k3s1' } }))
  })

  it('needs the provisioning permission', async () => {
    requireK8sProvisionMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await post({ version: 'v1.37.2+k3s1' })).status).toBe(403)
    expect(upgradeMock).not.toHaveBeenCalled()
  })

  it('refuses an imported cluster', async () => {
    getWithCredMock.mockResolvedValue({ ...deployed, row: { ...deployed.row, source: 'imported' } })
    const res = await post({ version: 'v1.37.2+k3s1' })
    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'not_deployed' })
  })

  it.each([
    [{}, 'invalid_request'],
    [{ version: 7 }, 'invalid_request'],
    [{ version: 'v'.repeat(65) }, 'invalid_request'],
    [{ version: 'v1.36.6+k3s1' }, 'not_newer'],
    [{ version: 'v1.38.0+k3s1' }, 'skips_minor'],
    [{ version: 'v1.37.2+k3s1; reboot' }, 'format'],
  ])('refuses %j', async (body, error) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error })
    expect(upgradeMock).not.toHaveBeenCalled()
  })

  it('waits for a running operation', async () => {
    getRunMock.mockResolvedValue(run({ status: 'scaling' }))
    const res = await post({ version: 'v1.37.2+k3s1' })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'run_not_changeable' })
  })

  it('refuses a distribution that cannot be upgraded', async () => {
    getRunMock.mockResolvedValue(run({ layout: { ...layout, upgradable: false } }))
    const res = await post({ version: 'v1.37.2+k3s1' })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'upgrade_unsupported' })
  })

  it('passes an orchestrator refusal on, and audits it', async () => {
    upgradeMock.mockResolvedValue({ ok: false, error: 'Orchestrator 409: {"error":"busy","code":"connection_busy"}' })
    const res = await post({ version: 'v1.37.2+k3s1' })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'connection_busy' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', details: expect.objectContaining({ error: 'connection_busy' }) }))
  })

  it('answers 502 when the orchestrator is down', async () => {
    getRunMock.mockResolvedValue({ ok: false, error: 'fetch failed' })
    const res = await post({ version: 'v1.37.2+k3s1' })
    expect(res.status).toBe(502)
  })
})

describe('GET /api/v1/k8s/clusters/[id]/upgrade', () => {
  it('lists the releases reachable in one step and the path to the newest', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ current: 'v1.36.6+k3s1', candidates: ['v1.37.2+k3s1', 'v1.36.7+k3s1'], path: ['v1.37.2+k3s1', 'v1.38.1+k3s1'] })
    expect(releasesMock).toHaveBeenCalledWith('k3s')
  })
  it('answers no candidates when the releases cannot be read', async () => {
    releasesMock.mockResolvedValue(null)
    expect(await readJson(await get())).toEqual({ current: 'v1.36.6+k3s1', candidates: null, path: [] })
  })
  it('needs the view permission', async () => {
    requireK8sPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await get()).status).toBe(403)
  })
  it('passes an orchestrator failure on', async () => {
    getRunMock.mockResolvedValue({ ok: false, error: 'fetch failed' })
    expect((await get()).status).toBe(502)
  })
})
