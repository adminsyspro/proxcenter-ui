import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useHardwareHandlers } from './useHardwareHandlers'

const fetchDetailsMock = vi.fn()
const putGuestConfigMock = vi.fn()

vi.mock('../helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('../helpers')>()

  return { ...actual, fetchDetails: (...a: any[]) => fetchDetailsMock(...a) }
})

vi.mock('@/lib/proxmox/guestConfigClient', () => ({
  putGuestConfig: (...a: any[]) => putGuestConfigMock(...a),
}))

const VM_A = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any
const VM_B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
const CLUSTER_A = { type: 'cluster', id: 'connA' } as any
const CLUSTER_B = { type: 'cluster', id: 'connB' } as any

function makeParams(selection: any, setData = vi.fn()) {
  return {
    selection,
    data: null,
    setData,
    t: (k: string) => k,
    selectedDisk: { id: 'scsi0' },
    setSelectedDisk: vi.fn(),
    selectedNetwork: { id: 'net0' },
    setSelectedNetwork: vi.fn(),
    activeDialog: 'none' as any,
    setActiveDialog: vi.fn(),
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchDetailsMock.mockReset()
  putGuestConfigMock.mockReset().mockResolvedValue(undefined)
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: {} }) } as any)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useHardwareHandlers post-write reload', () => {
  it('writes the config then shows the reloaded details of the guest still displayed', async () => {
    fetchDetailsMock.mockResolvedValue({ title: 'vm-a' })
    const setData = vi.fn()
    const { result } = renderHook(() => useHardwareHandlers(makeParams(VM_A, setData)))

    await act(async () => { await result.current.handleSaveNetwork({ net1: 'virtio,bridge=vmbr0' }) })

    expect(putGuestConfigMock).toHaveBeenCalledWith('conn-1', 'qemu', 'pve1', '100', { net1: 'virtio,bridge=vmbr0' }, expect.any(Object))
    expect(fetchDetailsMock).toHaveBeenCalledWith(VM_A, expect.any(AbortSignal))
    expect(setData).toHaveBeenCalledWith({ title: 'vm-a' })
  })

  it('never paints the guest it wrote to over the guest selected meanwhile', async () => {
    let releaseWrite!: () => void
    putGuestConfigMock.mockImplementation(() => new Promise<void>(r => { releaseWrite = r }))
    fetchDetailsMock.mockResolvedValue({ title: 'vm-a' })
    const setData = vi.fn()
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(VM_A, setData) })

    let pending!: Promise<void>
    act(() => { pending = result.current.handleSaveScsiController('virtio-scsi-single') })

    rerender(makeParams(VM_B, setData))
    await act(async () => { releaseWrite(); await pending })

    // The write itself was sent and completed; only its reload was skipped.
    expect(putGuestConfigMock).toHaveBeenCalledTimes(1)
    expect(fetchDetailsMock).not.toHaveBeenCalled()
    expect(setData).not.toHaveBeenCalled()
  })

  it('drops a reload answered after the switch, including its failure', async () => {
    let failReload!: (e: Error) => void
    fetchDetailsMock.mockImplementation(() => new Promise((_r, rej) => { failReload = rej }))
    const setData = vi.fn()
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(VM_A, setData) })

    let pending!: Promise<void>
    await act(async () => { pending = result.current.handleDeleteNetwork(); await Promise.resolve(); await Promise.resolve() })
    await waitFor(() => expect(fetchDetailsMock).toHaveBeenCalled())
    const signal = fetchDetailsMock.mock.calls[0][1] as AbortSignal

    rerender(makeParams(VM_B, setData))
    expect(signal.aborted).toBe(true)
    await act(async () => { failReload(new Error('AbortError')); await expect(pending).resolves.toBeUndefined() })
    expect(setData).not.toHaveBeenCalled()
  })

  it('still reports a reload failure of the guest displayed', async () => {
    fetchDetailsMock.mockRejectedValue(new Error('reload failed'))
    const { result } = renderHook(() => useHardwareHandlers(makeParams(VM_A)))

    await expect(result.current.handleSaveDisk({ scsi1: 'local:4' })).rejects.toThrow('reload failed')
  })
})

