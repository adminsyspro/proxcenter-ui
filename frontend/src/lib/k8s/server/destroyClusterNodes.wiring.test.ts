import { describe, it, expect, vi, beforeEach } from 'vitest'

const pveFetchMock = vi.fn()
const locateMock = vi.fn()
const getConnectionMock = vi.fn()
const getNodeMappingMock = vi.fn()
const releaseMock = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/locateVm', () => ({
  locateVmInCluster: (...a: any[]) => locateMock(...a),
  isVmConfigNotFoundError: (e: any) => /does not exist/.test(String(e?.message ?? e)),
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: any[]) => getConnectionMock(...a) }))
vi.mock('@/lib/k8s/repository', () => ({ getNodeMapping: (...a: any[]) => getNodeMappingMock(...a) }))
vi.mock('@/lib/vdc/ipam', () => ({ releaseAllocationsForVm: (...a: any[]) => releaseMock(...a) }))

import { destroyClusterNodes, checkNodeVms } from './destroyClusterNodes'

const conn = { id: 'conn-a' }
const config = (name: string) => ({ name, tags: 'proxcenter;dev', cicustom: 'user=local:snippets/dev.yaml' })

beforeEach(() => {
  pveFetchMock.mockReset()
  locateMock.mockReset()
  getConnectionMock.mockReset().mockResolvedValue(conn)
  getNodeMappingMock.mockReset().mockResolvedValue([
    { nodeName: 'dev-cp-1', connectionId: 'conn-a', vmid: 9001 },
    { nodeName: 'dev-worker-1', connectionId: 'conn-a', vmid: 9002 },
  ])
  releaseMock.mockReset().mockResolvedValue(undefined)
})

describe('destroyClusterNodes against the Proxmox API', () => {
  it('stops and deletes each node VM, removes its snippet and its addresses, one connection lookup', async () => {
    locateMock.mockImplementation(async (_c: any, vmid: number) => ({ node: 'pve1', status: vmid === 9001 ? 'running' : 'stopped' }))
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/9001/config')) return config('dev-cp-1')
      if (path.endsWith('/9002/config')) return config('dev-worker-1')
      if (path.endsWith('/status/current')) return { status: 'stopped' }
      return null
    })
    const out = await destroyClusterNodes('t1', 'c1', 'dev')
    expect(out.allOk).toBe(true)
    expect(out.results.map(r => r.status)).toEqual(['destroyed', 'destroyed'])
    const calls = pveFetchMock.mock.calls.map(c => `${c[2]?.method ?? 'GET'} ${c[1]}`)
    expect(calls).toContain('POST /nodes/pve1/qemu/9001/status/stop')
    expect(calls).not.toContain('POST /nodes/pve1/qemu/9002/status/stop')
    expect(calls).toContain('DELETE /nodes/pve1/qemu/9002?purge=1&destroy-unreferenced-disks=1')
    expect(calls).toContain(`DELETE /nodes/pve1/storage/local/content/${encodeURIComponent('local:snippets/dev.yaml')}`)
    expect(releaseMock).toHaveBeenCalledWith('conn-a', 9001)
    expect(getConnectionMock).toHaveBeenCalledTimes(1)
    expect(getConnectionMock).toHaveBeenCalledWith('conn-a', 't1')
  })

  it('touches no VM at all when one of them now carries another name', async () => {
    locateMock.mockResolvedValue({ node: 'pve1', status: 'running' })
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/9001/config')) return config('dev-cp-1')
      if (path.endsWith('/9002/config')) return config('web-01')
      return null
    })
    const out = await destroyClusterNodes('t1', 'c1', 'dev')
    expect(out.allOk).toBe(false)
    expect(out.results.map(r => r.status)).toEqual(['kept', 'error'])
    expect(pveFetchMock.mock.calls.every(c => !c[2]?.method)).toBe(true)
  })

  it('reports a connection that cannot be read as an error on its nodes', async () => {
    getConnectionMock.mockRejectedValue(new Error('connection not found'))
    const out = await destroyClusterNodes('t1', 'c1', 'dev')
    expect(out.allOk).toBe(false)
    expect(out.results[0].error).toBe('connection not found')
  })
})

describe('checkNodeVms', () => {
  it('names the VMs that are no longer the deployed node, without touching any', async () => {
    locateMock.mockImplementation(async (_c: any, vmid: number) => (vmid === 9003 ? null : { node: 'pve1', status: 'running' }))
    pveFetchMock.mockImplementation(async (_c: any, path: string) => (path.endsWith('/9001/config') ? config('dev-worker-1') : config('web-01')))
    const out = await checkNodeVms('t1', [
      { nodeName: 'dev-worker-1', connectionId: 'conn-a', vmid: 9001 },
      { nodeName: 'dev-worker-2', connectionId: 'conn-a', vmid: 9002 },
      { nodeName: 'dev-worker-3', connectionId: 'conn-a', vmid: 9003 },
    ], 'dev')
    expect(out.map(r => r.refusal === null)).toEqual([true, false, true])
    expect(pveFetchMock.mock.calls.every(c => !c[2]?.method)).toBe(true)
    expect(getConnectionMock).toHaveBeenCalledTimes(1)
  })
  it('a connection that cannot be read refuses', async () => {
    getConnectionMock.mockRejectedValue(new Error('connection not found'))
    const out = await checkNodeVms('t1', [{ nodeName: 'dev-worker-1', connectionId: 'conn-a', vmid: 9001 }], 'dev')
    expect(out[0].refusal).toBe('connection not found')
  })
})
