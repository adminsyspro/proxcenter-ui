import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useSnapshots } from './useSnapshots'

const seqMock = vi.fn()
vi.mock('@/lib/migration/deleteSnapshotsSequential', () => ({
  deleteSnapshotsSequential: (...a: any[]) => seqMock(...a),
}))

// selection.id format is connId:node:type:vmid (see InventoryTree.tsx); parseVmId
// reorders it into the connId:type:node:vmid vmKey used by the guests API routes.
const SELECTION = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any

function makeParams(over: Partial<any> = {}) {
  return {
    selection: SELECTION,
    detailTab: 0, // not 5, so the lazy auto-load effect does not fire on mount
    t: (k: string) => k,
    toast: { success: vi.fn(), error: vi.fn() },
    data: { title: 'my-vm' },
    setConfirmAction: vi.fn(),
    setConfirmActionLoading: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  seqMock.mockReset().mockResolvedValue({ ok: true })
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ data: { snapshots: [{ name: 'snap2' }, { name: 'snap1' }, { name: 'current' }], count: 3 } }),
  } as any)
})

describe('useSnapshots.deleteAllSnapshots', () => {
  it('opens a delete-all confirm with the count, then deletes all non-current snapshots and reloads', async () => {
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))

    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })

    expect(params.setConfirmAction).toHaveBeenCalled()
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    expect(confirm.action).toBe('delete-all-snapshots')
    expect(confirm.title).toContain('2') // 2 non-current snapshots

    await act(async () => { await confirm.onConfirm() })
    expect(seqMock).toHaveBeenCalledWith('conn-1:qemu:pve1:100', ['snap2', 'snap1'], expect.any(Function))
    expect(params.toast.success).toHaveBeenCalled()
  })

  it('surfaces an error toast when the sequential delete fails', async () => {
    seqMock.mockResolvedValue({ ok: false, failed: 'snap1', error: 'merge failed' })
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { await confirm.onConfirm() })
    expect(params.toast.error).toHaveBeenCalledWith('merge failed')
  })
})
