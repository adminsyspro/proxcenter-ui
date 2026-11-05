import { beforeEach, describe, expect, it, vi } from 'vitest'

const { waitForTaskStopped } = vi.hoisted(() => ({ waitForTaskStopped: vi.fn() }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTaskStopped }))

import { pendingVdcGpus, releaseWhenTaskStops, reserveVdcGpus, resetVdcPending, RESERVATION_TTL_MS, vdcUsage } from './vdcPending'
import type { VdcGpuEntry } from './vdcQuota'

const line: VdcGpuEntry = { id: 'e1', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 }
const q12 = { kind: 'vgpu' as const, modelKey: '0x10de:0x2231', profileName: 'RTXA5000-12Q' }

beforeEach(() => {
  resetVdcPending()
  waitForTaskStopped.mockReset()
})

describe('vDC GPU reservations', () => {
  it('count on the line until released', () => {
    const release = reserveVdcGpus('v1', '150', [q12])
    expect(pendingVdcGpus('v1')).toEqual([{ vmid: '150', demand: [q12] }])
    expect(vdcUsage('v1', [line], [{ ...q12, vmid: '9020', template: false }])).toEqual(new Map([['e1', 2]]))
    release()
    expect(pendingVdcGpus('v1')).toEqual([])
    expect(vdcUsage('v1', [line], [])).toEqual(new Map([['e1', 0]]))
  })

  it('a VM the collection already shows in the pool counts once', () => {
    reserveVdcGpus('v1', '150', [q12])
    expect(vdcUsage('v1', [line], [{ ...q12, vmid: '150', template: false }])).toEqual(new Map([['e1', 1]]))
  })

  it('expire, and stay per vDC', () => {
    reserveVdcGpus('v1', '150', [q12], { ttlMs: 1000, now: 0 })
    reserveVdcGpus('v2', '151', [q12])
    expect(pendingVdcGpus('v1', 999)).toHaveLength(1)
    expect(pendingVdcGpus('v1', 1000)).toEqual([])
    expect(pendingVdcGpus('v2')).toHaveLength(1)
  })
})

describe('releaseWhenTaskStops', () => {
  const UPID = 'UPID:pve3:0000A1B2:00C0FFEE:6726A000:qmclone:100:root@pam:'

  it('releases once the task is seen stopped, polled on the node in the UPID for as long as the reservation lives', async () => {
    waitForTaskStopped.mockResolvedValue({ stopped: true, exitstatus: 'OK' })
    const release = vi.fn()
    await releaseWhenTaskStops({ id: 'c' }, UPID, 'pve9', release)
    expect(waitForTaskStopped).toHaveBeenCalledWith({ id: 'c' }, 'pve3', UPID, { timeoutMs: RESERVATION_TTL_MS, intervalMs: 10_000 })
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('keeps the reservation when the end was not seen, or without a task id', async () => {
    waitForTaskStopped.mockResolvedValue({ stopped: false })
    const release = vi.fn()
    await releaseWhenTaskStops({}, UPID, 'pve9', release)
    await releaseWhenTaskStops({}, '', 'pve9', release)
    expect(release).not.toHaveBeenCalled()
  })

  it('falls back on the given node when the task id names none', async () => {
    waitForTaskStopped.mockResolvedValue({ stopped: true, exitstatus: 'OK' })
    await releaseWhenTaskStops({}, 'not-a-upid', 'pve9', vi.fn())
    expect(waitForTaskStopped).toHaveBeenCalledWith({}, 'pve9', 'not-a-upid', expect.anything())
  })
})
