import { describe, it, expect, vi, beforeEach } from 'vitest'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

const conn = { id: 'c1' } as any
const UPID = 'UPID:pve1:001C9B56:09EE7859:6AB525DA:vzdump:9882:root@pam:'

function lines(from: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({ n: from + i + 1, t: `l${from + i}` }))
}

beforeEach(() => pveFetchMock.mockReset())

describe('fetchTaskLog', () => {
  it('pages through the log in batches until a short batch', async () => {
    const { fetchTaskLog } = await import('./taskLog')
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      const start = Number(new URL(`http://x${path}`).searchParams.get('start'))
      return start === 0 ? lines(0, 5000) : lines(5000, 12)
    })
    const out = await fetchTaskLog(conn, 'pve1', UPID)
    expect(out).toHaveLength(5012)
    expect(pveFetchMock.mock.calls[0][1]).toBe(`/nodes/pve1/tasks/${encodeURIComponent(UPID)}/log?start=0&limit=5000`)
    expect(pveFetchMock.mock.calls[1][1]).toContain('start=5000')
  })

  it('stops at the cap', async () => {
    const { fetchTaskLog } = await import('./taskLog')
    pveFetchMock.mockImplementation(async () => lines(0, 5000))
    expect(await fetchTaskLog(conn, 'pve1', UPID, 10_000)).toHaveLength(10_000)
  })
})

describe('fetchTaskFirstLine', () => {
  it('asks for one line only and returns its text', async () => {
    const { fetchTaskFirstLine } = await import('./taskLog')
    pveFetchMock.mockResolvedValue([{ n: 1, t: 'INFO: starting new backup job: vzdump 1' }])
    expect(await fetchTaskFirstLine(conn, 'pve1', UPID)).toBe('INFO: starting new backup job: vzdump 1')
    expect(pveFetchMock.mock.calls[0][1]).toContain('start=0&limit=1')
  })

  it('returns null on an empty log', async () => {
    const { fetchTaskFirstLine } = await import('./taskLog')
    pveFetchMock.mockResolvedValue([])
    expect(await fetchTaskFirstLine(conn, 'pve1', UPID)).toBeNull()
  })
})
