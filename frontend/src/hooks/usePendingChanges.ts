'use client'

import { useEffect, useState } from 'react'

import { runInBatches } from '@/lib/migration/guestMigrateClient'
import { fetchPendingChanges, type PendingChange, type PendingCheckGuest } from '@/lib/migration/pendingChanges'

export interface PendingGuest extends PendingCheckGuest {
  name?: string
}

export interface GuestWithPendingChanges {
  guest: PendingGuest
  changes: PendingChange[]
}

/** Guests asked at once; a node can carry dozens. */
const CONCURRENCY = 4

const guestKey = (g: PendingCheckGuest) => `${g.connId}:${g.node}:${g.type}:${g.vmid}`

/**
 * The guests among `guests` that have configuration changes waiting for a
 * restart (#926). A guest whose check fails is left out: the warning is a
 * courtesy, the migration task still has the last word.
 */
export function usePendingChanges(guests: ReadonlyArray<PendingGuest>): { loading: boolean; flagged: GuestWithPendingChanges[] } {
  const key = guests.map(guestKey).join('|')
  const [state, setState] = useState<{ key: string; flagged: GuestWithPendingChanges[] }>({ key: '', flagged: [] })

  useEffect(() => {
    if (!key) return

    let cancelled = false

    void (async () => {
      const results = await runInBatches(guests, CONCURRENCY, async guest => ({ guest, changes: await fetchPendingChanges(guest) }))
      if (cancelled) return
      setState({
        key,
        flagged: results.filter((r): r is GuestWithPendingChanges => !!r.changes && r.changes.length > 0),
      })
    })()

    return () => { cancelled = true }
    // `key` stands for `guests`: a new array with the same guests must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!key) return { loading: false, flagged: [] }

  return state.key === key ? { loading: false, flagged: state.flagged } : { loading: true, flagged: [] }
}
