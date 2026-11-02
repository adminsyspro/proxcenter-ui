import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...a: any[]) => Promise<any>>() }))
vi.mock('@/lib/ssh/exec', () => ({
  executeSSH: vi.fn(async () => {
    throw new Error('executeSSH must not be called')
  }),
}))

import { pveFetch } from '@/lib/proxmox/client'
import { executeSSH } from '@/lib/ssh/exec'

import { runOkToStopApi } from './okToStopApi'

const pveFetchMock = pveFetch as any
const conn = { id: 'c1' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runOkToStopApi', () => {
  it('reads the verdict of the PVE cmd-safety route on the given node, with the exact query', async () => {
    pveFetchMock.mockResolvedValue({ safe: true })
    await runOkToStopApi(conn, 'pve2', 7)

    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock.mock.calls[0][0]).toBe(conn)
    expect(pveFetchMock.mock.calls[0][1]).toBe('/nodes/pve2/ceph/cmd-safety?service=osd&id=7&action=stop')
    expect(executeSSH).not.toHaveBeenCalled()
  })

  it('safe:true is a safe verdict', async () => {
    pveFetchMock.mockResolvedValue({ safe: true })

    expect(await runOkToStopApi(conn, 'pve1', 3)).toEqual({ verdict: { ok: true, osds: [3], numOkPgs: 0, numNotOkPgs: 0 } })
  })

  it('safe:false reads the number of PGs from the status text', async () => {
    pveFetchMock.mockResolvedValue({ safe: false, status: 'unsafe to stop osd(s) at this time (12 PGs are or would become offline)' })

    expect(await runOkToStopApi(conn, 'pve1', 3)).toEqual({ verdict: { ok: false, osds: [3], numOkPgs: 0, numNotOkPgs: 12 } })
  })

  it('safe:false reads a singular PG too', async () => {
    pveFetchMock.mockResolvedValue({ safe: false, status: 'unsafe (1 pg would become offline), 1 PG is affected' })

    expect((await runOkToStopApi(conn, 'pve1', 3)).verdict).toMatchObject({ ok: false, numNotOkPgs: 1 })
  })

  it('safe:false without a number of PGs is a refusal with 0', async () => {
    pveFetchMock.mockResolvedValue({ safe: false, status: 'unsafe to stop osd(s) at this time' })
    expect(await runOkToStopApi(conn, 'pve1', 3)).toEqual({ verdict: { ok: false, osds: [3], numOkPgs: 0, numNotOkPgs: 0 } })

    pveFetchMock.mockResolvedValue({ safe: false })
    expect(await runOkToStopApi(conn, 'pve1', 3)).toEqual({ verdict: { ok: false, osds: [3], numOkPgs: 0, numNotOkPgs: 0 } })
  })

  it('never carries the PVE status text in the verdict or the result', async () => {
    pveFetchMock.mockResolvedValue({ safe: false, status: 'OSD(s) 3 on pve1 10.42.0.101 have 129 PGs currently mapped to them. ' })
    const result = await runOkToStopApi(conn, 'pve1', 3)
    const raw = JSON.stringify(result)

    expect(result.verdict).toMatchObject({ ok: false, numNotOkPgs: 129 })
    expect(raw).not.toContain('10.42.0.101')
    expect(raw).not.toContain('pve1')
    expect(raw).not.toContain('mapped')
  })

  it('a PVE without the route (501, 404) is no verdict, never a safe one', async () => {
    for (const status of [501, 404]) {
      pveFetchMock.mockRejectedValue(Object.assign(new Error(`PVE ${status}: Method not implemented`), { status }))
      const result = await runOkToStopApi(conn, 'pve1', 3)

      expect(result.verdict).toBeNull()
      expect(result.error).toEqual(expect.any(String))
    }
  })

  it('an answer without a boolean safe is no verdict', async () => {
    for (const answer of [{}, { status: 'x' }, { safe: 'true' }, { safe: 1 }, null, undefined, 'safe', []]) {
      pveFetchMock.mockResolvedValue(answer)
      const result = await runOkToStopApi(conn, 'pve1', 3)

      expect(result.verdict).toBeNull()
      expect(result.error).toEqual(expect.any(String))
    }
  })

  it('an exception of pveFetch is no verdict and never rethrown', async () => {
    pveFetchMock.mockRejectedValue(new Error('socket hang up'))
    const result = await runOkToStopApi(conn, 'pve1', 3)

    expect(result.verdict).toBeNull()
    expect(result.error).toBe('socket hang up')
  })

  it('an exception without a message still gives an error text', async () => {
    pveFetchMock.mockRejectedValue(undefined)

    expect((await runOkToStopApi(conn, 'pve1', 3)).error).toEqual(expect.any(String))
  })

  it('encodes the node in the path', async () => {
    pveFetchMock.mockResolvedValue({ safe: true })
    await runOkToStopApi(conn, 'pve 1/x', 3)

    expect(pveFetchMock.mock.calls[0][1]).toBe('/nodes/pve%201%2Fx/ceph/cmd-safety?service=osd&id=3&action=stop')
  })
})
