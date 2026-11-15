'use client'

import { useState } from 'react'
import { Box, FormControl, InputLabel, MenuItem, Select, Skeleton, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'

import PostureCard from './PostureCard'
import type { BlockPhase } from './dashboardModel'
import { GROUP_BYS, POSTURE_SUGGESTIONS_LIMIT, arcPath, chordPath, type GroupBy, type PostureSlice, type PostureTraffic } from './dashboardPosture'
import { objectDotSx } from './microseg/objectColour'
import ZoneStateChip from './microseg/ZoneStateChip'

type Props = {
  phase: BlockPhase
  traffic: PostureTraffic
  groupBy: GroupBy
  onGroupBy: (groupBy: GroupBy) => void
  /** The page of pending flows was full: the figures are those of its first flows. */
  truncated: boolean
  /** The guest addresses are in: the sources in no zone are told apart (Unzoned) from the unknown ones. */
  addresses: boolean
  /** Shown under the donut (the time chart). */
  footer?: React.ReactNode
}

const R = 118
const RING = 40
const CHORD_R = R - RING / 2 - 4
const VIEW = 2 * (R + RING / 2 + 4)
/** Space between two slices, taken from each end (radians), when the slice is wide enough. */
const GAP = 0.012

const TITLE: Record<GroupBy, string> = { zone: 'postureTrafficByZone', dstzone: 'postureTrafficByDstZone', vlan: 'postureTrafficByVlan', node: 'postureTrafficByNode' }
const GROUP_LABEL: Record<GroupBy, string> = { zone: 'postureGroupZone', dstzone: 'postureGroupDstZone', vlan: 'postureGroupVlan', node: 'postureGroupNode' }
/** What a zone grouping counts: the hits each zone emitted, or received. */
const DIRECTION_NOTE: Partial<Record<GroupBy, string>> = { zone: 'postureCaptionEmitted', dstzone: 'postureCaptionReceived' }

/** The name of a group of the donut (and of a series of the time chart) in the words of the page. */
export function useSliceName() {
  const t = useTranslations('networkPage.dashboard')
  return (slice: Pick<PostureSlice, 'kind' | 'name'>): string => {
    switch (slice.kind) {
      case 'unzoned': return t('postureUnzoned')
      case 'external': return t('postureUnknownExternal')
      case 'other': return t('postureOther')
      case 'novlan': return t('postureNoVlan')
      case 'vlan': return t('postureVlan', { vlan: slice.name })
      default: return slice.name
    }
  }
}

/** The ring of the slices with the chords inside, the total in the centre. Hovering a slice highlights it. */
function Donut({ traffic, active, onActive, nameOf }: { traffic: PostureTraffic; active: string | null; onActive: (key: string | null) => void; nameOf: (s: PostureSlice) => string }) {
  const t = useTranslations('networkPage.dashboard')
  const theme = useTheme()
  const format = useFormatter()
  const bySlice = new Map(traffic.slices.map(s => [s.key, s]))
  const maxChord = Math.max(1, ...traffic.chords.map(c => c.hits))
  const several = traffic.slices.length > 1
  const sliceOpacity = (key: string) => (active && active !== key ? 0.3 : 1)
  const chordOpacity = (source: string, target: string) => {
    if (!active) return 0.6
    return source === active || target === active ? 0.9 : 0.1
  }

  return (
    <Box component='svg' role='img' aria-label={t('postureDonutLabel')} viewBox={`${-VIEW / 2} ${-VIEW / 2} ${VIEW} ${VIEW}`} sx={{ width: 300, maxWidth: '100%', flex: '0 0 auto', display: 'block' }}>
      {traffic.slices.map(s => {
        const pad = several && s.end - s.start > 4 * GAP ? GAP : 0
        return (
          <path
            key={s.key}
            data-testid={`slice-${s.key}`}
            d={arcPath(R, s.start + pad, s.end - pad)}
            fill='none'
            stroke={s.color}
            strokeWidth={RING}
            opacity={sliceOpacity(s.key)}
            onMouseEnter={() => onActive(s.key)}
            onMouseLeave={() => onActive(null)}
            style={{ cursor: 'default', transition: 'opacity 0.15s' }}
          >
            <title>{`${nameOf(s)}: ${format.number(s.hits)} (${Math.round(s.percent)}%)`}</title>
          </path>
        )
      })}
      {traffic.chords.map(c => (
        <path
          key={`${c.source}>${c.target}`}
          data-testid={`chord-${c.source}>${c.target}`}
          d={chordPath(CHORD_R, bySlice.get(c.source)!, bySlice.get(c.target)!)}
          fill='none'
          stroke={c.color}
          strokeWidth={1.5 + (3 * c.hits) / maxChord}
          strokeLinecap='round'
          opacity={chordOpacity(c.source, c.target)}
          pointerEvents='none'
        />
      ))}
      <text x={0} y={-4} textAnchor='middle' fontSize={28} fontWeight={700} fill={theme.palette.text.primary} data-testid='donut-total'>
        {format.number(traffic.total, { notation: 'compact' })}
      </text>
      <text x={0} y={18} textAnchor='middle' fontSize={12} fill={theme.palette.text.secondary}>{t('postureCentreLabel')}</text>
    </Box>
  )
}

/** One legend row: dot, group, hits, guests, zone state. One line. */
function LegendRow({ slice, name, hint, active, onActive }: { slice: PostureSlice; name: string; hint?: string; active: boolean; onActive: (key: string | null) => void }) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  return (
    <Box
      component='li'
      tabIndex={0}
      data-testid={`legend-${slice.key}`}
      onMouseEnter={() => onActive(slice.key)}
      onMouseLeave={() => onActive(null)}
      onFocus={() => onActive(slice.key)}
      onBlur={() => onActive(null)}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1, py: 0.5, borderRadius: 1, minWidth: 0, bgcolor: active ? alpha(slice.color, 0.1) : 'transparent', outline: 'none' }}
    >
      <Box sx={objectDotSx(slice.color)} />
      <Tooltip title={hint ?? name}>
        <Typography variant='body2' noWrap sx={{ fontWeight: 600, flex: '1 1 auto', minWidth: 0 }}>{name}</Typography>
      </Tooltip>
      <Typography variant='body2' sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{format.number(slice.hits)}</Typography>
      <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0, width: 36, textAlign: 'right' }}>{`${Math.round(slice.percent)}%`}</Typography>
      {slice.members !== null && (
        <Typography variant='caption' color='text.secondary' noWrap sx={{ flexShrink: 0 }} data-testid={`legend-${slice.key}-members`}>
          {t('postureMembers', { count: slice.members })}
        </Typography>
      )}
      {slice.zone && <ZoneStateChip state={slice.zone.state} />}
    </Box>
  )
}

