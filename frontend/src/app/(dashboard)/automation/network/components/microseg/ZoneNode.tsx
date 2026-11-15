'use client'

import { createContext, memo, useContext, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Box, Tooltip, Typography, alpha } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { ZoneState } from '@/lib/microseg/types'

import { STATE_DOT } from './ZoneRow'
import { NODE_H, NODE_W, UNZONED_ID, type BoundaryNodeData, type GuestNodeData, type MoreNodeData, type UnzonedNodeData, type ZoneNodeData } from './zoneGraph'
import { GLYPH_Y, GUEST_H, GUEST_R, GUEST_W } from './zoneLayout'

/** What the nodes do with the keys and the focus (ZoneCanvas provides it): the pointer goes through the canvas. */
export type MapActions = {
  openZone: (zoneId: string) => void
  selectGuest: (nodeId: string) => void
  /** The keyboard focus is on a node (or left it): the focus mode follows it. */
  setFocus: (nodeId: string | null) => void
}
export const MapActionsContext = createContext<MapActions>({ openZone: () => undefined, selectGuest: () => undefined, setFocus: () => undefined })

/** Edges meet at one point of a node (the center of a circle, of a guest glyph): the handles are invisible points there. */
export function Handles({ top = '50%' }: { top?: string | number }) {
  const style = {
    top, left: '50%', transform: 'translate(-50%, -50%)', width: 2, height: 2, minWidth: 2, minHeight: 2,
    opacity: 0, pointerEvents: 'none', border: 0, background: 'transparent',
  } as const
  return (
    <>
      <Handle type='target' position={Position.Left} isConnectable={false} style={style} />
      <Handle type='source' position={Position.Right} isConnectable={false} style={style} />
    </>
  )
}

export const onKeys = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

export const FOCUS_RING = { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } as const
export const tint = (color: string, amount: number) => (/^#[0-9a-f]{3,8}$/i.test(color) ? alpha(color, amount) : 'transparent')

/** The glyph of a zone: a shield in its colour with a dot of its state (disabled, observe, enforce) at its corner. */
export function ZoneShield({ color, state }: { color: string; state: ZoneState }) {
  return (
    <Box component='span' sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0 }}>
      <i className='ri-shield-fill' style={{ fontSize: 16, color }} />
      <Box
        component='span'
        data-state={state}
        sx={{ position: 'absolute', bottom: -2, right: -3, width: 8, height: 8, borderRadius: '50%', bgcolor: STATE_DOT[state], border: '1.5px solid', borderColor: 'background.paper' }}
      />
    </Box>
  )
}

/** The width of the line of text at the top of a circle (a chord of the circle, 26 px under its top). */
export const topChord = (r: number) => Math.max(60, Math.floor(2 * Math.sqrt(r * r - (r - 26) * (r - 26)) - 16))

/**
 * The title line of a circle: at least the chord of the circle, wider when its text needs it (centred, it then goes
 * past the border of the circle), so a zone name is never cut.
 */
export function circleTitleSx(r: number) {
  return {
    position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', width: 'max-content', minWidth: topChord(r),
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, whiteSpace: 'nowrap',
  } as const
}

function CircleTitle({ r, children }: { r: number; children: ReactNode }) {
  return <Box sx={circleTitleSx(r)}>{children}</Box>
}

/**
 * What a zone node says and does, for the circle and for the box of the compact rendering: its member count, its
 * state, its name for screen readers, and the props of its button (enter or space opens the panel, the focus lights
 * it like the pointer does).
 */
export function useZoneNodeProps(id: string, d: ZoneNodeData, selected: boolean | undefined) {
  const t = useTranslations('microsegPilot')
  const { openZone, setFocus } = useContext(MapActionsContext)
  const members = d.members === null ? t('overview.node.membersUnknown') : t('overview.node.members', { count: d.members })
  const stateText = t(`policy.zone.state.${d.state}`)
  const label = t('overview.node.aria', { name: d.zone.name, state: stateText, members })
  const button = {
    role: 'button', tabIndex: 0, 'aria-label': label, 'aria-pressed': !!selected,
    onKeyDown: onKeys(() => openZone(d.zone.id)), onFocus: () => setFocus(id), onBlur: () => setFocus(null),
  }
  return { members, stateText, label, button }
}

