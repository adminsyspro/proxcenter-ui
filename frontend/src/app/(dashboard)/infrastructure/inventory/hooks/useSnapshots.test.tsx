import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

import { useSnapshots } from './useSnapshots'

const seqMock = vi.fn()
vi.mock('@/lib/migration/deleteSnapshotsSequential', () => ({
  deleteSnapshotsSequential: (...a: any[]) => seqMock(...a),
}))

const waitMock = vi.fn()
vi.mock('@/lib/proxmox/waitForTaskClient', () => ({
  waitForPveTask: (...a: any[]) => waitMock(...a),
}))

// selection.id format is connId:node:type:vmid (see InventoryTree.tsx); parseVmId
// reorders it into the connId:type:node:vmid vmKey used by the guests API routes.
const SELECTION = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any

const UPID = 'UPID:pve1:0001A2B3:04C5D6E7:65F01234:qmdelsnapshot:100:root@pam:'

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

/**
 * URL-aware fetch mock: DELETE/POST answer with the given bodies, snapshot-list
 * GETs walk through `lists` (the last entry repeats). Returns a counter so
 * tests can assert how many list reloads actually happened.
 */
function mockGuestFetch(plan: { lists: any[][]; deleteBody?: any; postBody?: any }) {
  let listCalls = 0
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input)
    if (url.includes('/inventory/poll')) {
      return { ok: true, json: async () => ({}) } as any
    }
    if (init?.method === 'DELETE') {
      return { ok: true, json: async () => (plan.deleteBody ?? { data: { success: true, upid: UPID } }) } as any
    }
    if (init?.method === 'POST') {
      return { ok: true, json: async () => (plan.postBody ?? { data: { success: true, upid: UPID } }) } as any
    }
    const idx = Math.min(listCalls, plan.lists.length - 1)
    listCalls++
    return { ok: true, json: async () => ({ data: { snapshots: plan.lists[idx] } }) } as any
  })
  return { getListCalls: () => listCalls }
}

