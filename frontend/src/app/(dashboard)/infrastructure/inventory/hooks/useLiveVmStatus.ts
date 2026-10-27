import { useEffect } from 'react'

import type { DetailsPayload, Status } from '../types'

const PANEL_STATUS: Record<string, Status> = { running: 'ok', paused: 'warn' }

/**
 * Keeps the detail panel on the guest status the tree shows (optimistic update,
 * then the live stream). A details reload reads /cluster/resources, which
 * Proxmox refreshes up to ~10 s late: the one a finished start or stop task
 * triggers still says the old status, and must not win over the tree until the
 * next 30 s reload.
 */
export function useLiveVmStatus(
  liveStatus: string | undefined,
  data: DetailsPayload | null,
  setData: (data: DetailsPayload) => void,
) {
  useEffect(() => {
    if (!liveStatus || !data || liveStatus === data.vmRealStatus) return
    setData({ ...data, status: PANEL_STATUS[liveStatus] ?? 'crit', vmRealStatus: liveStatus })
  }, [liveStatus, data?.vmRealStatus])
}