/** A zone: a circle in its colour, its name, state and member count on its top line, its guests inside. */
function ZoneNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as ZoneNodeData
  const { zone, state, radius: r } = d
  const { members, label, button } = useZoneNodeProps(id, d, selected)
  const color = zone.color || 'currentColor'

  return (
    <Tooltip title={label} describeChild placement='top' enterDelay={500}>
      <Box
        {...button}
        sx={theme => ({
          position: 'relative', width: 2 * r, height: 2 * r, boxSizing: 'border-box', borderRadius: '50%', cursor: 'pointer',
          border: `2px solid ${zone.color || theme.palette.divider}`,
          bgcolor: tint(zone.color, 0.06),
          opacity: state === 'disabled' ? 0.65 : 1,
          boxShadow: selected ? `0 0 0 4px ${alpha(theme.palette.primary.main, 0.25)}` : 'none',
          '&:focus-visible': FOCUS_RING,
        })}
      >
        <Handles />
        <CircleTitle r={r}>
          <ZoneShield color={color} state={state} />
          <Typography noWrap fontWeight={600} sx={{ flexShrink: 0, fontSize: '0.85rem' }}>{zone.name}</Typography>
          <Typography noWrap variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{d.members === null ? '-' : members}</Typography>
        </CircleTitle>
      </Box>
    </Tooltip>
  )
}

export const ZoneNode = memo(ZoneNodeComponent)

/** The running guests in no zone: a dashed grey circle (they also show in Drifts). No panel opens from it. */
function UnzonedNodeComponent({ data }: NodeProps) {
  const d = data as unknown as UnzonedNodeData
  const t = useTranslations('microsegPilot.overview.node')
  return (
    <Tooltip title={t('unzonedHint')} placement='top'>
      <Box
        role='group'
        aria-label={t('unzoned', { count: d.count })}
        sx={{ position: 'relative', width: 2 * d.radius, height: 2 * d.radius, boxSizing: 'border-box', borderRadius: '50%', border: '2px dashed', borderColor: 'text.disabled' }}
      >
        <Handles />
        <CircleTitle r={d.radius}>
          <i className='ri-question-line' style={{ fontSize: 16, flexShrink: 0, opacity: 0.7 }} />
          <Typography noWrap fontWeight={600} color='text.secondary' sx={{ minWidth: 0, fontSize: '0.85rem' }}>{t('unzoned', { count: d.count })}</Typography>
        </CircleTitle>
      </Box>
    </Tooltip>
  )
}

export const UnzonedNode = memo(UnzonedNodeComponent)

function guestBorder(pending: boolean, selected: boolean): string {
  if (pending) return 'warning.main'
  return selected ? 'primary.main' : 'divider'
}

