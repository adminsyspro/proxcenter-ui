'use client'

import { useEffect, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'

import { microsegApi } from '@/lib/microseg/api'
import type { FlowDirection, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { OneLine } from './dialogParts'
import { isEgressReady, isZoneReady, pendingOutboundOf } from './zoneModel'

/** One page of pending would-block suggestions; a full page means there may be more we cannot see. */
export const SUGGESTIONS_LIMIT = 200

export type Readiness = 'ready' | 'notReady' | 'unchecked'

/**
 * Reads the pending would-block suggestions of the zone (always read with its direction: the zone filter of the backend also matches the outbound rows on their source, which must not count for the inbound read) and says whether
 * the zone is ready: observed for the whole window with none seen inside it. A full page or a failed read is never
 * "ready" (notReady, unchecked). Null while reading, and while `enabled` is false.
 */
export function useZoneReadiness(
  connectionId: string, zone: MicrosegZone, readyAfterHours: number, { direction = 'in', enabled = true }: { direction?: FlowDirection; enabled?: boolean } = {},
): Readiness | null {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const { id: zoneId, state, observe_since: observeSince, egress_state: egressState, egress_observe_since: egressSince } = zone
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    microsegApi(connectionId)
      .listSuggestions({ kind: 'would_block', status: 'pending', zone: zoneId, direction, limit: SUGGESTIONS_LIMIT })
      .then(({ suggestions }) => {
        if (cancelled) return
        const complete = suggestions.length < SUGGESTIONS_LIMIT
        const ready = complete && (direction === 'out'
          ? isEgressReady({ egress_state: egressState, egress_observe_since: egressSince }, pendingOutboundOf(suggestions as MicrosegSuggestion[], zoneId), readyAfterHours, Date.now())
          : isZoneReady({ state, observe_since: observeSince }, suggestions, readyAfterHours, Date.now()))
        setReadiness(ready ? 'ready' : 'notReady')
      })
      .catch(() => { if (!cancelled) setReadiness('unchecked') })
    return () => { cancelled = true }
  }, [enabled, direction, connectionId, zoneId, state, observeSince, egressState, egressSince, readyAfterHours])
  return enabled ? readiness : null
}

/** The line of a readiness dialog: a spinner while reading, then the verdict (`texts` holds the translated lines). */
export function ReadinessLine({ readiness, texts }: { readiness: Readiness | null; texts: { checking: string } & Record<Readiness, string> }) {
  if (readiness === null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <CircularProgress size={16} />
        <OneLine text={texts.checking} />
      </Box>
    )
  }
  return <OneLine text={texts[readiness]} />
}
