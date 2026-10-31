'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, CircularProgress, Link, Typography } from '@mui/material'

import { DEFAULT_PERIOD, type PeriodWindow } from '@/lib/availability/period'
import type { AvailabilityState } from '@/lib/availability/types'

import { availabilityErrorKind } from '../hooks/errorKind'
import { useAvailabilityOverview, type ConnectionOverview, type OverviewResponse } from '../hooks/useAvailabilityOverview'

import AvailabilityTiles, { type TileFilter } from './AvailabilityTiles'
import ConnectionAvailabilityCard from './ConnectionAvailabilityCard'
import PeriodToggle from './PeriodToggle'
import RatesExplainer from './RatesExplainer'

/** Current state of every node of the overview, keyed by connection then node. */
function nodeStates(data: OverviewResponse): Map<string, Map<string, AvailabilityState>> {
  const byConnection = new Map<string, Map<string, AvailabilityState>>()

  for (const s of data.current.states) {
    if (s.ref.kind !== 'node') continue

    const nodes = byConnection.get(s.ref.connection_id) ?? new Map<string, AvailabilityState>()

    nodes.set(s.ref.node ?? '', s.state)
    byConnection.set(s.ref.connection_id, nodes)
  }

  return byConnection
}

function worst(states: Iterable<AvailabilityState>): AvailabilityState | null {
  const all = [...states]

  for (const s of ['down', 'maintenance', 'up'] as const) if (all.includes(s)) return s

  return null
}

/** The connection a #conn-<id> link points to, as a one-item list; null without a link. */
function linkedConnection(): string[] | null {
  if (typeof location === 'undefined' || !location.hash.startsWith('#conn-')) return null

  return [location.hash.slice('#conn-'.length)]
}

/**
 * The connections left out of the registry: an empty page explains that
 * nothing is measured, a page with cards names how many are not. Whoever may
 * tick them gets the button that opens the configuration.
 */
function UnmeasuredNote({ count, none, onConfigure }: Readonly<{ count: number; none: boolean; onConfigure?: () => void }>) {
  const t = useTranslations('availability')

  if (none) {
    return (
      <Alert
        severity='info'
        action={onConfigure ? <Button onClick={onConfigure} size='small' color='inherit'>{t('connection.configure')}</Button> : undefined}
      >
        {t('connection.noneMeasured')}{onConfigure ? '' : ` ${t('connection.askAdmin')}`}
      </Alert>
    )
  }

  return (
    <Typography variant='body2' color='text.secondary' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <i className='ri-eye-off-line' aria-hidden='true' />
      {t('connection.unmeasured', { count })}
      {onConfigure
        ? <Link component='button' type='button' variant='body2' onClick={onConfigure}>{t('connection.configure')}</Link>
        : t('connection.askAdmin')}
    </Typography>
  )
}

const lowCoverage = (c: ConnectionOverview) => c.summary.coverage !== null && c.summary.coverage < 100

interface Props {
  /** Opens the configuration of the measured connections; unset for whoever may not change it. */
  onConfigure?: () => void
}

export default function OverviewTab({ onConfigure }: Readonly<Props>) {
  const t = useTranslations('availability')
  const [period, setPeriod] = useState<PeriodWindow>(DEFAULT_PERIOD)
  const [filter, setFilter] = useState<TileFilter | null>(null)
  // The cards opened on their hosts: folded by default, so that many connections
  // stay readable, but the one a #conn-<id> link points to.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(linkedConnection() ?? []))

  const toggle = useCallback((id: string) => setExpanded(prev => {
    const next = new Set(prev)

    if (!next.delete(id)) next.add(id)

    return next
  }), [])

  const { data, error, isLoading } = useAvailabilityOverview(period)

  // A link to #conn-<id> lands on the card once the data is there: one try, never again.
  const anchored = useRef(false)

  useEffect(() => {
    if (!data || anchored.current) return

    anchored.current = true
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [data])

  const states = useMemo(() => (data ? nodeStates(data) : new Map<string, Map<string, AvailabilityState>>()), [data])

  const shown = useMemo(() => {
    if (!data) return []

    return data.connections.filter(c => {
      const own = [...(states.get(c.id)?.values() ?? [])]

      if (filter === 'down') return own.includes('down')
      if (filter === 'maintenance') return own.includes('maintenance')
      if (filter === 'coverage') return lowCoverage(c)

      return true
    })
  }, [data, states, filter])

  const allExpanded = shown.length > 0 && shown.every(c => expanded.has(c.id))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
        {shown.length > 1 && (
          <Button
            size='small'
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(shown.map(c => c.id)))}
            startIcon={<i className={allExpanded ? 'ri-contract-up-down-line' : 'ri-expand-up-down-line'} aria-hidden='true' />}
          >
            {t(allExpanded ? 'connection.collapseAll' : 'connection.expandAll')}
          </Button>
        )}
        <PeriodToggle value={period} onChange={setPeriod} />
      </Box>

      {error ? (
        <Alert severity='warning'>{t(`error.${availabilityErrorKind(error)}`)}</Alert>
      ) : isLoading || !data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label={t('loading')} />
        </Box>
      ) : (
        <>
          <AvailabilityTiles
            tiles={data.tiles}
            nodesDown={data.current.states.filter(s => s.ref.kind === 'node' && s.state === 'down').length}
            lowCoverage={data.connections.filter(lowCoverage).length}
            connectionsTotal={data.connections.length}
            filter={filter}
            onFilter={setFilter}
          />
          {data.connections.length === 0 && (data.unmeasured ?? 0) > 0 ? (
            <UnmeasuredNote count={data.unmeasured ?? 0} none onConfigure={data.canConfigure ? onConfigure : undefined} />
          ) : data.connections.length === 0 ? (
            <Typography color='text.secondary'>{t('connection.empty')}</Typography>
          ) : shown.length === 0 ? (
            <Typography color='text.secondary'>{t('connection.noMatch')}</Typography>
          ) : (
            shown.map(c => (
              <ConnectionAvailabilityCard key={c.id} connection={c} to={data.to} status={worst(states.get(c.id)?.values() ?? [])} collectedAt={data.current.collectedAt[c.id]} live={typeof period === 'string'} expanded={expanded.has(c.id)} onToggle={toggle} />
            ))
          )}
          {data.connections.length > 0 && (data.unmeasured ?? 0) > 0 && (
            <UnmeasuredNote count={data.unmeasured ?? 0} none={false} onConfigure={data.canConfigure ? onConfigure : undefined} />
          )}
          <RatesExplainer />
        </>
      )}
    </Box>
  )
}
