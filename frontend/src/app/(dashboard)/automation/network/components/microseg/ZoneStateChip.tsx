'use client'

import type { MouseEvent } from 'react'
import { Chip, CircularProgress, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ZoneState } from '@/lib/microseg/types'

type StateColor = 'warning' | 'success' | 'default'

/** The colour and the icon of each zone state, shared by the chip and the state menu. */
export const STATE_VISUAL: Record<ZoneState, { color: StateColor; icon: string; palette: string }> = {
  observe: { color: 'warning', icon: 'ri-eye-line', palette: 'warning.main' },
  enforce: { color: 'success', icon: 'ri-shield-check-line', palette: 'success.main' },
  disabled: { color: 'default', icon: 'ri-shield-cross-line', palette: 'text.secondary' },
}

/**
 * The state of a zone as a coloured outlined chip with its icon; the tooltip says in one sentence what the state does.
 * With `onClick` the chip is a button that opens the state menu. `busy` while a run writes this state to Proxmox:
 * the chip already shows the state asked for, a spinner in place of its icon says it is not there yet. `iconOnly`
 * leaves the label to the tooltip (a crowded header).
 */
export default function ZoneStateChip({ state, size = 'small', onClick, busy = false, iconOnly = false }: { state: ZoneState; size?: 'small' | 'medium'; onClick?: (anchor: HTMLElement) => void; busy?: boolean; iconOnly?: boolean }) {
  const t = useTranslations('microsegPilot.policy.zone')
  const visual = STATE_VISUAL[state]
  const iconSize = size === 'small' ? 14 : 16
  const hint = busy ? t('stateChanging') : t(`stateHint.${state}`)
  return (
    <Tooltip title={iconOnly ? `${t(`state.${state}`)} : ${hint}` : hint} describeChild>
      <Chip
        size={size}
        variant='outlined'
        color={visual.color}
        icon={busy
          ? <CircularProgress size={iconSize - 2} color='inherit' aria-label={t('stateChanging')} />
          : <i className={visual.icon} style={{ fontSize: iconSize }} />}
        label={t(`state.${state}`)}
        aria-label={iconOnly ? t(`state.${state}`) : undefined}
        data-testid='zone-state-chip'
        {...(onClick ? { onClick: (e: MouseEvent<HTMLDivElement>) => onClick(e.currentTarget), 'aria-haspopup': 'menu' as const } : {})}
        sx={{ flexShrink: 0, maxWidth: '100%', ...(iconOnly && { '& .MuiChip-label': { display: 'none' }, '& .MuiChip-icon': { mx: '5px' } }) }}
      />
    </Tooltip>
  )
}
