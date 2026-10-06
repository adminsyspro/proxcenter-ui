import { describe, expect, it } from 'vitest'

import { osdGridStates } from './osdGrid'

const downOn = (ids: number[]) => ({
  OSD_DOWN: { detail: ids.map(id => ({ message: `osd.${id} (root=default,datacenter=AZ-B,host=pve-b) is down` })) },
  OSD_HOST_DOWN: { detail: [{ message: 'host pve-b (root=default,datacenter=AZ-B) (6 osds) is down' }] },
})

const countOf = (items: { state: string }[], state: string) => items.filter(i => i.state === state).length

describe('osdGridStates', () => {
  it('marks exactly the OSDs Ceph names as down, not the last positions as well', () => {
    const items = osdGridStates({ total: 18, up: 12, inCount: 18, healthChecks: downOn([1, 8, 9, 10, 11, 13]) })

    expect(countOf(items, 'down')).toBe(6)
    expect(countOf(items, 'up')).toBe(12)
    expect(items.filter(i => i.state === 'down').map(i => i.id)).toEqual([1, 8, 9, 10, 11, 13])
    expect(items[17].state).toBe('up')
  })

  it('falls back to the position when Ceph names no OSD', () => {
    const items = osdGridStates({ total: 6, up: 4, inCount: 5, healthChecks: {} })

    expect(items.map(i => i.state)).toEqual(['up', 'up', 'up', 'up', 'down', 'down'])
  })

  it('marks out OSDs by position only when no down OSD is named', () => {
    const items = osdGridStates({ total: 4, up: 4, inCount: 3, healthChecks: null })

    expect(items.map(i => i.state)).toEqual(['up', 'up', 'up', 'out'])
  })

  it('reports full and near-full OSDs that are still up', () => {
    const items = osdGridStates({
      total: 4, up: 4, inCount: 4,
      healthChecks: {
        OSD_FULL: { detail: [{ message: 'osd.2 is full' }] },
        OSD_NEARFULL: { detail: [{ message: 'osd.3 is near full' }] },
      },
    })

    expect(items.map(i => i.state)).toEqual(['up', 'up', 'full', 'nearfull'])
  })

  it('keeps every OSD up on a healthy cluster', () => {
    const items = osdGridStates({ total: 42, up: 42, inCount: 42, healthChecks: {} })

    expect(countOf(items, 'up')).toBe(42)
  })
})
