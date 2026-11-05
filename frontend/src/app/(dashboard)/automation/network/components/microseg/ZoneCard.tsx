'use client'

import { useState } from 'react'
import { Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import { zoneEgress, type MicrosegFlow, type MicrosegZone } from '@/lib/microseg/types'
import { serviceLabel } from '@/lib/network/serviceNames'

import DiffChip from './DiffChip'
import EgressChip from './EgressChip'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import { endText } from './policyTableModel'
import { flowsOfZone, type ZoneMember } from './zoneModel'
import { HOVER_ACTIONS, ZoneDetails, ZoneGlyph, ZoneStateMenu, type ZoneRowProps } from './ZoneRow'
import ZoneSparkline from './ZoneSparkline'
import ZoneStateChip from './ZoneStateChip'
import TruncatedText from './TruncatedText'

/** How many members and flows a card previews. */
export const CARD_PREVIEW = 3

export type ZoneCardProps = ZoneRowProps & {
  /** The zone's drifts (ignored ones left out), null while the engine has not computed them. */
  drifts: number | null
  onOpenDrifts?: (zone: MicrosegZone) => void
  /** The outbound observation is clean for the whole window (isEgressReady): the chip says ready. */
  egressReady?: boolean
  /**
   * The zone's uncovered traffic of the last 24 hours, one count per hour: `series` null while the history is read.
   * The whole value is null when the history cannot be read (an older orchestrator): no sparkline then.
   */
  uncovered?: { series: number[] | null; from: number; stepMs: number } | null
}

export const detailsId = (zoneId: string) => `zone-details-${zoneId}`

const CARD_SX = {
  height: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', border: 1, borderColor: 'divider', borderRadius: 1,
  bgcolor: 'background.paper', overflow: 'hidden',
} as const

function Stat({ name, value, label }: { name: string; value: number | null; label: string }) {
  return (
    <Box data-stat={name} sx={{ flex: '1 1 0', minWidth: 0 }}>
      <Typography variant='h6' component='span' sx={{ display: 'block', lineHeight: 1.2 }}>{value ?? '-'}</Typography>
      <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block' }}>{label}</Typography>
    </Box>
  )
}

function MemberPreview({ members, known }: { members: ZoneMember[]; known: boolean }) {
  const t = useTranslations('microsegPilot.policy.zone')
  if (!known) return <Typography variant='body2' color='text.disabled'>{t('membersUnknown')}</Typography>
  if (members.length === 0) return <Typography variant='body2' color='text.disabled'>{t('noMembers')}</Typography>
  const more = members.length - CARD_PREVIEW
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', minWidth: 0 }}>
      {members.slice(0, CARD_PREVIEW).map(m => {
        const name = m.guest?.name ?? `${m.ref.type}/${m.ref.vmid}`
        // The guest glyph with its status dot, as in the Members column and the map panel (list-row rule).
        const glyph = m.guest
          ? <StatusIcon type='vm' vmType={m.guest.type} status={m.guest.status} size={14} />
          : <i className='ri-question-line' style={{ fontSize: 14, opacity: 0.6 }} />
        return (
          <Chip
            key={`${m.ref.node}/${m.ref.type}/${m.ref.vmid}`}
            size='small'
            variant='outlined'
            icon={<Box component='span' sx={{ display: 'inline-flex', ml: '6px !important', mr: '-2px !important' }}>{glyph}</Box>}
            label={name}
            sx={{ maxWidth: 140 }}
          />
        )
      })}
      {more > 0 && <Chip size='small' label={`+${more}`} />}
    </Box>
  )
}

function FlowPreview({ zone, flows, zonesById }: { zone: MicrosegZone; flows: MicrosegFlow[]; zonesById: ZoneRowProps['zonesById'] }) {
  const t = useTranslations('microsegPilot.policy.zone')
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)
  const all = [...incoming, ...outgoing.filter(f => f.dst_zone_id !== zone.id)]
  if (all.length === 0) return <Typography variant='body2' color='text.disabled'>{t('noFlows')}</Typography>
  const more = all.length - CARD_PREVIEW
  return (
    <Box sx={{ minWidth: 0 }}>
      {all.slice(0, CARD_PREVIEW).map(flow => {
        const text = `${endText(flow.src_zone_id, flow.src_cidr, zonesById)} → ${endText(flow.dst_zone_id, flow.dst_cidr, zonesById)} ${serviceLabel(flow.proto, flow.dport)}`
        return (
          <Tooltip key={flow.id} title={text}>
            <Typography noWrap variant='body2' data-flow-preview>{text}</Typography>
          </Tooltip>
        )
      })}
      {more > 0 && <Typography variant='caption' color='text.secondary'>{t('moreFlows', { count: more })}</Typography>}
    </Box>
  )
}

/**
 * One zone as a card: its colour on top, shield with the state dot, name, diff badge, description, state chip (a
 * menu), drifts, the three counters, a preview of the first members and flows, then the footer: Details (the members
 * and the flows opened full width below the row of cards) and the actions, shown on hover or focus (always on touch).
 */