/** Drain chained microtasks (fake timers do not flush deep promise chains). */
async function flushAsync(times = 25) {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

async function confirmDelete(result: any, params: any, name = 'snap1') {
  await act(async () => { await result.current.deleteSnapshot(name) })
  const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
  await act(async () => { await confirm.onConfirm() })
  return confirm
}

beforeEach(() => {
  seqMock.mockReset().mockResolvedValue({ ok: true })
  waitMock.mockReset().mockResolvedValue({ outcome: 'ok' })
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
    // A halted run must not leave the snapshots it never reached flagged.
    expect(result.current.snapshotRowTasks).toEqual({})
    expect(result.current.snapshotTaskBusy).toBe(false)
  })

  it('closes the confirm immediately and flags every row instead of blocking the tab', async () => {
    let resolveRun!: (v: any) => void
    seqMock.mockImplementation(() => new Promise((r) => { resolveRun = r }))

    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { void confirm.onConfirm(); await flushAsync() })

    // The dialog is gone before the run finishes, and no blocking overlay.
    expect(params.setConfirmAction).toHaveBeenLastCalledWith(null)
    expect(params.setConfirmActionLoading).toHaveBeenLastCalledWith(false)
    expect(result.current.snapshotActionBusy).toBe(false)
    // ... but the other snapshot actions stay gated (PVE holds the VM lock).
    expect(result.current.snapshotTaskBusy).toBe(true)
    expect(result.current.deleteAllBusy).toBe(true)
    expect(result.current.snapshotRowTasks).toEqual({ snap2: 'delete', snap1: 'delete' })

    await act(async () => { resolveRun({ ok: true }); await flushAsync() })
    expect(result.current.snapshotRowTasks).toEqual({})
    expect(result.current.snapshotTaskBusy).toBe(false)
    expect(result.current.deleteAllBusy).toBe(false)
  })

  it('drops each row as soon as its own delete completes', async () => {
    mockGuestFetch({ lists: [[{ name: 'snap2' }, { name: 'snap1' }, { name: 'current' }], [{ name: 'current' }]] })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    seqMock.mockImplementation(async (_vmKey: string, names: string[], cb: any) => {
      cb(names[0], 'done')
      await gate
      cb(names[1], 'done')
      return { ok: true }
    })

    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { void confirm.onConfirm(); await flushAsync() })

    // snap2 is really gone (the route waited for its PVE task), snap1 is not.
    expect(result.current.snapshots.map((s: any) => s.name)).toEqual(['snap1', 'current'])
    expect(result.current.snapshotRowTasks).toEqual({ snap1: 'delete' })
    expect(result.current.deleteAllProgress).toEqual({ done: 1, total: 2 })

    await act(async () => { release(); await flushAsync() })
    expect(result.current.snapshots.map((s: any) => s.name)).toEqual(['current'])
    expect(result.current.snapshotRowTasks).toEqual({})
    expect(result.current.deleteAllProgress).toEqual({ done: 2, total: 2 })
  })

  it('advances delete-all progress as each snapshot completes', async () => {
    seqMock.mockImplementation(async (_vmKey: string, names: string[], cb: any) => {
      names.forEach((n) => cb(n, 'done'))
      return { ok: true }
    })
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { await confirm.onConfirm() })

    expect(result.current.deleteAllProgress).toEqual({ done: 2, total: 2 })
    expect(params.toast.success).toHaveBeenCalled()
  })

  it('surfaces an error toast when the sequential delete throws', async () => {
    seqMock.mockRejectedValue(new Error('boom'))
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { await confirm.onConfirm() })
    expect(params.toast.error).toHaveBeenCalledWith('boom')
  })

  it('falls back to a generic error message when the failure carries no detail', async () => {
    seqMock.mockResolvedValue({ ok: false, failed: 'snap1' })
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { await confirm.onConfirm() })
    expect(params.toast.error).toHaveBeenCalledWith('errors.deleteError')
  })

  it('falls back to a generic error message when the thrown error has no message', async () => {
    seqMock.mockRejectedValue({})
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    await act(async () => { await confirm.onConfirm() })
    expect(params.toast.error).toHaveBeenCalledWith('errors.deleteError')
  })

  it('does nothing when the selection is not a VM', () => {
    const params = makeParams({ selection: { type: 'node', id: 'conn-1:pve1' } })
    const { result } = renderHook(() => useSnapshots(params))
    act(() => { result.current.deleteAllSnapshots() })
    expect(params.setConfirmAction).not.toHaveBeenCalled()
  })

  it('does nothing when there are no non-current snapshots', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: { snapshots: [{ name: 'current' }], count: 1 } }),
    } as any)
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    act(() => { result.current.deleteAllSnapshots() })
    expect(params.setConfirmAction).not.toHaveBeenCalled()
  })

  it('labels the confirm with a fallback name when the VM has no title', async () => {
    const params = makeParams({ data: {} })
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    await waitFor(() => expect(result.current.snapshots.length).toBe(3))

    act(() => { result.current.deleteAllSnapshots() })
    expect(params.setConfirmAction).toHaveBeenCalled()
  })
})

/* ------------------------------------------------------------------ */
/* #627 — snapshot actions must follow the PVE task to its real end    */
/* ------------------------------------------------------------------ */

