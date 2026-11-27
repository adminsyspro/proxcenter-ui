import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sProvisionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const startProvisionMock = vi.fn()
const auditMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({ startProvision: (...a: any[]) => startProvisionMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))
const provisionTargetMock = vi.fn()
const listClustersMock = vi.fn()
vi.mock('@/lib/k8s/repository', () => ({ listClusters: (...a: any[]) => listClustersMock(...a) }))
vi.mock('@/lib/k8s/provisionAccess', () => ({ requireProvisionTarget: (...a: any[]) => provisionTargetMock(...a) }))

const validBody = {
  clusterName: 'demo',
  connectionId: 'conn-1',
  distro: 'talos',
  pveNode: 'pve1',
  imageDatastore: 'local',
  vmDatastore: 'local-lvm',
  bridge: 'vmbr0',
  vlan: 0,
  subnetPrefix: 24,
  gateway: '10.0.0.1',
  dns: ['1.1.1.1'],
  talosVersion: 'v1.13.5',
  kubernetesVersion: '1.36.2',
  schematicId: 'schema-1',
  controlPlane: [{ name: 'cp-1', ip: '10.0.0.10', vmid: 100 }],
  workers: [],
  cpCores: 2,
  cpMemory: 4096,
  cpDisk: 20,
  workerCores: 2,
  workerMemory: 4096,
  workerDisk: 40,
}

beforeEach(() => {
  listClustersMock.mockReset().mockResolvedValue([{ id: 'x', name: 'other' }])
  provisionTargetMock.mockReset().mockResolvedValue(null)
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  startProvisionMock.mockReset().mockResolvedValue({ ok: true, value: { runId: 'run-1', status: 'queued' } })
  auditMock.mockReset().mockResolvedValue('a1')
})

