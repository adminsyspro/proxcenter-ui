import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ pveFetch: vi.fn(), wait: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTaskStopped: (...a: unknown[]) => m.wait(...a) }))

import { applySdn } from './sdn'

const conn = { baseUrl: 'https://pve-a:8006' }
const upid = (n: number) => `UPID:pve1:0000${n}:00:00:reloadnetworkall::root@pam:`

/** A task that ends when the returned function is called. */
function deferredTask() {
  let end!: (v: { stopped: true; exitstatus: string }) => void
  const done = new Promise<{ stopped: true; exitstatus: string }>(resolve => { end = resolve })
  return { done, finish: (exitstatus = 'OK') => end({ stopped: true, exitstatus }) }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  m.pveFetch.mockImplementation(async () => upid(++n))
})

describe('applySdn (issue #1360: one apply at a time per cluster)', () => {
  it('waits for the reload task of the node that runs it', async () => {
    m.wait.mockResolvedValue({ stopped: true, exitstatus: 'OK' })
    await applySdn(conn)
    expect(m.pveFetch).toHaveBeenCalledWith(conn, '/cluster/sdn', { method: 'PUT' })
    expect(m.wait).toHaveBeenCalledWith(conn, 'pve1', upid(1), { timeoutMs: 120_000, intervalMs: 1_500 })
  })

  it('does not wait when Proxmox answers no task id', async () => {
    m.pveFetch.mockResolvedValue(null)
    await applySdn(conn)
    expect(m.wait).not.toHaveBeenCalled()
  })

  it('coalesces a burst: one apply runs, every later caller shares the next one', async () => {
    const first = deferredTask()
    const second = deferredTask()
    m.wait.mockReturnValueOnce(first.done).mockReturnValueOnce(second.done)

    const callers = [applySdn(conn), applySdn(conn), applySdn(conn), applySdn(conn)]
    await tick()
    expect(m.pveFetch).toHaveBeenCalledTimes(1)

    first.finish()
    await callers[0]
    await tick()
    expect(m.pveFetch).toHaveBeenCalledTimes(2)
    second.finish()
    await Promise.all(callers)
    expect(m.pveFetch).toHaveBeenCalledTimes(2)
  })

  it('runs the clusters apart from each other', async () => {
    const a = deferredTask()
    m.wait.mockReturnValueOnce(a.done).mockResolvedValue({ stopped: true, exitstatus: 'OK' })
    const onA = applySdn(conn)
    await applySdn({ baseUrl: 'https://pve-b:8006' })
    expect(m.pveFetch).toHaveBeenCalledTimes(2)
    a.finish()
    await onA
  })

  it('still runs the next apply when the running one failed, and passes its own error on', async () => {
    m.pveFetch.mockRejectedValueOnce(new Error('PVE down')).mockResolvedValue(upid(9))
    m.wait.mockResolvedValue({ stopped: true, exitstatus: 'OK' })
    const failing = applySdn(conn)
    const queued = applySdn(conn)
    await expect(failing).rejects.toThrow('PVE down')
    await expect(queued).resolves.toBeUndefined()
    expect(m.pveFetch).toHaveBeenCalledTimes(2)
  })

  it('logs a reload that ended badly or is still running, without failing the write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.wait.mockResolvedValueOnce({ stopped: true, exitstatus: 'command failed' }).mockResolvedValueOnce({ stopped: false })
    await applySdn(conn)
    await applySdn(conn)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
