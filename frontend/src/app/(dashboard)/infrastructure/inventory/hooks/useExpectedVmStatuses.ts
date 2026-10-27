import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'

import type { InventoryEvent } from '@/lib/cache/inventoryPoller'

import { expectStatus, holdExpectedStatuses, withVmStatus, type ExpectedStatuses } from '../expectedVmStatus'
import type { TreeCluster } from '../InventoryTree'

/**
 * The tree's optimistic status after a power action, held against the live
 * stream until Proxmox reports it (see expectedVmStatus). `show` takes the
 * guest type from the tree menu; the details panel only has the vmid.
 */
export function useExpectedVmStatuses(setClusters: Dispatch<SetStateAction<TreeCluster[]>>) {
  const expected = useRef<ExpectedStatuses>(new Map())

  const show = useCallback((connId: string, vmid: string, status: string, type?: string) => {
    expectStatus(expected.current, connId, vmid, status)
    setClusters(prev => withVmStatus(prev, connId, vmid, status, type))
  }, [setClusters])

  const hold = useCallback((events: InventoryEvent[]) => holdExpectedStatuses(events, expected.current), [])

  return { show, hold }
}
