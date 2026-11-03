'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, alpha } from '@mui/material'
import { useTranslations } from 'next-intl'

import { BOX_H, BOX_W } from './compactGraph'
import { NODE_H, NODE_W, type IpNodeData, type ZoneNodeData } from './zoneGraph'
import { FOCUS_RING, Handles, ZoneShield, tint, useZoneNodeProps } from './ZoneNode'

/**
 * A zone of the compact rendering: a box in its colour, the shield and state dot with the name on the first line,
 * the state and the member count on the second (the observed flows inside the zone in its tooltip). Enter, space or
 * a click opens its panel.
 */
function ZoneBoxNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as ZoneNodeData
  const t = useTranslations('microsegPilot.overview.node')
  const { zone, state } = d
  const { members, stateText, label, button } = useZoneNodeProps(id, d, selected)
  // The flows seen inside the zone have no edge here (the diagonal of the matrix shows them): the tooltip counts them.
  const tip = d.inside ? `${label} · ${t('inside', { count: d.inside })}` : label

  return (
    <Tooltip title={tip} describeChild placement='top' enterDelay={500}>
      <Box
        {...button}
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

/** An address in no zone and no guest that talked to the zone of the guest view: a box with the address. */
function IpNodeComponent({ data }: NodeProps) {
  const d = data as unknown as IpNodeData
  const t = useTranslations('microsegPilot.overview.node')
  return (
    <Tooltip title={t('ipHint', { ip: d.ip })}>
      <Box
        sx={{
          width: NODE_W, height: NODE_H, boxSizing: 'border-box', border: '1px dashed', borderColor: 'text.disabled', borderRadius: 1.5,
          px: 1.25, display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', bgcolor: 'background.paper',
        }}
      >
        <Handles />
        <i className='ri-map-pin-line' style={{ fontSize: 16, flexShrink: 0 }} />
        <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0, fontSize: '0.85rem' }}>{d.ip}</Typography>
      </Box>
    </Tooltip>
  )
}

export const IpNode = memo(IpNodeComponent)
