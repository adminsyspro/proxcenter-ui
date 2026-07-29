'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { PublicBroadcast } from '@/lib/broadcast/types'

export const DISMISSED_STORAGE_KEY = 'proxcenter_broadcast_dismissed'

type DismissedMap = Record<string, string>

/**
 * Reading and writing are both guarded: a browser in a non-secure or
 * partitioned context can throw on localStorage, and a banner must never take
 * the dashboard down with it.
 */
function readMap(): DismissedMap {
  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as DismissedMap
  } catch {
    return {}
  }
}

function writeMap(map: DismissedMap): void {
  try {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Ignored on purpose: the dismissal simply does not survive a reload.
  }
}

export function useDismissedBroadcasts(banners: PublicBroadcast[]) {
  const [dismissed, setDismissed] = useState<DismissedMap>({})

  useEffect(() => {
    setDismissed(readMap())
  }, [])

  // Drop entries whose banner no longer exists so the key cannot grow
  // without bound. Keyed on updatedAt, so editing a dismissed banner brings
  // it back.
  useEffect(() => {
    if (banners.length === 0) return
    const live = new Set(banners.map(b => b.id))
    setDismissed(prev => {
      const next: DismissedMap = {}
      for (const [id, stamp] of Object.entries(prev)) {
        if (live.has(id)) next[id] = stamp
      }
      if (Object.keys(next).length === Object.keys(prev).length) return prev
      writeMap(next)
      return next
    })
  }, [banners])

  const dismiss = useCallback((banner: PublicBroadcast) => {
    setDismissed(prev => {
      const next = { ...prev, [banner.id]: banner.updatedAt }
      writeMap(next)
      return next
    })
  }, [])

  const visible = useMemo(
    () => banners.filter(b => dismissed[b.id] !== b.updatedAt),
    [banners, dismissed],
  )

  return { visible, dismiss }
}
