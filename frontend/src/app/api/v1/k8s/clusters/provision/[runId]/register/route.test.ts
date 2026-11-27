import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sProvisionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getProvisionRunMock = vi.fn()
const listClustersMock = vi.fn()
const createClusterMock = vi.fn()
const recordNodeMappingMock = vi.fn()
const listKubeconfigContextsMock = vi.fn()
const sanitizeKubeconfigMock = vi.fn()
const auditMock = vi.fn()
const getServerSessionMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({ getProvisionRun: (...a: any[]) => getProvisionRunMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({
  listClusters: (...a: any[]) => listClustersMock(...a),
  createCluster: (...a: any[]) => createClusterMock(...a),
  recordNodeMapping: (...a: any[]) => recordNodeMappingMock(...a),
}))
vi.mock('@/lib/k8s/kubeconfig', () => ({
  listKubeconfigContexts: (...a: any[]) => listKubeconfigContextsMock(...a),
  sanitizeKubeconfig: (...a: any[]) => sanitizeKubeconfigMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))
vi.mock('next-auth', () => ({ getServerSession: (...a: any[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

const completedRun = {
  run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, distro: 'talos', clusterName: 'demo', connectionId: 'conn-1' },
  outputs: {
    kubeconfig: 'kc-text',
    talosconfig: 'tc-text',
    nodes: [
      { name: 'cp-1', role: 'controlplane', vmid: 100, ip: '10.0.0.10' },
      { name: 'wk-1', role: 'worker', vmid: 101, ip: '10.0.0.11' },
    ],
  },
}

const sanitizedCred = {
  apiServerUrl: 'https://10.0.0.10:6443',
  insecureSkipTlsVerify: false,
  credentialType: 'token' as const,
  credential: 'tok',
  contextName: 'admin@demo',
}

beforeEach(() => {
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getProvisionRunMock.mockReset().mockResolvedValue({ ok: true, value: completedRun })
  listClustersMock.mockReset().mockResolvedValue([])
  createClusterMock.mockReset().mockResolvedValue('new-cluster-id')
  recordNodeMappingMock.mockReset().mockResolvedValue(undefined)
  listKubeconfigContextsMock.mockReset().mockReturnValue({ ok: true, value: ['admin@demo'] })
  sanitizeKubeconfigMock.mockReset().mockReturnValue({ ok: true, value: sanitizedCred })
  auditMock.mockReset().mockResolvedValue('a1')
  getServerSessionMock.mockReset().mockResolvedValue({ user: { id: 'u1' } })
})

const body = { clusterName: 'demo', connectionId: 'conn-1' }

describe('POST /api/v1/k8s/clusters/provision/[runId]/register', () => {
  it('403 when the guard denies', async () => {
    requireK8sProvisionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(403)
    expect(getProvisionRunMock).not.toHaveBeenCalled()
  })

  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(403)
  })

  it('502 when the run carries no cluster name or connection', async () => {
    const POST = (await import('./route')).POST
    getProvisionRunMock.mockResolvedValue({ ok: true, value: { ...completedRun, run: { ...completedRun.run, clusterName: '' } } })
    expect((await callRoute(POST, { params: { runId: 'run-1' }, body })).status).toBe(502)
    getProvisionRunMock.mockResolvedValue({ ok: true, value: { ...completedRun, run: { ...completedRun.run, connectionId: undefined } } })
    expect((await callRoute(POST, { params: { runId: 'run-1' }, body })).status).toBe(502)
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('registers under the name and connection of the run, whatever the browser sends', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body: { clusterName: 'other', connectionId: 'someone-elses-conn' } })
    expect(res.status).toBe(201)
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({ name: 'demo', proxmoxConnectionId: 'conn-1', provisioningRunId: 'run-1' }))
    expect(recordNodeMappingMock).toHaveBeenCalledWith('new-cluster-id', expect.arrayContaining([expect.objectContaining({ connectionId: 'conn-1' })]))
  })

  it('idempotent: the cluster already registered for the run short-circuits to 200', async () => {
    const POST = (await import('./route')).POST
    listClustersMock.mockResolvedValue([{ id: 'by-run', name: 'renamed', provisioningRunId: 'run-1' }])
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ clusterId: 'by-run', alreadyRegistered: true })
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('409 when another cluster already holds the name: never handed out as this run\'s cluster', async () => {
    const POST = (await import('./route')).POST
    listClustersMock.mockResolvedValue([{ id: 'imported-id', name: 'demo', provisioningRunId: null }])
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'cluster_name_taken' })
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('409 when the run is not completed', async () => {
    getProvisionRunMock.mockResolvedValue({ ok: true, value: { run: { id: 'run-1', status: 'running', phase: 'p', progress: 40, clusterName: 'demo', connectionId: 'conn-1' } } })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(409)
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('409 when the run is completed but outputs are missing', async () => {
    getProvisionRunMock.mockResolvedValue({ ok: true, value: { run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, clusterName: 'demo', connectionId: 'conn-1' } } })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(409)
  })

  it('maps a getProvisionRun failure via orchestratorStatus (e.g. "Orchestrator 404")', async () => {
    getProvisionRunMock.mockResolvedValue({ ok: false, error: 'Orchestrator 404: run not found' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'missing' }, body })
    expect(res.status).toBe(404)
  })

  it('400 when the kubeconfig has no contexts', async () => {
    listKubeconfigContextsMock.mockReturnValue({ ok: false, error: 'no contexts' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(400)
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('400 + audit failure when sanitizeKubeconfig rejects', async () => {
    sanitizeKubeconfigMock.mockReturnValue({ ok: false, error: 'rejected', rejections: ['bad field'] })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'rejected', rejections: ['bad field'] })
    expect(createClusterMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure', category: 'k8s' }))
  })

  it('success: creates the cluster with the sanitized credential, records the node mapping, audits, returns 201', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })

    expect(listKubeconfigContextsMock).toHaveBeenCalledWith('kc-text')
    expect(sanitizeKubeconfigMock).toHaveBeenCalledWith('kc-text', 'admin@demo')
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({
      name: 'demo',
      distro: 'talos',
      source: 'deployed',
      cred: sanitizedCred,
      proxmoxConnectionId: 'conn-1',
      createdBy: 'u1',
    }))
    expect(recordNodeMappingMock).toHaveBeenCalledWith('new-cluster-id', [
      { name: 'cp-1', vmid: 100, connectionId: 'conn-1' },
      { name: 'wk-1', vmid: 101, connectionId: 'conn-1' },
    ])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', category: 'k8s', resourceId: 'new-cluster-id', resourceName: 'demo', status: 'success',
    }))
    expect(res.status).toBe(201)
    expect(await readJson(res)).toEqual({ clusterId: 'new-cluster-id' })
  })

  it('success with no session: createdBy is null (does not block registration)', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(201)
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({ createdBy: null }))
  })

  it('k3s run: registers the cluster with distro k3s (no talosconfig in outputs)', async () => {
    getProvisionRunMock.mockResolvedValue({
      ok: true,
      value: {
        run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, distro: 'k3s', clusterName: 'demo', connectionId: 'conn-1' },
        outputs: {
          kubeconfig: 'kc-text',
          nodes: [{ name: 'demo-cp-1', role: 'controlplane', vmid: 100, ip: '10.0.0.10' }],
        },
      },
    })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(201)
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({ distro: 'k3s' }))
  })

  it('422 when the run status has no distro (never silently registers as talos)', async () => {
    getProvisionRunMock.mockResolvedValue({
      ok: true,
      value: {
        run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, clusterName: 'demo', connectionId: 'conn-1' },
        outputs: completedRun.outputs,
      },
    })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(422)
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('rke2 run: registers the cluster with distro rke2 (not 422)', async () => {
    getProvisionRunMock.mockResolvedValue({
      ok: true,
      value: {
        run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, distro: 'rke2', clusterName: 'demo', connectionId: 'conn-1' },
        outputs: {
          kubeconfig: 'kc-text',
          nodes: [{ name: 'demo-cp-1', role: 'controlplane', vmid: 100, ip: '10.0.0.10' }],
        },
      },
    })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(201)
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({ distro: 'rke2', source: 'deployed' }))
  })

  it('kubeadm run: registers the cluster with distro kubeadm (not 422)', async () => {
    getProvisionRunMock.mockResolvedValue({
      ok: true,
      value: {
        run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, distro: 'kubeadm', clusterName: 'demo', connectionId: 'conn-1' },
        outputs: {
          kubeconfig: 'kc-text',
          nodes: [{ name: 'demo-cp-1', role: 'controlplane', vmid: 100, ip: '10.0.0.10' }],
        },
      },
    })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(201)
    expect(createClusterMock).toHaveBeenCalledWith('t1', expect.objectContaining({ distro: 'kubeadm', source: 'deployed' }))
  })

  it('422 when the run status carries an unknown distro', async () => {
    getProvisionRunMock.mockResolvedValue({
      ok: true,
      value: {
        run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100, distro: 'microk8s', clusterName: 'demo', connectionId: 'conn-1' },
        outputs: completedRun.outputs,
      },
    })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { params: { runId: 'run-1' }, body })
    expect(res.status).toBe(422)
    expect(createClusterMock).not.toHaveBeenCalled()
  })

  it('recordNodeMapping uses the clusterId returned by createCluster, never a client-supplied id', async () => {
    createClusterMock.mockResolvedValue('server-assigned-id')
    const POST = (await import('./route')).POST
    await callRoute(POST, { params: { runId: 'run-1' }, body: { ...body, clusterId: 'client-supplied-evil-id' } })
    expect(recordNodeMappingMock).toHaveBeenCalledWith('server-assigned-id', expect.anything())
  })
})
