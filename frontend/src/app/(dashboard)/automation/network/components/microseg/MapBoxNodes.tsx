'use client'

import { memo, useContext } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, alpha } from '@mui/material'
import { useTranslations } from 'next-intl'

import { BOX_H, BOX_W } from './compactGraph'
import type { ZoneNodeData } from './zoneGraph'
import { FOCUS_RING, Handles, MapActionsContext, ZoneShield, onKeys, tint } from './ZoneNode'

/**
 * A zone of the compact rendering: a box in its colour, the shield and state dot with the name on the first line,
 * the state and the member count on the second. Enter, space or a click opens its panel.
 */
function ZoneBoxNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as ZoneNodeData
  const t = useTranslations('microsegPilot')
  const { openZone, setFocus } = useContext(MapActionsContext)
  const { zone, state } = d
  const members = d.members === null ? t('overview.node.membersUnknown') : t('overview.node.members', { count: d.members })
  const stateText = t(`policy.zone.state.${state}`)
  const label = t('overview.node.aria', { name: zone.name, state: stateText, members })

  return (
    <Tooltip title={label} describeChild placement='top' enterDelay={500}>
      <Box
        role='button'
        tabIndex={0}
        aria-label={label}
        aria-pressed={!!selected}
        onKeyDown={onKeys(() => openZone(zone.id))}
        onFocus={() => setFocus(id)}
        onBlur={() => setFocus(null)}
        sx={theme => ({
          width: BOX_W, height: BOX_H, boxSizing: 'border-box', borderRadius: 1.5, cursor: 'pointer', px: 1.25,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.25,
          border: `2px solid ${zone.color || theme.palette.divider}`, bgcolor: theme.palette.background.paper,
          backgroundImage: `linear-gradient(${tint(zone.color, 0.08)}, ${tint(zone.color, 0.08)})`,
          opacity: state === 'disabled' ? 0.65 : 1,
          boxShadow: selected ? `0 0 0 4px ${alpha(theme.palette.primary.main, 0.25)}` : 'none',
          '&:focus-visible': FOCUS_RING,
        })}
      >
        <Handles />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <ZoneShield color={zone.color || 'currentColor'} state={state} />
          <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0, fontSize: '1rem' }}>{zone.name}</Typography>
        </Box>
        <Typography noWrap variant='caption' color='text.secondary' sx={{ pl: 3, fontSize: '0.8rem' }}>
          {`${stateText} · ${d.members === null ? '-' : members}`}
        </Typography>
      </Box>
    </Tooltip>
  )
}

export const ZoneBoxNode = memo(ZoneBoxNodeComponent)