describe('POST /api/v1/k8s/clusters/provision', () => {
  it('403 when the enterprise/permission guard denies (before checking tenant or calling startProvision)', async () => {
    requireK8sProvisionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(403)
    expect(resolveStrictTenantMock).not.toHaveBeenCalled()
    expect(startProvisionMock).not.toHaveBeenCalled()
  })

  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(403)
    expect(startProvisionMock).not.toHaveBeenCalled()
  })

  it('400 when required fields are missing (clusterName)', async () => {
    const POST = (await import('./route')).POST
    const { clusterName, ...rest } = validBody
    const res = await callRoute(POST, { body: rest })
    expect(res.status).toBe(400)
    expect(startProvisionMock).not.toHaveBeenCalled()
  })

  it('400 when connectionId is missing', async () => {
    const POST = (await import('./route')).POST
    const { connectionId, ...rest } = validBody
    const res = await callRoute(POST, { body: rest })
    expect(res.status).toBe(400)
  })

  it('400 when controlPlane is empty', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: { ...validBody, controlPlane: [] } })
    expect(res.status).toBe(400)
  })

  it('valid body -> calls startProvision, returns 202 {runId,status}, audits success', async () => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(202)
    expect(await readJson(res)).toEqual({ runId: 'run-1', status: 'queued' })
    expect(startProvisionMock).toHaveBeenCalledTimes(1)
    expect(startProvisionMock.mock.calls[0][0]).toEqual(validBody)
    expect(typeof startProvisionMock.mock.calls[0][1]).toBe('string')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'provision', category: 'k8s', resourceName: 'demo', status: 'success',
    }))
  })

  it('uses the X-Idempotency-Key header when supplied instead of generating one', async () => {
    const POST = (await import('./route')).POST
    await callRoute(POST, { body: validBody, headers: { 'X-Idempotency-Key': 'client-key-1' } })
    expect(startProvisionMock).toHaveBeenCalledWith(validBody, 'client-key-1')
  })

  it('generates a distinct idempotency key per call when the header is absent', async () => {
    const POST = (await import('./route')).POST
    await callRoute(POST, { body: validBody })
    await callRoute(POST, { body: validBody })
    const k1 = startProvisionMock.mock.calls[0][1]
    const k2 = startProvisionMock.mock.calls[1][1]
    expect(k1).not.toBe(k2)
  })

  it('maps an "Orchestrator 409" failure to 409 and audits failure', async () => {
    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator 409: cluster name already active' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(409)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }))
  })

  it('checks the caller may create VMs on the target connection before anything reaches the orchestrator', async () => {
    provisionTargetMock.mockResolvedValue(new Response(JSON.stringify({ error: 'connection_not_found' }), { status: 404 }))
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(404)
    expect(provisionTargetMock).toHaveBeenCalledWith('t1', validBody.connectionId, 'create')
    expect(startProvisionMock).not.toHaveBeenCalled()
  })

  it('answers a refusal with the code the UI translates, not the orchestrator text', async () => {
    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator 409: {"error":"another kubernetes deployment is in progress on this proxmox connection","code":"connection_busy"}' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'connection_busy' })
  })

  it('passes on the sentence of a validation refusal and the 422 of a missing SSH access', async () => {
    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator 400: {"error":"invalid provision request: pod cidr 10.42.0.0/16 overlaps the node network 10.42.0.0/24","code":"invalid_request"}' })
    const POST = (await import('./route')).POST
    let res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'invalid_request', message: 'invalid provision request: pod cidr 10.42.0.0/16 overlaps the node network 10.42.0.0/24' })

    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator 422: {"error":"ssh access ...","code":"ssh_access_required"}' })
    res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(422)
    expect(await readJson(res)).toEqual({ error: 'ssh_access_required' })
  })

  it('never passes on the text of an orchestrator fault', async () => {
    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator 500: {"error":"pq: password authentication failed"}' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ error: 'unavailable' })
  })

  it('maps an "Orchestrator 400" failure to 400', async () => {
    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator 400: bad request' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(400)
  })

  it('maps an unrecognized orchestrator failure to 502', async () => {
    startProvisionMock.mockResolvedValue({ ok: false, error: 'Orchestrator unavailable' })
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: validBody })
    expect(res.status).toBe(502)
  })

  it('400 when distro is missing', async () => {
    const POST = (await import('./route')).POST
    const { distro, ...rest } = validBody as any
    const res = await callRoute(POST, { body: rest })
    expect(res.status).toBe(400)
    expect(startProvisionMock).not.toHaveBeenCalled()
  })

  it.each(['nonsense', 'Talos', ''])('400 when distro is %j (not provisionable)', async bad => {
    const POST = (await import('./route')).POST
    const res = await callRoute(POST, { body: { ...validBody, distro: bad } })
    expect(res.status).toBe(400)
    expect(startProvisionMock).not.toHaveBeenCalled()
  })

  it('202 for a k3s body: proxies it to startProvision unchanged', async () => {
    const POST = (await import('./route')).POST
    const k3sBody = {
      ...validBody,
      distro: 'k3s',
      talosVersion: undefined,
      kubernetesVersion: undefined,
      schematicId: undefined,
      k3sVersion: 'v1.36.2+k3s1',
      osImageUrl: 'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img',
      osImageChecksum: '5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44',
      snippetDatastore: 'local',
    }
    const res = await callRoute(POST, { body: k3sBody })
    expect(res.status).toBe(202)
    expect(startProvisionMock.mock.calls[0][0]).toMatchObject({ distro: 'k3s', snippetDatastore: 'local' })
  })

  it('202 for an rke2 body: proxies it to startProvision unchanged', async () => {
    const POST = (await import('./route')).POST
    const rke2Body = {
      ...validBody,
      distro: 'rke2',
      talosVersion: undefined,
      kubernetesVersion: undefined,
      schematicId: undefined,
      rke2Version: 'v1.35.6+rke2r1',
      osImageUrl: 'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img',
      osImageChecksum: '5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44',
      snippetDatastore: 'local',
    }
    const res = await callRoute(POST, { body: rke2Body })
    expect(res.status).toBe(202)
    expect(startProvisionMock.mock.calls[0][0]).toMatchObject({ distro: 'rke2', snippetDatastore: 'local' })
  })

  it('202 for a kubeadm body: proxies it to startProvision unchanged', async () => {
    const POST = (await import('./route')).POST
    const kubeadmBody = {
      ...validBody,
      distro: 'kubeadm',
      talosVersion: undefined,
      kubernetesVersion: undefined,
      schematicId: undefined,
      kubeadmVersion: '1.34.9',
      cni: 'calico',
      controlPlaneVip: '10.17.17.108',
      podCIDR: '10.244.0.0/16',
      osImageUrl: 'https://cloud-images.ubuntu.com/releases/noble/release/ubuntu-24.04-server-cloudimg-amd64.img',
      osImageChecksum: '5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44',
      snippetDatastore: 'local',
    }
    const res = await callRoute(POST, { body: kubeadmBody })
    expect(res.status).toBe(202)
    expect(startProvisionMock.mock.calls[0][0]).toMatchObject({ distro: 'kubeadm', controlPlaneVip: '10.17.17.108', snippetDatastore: 'local' })
  })

  it('409 when a cluster of the tenant already holds the name, before anything is deployed', async () => {
    listClustersMock.mockResolvedValue([{ id: 'x', name: validBody.clusterName }])
    const res = await callRoute((await import('./route')).POST, { body: validBody })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'cluster_name_taken' })
    expect(startProvisionMock).not.toHaveBeenCalled()
  })
})
