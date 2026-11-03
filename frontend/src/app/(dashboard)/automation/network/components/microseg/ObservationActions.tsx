'use client'

import type { ReactNode } from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSuggestion, SuggestionAction, SuggestionKind } from '@/lib/microseg/types'

import { ObservedKindGlyph } from './observationParts'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

const ACTION_SX = { minWidth: 0, px: 1, py: 0, lineHeight: 1.6, whiteSpace: 'nowrap' } as const

type FlowActionsProps = {
  suggestion: MicrosegSuggestion
  /** Names of the two ends as the row shows them, for the tooltip of Accept. */
  source: string
  destination: string
  busy: boolean
  onResolve: (action: SuggestionAction) => void
}

/**
 * The three ways out of an observed flow of the table, as labelled buttons whose tooltip says what each does: Accept
 * (a flow between the zones in the draft), As CIDR (the same with the source as an address range) and Dismiss.
 */
export function FlowActions({ suggestion: s, source, destination, busy, onResolve }: FlowActionsProps) {
  const t = useTranslations('microsegPilot.observation')
  const { canWrite } = useMicrosegWrite()
  const service = s.dport ? `${s.proto}/${s.dport}` : s.proto

  return (
    <Box sx={{ display: 'inline-flex', gap: 0.5 }}>
      <WriteTip title={s.src_zone_id ? t('acceptTip', { from: source, to: destination, service }) : t('acceptNoZone')}>
        <Button size='small' variant='outlined' disabled={!canWrite || busy || !s.src_zone_id} onClick={() => onResolve('accept')} sx={ACTION_SX}>
          {t('accept')}
        </Button>
      </WriteTip>
      <WriteTip title={s.src_ip ? t('cidrTip', { ip: s.src_ip }) : t('acceptCidrNoIp')}>
        <Button size='small' variant='outlined' disabled={!canWrite || busy || !s.src_ip} onClick={() => onResolve('accept_cidr')} sx={ACTION_SX}>
          {t('asCidr')}
        </Button>
      </WriteTip>
      <WriteTip title={t('dismissTip')}>
        <Button size='small' variant='outlined' color='inherit' disabled={!canWrite || busy} onClick={() => onResolve('dismiss')} sx={ACTION_SX}>
          {t('dismiss')}
        </Button>
      </WriteTip>
    </Box>
  )
}

type BulkBarProps = {
  count: number
  busy: boolean
  /** A selected flow has no source zone (Accept impossible) / no source IP (As CIDR impossible). */
  noZone: boolean
  noIp: boolean
  onResolve: (action: SuggestionAction) => void
}

/** "3 selected · Accept · As CIDR · Dismiss": the same three ways out for every checked flow of the page. */
export function BulkBar({ count, busy, noZone, noIp, onResolve }: BulkBarProps) {
  const t = useTranslations('microsegPilot.observation')
  const { canWrite } = useMicrosegWrite()

  return (
    <Box
      role='toolbar'
      aria-label={t('bulkLabel')}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.selected' }}
    >
      <Typography noWrap variant='body2' fontWeight={600} sx={{ flexShrink: 0, mr: 0.5 }}>{t('selected', { count })}</Typography>
      <WriteTip title={noZone ? t('bulkAcceptBlocked') : t('bulkAcceptTip')}>
        <Button size='small' variant='outlined' aria-label={t('bulkAccept')} disabled={!canWrite || busy || noZone} onClick={() => onResolve('accept')} sx={ACTION_SX}>
          {t('accept')}
        </Button>
      </WriteTip>
      <WriteTip title={noIp ? t('bulkCidrBlocked') : t('bulkCidrTip')}>
        <Button size='small' variant='outlined' aria-label={t('bulkAcceptCidr')} disabled={!canWrite || busy || noIp} onClick={() => onResolve('accept_cidr')} sx={ACTION_SX}>
          {t('asCidr')}
        </Button>
      </WriteTip>
      <WriteTip title={t('bulkDismissTip')}>
        <Button size='small' variant='outlined' color='inherit' aria-label={t('bulkDismiss')} disabled={!canWrite || busy} onClick={() => onResolve('dismiss')} sx={ACTION_SX}>
          {t('dismiss')}
        </Button>
      </WriteTip>
    </Box>
  )
}

function Dot({ color }: { color: string }) {
  return <Box component='span' data-legend-dot={color} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
}

function LegendItem({ mark, text }: { mark: ReactNode; text: string }) {
  return (
    <Box component='li' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      {mark}
      <Typography noWrap variant='caption' color='text.secondary'>{text}</Typography>
    </Box>
  )
}

const KINDS: SuggestionKind[] = ['would_block', 'blocked']

/**
 * What the marks of the table mean, on one compact row, with the sampling limit of Proxmox behind an info icon and the
 * way to the settings where it is raised.
 */
export function ObservationLegend({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const t = useTranslations('microsegPilot.observation')

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, mb: 1.5, minWidth: 0 }}>
      <Box component='ul' aria-label={t('legend.title')} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.5, m: 0, p: 0, listStyle: 'none', minWidth: 0 }}>
        {KINDS.map(kind => <LegendItem key={kind} mark={<ObservedKindGlyph kind={kind} />} text={t(`legend.${kind}`)} />)}
        <LegendItem mark={<Dot color='primary.main' />} text={t('legend.zoneDot')} />
        <LegendItem mark={<Dot color='error.main' />} text={t('legend.unknownDot')} />
      </Box>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, ml: 'auto' }}>
        <Tooltip title={t('sampling')}>
          <IconButton size='small' aria-label={t('legend.about')}><i className='ri-information-line' /></IconButton>
        </Tooltip>
        <Button size='small' disabled={!onOpenSettings} onClick={onOpenSettings} sx={{ whiteSpace: 'nowrap' }}>{t('openSettings')}</Button>
      </Box>
    </Box>
  )
}