export default function ZoneCard(props: ZoneCardProps) {
  const { zone, members, membersKnown, flows, zonesById, diffKind, open, onToggle, onEdit, onDelete, onSetState, onAssign, onAddFlow, drifts, onOpenDrifts, uncovered, egressReady = false } = props
  const t = useTranslations('microsegPilot.policy.zone')
  const ts = useTranslations('microsegPilot.overview.sections')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { canWrite } = useMicrosegWrite()
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)

  return (
    <Box
      role='listitem'
      aria-label={zone.name}
      sx={{ ...CARD_SX, borderTop: 4, borderTopColor: zone.color || 'divider', ...(open ? { borderColor: 'primary.main', borderTopColor: zone.color || 'primary.main' } : {}), ...HOVER_ACTIONS }}
    >
      <Box sx={{ p: 1.5, pb: 1, flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        {/* One line: the name at the left, the state, diff and drifts chips at the right; the description below. */}
        <Box data-zone-title sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
          <TruncatedText text={zone.name} fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            <ZoneStateChip state={zone.state} onClick={canWrite ? setAnchor : undefined} />
            <EgressChip state={zoneEgress(zone)} ready={egressReady} />
            <DiffChip kind={diffKind} />
            {!!drifts && (
              <Chip
                size='small'
                color='warning'
                variant='outlined'
                icon={<i className='ri-error-warning-line' />}
                label={ts('drifts', { count: drifts })}
                onClick={onOpenDrifts ? () => onOpenDrifts(zone) : undefined}
              />
            )}
          </Box>
        </Box>
        <TruncatedText text={zone.label} variant='body2' color='text.secondary' sx={{ minHeight: 20 }} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Stat name='members' value={membersKnown ? members.length : null} label={t('statMembers')} />
          <Stat name='incoming' value={incoming.length} label={t('statIncoming')} />
          <Stat name='outgoing' value={outgoing.length} label={t('statOutgoing')} />
        </Box>
        <MemberPreview members={members} known={membersKnown} />
        <FlowPreview zone={zone} flows={flows} zonesById={zonesById} />
        {/* At the bottom of the card: the cards of a row share their height, so the bars line up across the row. */}
        {uncovered && (
          <Box sx={{ mt: 'auto', pt: 0.5 }}>
            <ZoneSparkline state={zone.state} series={uncovered.series} from={uncovered.from} stepMs={uncovered.stepMs} />
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
        <Button
          size='small'
          aria-expanded={open}
          aria-controls={detailsId(zone.id)}
          aria-label={open ? t('hideDetailsOf', { zone: zone.name }) : t('showDetailsOf', { zone: zone.name })}
          endIcon={<i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />}
          onClick={onToggle}
          sx={{ mr: 'auto' }}
        >
          {t('details')}
        </Button>
        <Box className='zone-actions' sx={{ display: 'flex', alignItems: 'center' }}>
          <WriteTip title={t('edit')}>
            <IconButton size='small' aria-label={t('edit')} disabled={!canWrite} onClick={() => onEdit(zone)}><i className='ri-pencil-line' /></IconButton>
          </WriteTip>
          <WriteTip title={t('changeState')}>
            <IconButton size='small' aria-label={t('changeState')} aria-haspopup='menu' disabled={!canWrite} onClick={e => setAnchor(e.currentTarget)}>
              <i className='ri-toggle-line' />
            </IconButton>
          </WriteTip>
          <WriteTip title={t('addFlowInto', { zone: zone.name })}>
            <IconButton size='small' aria-label={t('addFlowInto', { zone: zone.name })} disabled={!canWrite} onClick={() => onAddFlow(zone)}><i className='ri-route-line' /></IconButton>
          </WriteTip>
          <WriteTip title={t('assign')}>
            <IconButton size='small' aria-label={t('assign')} disabled={!canWrite} onClick={() => onAssign(zone)}><i className='ri-user-add-line' /></IconButton>
          </WriteTip>
          <WriteTip title={t('delete')}>
            <IconButton size='small' aria-label={t('delete')} disabled={!canWrite} onClick={() => onDelete(zone)}><i className='ri-delete-bin-line' /></IconButton>
          </WriteTip>
        </Box>
      </Box>
      <ZoneStateMenu zone={zone} anchor={anchor} onClose={() => setAnchor(null)} onPick={state => onSetState(zone, state)} />
    </Box>
  )
}

/** The members and the flows of an opened card, full width below its row of cards. */
export function ZoneCardDetails(props: ZoneRowProps) {
  const { zone } = props
  const t = useTranslations('microsegPilot.policy.zone')
  return (
    <Box
      component='section'
      id={detailsId(zone.id)}
      aria-label={t('detailsOf', { zone: zone.name })}
      sx={{ gridColumn: '1 / -1', border: 1, borderColor: 'primary.main', borderRadius: 1, bgcolor: 'background.paper', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1 }}>
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <Typography fontWeight={600} noWrap>{zone.name}</Typography>
      </Box>
      <ZoneDetails {...props} />
    </Box>
  )
}

/** A zone the draft removed: struck through with its badge until the next apply, without actions. */
export function RemovedZoneCard({ zone }: { zone: MicrosegZone }) {
  const t = useTranslations('microsegPilot.policy.zone')
  return (
    <Box role='listitem' aria-label={zone.name} data-removed sx={{ ...CARD_SX, borderTop: 4, borderTopColor: zone.color || 'divider', opacity: 0.7 }}>
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
          <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0, textDecoration: 'line-through' }}>{zone.name}</Typography>
          <DiffChip kind='removed' />
        </Box>
        <Typography noWrap variant='body2' color='text.secondary' sx={{ textDecoration: 'line-through', minHeight: 20 }}>{zone.label}</Typography>
      </Box>
    </Box>
  )
}
