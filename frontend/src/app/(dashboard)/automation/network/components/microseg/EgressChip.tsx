'use client'

import { Chip, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { zoneEgress, type EgressState, type MicrosegSuggestion, type MicrosegZone } from '@/lib/microseg/types'

import { useNow } from './useNow'
import { isEgressReady, pendingOutboundOf } from './zoneModel'

type Look = 'off' | 'observe' | 'ready' | 'enforce'

const LOOK: Record<Look, { color: 'default' | 'info' | 'success' | 'error' }> = {
  off: { color: 'default' },
  observe: { color: 'info' },
  ready: { color: 'success' },
  enforce: { color: 'error' },
}

/**
 * The outbound state of a zone as a chip: off, observing (ready once the observation window is clean), blocking.
 * With `iconOnlyBelow` (px), the label is hidden when the nearest size container (the card title) is narrower than
 * that: the icon and the tooltip stay, so the zone name keeps its room. `iconOnly` always leaves it to the tooltip.
 */
export default function EgressChip({ state, ready = false, size = 'small', iconOnlyBelow, iconOnly = false }: { state: EgressState; ready?: boolean; size?: 'small' | 'medium'; iconOnlyBelow?: number; iconOnly?: boolean }) {
  const t = useTranslations('microsegPilot.policy.zone.egress')
  const look: Look = state === 'observe' && ready ? 'ready' : state
  return (
    <Tooltip title={iconOnly ? `${t(`state.${look}`)} : ${t(`hint.${look}`)}` : t(`hint.${look}`)} describeChild>
      <Chip
        size={size}
        variant='outlined'
        color={LOOK[look].color}
        icon={<i className='ri-logout-box-r-line' style={{ fontSize: size === 'small' ? 14 : 16 }} />}
        aria-label={iconOnlyBelow || iconOnly ? t(`state.${look}`) : undefined}
        data-testid='egress-chip'
        label={<span data-egress-label>{t(`state.${look}`)}</span>}
        sx={{
          flexShrink: 0, maxWidth: '100%',
          ...(iconOnly && { '& .MuiChip-label': { display: 'none' }, '& .MuiChip-icon': { mx: '5px' } }),
          ...(iconOnlyBelow ? { [`@container (max-width: ${iconOnlyBelow}px)`]: { '& .MuiChip-label': { display: 'none' }, '& .MuiChip-icon': { mr: '5px' } } } : {}),
        }}
      />
    </Tooltip>
  )
}

/**
 * The outbound state of a zone, and whether it is ready to block (observing, its window clean of pending outbound
 * would-block flows). Not ready while the pending flows read were cut (`partial`); a null zone is off.
 */
export function useZoneEgress(zone: MicrosegZone | null, suggestions: readonly MicrosegSuggestion[], readyAfterHours: number | undefined, partial: boolean): { state: EgressState; ready: boolean } {
  const now = useNow()
  const state = zone ? zoneEgress(zone) : 'off'
  const ready = !!zone && state === 'observe' && !partial && isEgressReady(zone, pendingOutboundOf(suggestions, zone.id), readyAfterHours, now)
  return { state, ready }
}
