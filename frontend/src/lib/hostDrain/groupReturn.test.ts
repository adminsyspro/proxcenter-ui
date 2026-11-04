import { describe, expect, it } from 'vitest'

import { lastGroupDrain, returnDrainConfig, returnableGuests, type GroupDrainRecord } from './groupReturn'

const group = (id: string, nodes: string[], created_at: string, guests: GroupDrainRecord['guests'] = []): GroupDrainRecord =>
  ({ id, node: [...nodes].sort((x, y) => x.localeCompare(y)).join(','), created_at, config: { nodes }, guests })

describe('lastGroupDrain', () => {
  it('takes the newest drain of exactly these nodes, in any order', () => {
    const drains = [
      group('old', ['pve1', 'pve3'], '2026-11-01T10:00:00Z'),
      group('new', ['pve3', 'pve1'], '2026-11-03T10:00:00Z'),
      group('other', ['pve1', 'pve2'], '2026-11-04T10:00:00Z'),
      { id: 'single', node: 'pve1', created_at: '2026-11-05T10:00:00Z', config: {} },
    ]
    expect(lastGroupDrain(drains, ['pve1', 'pve3'])?.id).toBe('new')
    expect(lastGroupDrain(drains, ['pve1', 'pve2', 'pve3'])).toBeNull()
  })
})

describe('returnableGuests and returnDrainConfig', () => {
  it('keeps the completed non-HA guests that left the group for a node outside it', () => {
    const drain = group('g', ['pve1', 'pve3'], 'x', [
      { vmid: 1, status: 'completed', mode: 'live', source_node: 'pve1', target_node: 'pve2' },
      { vmid: 2, status: 'completed', mode: 'ha', ha: true, source_node: 'pve1', target_node: 'pve2' },
      { vmid: 3, status: 'skipped', source_node: 'pve3' },
      { vmid: 4, status: 'failed', mode: 'live', source_node: 'pve3', target_node: 'pve2' },
      { vmid: 5, status: 'completed', mode: 'offline', source_node: 'pve3', target_node: 'pve2' },
      { vmid: 6, status: 'completed', mode: 'live', source_node: 'pve3', target_node: 'pve1' },
    ])
    const back = returnableGuests(drain)
    expect(back.map(g => g.vmid)).toEqual([1, 5])
    expect(returnDrainConfig(back)).toEqual({ vmids: [1, 5], guest_targets: { 1: 'pve1', 5: 'pve3' }, include_stopped: true, mem_ceiling_percent: 100 })
    expect(returnableGuests(null)).toEqual([])
  })
})
