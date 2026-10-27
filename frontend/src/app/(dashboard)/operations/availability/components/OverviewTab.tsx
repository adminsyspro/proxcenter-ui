'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'

import { DEFAULT_PERIOD, type Period } from '@/lib/availability/period'
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

const lowCoverage = (c: ConnectionOverview) => c.summary.coverage !== null && c.summary.coverage < 100

export default function OverviewTab() {
  const t = useTranslations('availability')
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD)
  const [filter, setFilter] = useState<TileFilter | null>(null)

  const { data, error, isLoading } = useAvailabilityOverview(period)

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
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
            filter={filter}
            onFilter={setFilter}
          />
          {data.connections.length === 0 ? (
            <Typography color='text.secondary'>{t('connection.empty')}</Typography>
          ) : shown.length === 0 ? (
            <Typography color='text.secondary'>{t('connection.noMatch')}</Typography>
          ) : (
            shown.map(c => (
              <ConnectionAvailabilityCard key={c.id} connection={c} to={data.to} status={worst(states.get(c.id)?.values() ?? [])} collectedAt={data.current.collectedAt[c.id]} />
            ))
          )}
          <RatesExplainer />
        </>
      )}
    </Box>
  )
}
