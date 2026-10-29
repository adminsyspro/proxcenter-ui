import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchRrdBatch = vi.fn()

vi.mock('@/app/(dashboard)/infrastructure/inventory/helpers', () => ({
  fetchRrdBatch: (...args: unknown[]) => fetchRrdBatch(...args),
}))

import { fetchGuestSeries, type RrdGuest } from './myVmsRrd'

const guest = (connId: string, vmid: number, name: string, extra: Partial<RrdGuest> = {}): RrdGuest =>
  ({ connId, vmid, name, type: 'qemu', node: 'pve1', ...extra })

describe('fetchGuestSeries', () => {
  beforeEach(() => { fetchRrdBatch.mockReset() })

  it('sends one batch per connection and leaves templates out', async () => {
    fetchRrdBatch.mockImplementation(async (_connId: string, paths: string[]) => new Map(paths.map(p => [p, [{ time: 1, cpu: 0.1 }]])))
    const signal = new AbortController().signal

    const series = await fetchGuestSeries([
      guest('c1', 100, 'web'),
      guest('c1', 101, 'db', { type: 'lxc', node: 'pve2' }),
      guest('c1', 9000, 'tpl', { template: true }),
      guest('c2', 200, 'app'),
    ], signal)

    expect(fetchRrdBatch).toHaveBeenCalledTimes(2)
    expect(fetchRrdBatch).toHaveBeenCalledWith('c1', ['/nodes/pve1/qemu/100', '/nodes/pve2/lxc/101'], 'hour', signal)
    expect(fetchRrdBatch).toHaveBeenCalledWith('c2', ['/nodes/pve1/qemu/200'], 'hour', signal)
    expect(series.map(s => s.key)).toEqual(['c2:qemu:200', 'c1:lxc:101', 'c1:qemu:100'])
    expect(series.every(s => s.raw.length === 1)).toBe(true)
  })

  it('keeps the guests of a failed connection, without points', async () => {
    fetchRrdBatch.mockImplementation(async (connId: string, paths: string[]) => {
      if (connId === 'c2') throw new Error('RRD batch HTTP 500')
      return new Map(paths.map(p => [p, [{ time: 1 }]]))
    })

    const series = await fetchGuestSeries([guest('c1', 100, 'a'), guest('c2', 200, 'b')])

    expect(series).toEqual([
      { key: 'c1:qemu:100', name: 'a', raw: [{ time: 1 }] },
      { key: 'c2:qemu:200', name: 'b', raw: [] },
    ])
  })

  it('gives a guest the batch left out (no permission) no points', async () => {
    fetchRrdBatch.mockResolvedValue(new Map([['/nodes/pve1/qemu/100', [{ time: 1 }]]]))

    const series = await fetchGuestSeries([guest('c1', 100, 'a'), guest('c1', 101, 'b')])

    expect(series.map(s => s.raw.length)).toEqual([1, 0])
  })

  it('sends nothing for a vDC with only templates', async () => {
    expect(await fetchGuestSeries([guest('c1', 9000, 'tpl', { template: true })])).toEqual([])
    expect(fetchRrdBatch).not.toHaveBeenCalled()
  })
})
