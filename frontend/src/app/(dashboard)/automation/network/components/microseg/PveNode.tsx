'use client'

import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { NodeIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

import ConnectionGlyph, { useConnectionKind } from './ConnectionGlyph'
import { FRAME_HEAD, UNZONED_COLOR } from './nodeViewModel'
import { Handles, circleTitleSx } from './ZoneNode'
import type { PveClusterData, PveNodeData } from './zoneGraph'

/** The zones drawn as dots under the name of a node; a "+N" stands for the others (its tooltip names them). */
export const MAX_ZONE_DOTS = 8

const ICON_SIZE = 16

/**
 * The icon of a Proxmox node, as the inventory and the Firewalling tab draw it: the Proxmox logo of the theme with the
 * status dot of the node. While the status is not known, the logo alone: no dot says "offline" by default.
 */
function PveIcon({ status }: { status?: string }) {
  const theme = useTheme()
  return (
    <Box component='span' data-testid='pve-icon' data-status={status ?? 'unknown'} sx={{ display: 'inline-flex', flexShrink: 0 }}>
      {status
        ? <NodeIcon status={status} size={ICON_SIZE} />
        : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' style={{ width: ICON_SIZE, height: ICON_SIZE, opacity: 0.8 }} />}
    </Box>
  )
}

/**
 * A Proxmox node of the node view: a circle with its Proxmox icon, its name and guest count on its top line, then a dot per zone it
 * holds guests of (grey for the guests in no zone; the tooltip of a dot names the zone and counts its guests) and
 * the observed flows that stay inside the node. Its guests are drawn inside. No panel opens from it.
 */
function PveNodeComponent({ data }: NodeProps) {
  const d = data as unknown as PveNodeData
  const t = useTranslations('microsegPilot.overview.pve')
  const r = d.radius
  const guests = t('guests', { count: d.count })
  const shares = [
    ...d.zones.map(z => ({ key: z.id, color: z.color || UNZONED_COLOR, title: t('zoneShare', { zone: z.name, count: z.count }) })),
    ...(d.unzoned ? [{ key: '', color: UNZONED_COLOR, title: t('unzonedShare', { count: d.unzoned }) }] : []),
  ]
  const shown = shares.slice(0, MAX_ZONE_DOTS)
  const rest = shares.slice(MAX_ZONE_DOTS)

  return (
    <Box
      role='group'
      aria-label={d.cluster ? t('ariaCluster', { name: d.node, cluster: d.cluster.name, guests }) : t('aria', { name: d.node, guests })}
      sx={{ position: 'relative', width: 2 * r, height: 2 * r, boxSizing: 'border-box', borderRadius: '50%', border: '2px solid', borderColor: 'text.secondary', bgcolor: 'action.hover' }}
    >
      <Handles />
      <Box sx={circleTitleSx(r)}>
        <PveIcon status={d.status} />
        <Typography noWrap fontWeight={600} sx={{ flexShrink: 0, fontSize: '0.85rem' }}>{d.node}</Typography>
        <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{guests}</Typography>
      </Box>
      <Box sx={{ position: 'absolute', top: 38, left: '50%', transform: 'translateX(-50%)', width: 'max-content', display: 'flex', alignItems: 'center', gap: 0.5, whiteSpace: 'nowrap' }}>
        {shown.map(s => (
          <Tooltip key={s.key} title={s.title} placement='top'>
            <Box component='span' role='img' aria-label={s.title} data-testid={`pve-share-${s.key || 'unzoned'}`} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
          </Tooltip>
        ))}
        {rest.length > 0 && (
          <Tooltip title={rest.map(s => s.title).join(' · ')} placement='top'>
            <Typography variant='caption' color='text.secondary'>{`+${rest.length}`}</Typography>
          </Tooltip>
        )}
        {d.inside > 0 && (
          <Tooltip title={t('insideHint')} placement='top'>
            <Typography variant='caption' color='text.secondary' sx={{ ml: shares.length ? 0.5 : 0 }}>{t('inside', { count: d.inside })}</Typography>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}

export const PveNode = memo(PveNodeComponent)

/**
 * On the node view of a shared policy, the frame around the nodes of one cluster: a dashed outline in the colour of the
 * dividers (the colours of the map belong to the zones and the flows), headed by the glyph of the cluster (or of the
 * standalone node) and its name, cut with an ellipsis. It takes no pointer: the map behind it pans as usual.
 */
function PveClusterComponent({ data }: NodeProps) {
  const d = data as unknown as PveClusterData
  const kind = useConnectionKind(d.cluster.id)
  return (
    <Box
      role='group'
      aria-label={d.cluster.name}
      sx={{ position: 'relative', width: d.width, height: d.height, boxSizing: 'border-box', border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}
    >
      <Box sx={{ position: 'absolute', top: 0, left: 16, right: 16, height: FRAME_HEAD, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <ConnectionGlyph kind={kind} />
        <Typography noWrap fontWeight={600} sx={{ minWidth: 0, fontSize: '0.9rem' }}>{d.cluster.name}</Typography>
      </Box>
    </Box>
  )
}

export const PveCluster = memo(PveClusterComponent)
