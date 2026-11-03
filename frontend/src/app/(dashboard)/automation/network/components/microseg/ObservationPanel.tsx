'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegSuggestion, SuggestionAction } from '@/lib/microseg/types'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import ObservationFilters, { type ObservationFilterValues } from './ObservationFilters'
import ObservationTable from './ObservationTable'
import { useResolveSuggestions } from './observationParts'
import { Notice } from './PlanNotices'
import { PrevNextPager } from './PolicyPager'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import { useNow } from './useNow'

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
  const { canWrite } = useMicrosegWrite()
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

  // Select-all covers the current page, the pending flows of it (the others cannot be resolved).
  const pending = rows.filter(r => r.status === 'pending')
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
      <Box sx={{ mb: 1.5 }}>
        <Notice
          severity='info'
          text={t('sampling')}
          action={<Button color='inherit' size='small' disabled={!onOpenSettings} onClick={onOpenSettings}>{t('openSettings')}</Button>}
        />
      </Box>
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
            {chosen.length > 0 ? (
              <>
                <Typography noWrap variant='body2' sx={{ flexShrink: 0 }}>{t('selected', { count: chosen.length })}</Typography>
                <Box sx={{ flex: 1 }} />
                <WriteTip title={noZoneAmongChosen ? t('bulkAcceptBlocked') : ''}>
                  <Button size='small' disabled={!canWrite || busy || noZoneAmongChosen} onClick={() => bulk('accept')} sx={{ whiteSpace: 'nowrap' }}>{t('bulkAccept')}</Button>
                </WriteTip>
                <WriteTip title={noIpAmongChosen ? t('bulkCidrBlocked') : ''}>
                  <Button size='small' disabled={!canWrite || busy || noIpAmongChosen} onClick={() => bulk('accept_cidr')} sx={{ whiteSpace: 'nowrap' }}>{t('bulkAcceptCidr')}</Button>
                </WriteTip>
                <WriteTip>
                  <Button size='small' color='inherit' disabled={!canWrite || busy} onClick={() => bulk('dismiss')} sx={{ whiteSpace: 'nowrap' }}>{t('bulkDismiss')}</Button>
                </WriteTip>
              </>
            ) : <Box sx={{ flex: 1 }} />}
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
            />
          )}
        </>
      )}
    </Box>
  )
}
