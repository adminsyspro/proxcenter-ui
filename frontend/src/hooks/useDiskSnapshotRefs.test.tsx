import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { useDiskSnapshotRefs } from './useDiskSnapshotRefs'

const guest = { connId: 'conn 1', type: 'qemu', node: 'pve3', vmid: '100' }
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })

describe('useDiskSnapshotRefs', () => {
  it('returns the snapshots holding the disk once the check answers', async () => {
    fetchMock.mockResolvedValue(ok({ volid: 'local-lvm:vm-100-disk-0', snapshots: ['before-upgrade'] }))

    const { result } = renderHook(() => useDiskSnapshotRefs(guest, 'scsi0'))

    expect(result.current.snapshots).toBeNull()
    await waitFor(() => expect(result.current.snapshots).toEqual(['before-upgrade']))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/connections/conn%201/guests/qemu/pve3/100/disk/snapshot-refs?disk=scsi0',
    )
  })

  it('stays unknown when the check fails, so nothing gets blocked', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) })

    const { result } = renderHook(() => useDiskSnapshotRefs(guest, 'scsi0'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 0))
    expect(result.current.snapshots).toBeNull()
  })

  it('asks again on recheck, after snapshots were deleted', async () => {
    fetchMock.mockResolvedValueOnce(ok({ volid: 'v', snapshots: ['s1'] }))
      .mockResolvedValueOnce(ok({ volid: 'v', snapshots: [] }))

    const { result } = renderHook(() => useDiskSnapshotRefs(guest, 'scsi0'))
    await waitFor(() => expect(result.current.snapshots).toEqual(['s1']))

    act(() => result.current.recheck())

    await waitFor(() => expect(result.current.snapshots).toEqual([]))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not call the API while the guest or the disk is unknown', () => {
    renderHook(() => useDiskSnapshotRefs(null, 'scsi0'))
    renderHook(() => useDiskSnapshotRefs(guest, undefined))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