describe('useSnapshots task follow (#627)', () => {
  it('clears the deleted snapshot after the task ends, even when the 2s refresh was too early', async () => {
    vi.useFakeTimers()
    try {
      const { getListCalls } = mockGuestFetch({
        lists: [
          [{ name: 'snap1' }, { name: 'current' }], // initial load
          [{ name: 'snap1' }, { name: 'current' }], // T+2s blind refresh: merge still running
          [{ name: 'current' }],                    // authoritative reload once the task ended
        ],
      })
      let resolveTask!: (v: any) => void
      waitMock.mockImplementation(() => new Promise((r) => { resolveTask = r }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.loadSnapshots() })
      expect(result.current.snapshots.map((s: any) => s.name)).toContain('snap1')

      await confirmDelete(result, params)

      // The task is still running: no success claim yet, the row is flagged.
      expect(params.toast.success).not.toHaveBeenCalled()
      expect(result.current.snapshotRowTasks).toEqual({ snap1: 'delete' })

      // T+2s blind refresh: PVE still lists the snapshot — the #627 bug window.
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); await flushAsync() })
      expect(result.current.snapshots.map((s: any) => s.name)).toContain('snap1')

      // The delete task finally ends OK → the follow reloads and drops the row.
      await act(async () => { resolveTask({ outcome: 'ok' }); await flushAsync() })
      expect(result.current.snapshots.map((s: any) => s.name)).not.toContain('snap1')
      expect(result.current.snapshotRowTasks).toEqual({})
      expect(params.toast.success).toHaveBeenCalledTimes(1)
      expect(params.toast.success).toHaveBeenCalledWith('inventory.snapshotDeleted')
      expect(getListCalls()).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags the snapshot as deleting while the task runs, without duplicates', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      const resolvers: Array<(v: any) => void> = []
      waitMock.mockImplementation(() => new Promise((r) => { resolvers.push(r) }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      const confirm = await confirmDelete(result, params)
      expect(result.current.snapshotRowTasks).toEqual({ snap1: 'delete' })

      // A second delete of the same name must not duplicate the flag.
      await act(async () => { await confirm.onConfirm() })
      expect(result.current.snapshotRowTasks).toEqual({ snap1: 'delete' })

      await act(async () => { resolvers.forEach((r) => r({ outcome: 'ok' })); await flushAsync() })
      expect(result.current.snapshotRowTasks).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds snapshotTaskBusy while any snapshot task runs, so the VM config lock cannot be hit', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      let resolveTask!: (v: any) => void
      waitMock.mockImplementation(() => new Promise((r) => { resolveTask = r }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      expect(result.current.snapshotTaskBusy).toBe(false)

      // The row flag only marks the created row; snapshotTaskBusy is what
      // gates the whole tab (any other snapshot action would hit the lock).
      await act(async () => { result.current.setNewSnapshotName('snap2') })
      await act(async () => { await result.current.createSnapshot() })
      expect(result.current.snapshotTaskBusy).toBe(true)
      expect(result.current.snapshotRowTasks).toEqual({ snap2: 'create' })

      await act(async () => { resolveTask({ outcome: 'ok' }); await flushAsync() })
      expect(result.current.snapshotTaskBusy).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces the exact PVE exitstatus and still reloads when the task fails', async () => {
    vi.useFakeTimers()
    try {
      const { getListCalls } = mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      waitMock.mockResolvedValue({ outcome: 'failed', error: "VM 100 qmp command 'blockdev-del' failed" })

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.loadSnapshots() })
      await confirmDelete(result, params)
      await act(async () => { await flushAsync() })

      expect(params.toast.error).toHaveBeenCalledWith("VM 100 qmp command 'blockdev-del' failed")
      expect(params.toast.success).not.toHaveBeenCalled()
      expect(result.current.snapshotRowTasks).toEqual({})
      expect(getListCalls()).toBe(2) // initial load + post-task reload
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the generic delete error when the failure carries no detail', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      waitMock.mockResolvedValue({ outcome: 'failed', error: '' })

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await confirmDelete(result, params)
      await act(async () => { await flushAsync() })

      expect(params.toast.error).toHaveBeenCalledWith('errors.deleteError')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays silent on timeout but reloads and un-flags the snapshot', async () => {
    vi.useFakeTimers()
    try {
      const { getListCalls } = mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      waitMock.mockResolvedValue({ outcome: 'timeout' })

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.loadSnapshots() })
      await confirmDelete(result, params)
      await act(async () => { await flushAsync() })

      // No toast: the reload tells the truth (the row stays if PVE still lists it).
      expect(params.toast.success).not.toHaveBeenCalled()
      expect(params.toast.error).not.toHaveBeenCalled()
      expect(result.current.snapshotRowTasks).toEqual({})
      expect(getListCalls()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('touches nothing when the follow is abandoned (user left the VM)', async () => {
    vi.useFakeTimers()
    try {
      const { getListCalls } = mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      waitMock.mockResolvedValue({ outcome: 'abandoned' })

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.loadSnapshots() })
      await confirmDelete(result, params)
      await act(async () => { await flushAsync() })

      expect(params.toast.success).not.toHaveBeenCalled()
      expect(params.toast.error).not.toHaveBeenCalled()
      expect(result.current.snapshots.map((s: any) => s.name)).toContain('snap1')
      expect(getListCalls()).toBe(1) // only the initial load, no reload
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the legacy toast + 2s refresh when the response carries no UPID', async () => {
    vi.useFakeTimers()
    try {
      const { getListCalls } = mockGuestFetch({
        lists: [[{ name: 'snap1' }, { name: 'current' }], [{ name: 'current' }]],
        deleteBody: { data: { success: true } }, // no upid at all
      })
      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.loadSnapshots() })
      await confirmDelete(result, params)

      expect(waitMock).not.toHaveBeenCalled()
      expect(params.toast.success).toHaveBeenCalledWith('inventory.snapshotDeleted')
      expect(result.current.snapshotRowTasks).toEqual({})

      await act(async () => { await vi.advanceTimersByTimeAsync(2000); await flushAsync() })
      expect(getListCalls()).toBe(2)
      expect(result.current.snapshots.map((s: any) => s.name)).not.toContain('snap1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a non-UPID string the same as a missing UPID', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({
        lists: [[{ name: 'snap1' }, { name: 'current' }]],
        deleteBody: { data: { success: true, upid: 'not-a-upid' } },
      })
      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await confirmDelete(result, params)

      expect(waitMock).not.toHaveBeenCalled()
      expect(params.toast.success).toHaveBeenCalledWith('inventory.snapshotDeleted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('createSnapshot follows the returned UPID and toasts only when the task ends OK', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'new-snap' }, { name: 'current' }]] })
      let resolveTask!: (v: any) => void
      waitMock.mockImplementation(() => new Promise((r) => { resolveTask = r }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      act(() => { result.current.setNewSnapshotName('new-snap') })
      await act(async () => { await result.current.createSnapshot() })

      expect(params.toast.success).not.toHaveBeenCalled()
      expect(waitMock).toHaveBeenCalledTimes(1)
      const [connId, node, upid, opts] = waitMock.mock.calls[0]
      expect([connId, node, upid]).toEqual(['conn-1', 'pve1', UPID])
      expect(opts.shouldContinue()).toBe(true) // selection unchanged

      await act(async () => { resolveTask({ outcome: 'ok' }); await flushAsync() })
      expect(params.toast.success).toHaveBeenCalledWith('inventory.snapshotCreated')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rollbackSnapshot follows the returned UPID and toasts only when the task ends OK', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      let resolveTask!: (v: any) => void
      waitMock.mockImplementation(() => new Promise((r) => { resolveTask = r }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.rollbackSnapshot('snap1') })
      const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
      expect(confirm.action).toBe('restore-snapshot')
      await act(async () => { await confirm.onConfirm() })

      expect(params.toast.success).not.toHaveBeenCalled()
      expect(waitMock).toHaveBeenCalledWith('conn-1', 'pve1', UPID, expect.objectContaining({ shouldContinue: expect.any(Function) }))
      // The inventory poll nudge stays in place.
      const fetchCalls = (global.fetch as any).mock.calls.map((c: any[]) => String(c[0]))
      expect(fetchCalls.some((u: string) => u.includes('/inventory/poll'))).toBe(true)

      await act(async () => { resolveTask({ outcome: 'ok' }); await flushAsync() })
      expect(params.toast.success).toHaveBeenCalledWith('inventory.snapshotRestored')
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags the created snapshot as in progress while qmsnapshot runs, then clears it', async () => {
    vi.useFakeTimers()
    try {
      // PVE writes the snapshot into the VM config before the task ends, so
      // the early refresh already lists the row — only the row flag tells the
      // user the snapshot is not done yet (the user-reported gap).
      mockGuestFetch({ lists: [[{ name: 'new-snap' }, { name: 'current' }]] })
      let resolveTask!: (v: any) => void
      waitMock.mockImplementation(() => new Promise((r) => { resolveTask = r }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      act(() => { result.current.setNewSnapshotName('  new-snap  ') })
      await act(async () => { await result.current.createSnapshot() })

      // The form was reset on success, but the trimmed name stays flagged.
      expect(result.current.newSnapshotName).toBe('')
      expect(result.current.snapshotRowTasks).toEqual({ 'new-snap': 'create' })

      await act(async () => { resolveTask({ outcome: 'ok' }); await flushAsync() })
      expect(result.current.snapshotRowTasks).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  it('flags the restored snapshot as in progress while the rollback task runs, then clears it', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      let resolveTask!: (v: any) => void
      waitMock.mockImplementation(() => new Promise((r) => { resolveTask = r }))

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await act(async () => { await result.current.rollbackSnapshot('snap1') })
      const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
      await act(async () => { await confirm.onConfirm() })

      expect(result.current.snapshotRowTasks).toEqual({ snap1: 'rollback' })

      await act(async () => { resolveTask({ outcome: 'ok' }); await flushAsync() })
      expect(result.current.snapshotRowTasks).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  it('createSnapshot without a UPID keeps the legacy path and never flags the row', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({
        lists: [[{ name: 'current' }]],
        postBody: { data: { success: true } }, // no upid at all
      })
      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      act(() => { result.current.setNewSnapshotName('new-snap') })
      await act(async () => { await result.current.createSnapshot() })

      expect(waitMock).not.toHaveBeenCalled()
      expect(params.toast.success).toHaveBeenCalledWith('inventory.snapshotCreated')
      expect(result.current.snapshotRowTasks).toEqual({})
    } finally {
      vi.useRealTimers()
    }
  })

  it('resetSnapshots clears the row task flags', async () => {
    vi.useFakeTimers()
    try {
      mockGuestFetch({ lists: [[{ name: 'snap1' }, { name: 'current' }]] })
      waitMock.mockImplementation(() => new Promise(() => {})) // task never ends

      const params = makeParams()
      const { result } = renderHook(() => useSnapshots(params))
      await confirmDelete(result, params)
      expect(result.current.snapshotRowTasks).toEqual({ snap1: 'delete' })
      expect(result.current.snapshotTaskBusy).toBe(true)

      // Leaving the VM must not carry its lock over to the next one.
      act(() => { result.current.resetSnapshots() })
      expect(result.current.snapshotRowTasks).toEqual({})
      expect(result.current.snapshotTaskBusy).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useSnapshots stale-selection guard', () => {
  it('does not paint a stale response over a newly selected VM', async () => {
    let resolveJson!: (v: any) => void
    const blocked = new Promise((r) => { resolveJson = r })
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.includes('conn-1')) {
        // VM A's list answer is withheld until after the user switched VM.
        return { ok: true, json: () => blocked } as any
      }
      return { ok: true, json: async () => ({ data: { snapshots: [{ name: 'b-snap' }] } }) } as any
    })

    const params = makeParams()
    const { result, rerender } = renderHook((p: any) => useSnapshots(p), { initialProps: params })

    let pending!: Promise<void>
    act(() => { pending = result.current.loadSnapshots() })
    expect(result.current.snapshotsLoading).toBe(true)

    // The user switches to another VM while VM A's list is still in flight.
    rerender(makeParams({ selection: { type: 'vm', id: 'conn-2:pve9:qemu:200' } }))

    await act(async () => { resolveJson({ data: { snapshots: [{ name: 'a-snap' }] } }); await pending })

    // Every state write of the stale load was skipped.
    expect(result.current.snapshots).toEqual([])
    expect(result.current.snapshotsLoaded).toBe(false)

    // The abandoned load never cleared its own loading flag; resetSnapshots
    // (fired by the consumer on selection change) releases it.
    expect(result.current.snapshotsLoading).toBe(true)
    act(() => { result.current.resetSnapshots() })
    expect(result.current.snapshotsLoading).toBe(false)
  })

  it('skips a delayed refresh entirely once the selection changed', async () => {
    vi.useFakeTimers()
    try {
      let listCalls = 0
      vi.spyOn(global, 'fetch').mockImplementation(async (_input: any, init?: any) => {
        if (init?.method === 'DELETE') {
          // No upid → legacy path schedules the blind 2s refresh.
          return { ok: true, json: async () => ({ data: { success: true } }) } as any
        }
        listCalls++
        return { ok: true, json: async () => ({ data: { snapshots: [] } }) } as any
      })

      const params = makeParams()
      const { result, rerender } = renderHook((p: any) => useSnapshots(p), { initialProps: params })
      await confirmDelete(result, params)
      expect(params.toast.success).toHaveBeenCalled()

      rerender(makeParams({ selection: { type: 'vm', id: 'conn-2:pve9:qemu:200' } }))

      await act(async () => { await vi.advanceTimersByTimeAsync(2500); await flushAsync() })
      expect(listCalls).toBe(0) // the stale refresh returned before fetching anything
    } finally {
      vi.useRealTimers()
    }
  })

  it('loadSnapshots resolves the snapshot feature for LXC guests, defaulting to false when absent', async () => {
    let featureBody: any = { data: { hasFeature: true } }
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.includes('features')) {
        return { ok: true, json: async () => featureBody } as any
      }
      return { ok: true, json: async () => ({ data: { snapshots: [] } }) } as any
    })
    const params = makeParams({ selection: { type: 'vm', id: 'conn-1:pve1:lxc:105' } })
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    expect(result.current.snapshotFeatureAvailable).toBe(true)

    // PVE answered without a hasFeature field: assume the feature is missing.
    featureBody = { data: {} }
    await act(async () => { await result.current.loadSnapshots() })
    expect(result.current.snapshotFeatureAvailable).toBe(false)
  })

  it('skips the LXC feature write when the selection changed mid-flight', async () => {
    let resolveFeature!: (v: any) => void
    const blocked = new Promise((r) => { resolveFeature = r })
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.includes('conn-1') && url.includes('features')) {
        return { ok: true, json: () => blocked } as any
      }
      return { ok: true, json: async () => ({ data: { snapshots: [] } }) } as any
    })

    const params = makeParams({ selection: { type: 'vm', id: 'conn-1:pve1:lxc:105' } })
    const { result, rerender } = renderHook((p: any) => useSnapshots(p), { initialProps: params })

    let pending!: Promise<void>
    act(() => { pending = result.current.loadSnapshots() })
    rerender(makeParams({ selection: { type: 'vm', id: 'conn-2:pve9:qemu:200' } }))

    await act(async () => { resolveFeature({ data: { hasFeature: true } }); await pending })
    expect(result.current.snapshotFeatureAvailable).toBeNull()
  })

  it('loadSnapshots surfaces fetch failures for the current selection', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'))
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    expect(result.current.snapshotsError).toBe('boom')
  })

  it('loadSnapshots falls back to a generic message when the failure has none', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue({})
    const params = makeParams()
    const { result } = renderHook(() => useSnapshots(params))
    await act(async () => { await result.current.loadSnapshots() })
    expect(result.current.snapshotsError).toBe('errors.loadingError')
  })

  it('skips even the error write when a failing load went stale', async () => {
    let rejectJson!: (e: any) => void
    const blocked = new Promise((_res, rej) => { rejectJson = rej })
    vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input)
      if (url.includes('conn-1')) {
        return { ok: true, json: () => blocked } as any
      }
      return { ok: true, json: async () => ({ data: { snapshots: [] } }) } as any
    })

    const params = makeParams()
    const { result, rerender } = renderHook((p: any) => useSnapshots(p), { initialProps: params })

    let pending!: Promise<void>
    act(() => { pending = result.current.loadSnapshots() })
    rerender(makeParams({ selection: { type: 'vm', id: 'conn-2:pve9:qemu:200' } }))

    await act(async () => { rejectJson(new Error('too late to matter')); await pending })
    expect(result.current.snapshotsError).toBeNull()
  })
})
