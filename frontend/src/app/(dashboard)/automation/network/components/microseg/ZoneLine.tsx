'use client'

import { useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { zoneEgress, type MicrosegZone } from '@/lib/microseg/types'

import DiffChip from './DiffChip'
import { ZoneActions, ZoneChips, detailsId, type ZoneCardProps } from './ZoneCard'
import { HOVER_ACTIONS, ZoneGlyph, ZoneStateMenu } from './ZoneRow'
import { ZoneSparkCell } from './ZoneSparkline'
import { flowsOfZone } from './zoneModel'
import { useMicrosegWrite } from './microsegAccess'
import { useRunsInProgress } from './runsInProgress'
import TruncatedText from './TruncatedText'

/**
 * The columns of a zone row, the same for the header and every row: the zone, its chips, three counters, the uncovered
 * traffic of the last 24 hours, the actions and the chevron. Fixed or fractional widths only, so the rows line up.
 */
export const ZONE_LINE_COLUMNS = 'minmax(140px, 1.2fr) minmax(190px, 1.4fr) 76px 76px 76px minmax(200px, 2fr) 228px'

const LINE_SX = { display: 'grid', gridTemplateColumns: ZONE_LINE_COLUMNS, alignItems: 'center', columnGap: 1.5, px: 1.5, minWidth: 0 } as const

function Count({ name, value }: { name: string; value: number | null }) {
  return <Typography data-stat={name} variant='body2' sx={{ fontVariantNumeric: 'tabular-nums' }}>{value ?? '-'}</Typography>
}

/** The titles of the columns, above the first row. */
export function ZoneLineHeader({ uncovered }: { uncovered: boolean }) {
  const t = useTranslations('microsegPilot.policy.zone')
  const tp = useTranslations('microsegPilot.policy')
  const head = (text: string) => <Typography variant='caption' fontWeight={600} color='text.secondary' noWrap>{text}</Typography>
  return (
    <Box aria-hidden sx={{ ...LINE_SX, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
      {head(tp('zonesTitle'))}
      {head(tp('table.stateColumn'))}
      {head(t('statMembers'))}
      {head(t('statIncoming'))}
      {head(t('statOutgoing'))}
      {uncovered ? head(t('sparkline.title')) : <span />}
      <span />
    </Box>
  )
}

/**
 * One zone on one line: shield with the state dot and the name, the chips (state as a menu, outbound, draft change,
 * drifts), members, incoming and outgoing flows, the uncovered traffic of the last 24 hours as a line with its total,
 * then the actions (on hover or focus) and the chevron that opens the members and flows below the row.
 */
export default function ZoneLine(props: ZoneCardProps) {
  const { zone, members, membersKnown, flows, diffKind, open, onToggle, onSetState, drifts, onOpenDrifts, uncovered, egressReady = false } = props
  const t = useTranslations('microsegPilot.policy.zone')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const { canWrite } = useMicrosegWrite()
  const changing = useRunsInProgress().zones.has(zone.id)
  const { incoming, outgoing } = flowsOfZone(zone.id, flows)
  return (
    <Box
      role='listitem'
      aria-label={zone.name}
      sx={{
        ...LINE_SX, py: 0.5, minHeight: 44, borderBottom: 1, borderColor: 'divider', borderLeft: 3, borderLeftColor: zone.color || 'divider',
        ...(open ? { bgcolor: 'action.selected' } : { '&:hover': { bgcolor: 'action.hover' } }), ...HOVER_ACTIONS,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <TruncatedText text={zone.name} fontWeight={600} sx={{ minWidth: 0 }} />
        {zone.label && (
          <Tooltip title={zone.label}>
            <Box component='i' className='ri-information-line' aria-label={zone.label} sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
          </Tooltip>
        )}
      </Box>
      <ZoneChips zone={zone} diffKind={diffKind} drifts={drifts} onOpenDrifts={onOpenDrifts} egressReady={egressReady} changing={changing} onStateMenu={canWrite && !changing ? setAnchor : undefined} iconOnly />
      <Count name='members' value={membersKnown ? members.length : null} />
      <Count name='incoming' value={incoming.length} />
      <Count name='outgoing' value={outgoing.length} />
      {uncovered ? <ZoneSparkCell state={zone.state} series={uncovered.series} outSeries={uncovered.outSeries} outState={zoneEgress(zone)} /> : <span />}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 }}>
        <ZoneActions {...props} changing={changing} onStateMenu={setAnchor} />
        <Tooltip title={open ? t('hideDetailsOf', { zone: zone.name }) : t('showDetailsOf', { zone: zone.name })}>
          <IconButton
            size='small'
            aria-expanded={open}
            aria-controls={detailsId(zone.id)}
            aria-label={open ? t('hideDetailsOf', { zone: zone.name }) : t('showDetailsOf', { zone: zone.name })}
            onClick={onToggle}
          >
            <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
          </IconButton>
        </Tooltip>
      </Box>
      <ZoneStateMenu zone={zone} anchor={anchor} onClose={() => setAnchor(null)} onPick={state => onSetState(zone, state)} />
    </Box>
  )
}

/** A zone the draft removed, as a row: struck through with its badge until the next apply, without actions. */
export function RemovedZoneLine({ zone }: { zone: MicrosegZone }) {
  const t = useTranslations('microsegPilot.policy.zone')
  return (
    <Box role='listitem' aria-label={zone.name} data-removed sx={{ ...LINE_SX, py: 0.5, minHeight: 44, borderBottom: 1, borderColor: 'divider', borderLeft: 3, borderLeftColor: zone.color || 'divider', opacity: 0.7 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <Typography noWrap fontWeight={600} sx={{ minWidth: 0, textDecoration: 'line-through' }}>{zone.name}</Typography>
      </Box>
      <Box><DiffChip kind='removed' /></Box>
    </Box>
  )
}