/** A guest inside its circle: its glyph (type and status), its name under it, the details in a tooltip; a ring when targeted. */
function GuestNodeComponent({ id, data, selected }: NodeProps) {
  const d = data as unknown as GuestNodeData
  const t = useTranslations('microsegPilot.overview.node')
  const { selectGuest, setFocus } = useContext(MapActionsContext)
  const [hovered, setHovered] = useState(false)
  const m = d.member
  const details = (
    <Box>
      <Typography variant='caption' fontWeight={600} sx={{ display: 'block' }}>{m.name}</Typography>
      <Typography variant='caption' sx={{ display: 'block' }}>{t('guestWhere', { vmid: m.vmid, node: m.node })}</Typography>
      <Typography variant='caption' sx={{ display: 'block' }}>{m.ips.length ? t('guestIps', { ips: m.ips.join(', ') }) : t('guestNoIp')}</Typography>
      {m.pending && <Typography variant='caption' sx={{ display: 'block' }}>{t('guestPending')}</Typography>}
    </Box>
  )
  return (
    <Tooltip title={details} open={!!selected || hovered} onOpen={() => setHovered(true)} onClose={() => setHovered(false)} describeChild placement='bottom'>
      <Box
        role='button'
        tabIndex={0}
        aria-label={t('guestAria', { name: m.name, vmid: m.vmid })}
        aria-pressed={!!selected}
        onKeyDown={onKeys(() => selectGuest(id))}
        onFocus={() => setFocus(id)}
        onBlur={() => setFocus(null)}
        sx={{ position: 'relative', width: GUEST_W, height: GUEST_H, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', borderRadius: 1, '&:focus-visible': FOCUS_RING }}
      >
        <Handles top={GLYPH_Y} />
        <Box
          data-target={d.target === undefined ? undefined : 'true'}
          sx={theme => ({
            mt: `${GLYPH_Y - GUEST_R}px`, width: 2 * GUEST_R, height: 2 * GUEST_R, boxSizing: 'border-box', borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper',
            border: '1.5px solid', borderStyle: m.pending ? 'dashed' : 'solid', borderColor: guestBorder(m.pending, !!selected),
            boxShadow: d.target === undefined ? 'none' : `0 0 0 3px ${d.target || theme.palette.primary.main}`,
          })}
        >
          <StatusIcon type='vm' vmType={m.type} status={m.status} size={14} />
        </Box>
        {/* On a paper background: an edge passing under the guest goes behind its name, not through it. */}
        <Typography noWrap sx={{ fontSize: '0.65rem', lineHeight: 1.4, maxWidth: GUEST_W, mt: 0.25, px: 0.25, borderRadius: 0.5, bgcolor: 'background.paper' }}>{m.name}</Typography>
      </Box>
    </Tooltip>
  )
}

export const GuestNode = memo(GuestNodeComponent)

/** The guests a circle does not draw: "+N". On a zone it opens the panel, which lists every member. */
function MoreNodeComponent({ data }: NodeProps) {
  const d = data as unknown as MoreNodeData
  const t = useTranslations('microsegPilot.overview.node')
  const { openZone } = useContext(MapActionsContext)
  const unzoned = d.groupId === UNZONED_ID
  const text = `+${d.count}`
  return (
    <Tooltip title={t(unzoned ? 'moreUnzonedHint' : 'moreHint', { count: d.count })} describeChild placement='bottom'>
      <Box
        role={unzoned ? undefined : 'button'}
        tabIndex={unzoned ? undefined : 0}
        aria-label={t(unzoned ? 'moreUnzonedHint' : 'moreHint', { count: d.count })}
        onKeyDown={unzoned ? undefined : onKeys(() => openZone(d.groupId))}
        sx={{ position: 'relative', width: GUEST_W, height: GUEST_H, display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: unzoned ? 'default' : 'pointer', borderRadius: 1, '&:focus-visible': FOCUS_RING }}
      >
        <Handles top={GLYPH_Y} />
        <Box
          sx={{
            mt: `${GLYPH_Y - GUEST_R}px`, width: 2 * GUEST_R, height: 2 * GUEST_R, boxSizing: 'border-box', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid', borderColor: 'divider', bgcolor: 'action.hover',
          }}
        >
          <Typography noWrap sx={{ fontSize: '0.65rem', fontWeight: 600 }}>{text}</Typography>
        </Box>
      </Box>
    </Tooltip>
  )
}

export const MoreNode = memo(MoreNodeComponent)

const BOUNDARY_ICON = { external: 'ri-global-line', outside: 'ri-cloud-line' } as const

/** The two places outside the zones: Unknown / External (sources that match no guest), Outside (CIDR destinations: their flows are applied once the source zone enforces its outbound traffic). */
function BoundaryNodeComponent({ data }: NodeProps) {
  const d = data as unknown as BoundaryNodeData
  const t = useTranslations('microsegPilot.overview.node')

  return (
    <Tooltip title={t(`${d.kind}Hint`)}>
      <Box
        sx={{
          width: NODE_W, height: NODE_H, boxSizing: 'border-box', border: '1px dashed', borderColor: 'text.disabled', borderRadius: 1.5,
          px: 1.25, display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary', bgcolor: 'background.paper',
        }}
      >
        <Handles />
        <i className={BOUNDARY_ICON[d.kind]} style={{ fontSize: 16, flexShrink: 0 }} />
        <Typography noWrap fontWeight={600} sx={{ flexShrink: 0, fontSize: '0.85rem' }}>{t(d.kind)}</Typography>
        {d.kind === 'outside' && (d.egress === 'notApplied' || d.egress === 'observed') && (
          <Typography noWrap variant='caption' sx={{ flex: '1 1 0', minWidth: 0 }}>{t(d.egress)}</Typography>
        )}
      </Box>
    </Tooltip>
  )
}

export const BoundaryNode = memo(BoundaryNodeComponent)
