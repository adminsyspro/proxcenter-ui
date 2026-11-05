'use client'

import { Chip, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { EgressState } from '@/lib/microseg/types'

type Look = 'off' | 'observe' | 'ready' | 'enforce'

const LOOK: Record<Look, { color: 'default' | 'info' | 'success' | 'error' }> = {
  off: { color: 'default' },
  observe: { color: 'info' },
  ready: { color: 'success' },
  enforce: { color: 'error' },
}

/** The outbound state of a zone as a chip: off, observing (ready once the observation window is clean), blocking. */
export default function EgressChip({ state, ready = false, size = 'small' }: { state: EgressState; ready?: boolean; size?: 'small' | 'medium' }) {
  const t = useTranslations('microsegPilot.policy.zone.egress')
  const look: Look = state === 'observe' && ready ? 'ready' : state
  return (
    <Tooltip title={t(`hint.${look}`)} describeChild>
      <Chip
        size={size}
        variant='outlined'
        color={LOOK[look].color}
        icon={<i className='ri-logout-box-r-line' style={{ fontSize: size === 'small' ? 14 : 16 }} />}
        label={t(`state.${look}`)}
        sx={{ flexShrink: 0, maxWidth: '100%' }}
      />
    </Tooltip>
  )
}
