'use client'

import { memo, useMemo } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Card, CardContent, Chip, LinearProgress, Typography } from '@mui/material'

import type { AvailabilityState } from '@/lib/availability/types'

import type { ConnectionOverview } from '../hooks/useAvailabilityOverview'

import AvailabilityTimeline, { type TimelineRow } from './AvailabilityTimeline'
import { useAvailabilityFormat } from './availabilityFormat'

interface Props {
  connection: ConnectionOverview
  /** End of the queried window, RFC 3339: no slot ends after it. */
  to: string
  /** Worst current state among the connection's nodes, null when none is known. */
  status: AvailabilityState | null
  /** Time of the registry's last sample for this connection, RFC 3339; a string so the memo holds. */
  collectedAt?: string
}

const STATUS_COLOR: Partial<Record<AvailabilityState, 'success' | 'error' | 'info'>> = {
  up: 'success',
  down: 'error',
  maintenance: 'info',
}

function Rate({ label, value }: { label: string; value: number | null }) {
  const t = useTranslations('availability')
  const { rate } = useAvailabilityFormat()

  return (
    <Box>
      {value === null
        ? <Typography variant='h5' color='text.secondary'>{t('connection.notMeasured')}</Typography>
        : <Typography variant='h5'>{rate(value)}</Typography>}
      <Typography variant='body2' sx={{ display: 'block' }}>{label}</Typography>
      <LinearProgress
        variant='determinate'
        color='success'
        value={value ?? 0}
        sx={{ mt: 1, height: 4, borderRadius: 2, visibility: value === null ? 'hidden' : 'visible' }}
      />
    </Box>
  )
}

function ConnectionAvailabilityCard({ connection, to, status, collectedAt }: Props) {
  const t = useTranslations('availability')
  const { dateTime } = useAvailabilityFormat()

  const clusterLabel = t('connection.clusterRow')
  const rows = useMemo<TimelineRow[]>(() => [
    ...(connection.cluster ? [{ label: clusterLabel, result: connection.cluster }] : []),
    ...connection.nodes.map(n => ({ label: n.ref.node ?? '', result: n })),
  ], [connection.cluster, connection.nodes, clusterLabel])
  const color = status ? STATUS_COLOR[status] : undefined

  return (
    <Card component='section' aria-label={connection.name} variant='outlined'>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-server-line' aria-hidden='true' />
          <Typography variant='h6' noWrap>{connection.name}</Typography>
          {status && <Chip size='small' color={color} variant='outlined' label={t(`states.${status}`)} />}
          <Typography variant='caption' color='text.secondary' noWrap sx={{ marginInlineStart: 'auto' }}>
            {collectedAt ? t('connection.lastCollected', { time: dateTime(collectedAt) }) : t('connection.neverCollected')}
          </Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
          <Rate label={t('connection.availability')} value={connection.summary.availability} />
          <Rate label={t('connection.coverage')} value={connection.summary.coverage} />
          {/* No cluster row for a standalone node or a tenant that only sees some nodes. */}
          {connection.cluster && <Rate label={t('connection.clusterAvailability')} value={connection.cluster.availability} />}
        </Box>
        <Box>
          <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('connection.perHost')}</Typography>
          {rows.length === 0
            ? <Typography variant='body2' color='text.secondary'>{t('connection.noNodes')}</Typography>
            : <AvailabilityTimeline rows={rows} to={to} />}
        </Box>
      </CardContent>
    </Card>
  )
}

export default memo(ConnectionAvailabilityCard)
