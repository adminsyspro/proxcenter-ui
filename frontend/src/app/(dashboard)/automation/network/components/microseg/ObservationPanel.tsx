'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSuggestion, SuggestionAction } from '@/lib/microseg/types'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import { BulkBar, ObservationLegend } from './ObservationActions'
import ObservationFilters, { type ObservationFilterValues } from './ObservationFilters'
import { decodeCollapsed, encodeCollapsed } from './observationModel'
import ObservationTable from './ObservationTable'
import { useResolveSuggestions } from './observationParts'
import { PrevNextPager } from './PolicyPager'
import { useNow } from './useNow'
import { useStored } from './useStoredChoice'

/** Where the folded destination zones of the table are kept in this browser. */
export const COLLAPSED_STORAGE_KEY = 'microseg.observation.collapsed'

/** Flows per page. The request asks for one more, which tells whether a next page exists. */
export const OBSERVATION_PAGE_SIZE = 25

type Resolved = { action: SuggestionAction; count: number }

/**
 * The Observation sub-tab: what the engine saw cross the zones, as suggestions.
 * Filtering and paging are the server's. Accepting turns a flow into a learned
 * flow of the draft (the plan applies it); dismissing hides it for good.
 */
export default function ObservationPanel({ connectionId, policy, reloadPolicy, onOpenSettings }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.observation')
  const [filters, setFilters] = useState<ObservationFilterValues>({ kind: '', status: 'pending', zone: '' })
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [resolved, setResolved] = useState<Resolved | null>(null)

  const { data, loading, error, reload } = useMicrosegSuggestions(connectionId, {
    kind: filters.kind || undefined,
    limit: OBSERVATION_PAGE_SIZE + 1,
    offset: page > 0 ? page * OBSERVATION_PAGE_SIZE : undefined,
    status: filters.status || undefined,
    zone: filters.zone || undefined,
  })
  const { busy, failure, clearFailure, resolve: resolveIds } = useResolveSuggestions(connectionId, policy.version, reloadPolicy, reload)
  const zonesById = useMemo(() => new Map(policy.zones.map(z => [z.id, z])), [policy.zones])
  const rows = useMemo(() => (data ?? []).slice(0, OBSERVATION_PAGE_SIZE), [data])
  const hasNext = (data?.length ?? 0) > OBSERVATION_PAGE_SIZE
  const now = useNow(undefined, data)

  const [collapsedKeys, setCollapsedKeys] = useStored(COLLAPSED_STORAGE_KEY, decodeCollapsed, encodeCollapsed)
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys])

  // Select-all covers the pending flows of the page that are shown: not the resolved ones, not those of a folded zone.
  const pending = rows.filter(r => r.status === 'pending' && !collapsed.has(r.dst_zone_id))
  const chosen = pending.filter(r => selected.has(r.id))
  const allChecked = pending.length > 0 && chosen.length === pending.length
  const noZoneAmongChosen = chosen.some(r => !r.src_zone_id)
  const noIpAmongChosen = chosen.some(r => !r.src_ip)

  const changeFilters = (next: ObservationFilterValues) => {
    setFilters(next)
    setPage(0)
    setSelected(new Set())
  }
  const goToPage = (next: number) => {
    setPage(next)
    setSelected(new Set())
  }
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (!next.delete(id)) next.add(id)
    return next
  })
  // Folding a zone drops its flows from the selection: a bulk action never reaches a flow the admin cannot see.
  const toggleGroup = (key: string) => {
    if (collapsed.has(key)) {
      setCollapsedKeys(collapsedKeys.filter(k => k !== key))
      return
    }
    setCollapsedKeys([...collapsedKeys, key])
    const hidden = new Set(rows.filter(r => r.dst_zone_id === key).map(r => r.id))
    setSelected(prev => new Set([...prev].filter(id => !hidden.has(id))))
  }
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(pending.map(r => r.id)))

  async function resolve(ids: string[], action: SuggestionAction) {
    if (busy || ids.length === 0) return
    setResolved(null)
    // A 409 (the draft moved) re-reads the list and the draft; the selection stays for the next try.
    const outcome = await resolveIds(ids, action)
    if (!outcome) return
    if (outcome.resolved) {
      setSelected(prev => new Set([...prev].filter(id => !ids.includes(id))))
      setResolved({ action, count: ids.length })
    }
    // Everything of the last page was resolved: the page no longer exists, show the one before.
    if (page > 0 && outcome.fresh && outcome.fresh.length === 0) goToPage(page - 1)
  }

  const one = (s: MicrosegSuggestion, action: SuggestionAction) => resolve([s.id], action)
  const bulk = (action: SuggestionAction) => resolve(chosen.map(r => r.id), action)

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      <ObservationLegend onOpenSettings={onOpenSettings} />
      <ObservationFilters values={filters} zones={policy.zones} onChange={changeFilters} />

      {error && <MicrosegErrorAlert error={error} onRetry={reload} />}
      {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1.5 }}>{failure}</Alert>}
      {resolved && (
        <Alert severity='success' onClose={() => setResolved(null)} sx={{ mb: 1.5 }}>
          {t(resolved.action === 'dismiss' ? 'resolvedDismiss' : 'resolvedAccept', { count: resolved.count })}
        </Alert>
      )}

      {!data && !error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={20} />
          <Typography color='text.secondary'>{loading ? t('loading') : ''}</Typography>
        </Box>
      )}

      {data && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 40 }}>
            {chosen.length > 0 && <BulkBar count={chosen.length} busy={busy} noZone={noZoneAmongChosen} noIp={noIpAmongChosen} onResolve={bulk} />}
            <Box sx={{ flex: 1 }} />
            <PrevNextPager page={page} hasNext={hasNext} onPage={goToPage} />
          </Box>
          {rows.length === 0 ? (
            <Typography color='text.secondary' sx={{ py: 2 }}>{t('empty')}</Typography>
          ) : (
            <ObservationTable
              rows={rows}
              zones={zonesById}
              selected={selected}
              busy={busy}
              now={now}
              allChecked={allChecked}
              someChecked={chosen.length > 0}
              canSelect={pending.length > 0}
              onToggleAll={toggleAll}
              onToggle={toggle}
              onResolve={one}
              nextZoneId={hasNext ? data[OBSERVATION_PAGE_SIZE].dst_zone_id : undefined}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
            />
          )}
        </>
      )}
    </Box>
  )
}
