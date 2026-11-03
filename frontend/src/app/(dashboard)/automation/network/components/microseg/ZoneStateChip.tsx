'use client'

import { Chip, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ZoneState } from '@/lib/microseg/types'

type StateColor = 'warning' | 'success' | 'default'

/** The colour and the icon of each zone state, shared by the chip and the state menu. */
export const STATE_VISUAL: Record<ZoneState, { color: StateColor; icon: string; palette: string }> = {
  observe: { color: 'warning', icon: 'ri-eye-line', palette: 'warning.main' },
  enforce: { color: 'success', icon: 'ri-shield-check-line', palette: 'success.main' },
  disabled: { color: 'default', icon: 'ri-shield-cross-line', palette: 'text.secondary' },
}

/** The state of a zone as a coloured outlined chip with its icon; the tooltip says in one sentence what the state does. */
export default function ZoneStateChip({ state, size = 'small' }: { state: ZoneState; size?: 'small' | 'medium' }) {
  const t = useTranslations('microsegPilot.policy.zone')
  const visual = STATE_VISUAL[state]
  return (
    <Tooltip title={t(`stateHint.${state}`)} describeChild>
      <Chip
        size={size}
        variant='outlined'
        color={visual.color}
        icon={<i className={visual.icon} style={{ fontSize: size === 'small' ? 14 : 16 }} />}
        label={t(`state.${state}`)}
        sx={{ flexShrink: 0, maxWidth: '100%' }}
      />
    </Tooltip>
  )
}
