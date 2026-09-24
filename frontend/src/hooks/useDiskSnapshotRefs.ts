'use client'

import { useCallback, useEffect, useState } from 'react'

export interface GuestRef {
  connId: string
  type: string
  node: string
  vmid: string
}

/**
 * Names of the snapshots that still reference `disk`'s volume (#1004), or
 * null while unknown. PVE refuses to move such a disk with "delete source"
 * and to remove it as an unused disk; the dialogs use this to warn first.
 * A failed check stays null on purpose: the action is then left to PVE,
 * which is how it behaved before, rather than blocked on a guess.
 * `recheck` asks again, once the blocking snapshots have been deleted.
 */
export function useDiskSnapshotRefs(
  guest: GuestRef | null | undefined,
  disk: string | null | undefined,
): { snapshots: string[] | null; recheck: () => void } {
  // The answer is stored with the request it belongs to, so a disk switch or
  // a recheck reads as unknown until its own answer lands.
  const [answer, setAnswer] = useState<{ key: string; snapshots: string[] } | null>(null)
  const [round, setRound] = useState(0)
  const { connId, type, node, vmid } = guest ?? {}
  const url = connId && type && node && vmid && disk
    ? `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/disk/snapshot-refs?disk=${encodeURIComponent(disk)}`
    : null
  const key = url ? `${url}#${round}` : null

  useEffect(() => {
    if (!url || !key) return

    let cancelled = false

    fetch(url)
      .then(async res => {
        if (!res.ok) return
        const json = await res.json()
        const list = json?.data?.snapshots
        if (!cancelled && Array.isArray(list)) setAnswer({ key, snapshots: list })
      })
      .catch(() => { /* unknown: leave the action to PVE */ })

    return () => { cancelled = true }
  }, [url, key])

  const recheck = useCallback(() => setRound(r => r + 1), [])

  return { snapshots: answer?.key === key ? answer.snapshots : null, recheck }
}
