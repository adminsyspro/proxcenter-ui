'use client'

import { useEffect, useEffectEvent, useRef } from 'react'

import { usePageVisible } from '@/hooks/usePageVisibility'

/**
 * Les reessais SWR sont coupes onglet cache (voir COCKPIT_SWR_RETRY) : a la reprise de visibilite,
 * un hook en erreur revalide UNE fois. Sans erreur, aucun appel.
 */
export function useRevalidateErrorOnResume(error: unknown, revalidate: () => unknown) {
  const visible = usePageVisible()
  const was = useRef(visible)
  // Evenement d'effet : voit l'erreur et la fonction les plus recentes sans relancer l'effet de visibilite.
  const revalidateIfFailed = useEffectEvent(() => { if (error) void revalidate() })

  useEffect(() => {
    if (visible && !was.current) revalidateIfFailed()
    was.current = visible
  }, [visible])
}