function TrafficSkeleton() {
  return (
    <Box data-testid='traffic-loading' sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
      <Skeleton variant='circular' width={240} height={240} />
      <Stack spacing={1} sx={{ flex: '1 1 220px' }}>
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} variant='rounded' height={24} />)}
      </Stack>
    </Box>
  )
}

/**
 * "Traffic by zone" of the Posture Dashboard: a donut of the hits of the pending observed flows per source zone, per
 * destination zone (the zone that logged them), or per VLAN / node of the destination guest, chords between the groups that exchange traffic, and its legend.
 */
export default function TrafficByZone({ phase, traffic, groupBy, onGroupBy, truncated, addresses, footer }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const [active, setActive] = useState<string | null>(null)
  const nameOf = useSliceName()

  const base = truncated ? t('postureTrafficCaptionFirst', { count: POSTURE_SUGGESTIONS_LIMIT }) : t('postureTrafficCaption')
  const parts = [base]
  const direction = DIRECTION_NOTE[groupBy]
  if (direction) parts.push(t(direction))
  // Until the guest list is read (a VLAN or node grouping), a source in no zone cannot be told from an unknown one.
  if (!addresses && groupBy === 'zone') parts.push(t('postureUnknownIncludesUnzoned'))
  const caption = parts.join(' · ')
  const select = (
    <FormControl size='small' sx={{ minWidth: 140 }}>
      <InputLabel shrink id='posture-group-by'>{t('postureGroupBy')}</InputLabel>
      <Select
        labelId='posture-group-by'
        label={t('postureGroupBy')}
        notched
        value={groupBy}
        onChange={e => onGroupBy(e.target.value as GroupBy)}
        inputProps={{ 'aria-label': t('postureGroupBy') }}
        sx={SMALL_SELECT_SX}
      >
        {GROUP_BYS.map(g => <MenuItem key={g} value={g}>{t(GROUP_LABEL[g])}</MenuItem>)}
      </Select>
    </FormControl>
  )

  let body: React.ReactNode
  if (phase === 'loading') body = <TrafficSkeleton />
  else if (phase === 'unavailable') body = <Typography variant='body2' color='text.secondary' data-testid='traffic-unavailable'>{t('postureTrafficUnavailable')}</Typography>
  else if (traffic.total === 0) body = <Typography variant='body2' color='text.secondary' data-testid='traffic-empty'>{t('postureNoTraffic')}</Typography>
  else {
    const externalHint = addresses ? undefined : t('postureExternalHint')
    body = (
      <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <Donut traffic={traffic} active={active} onActive={setActive} nameOf={nameOf} />
        <Box component='ul' data-testid='traffic-legend' sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5, flex: '1 1 260px', minWidth: 0 }}>
          {traffic.slices.map(s => (
            <LegendRow key={s.key} slice={s} name={nameOf(s)} hint={s.kind === 'external' ? externalHint : undefined} active={active === s.key} onActive={setActive} />
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <PostureCard testId='traffic-card' title={t(TITLE[groupBy])} caption={caption} action={select}>
      {body}
      {footer && <Box sx={{ mt: 1, pt: 2, borderTop: 1, borderColor: 'divider' }}>{footer}</Box>}
    </PostureCard>
  )
}
