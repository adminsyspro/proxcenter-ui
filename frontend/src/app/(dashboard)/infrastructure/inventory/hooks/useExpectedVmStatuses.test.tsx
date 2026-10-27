import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'

import type { InventoryEvent } from '@/lib/cache/inventoryPoller'

import type { TreeCluster } from '../InventoryTree'
import { useExpectedVmStatuses } from './useExpectedVmStatuses'

const tree = (status: string): TreeCluster[] => [
  { connId: 'c1', name: 'c1', isCluster: false, pools: [], nodes: [{ node: 'pve1', status: 'online', vms: [{ type: 'qemu', vmid: '9882', name: 't-ccm-882', status }] }] } as any,
]
const update = (status: string): InventoryEvent => ({ event: 'vm:update', connId: 'c1', vmid: 9882, node: 'pve1', type: 'qemu', status, cpu: 0.3 })

function mount() {
  return renderHook(() => {
    const [clusters, setClusters] = useState(tree('running'))
    return { clusters, ...useExpectedVmStatuses(setClusters) }
  })
}

describe('useExpectedVmStatuses', () => {
  it('shows the status a stop leads to and holds it over a late running read', () => {
    const { result } = mount()

    act(() => result.current.show('c1', '9882', 'stopped', 'qemu'))
    expect(result.current.clusters[0].nodes[0].vms[0].status).toBe('stopped')

    expect(result.current.hold([update('running')])).toEqual([update('stopped')])
    expect(result.current.hold([update('stopped')])).toEqual([update('stopped')])
    expect(result.current.hold([update('running')])).toEqual([update('running')])
  })

  it('keeps the same functions across renders', () => {
    const { result, rerender } = mount()
    const { show, hold } = result.current

    rerender()
    expect(result.current.show).toBe(show)
    expect(result.current.hold).toBe(hold)
  })
})
