'use client'

import { useEffect, useId, useRef } from 'react'

/*
   Ceph flags are shown by several independent pieces of the node view (the
   maintenance banner, the Flags OSD panel of the Ceph tab, the OSD table):
   each reads its own copy. A write from one of them announces itself here so
   the others reread instead of showing a stale state until the next reload
   (ui#1164 recette: noup set from the panel never reached the banner).
*/

export const CEPH_FLAGS_CHANGED = 'proxcenter:ceph-flags-changed'

interface CephFlagsChangedDetail {
  connId: string
  /** The writer, so it does not reread its own write. */
  source?: string
}

export function notifyCephFlagsChanged(connId: string, source?: string): void {
  if (typeof window === 'undefined' || !connId) return
  window.dispatchEvent(new CustomEvent<CephFlagsChangedDetail>(CEPH_FLAGS_CHANGED, { detail: { connId, source } }))
}

/**
 * Calls `onChange` when another writer changed the Ceph flags of `connId`.
 * Returns this subscriber's own source id, to pass to notifyCephFlagsChanged.
 */
export function useCephFlagsChanged(connId: string | null | undefined, onChange: () => void, enabled = true): string {
  const source = useId()
  const callbackRef = useRef(onChange)

  useEffect(() => {
    callbackRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!enabled || !connId) return
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<CephFlagsChangedDetail>).detail
      if (detail?.connId === connId && detail.source !== source) callbackRef.current()
    }
    window.addEventListener(CEPH_FLAGS_CHANGED, listener)
    return () => window.removeEventListener(CEPH_FLAGS_CHANGED, listener)
  }, [connId, enabled, source])

  return source
}
