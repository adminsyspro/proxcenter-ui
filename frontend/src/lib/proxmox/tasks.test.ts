import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))
vi.mock('./client', () => ({ pveFetch: pveFetchMock }))

import { waitForTask } from './tasks'

const conn = { baseUrl: 'https://pve:8006', apiToken: 't' } as any
const stopped = (exitstatus: string) => ({ status: 'stopped', exitstatus })

beforeEach(() => { pveFetchMock.mockReset() })

describe('waitForTask', () => {
  it('polls until the task stops OK', async () => {
    pveFetchMock.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce(stopped('OK'))
    await expect(waitForTask(conn, 'pve1', 'UPID:x', { intervalMs: 1 })).resolves.toBeUndefined()
    expect(pveFetchMock).toHaveBeenCalledWith(conn, '/nodes/pve1/tasks/UPID%3Ax/status')
    expect(pveFetchMock).toHaveBeenCalledTimes(2)
  })

  it('polls the node named in the UPID, which runs the task (#1293)', async () => {
    // A clone with `target` runs on the source node and only moves the guest
    // at the end: the target node answers 400 "no such task" for this UPID.
    pveFetchMock.mockResolvedValue(stopped('OK'))
    const upid = 'UPID:pve1:000BF9C8:005C7EA2:6AEB315D:qmclone:99293:root@pam!root:'
    await waitForTask(conn, 'pve2', upid)
    expect(pveFetchMock).toHaveBeenCalledWith(conn, `/nodes/pve1/tasks/${encodeURIComponent(upid)}/status`)
  })

  it('treats WARNINGS as a failure by default', async () => {
    pveFetchMock.mockResolvedValue(stopped('WARNINGS: 1'))
    await expect(waitForTask(conn, 'pve1', 'UPID:x')).rejects.toThrow('PVE task failed: WARNINGS: 1')
  })

  it('accepts WARNINGS when asked to (#181)', async () => {
    pveFetchMock.mockResolvedValue(stopped('WARNINGS: 1'))
    await expect(waitForTask(conn, 'pve1', 'UPID:x', { acceptWarnings: true })).resolves.toBeUndefined()
  })

  it('still fails on an error with acceptWarnings', async () => {
    pveFetchMock.mockResolvedValue(stopped('clone failed: no space left'))
    await expect(waitForTask(conn, 'pve1', 'UPID:x', { acceptWarnings: true })).rejects.toThrow('no space left')
  })

  it('times out', async () => {
    pveFetchMock.mockResolvedValue({ status: 'running' })
    await expect(waitForTask(conn, 'pve1', 'UPID:x', { timeoutMs: 5, intervalMs: 2 })).rejects.toThrow('timed out')
  })
})
