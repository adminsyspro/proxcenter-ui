'use client'

import { createContext, memo, useContext, type KeyboardEvent } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, alpha } from '@mui/material'
import { useTranslations } from 'next-intl'

import { STATE_DOT } from './ZoneRow'
import { NODE_H, NODE_W, type BoundaryNodeData, type ZoneNodeData } from './zoneGraph'

/** Edges meet in the middle of a node: the handles are two invisible points there (the edge clips itself on the box). */
const CENTER_HANDLE = {
  top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 2, minWidth: 2, minHeight: 2,
  opacity: 0, pointerEvents: 'none', border: 0, background: 'transparent',
} as const

function Handles() {
  return (
    <>
      <Handle type='target' position={Position.Top} isConnectable={false} style={CENTER_HANDLE} />
      <Handle type='source' position={Position.Top} isConnectable={false} style={CENTER_HANDLE} />
    </>
  )
}

/** What Enter or Space on a zone node does (ZoneCanvas provides it): the click of the pointer goes through the canvas. */
export const ZoneActivateContext = createContext<(zoneId: string) => void>(() => undefined)

/** One line: the shield of the zone in its color with its state dot, its name, its member count. */
function ZoneNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as ZoneNodeData
  const t = useTranslations('microsegPilot')
  const { zone, state } = d
  const activate = useContext(ZoneActivateContext)
  const members = d.members === null ? t('overview.node.membersUnknown') : t('overview.node.members', { count: d.members })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activate(zone.id)
  }
  const color = zone.color || 'currentColor'

  return (
    <Box
      role='button'
      tabIndex={0}
      aria-label={t('overview.node.aria', { name: zone.name, state: t(`policy.zone.state.${state}`), members })}
      aria-pressed={!!selected}
      onKeyDown={onKeyDown}
      sx={theme => ({
        width: NODE_W,
        height: NODE_H,
        boxSizing: 'border-box',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        borderLeft: `4px solid ${zone.color || theme.palette.divider}`,
        borderRadius: 1.5,
        px: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        cursor: 'pointer',
        opacity: state === 'disabled' ? 0.65 : 1,
        boxShadow: selected ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.25)}` : '0 1px 4px rgba(0,0,0,0.08)',
        '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.16)' },
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
      })}
    >
      <Handles />
      <Tooltip title={t(`policy.zone.state.${state}`)}>
        <Box component='span' sx={{ position: 'relative', display: 'inline-flex', width: 18, height: 18, flexShrink: 0 }}>
          <i className='ri-shield-fill' style={{ fontSize: 18, color }} />
          <Box
            component='span'
            data-state={state}
            sx={{ position: 'absolute', bottom: -2, right: -3, width: 9, height: 9, borderRadius: '50%', bgcolor: STATE_DOT[state], border: '1.5px solid', borderColor: 'background.paper' }}
          />
        </Box>
      </Tooltip>
      <Tooltip title={zone.name}>
        <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0, fontSize: '0.85rem' }}>{zone.name}</Typography>
      </Tooltip>
      <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>
        {d.members === null ? '—' : members}
      </Typography>
    </Box>
  )
}

export const ZoneNode = memo(ZoneNodeComponent)

const BOUNDARY_ICON = { external: 'ri-global-line', outside: 'ri-cloud-line' } as const

/** The two places outside the zones: External (sources in no zone) and Outside (CIDR destinations, not applied in v1). */
function BoundaryNodeComponent({ data }: NodeProps) {
  const d = data as unknown as BoundaryNodeData
  const t = useTranslations('microsegPilot.overview.node')

  return (
    <Tooltip title={t(`${d.kind}Hint`)}>
      <Box
        sx={{
          width: NODE_W,
          height: NODE_H,
          boxSizing: 'border-box',
          border: '1px dashed',
          borderColor: 'text.disabled',
          borderRadius: 1.5,
          px: 1.25,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          color: 'text.secondary',
          bgcolor: 'transparent',
        }}
      >
        <Handles />
        <i className={BOUNDARY_ICON[d.kind]} style={{ fontSize: 16, flexShrink: 0 }} />
        <Typography noWrap fontWeight={600} sx={{ flexShrink: 0, fontSize: '0.85rem' }}>{t(d.kind)}</Typography>
        {d.kind === 'outside' && (
          <Typography noWrap variant='caption' sx={{ flex: '1 1 0', minWidth: 0 }}>{t('notApplied')}</Typography>
        )}
      </Box>
    </Tooltip>
  )
}

export const BoundaryNode = memo(BoundaryNodeComponent)
