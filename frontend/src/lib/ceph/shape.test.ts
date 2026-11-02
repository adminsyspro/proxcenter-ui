import { describe, expect, it } from 'vitest'

import status from './__fixtures__/status-lab-ceph20.json'
import { liveFromCephStatus } from './live'
import { parseCrushMap } from './crushRules'
import { isCephHistory, isCephInventory, isCephLive, isCrushMap } from './shape'

const inventory = {
  hasCeph: true,
  health: { status: 'HEALTH_OK', checks: [] },
  capacity: {},
  performance: {},
  pgs: { total: 1, states: [] },
  osds: { list: [] },
  monitors: { list: [] },
  pools: { list: [] },
  mds: { list: [] },
  managers: { active: null, standbys: [] },
}

describe('cockpit shape guards', () => {
  it('accept what the routes produce', () => {
    expect(isCephLive(liveFromCephStatus(status, 1))).toBe(true)
    expect(isCephInventory(inventory)).toBe(true)
    expect(isCrushMap(parseCrushMap('type 0 osd\ntype 1 host\n'))).toBe(true)
    expect(isCephHistory({ from: 'a', to: 'b', step: 60, points: [], slowest_osds: [] })).toBe(true)
  })

  it('reject the demo fallback and any body without health', () => {
    for (const body of [[], {}, null, 'html', { health: 'HEALTH_OK' }, { health: { status: 'HEALTH_OK' } }]) {
      expect(isCephLive(body)).toBe(false)
      expect(isCephInventory(body)).toBe(false)
    }
    expect(isCrushMap([])).toBe(false)
    expect(isCephHistory([])).toBe(false)
  })

  it('accept an inventory with or without the stopped managers, and refuse a stopped list that is not a list', () => {
    expect(isCephInventory({ ...inventory, managers: { active: null, standbys: [], stopped: [] } })).toBe(true)
    expect(isCephInventory({ ...inventory, managers: { active: null, standbys: [], stopped: {} } })).toBe(false)
  })

  it('reject an inventory with the legacy managers list or PG state map', () => {
    expect(isCephInventory({ ...inventory, managers: [] })).toBe(false)
    expect(isCephInventory({ ...inventory, pgs: { total: 1, states: { 'active+clean': 1 } } })).toBe(false)
  })

  it('reject a live read without its counters', () => {
    const live = liveFromCephStatus(status, 1)

    expect(isCephLive({ ...live, osd: { total: 3 } })).toBe(false)
    expect(isCephLive({ ...live, pg: undefined })).toBe(false)
  })
})
