import { describe, it, expect, vi, beforeEach } from 'vitest'

const orchestratorFetchMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  orchestratorFetch: (...args: any[]) => orchestratorFetchMock(...args),
}))

import {
  startProvision,
  getProvisionRun,
  getProvisionLogs,
  destroyProvisionRun,
  type ProvisionRequest,
} from './provisionOrchestrator'

const req: ProvisionRequest = {
  distro: 'talos',
  clusterName: 'demo',
  connectionId: 'conn-1',
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
  schematicId: '376567988ad370138ad8b2698212367b8edcb69b5fd68c80be1f2ec7d603b4ba',
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
  orchestratorFetchMock.mockReset()
})

describe('startProvision', () => {
  it('returns ok + value on success and posts to /k8s/provision with the idempotency key in the body', async () => {
    orchestratorFetchMock.mockResolvedValueOnce({ runId: 'run-1', status: 'queued' })

    const r = await startProvision(req, 'idem-key-1')

    expect(r).toEqual({ ok: true, value: { runId: 'run-1', status: 'queued' } })
    // The key travels in the body: the client owns the request headers.
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/k8s/provision', {
      method: 'POST',
      body: { ...req, idempotencyKey: 'idem-key-1' },
    })
  })

  it('returns ok:false with the error message when orchestratorFetch throws', async () => {
    orchestratorFetchMock.mockRejectedValueOnce(new Error('Orchestrator 409: cluster name already active'))

    const r = await startProvision(req, 'idem-key-1')

    expect(r.ok).toBe(false)
    expect(r.error).toBe('Orchestrator 409: cluster name already active')
    expect(r.value).toBeUndefined()
  })

  it('falls back to a generic error when the thrown value has no message', async () => {
    // A non-Error rejection (e.g. a bare object) exercises the `?? fallback` path.
    orchestratorFetchMock.mockRejectedValueOnce({ code: 'WEIRD' })

    const r = await startProvision(req, 'idem-key-1')

    expect(r.ok).toBe(false)
    expect(r.error).toBe('provisioning request failed')
  })
})

describe('getProvisionRun', () => {
  it('returns ok + value on success', async () => {
    const value = { run: { id: 'run-1', status: 'running', phase: 'provisioning', progress: 40 } }
    orchestratorFetchMock.mockResolvedValueOnce(value)

    const r = await getProvisionRun('run-1')

    expect(r).toEqual({ ok: true, value })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/k8s/provision/run-1')
  })

  it('returns ok:false with the error message when orchestratorFetch throws', async () => {
    orchestratorFetchMock.mockRejectedValueOnce(new Error('Orchestrator 404: run not found'))

    const r = await getProvisionRun('missing')

    expect(r.ok).toBe(false)
    expect(r.error).toBe('Orchestrator 404: run not found')
  })
})

describe('getProvisionLogs', () => {
  it('returns ok + value on success and includes the limit query', async () => {
    const value = { logs: [{ level: 'info', message: 'starting', createdAt: '2026-07-02T00:00:00Z' }] }
    orchestratorFetchMock.mockResolvedValueOnce(value)

    const r = await getProvisionLogs('run-1', 50)

    expect(r).toEqual({ ok: true, value })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/k8s/provision/run-1/logs?limit=50')
  })

  it('omits the limit query when limit is 0', async () => {
    orchestratorFetchMock.mockResolvedValueOnce({ logs: [] })

    await getProvisionLogs('run-1', 0)

    expect(orchestratorFetchMock).toHaveBeenCalledWith('/k8s/provision/run-1/logs')
  })

  it('omits the limit query when limit is negative', async () => {
    orchestratorFetchMock.mockResolvedValueOnce({ logs: [] })

    await getProvisionLogs('run-1', -1)

    expect(orchestratorFetchMock).toHaveBeenCalledWith('/k8s/provision/run-1/logs')
  })

  it('returns ok:false with the error message when orchestratorFetch throws', async () => {
    orchestratorFetchMock.mockRejectedValueOnce(new Error('Orchestrator 404: run not found'))

    const r = await getProvisionLogs('missing', 50)

    expect(r.ok).toBe(false)
    expect(r.error).toBe('Orchestrator 404: run not found')
  })
})

describe('destroyProvisionRun', () => {
  it('returns ok + value on success', async () => {
    orchestratorFetchMock.mockResolvedValueOnce({ status: 'destroying' })

    const r = await destroyProvisionRun('run-1')

    expect(r).toEqual({ ok: true, value: { status: 'destroying' } })
    expect(orchestratorFetchMock).toHaveBeenCalledWith('/k8s/provision/run-1/destroy', { method: 'POST' })
  })

  it('returns ok:false with the error message when orchestratorFetch throws', async () => {
    orchestratorFetchMock.mockRejectedValueOnce(new Error('Orchestrator 409: not destroyable'))

    const r = await destroyProvisionRun('run-1')

    expect(r.ok).toBe(false)
    expect(r.error).toBe('Orchestrator 409: not destroyable')
  })
})