describe('useHardwareHandlers selection-bound loaders', () => {
  it('drops the cluster HA of A when it answers after the switch to B, and lets B load', async () => {
    let releaseA!: () => void
    const gate = new Promise<void>(r => { releaseA = r })
    fetchSpy.mockImplementation(async (input: any) => {
      if (String(input).includes('connA')) {
        await gate

        return { ok: true, json: async () => ({ data: { resources: [{ sid: 'vm:100' }] } }) } as any
      }

      return { ok: true, json: async () => ({ data: { resources: [{ sid: 'vm:200' }] } }) } as any
    })
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(CLUSTER_A) })

    act(() => { void result.current.loadClusterHa('connA') })
    expect(result.current.clusterHaLoading).toBe(true)

    rerender(makeParams(CLUSTER_B))
    // The loading flag abandoned by A is released so B's lazy load can start.
    await waitFor(() => expect(result.current.clusterHaLoading).toBe(false))
    await act(async () => { await result.current.loadClusterHa('connB') })
    expect(result.current.clusterHaResources).toEqual([{ sid: 'vm:200' }])

    await act(async () => { releaseA(); await gate; await Promise.resolve() })
    expect(result.current.clusterHaResources).toEqual([{ sid: 'vm:200' }])
  })

  it.each([
    ['loadClusterConfig', 'clusterConfig'],
    ['loadClusterNotes', 'clusterNotesContent'],
    ['loadClusterCeph', 'clusterCephData'],
    ['loadClusterStorage', 'clusterStorageData'],
  ])('%s never writes the previous cluster data', async (loader, field) => {
    let releaseA!: () => void
    const gate = new Promise<void>(r => { releaseA = r })
    fetchSpy.mockImplementation(async () => {
      await gate

      return { ok: true, json: async () => ({ data: { description: 'notes of A', owner: 'A' } }) } as any
    })
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(CLUSTER_A) })
    const before = (result.current as any)[field]

    let pending!: Promise<void>
    act(() => { pending = (result.current as any)[loader]('connA') })
    rerender(makeParams(CLUSTER_B))
    await act(async () => { releaseA(); await pending })

    expect((result.current as any)[field]).toEqual(before)
  })

  it.each([
    ['loadClusterHa', 'clusterHaLoaded'],
    ['loadClusterCeph', 'clusterCephData'],
    ['loadClusterStorage', 'clusterStorageData'],
  ])('%s keeps its failure to itself once the cluster is left', async (loader, field) => {
    let failA!: (e: Error) => void
    fetchSpy.mockImplementation(() => new Promise((_r, rej) => { failA = rej }) as any)
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(CLUSTER_A) })
    const before = (result.current as any)[field]

    let pending!: Promise<void>
    act(() => { pending = (result.current as any)[loader]('connA') })
    rerender(makeParams(CLUSTER_B))
    await act(async () => { failA(new Error('boom')); await pending })

    expect((result.current as any)[field]).toEqual(before)
  })

  it('drops the backups of the previous guest', async () => {
    let releaseA!: () => void
    const gate = new Promise<void>(r => { releaseA = r })
    fetchSpy.mockImplementation(async () => {
      await gate

      return { ok: true, json: async () => ({ data: { backups: [{ volid: 'backup-of-A' }] } }) } as any
    })
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(VM_A) })

    let pending!: Promise<void>
    act(() => { pending = result.current.loadBackups('100', 'qemu', 'conn-1', { node: 'pve1' }) })
    expect(result.current.backupsLoading).toBe(true)

    rerender(makeParams(VM_B))
    await act(async () => { releaseA(); await pending })

    expect(result.current.backups).toEqual([])
    expect(result.current.backupsLoading).toBe(false)
  })

  it('loads the backups of the guest displayed', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: { backups: [{ volid: 'b1' }], vzdumpScanned: true } }) } as any)
    const { result } = renderHook(() => useHardwareHandlers(makeParams(VM_A)))

    await act(async () => { await result.current.loadBackups('100', 'qemu', 'conn-1', { node: 'pve1', scanVzdump: true }) })
    expect(result.current.backups).toEqual([{ volid: 'b1' }])
    expect(String(fetchSpy.mock.calls.at(-1)![0])).toContain('scanVzdump=1')
  })

  it.each([
    ['handleEditDisk', ['local:8']],
    ['handleDetachDisk', []],
    ['handleResizeDisk', ['+1G']],
    ['handleMoveDisk', ['ceph', true]],
  ])('%s reloads the details of the guest displayed after its write', async (handler, args) => {
    fetchDetailsMock.mockResolvedValue({ title: 'vm-a' })
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: { scsi0: 'local:vm-100-disk-0' } }) } as any)
    const setData = vi.fn()
    const { result } = renderHook(() => useHardwareHandlers(makeParams(VM_A, setData)))

    await act(async () => { await (result.current as any)[handler](...args) })
    expect(setData).toHaveBeenCalledWith({ title: 'vm-a' })
  })

  it.each([
    ['loadClusterConfig', 'clusterConfig', { nodes: ['pve1'] }],
    ['loadClusterCeph', 'clusterCephData', { nodes: ['pve1'] }],
    ['loadClusterStorage', 'clusterStorageData', { nodes: ['pve1'] }],
  ])('%s fills the state of the cluster displayed', async (loader, field, body) => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: body }) } as any)
    const { result } = renderHook(() => useHardwareHandlers(makeParams(CLUSTER_A)))

    await act(async () => { await (result.current as any)[loader]('connA') })
    expect((result.current as any)[field]).toEqual(body)
  })

  it('loadClusterNotes fills the datacenter notes of the cluster displayed', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: { description: 'dc notes' } }) } as any)
    const { result } = renderHook(() => useHardwareHandlers(makeParams(CLUSTER_A)))

    await act(async () => { await result.current.loadClusterNotes('connA') })
    expect(result.current.clusterNotesContent).toBe('dc notes')
  })

  it.each(['loadClusterHa', 'loadClusterConfig', 'loadClusterNotes', 'loadClusterCeph', 'loadClusterStorage'])(
    '%s handles an API error and a network failure of the cluster displayed',
    async loader => {
      fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ error: 'denied' }) } as any)
      const { result } = renderHook(() => useHardwareHandlers(makeParams(CLUSTER_A)))

      await act(async () => { await (result.current as any)[loader]('connA') })
      fetchSpy.mockRejectedValue(new Error('pve down'))
      await act(async () => { await (result.current as any)[loader]('connA') })

      expect(console.error).toHaveBeenCalled()
    },
  )

  it('surfaces the backup listing error of the guest displayed', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ error: 'pbs down' }) } as any)
    const { result } = renderHook(() => useHardwareHandlers(makeParams(VM_A)))

    await act(async () => { await result.current.loadBackups('100', 'lxc', 'conn-1') })
    expect(result.current.backupsError).toBe('pbs down')

    fetchSpy.mockRejectedValue(new Error('network down'))
    await act(async () => { await result.current.loadBackups('100', 'qemu') })
    expect(result.current.backupsError).toBe('network down')
  })

  it('drops the backup listing error of the previous guest', async () => {
    let failA!: (e: Error) => void
    fetchSpy.mockImplementation(() => new Promise((_r, rej) => { failA = rej }) as any)
    const { result, rerender } = renderHook(p => useHardwareHandlers(p), { initialProps: makeParams(VM_A) })

    let pending!: Promise<void>
    act(() => { pending = result.current.loadBackups('100', 'qemu', 'conn-1') })
    rerender(makeParams(VM_B))
    await act(async () => { failA(new Error('A failed')); await pending })
    expect(result.current.backupsError).toBeNull()
  })
})
