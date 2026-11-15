'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { isAggregateDst, type MicrosegSuggestion, type MicrosegZone, type SuggestionAction } from '@/lib/microseg/types'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import type { MicrosegSubTabProps, ObservedService } from './microsegTabTypes'
import { BulkBar, FlowExceptionDialog, ObservationLegend, useFlowExceptions, type FlowException } from './ObservationActions'
import ObservationFilters, { type ObservationFilterValues } from './ObservationFilters'
import { decodeCollapsed, destinationKey, encodeCollapsed } from './observationModel'
import ObservationTable from './ObservationTable'
import { destinationName, endpoint } from './ObservationRow'
import ObservedFlowDialog from './ObservedFlowDialog'
import { gatewayNameMap, namedAddress } from './gatewayNames'
import { useResolveSuggestions } from './observationParts'
import { PrevNextPager } from './PolicyPager'
import { useNow } from './useNow'
import { usePendingChanges } from './usePendingChanges'
import { useZoneGuests } from './useZoneGuests'
import { useStored } from './useStoredChoice'
import { uncoveredOf, useZoneUncovered } from './useZoneUncovered'

/** Where the folded destination zones of the table are kept in this browser. */
export const COLLAPSED_STORAGE_KEY = 'microseg.observation.collapsed'

/** Flows per page. The request asks for one more, which tells whether a next page exists. */
export const OBSERVATION_PAGE_SIZE = 25

/**
 * The guests by address, from the inventory the tab already reads (one request for the whole folder), and the gateways
 * of the zones ("Gateway of web (10.30.0.1)"): a guest keeps its name when it is also a gateway.
 */
function useAddressNames(connectionId: string, zones: readonly MicrosegZone[]): { guestName: (ip: string) => string | undefined; gatewayName: (ip: string) => string | undefined } {
  const { guests } = useZoneGuests(connectionId)
  const tg = useTranslations('microsegPilot.gateway')
  const gateways = useMemo(() => gatewayNameMap(zones, names => tg('name', { zones: names })), [zones, tg])
  const byIp = useMemo(() => {
    const map = new Map<string, string>()
    for (const ip of gateways.keys()) map.set(ip, namedAddress(ip, gateways))
    for (const g of guests) for (const ip of g.ips ?? []) map.set(ip, g.name)
    return map
  }, [guests, gateways])
  return useMemo(() => ({
    guestName: (ip: string) => byIp.get(ip),
    gatewayName: (ip: string) => (gateways.has(ip) ? namedAddress(ip, gateways) : undefined),
  }), [byIp, gateways])
}

type Resolved = { action: SuggestionAction; count: number }

/**
 * The Observation sub-tab: what the engine saw cross the zones, as suggestions.
 * Filtering and paging are the server's. Accepting turns a flow into a learned
 * flow of the draft (the plan applies it); dismissing hides it for good.
 */
/**
 * The zone the list is filtered on, with its uncovered hits of the last 24 hours (the same history read and count as
 * the Policy zone group it was opened from): suggestions and hits are two datasets, shown side by side.
 */
function ZoneFilterBanner({ connectionId, policy, zoneId }: { connectionId: string; policy: MicrosegSubTabProps['policy']; zoneId: string }) {
  const t = useTranslations('microsegPilot.observation')
  const { byZone } = useZoneUncovered(connectionId)
  const { diff } = usePendingChanges(connectionId, policy)
  const zone = policy.zones.find(z => z.id === zoneId)
  if (!zone) return null
  const count = byZone ? uncoveredOf(byZone, zone.name, diff?.renamedZones.get(zone.id)) : null
  return (
    <Alert severity='info' icon={<i className='ri-radar-line' />} sx={{ mb: 1.5 }}>
      {count === null ? t('zoneBannerNoCount', { zone: zone.name }) : t('zoneBanner', { zone: zone.name, count })}
    </Alert>
  )
}

/** A filter the Dashboard opened the list on that no select of the row holds: a line above the table, closed to drop it. */
function FocusBanner({ testId, text, clearText, onClear }: { testId: string; text: string; clearText: string; onClear: () => void }) {
  return (
    <Alert severity='info' icon={<i className='ri-filter-3-line' />} onClose={onClear} closeText={clearText} data-testid={testId} sx={{ mb: 1.5 }}>
      {text}
    </Alert>
  )
}

export default function ObservationPanel({ connectionId, policy, reloadPolicy, startRun, onOpenSettings, observationZone = null, observationFocus = null }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.observation')
  // Opened from a Policy zone group: filtered on that zone; from a figure of the Dashboard: on its type of flow. Both
  // stay filters the user can clear.
  const [filters, setFilters] = useState<ObservationFilterValues>(() => ({ kind: observationFocus?.kind ?? '', status: 'pending', zone: observationZone ?? observationFocus?.zoneId ?? '', direction: '' }))
  // The service a row of the Dashboard opened the list on: not one of the selects, shown in its own line above the table.
  const [service, setService] = useState<ObservedService | null>(() => observationFocus?.service ?? null)
  // The flows whose source is in no zone, opened from the "Unknown source" figures of the Dashboard.
  const [unknownSource, setUnknownSource] = useState(() => observationFocus?.source === 'unknown')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [resolved, setResolved] = useState<Resolved | null>(null)
  // The flow opened in its dialog.
  const [detail, setDetail] = useState<MicrosegSuggestion | null>(null)
  // "Allow this flow only": the exception the flow of the dialog would be, then the one being written in its own dialog.
  const flowExceptionOf = useFlowExceptions(connectionId, policy)
  const [exception, setException] = useState<FlowException | null>(null)
  const [exceptionSaved, setExceptionSaved] = useState(false)

  const { data, loading, error, reload } = useMicrosegSuggestions(connectionId, {
    kind: filters.kind || undefined,
    limit: OBSERVATION_PAGE_SIZE + 1,
    offset: page > 0 ? page * OBSERVATION_PAGE_SIZE : undefined,
    status: filters.status || undefined,
    zone: filters.zone || undefined,
    direction: filters.direction || undefined,
    service: service?.tokens,
    source: unknownSource ? 'unknown' : undefined,
  })
  const { busy, failure, clearFailure, resolve: resolveIds } = useResolveSuggestions(connectionId, policy.version, reloadPolicy, reload)
  const { guestName, gatewayName } = useAddressNames(connectionId, policy.zones)
  const zonesById = useMemo(() => new Map(policy.zones.map(z => [z.id, z])), [policy.zones])
  const rows = useMemo(() => (data ?? []).slice(0, OBSERVATION_PAGE_SIZE), [data])
  const hasNext = (data?.length ?? 0) > OBSERVATION_PAGE_SIZE
  const now = useNow(undefined, data)

  const [collapsedKeys, setCollapsedKeys] = useStored(COLLAPSED_STORAGE_KEY, decodeCollapsed, encodeCollapsed)
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys])

  // Select-all covers the pending flows of the page that are shown: not the resolved ones, not those of a folded zone.
  const pending = rows.filter(r => r.status === 'pending' && !collapsed.has(destinationKey(r)))
  const chosen = pending.filter(r => selected.has(r.id))
  const allChecked = pending.length > 0 && chosen.length === pending.length
  const noZoneAmongChosen = chosen.some(r => !r.src_zone_id)
  // Bulk As CIDR needs the source address of every inbound flow; an outbound flow is accepted as a network one by one.
  const noIpAmongChosen = chosen.some(r => !r.src_ip && r.direction !== 'out')
  const outboundAmongChosen = chosen.some(r => r.direction === 'out')
  const aggregateAmongChosen = chosen.some(r => r.direction === 'out' && isAggregateDst(r))
  const outboundZoneAmongChosen = chosen.some(r => r.direction === 'out' && !!r.dst_zone_id)

  const changeFilters = (next: ObservationFilterValues) => {
    setFilters(next)
    setPage(0)
    setSelected(new Set())
  }
  const backToFirstPage = () => {
    setPage(0)
    setSelected(new Set())
  }
  const clearService = () => {
    setService(null)
    backToFirstPage()
  }
  const clearUnknownSource = () => {
    setUnknownSource(false)
    backToFirstPage()
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
    const hidden = new Set(rows.filter(r => destinationKey(r) === key).map(r => r.id))
    setSelected(prev => new Set([...prev].filter(id => !hidden.has(id))))
  }
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(pending.map(r => r.id)))

  async function resolve(ids: string[], action: SuggestionAction, prefixLen?: number) {
    if (busy || ids.length === 0) return
    setResolved(null)
    setExceptionSaved(false)
    // A 409 (the draft moved) re-reads the list and the draft; the selection stays for the next try.
    const outcome = await resolveIds(ids, action, prefixLen)
    if (!outcome) return
    if (outcome.resolved) {
      setSelected(prev => new Set([...prev].filter(id => !ids.includes(id))))
      setResolved({ action, count: ids.length })
    }
    // Everything of the last page was resolved: the page no longer exists, show the one before.
    if (page > 0 && outcome.fresh && outcome.fresh.length === 0) goToPage(page - 1)
  }

  const one = (s: MicrosegSuggestion, action: SuggestionAction, prefixLen?: number) => resolve([s.id], action, prefixLen)
  // An action from the dialog closes it: the outcome (or the failure) shows above the table, as for a row's action.
  const fromDialog = (s: MicrosegSuggestion, action: SuggestionAction, prefixLen?: number) => {
    setDetail(null)
    void resolve([s.id], action, prefixLen)
  }
  // What the action of a flow needs (the names of its two guests, what opens its dialog); undefined: no action.
  const exceptionActionOf = (s: MicrosegSuggestion) => {
    const target = flowExceptionOf(s)
    if (!target) return undefined
    const open = () => {
      setDetail(null)
      setResolved(null)
      setExceptionSaved(false)
      setException(target)
    }
    return { source: target.draft.sources[0].name, destination: target.draft.destinations[0].name, open }
  }
  // The draft was read again by the write; the list is read again too, like after an accepted flow.
  const exceptionWritten = () => {
    setException(null)
    setResolved(null)
    setExceptionSaved(true)
    void reload()
  }
  const endName = (zoneId: string, ip: string) => endpoint(zoneId, ip, zonesById, t, gatewayName)
  const bulk = (action: SuggestionAction) => resolve(chosen.map(r => r.id), action)

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      <ObservationFilters values={filters} zones={policy.zones} onChange={changeFilters} />
      {filters.zone && <ZoneFilterBanner connectionId={connectionId} policy={policy} zoneId={filters.zone} />}
      {service && <FocusBanner testId='observation-service-filter' text={t('serviceBanner', { service: service.label, ports: service.tokens.join(', ') })} clearText={t('serviceBannerClear')} onClear={clearService} />}
      {unknownSource && <FocusBanner testId='observation-source-filter' text={t('sourceBanner')} clearText={t('sourceBannerClear')} onClear={clearUnknownSource} />}

      {error && <MicrosegErrorAlert error={error} onRetry={reload} />}
      {failure && <Alert severity='error' onClose={clearFailure} sx={{ mb: 1.5 }}>{failure}</Alert>}
      {resolved && (
        <Alert severity='success' onClose={() => setResolved(null)} sx={{ mb: 1.5 }}>
          {t(resolved.action === 'dismiss' ? 'resolvedDismiss' : 'resolvedAccept', { count: resolved.count })}
        </Alert>
      )}
      {exceptionSaved && <Alert severity='success' onClose={() => setExceptionSaved(false)} sx={{ mb: 1.5 }}>{t('exceptionSaved')}</Alert>}

      {/* One row: the legend, the bulk actions of a selection, the pager. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 40 }}>
        <ObservationLegend onOpenSettings={onOpenSettings} />
        {data && chosen.length > 0 && <BulkBar count={chosen.length} busy={busy} noZone={noZoneAmongChosen} noIp={noIpAmongChosen} outbound={outboundAmongChosen} aggregate={aggregateAmongChosen} outboundZone={outboundZoneAmongChosen} onResolve={bulk} />}
        <Box sx={{ flex: 1 }} />
        {data && <PrevNextPager page={page} hasNext={hasNext} onPage={goToPage} />}
      </Box>

      {!data && !error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={20} />
          <Typography color='text.secondary'>{loading ? t('loading') : ''}</Typography>
        </Box>
      )}

      {data && (
        <>
          {rows.length === 0 ? (
            <Typography color='text.secondary' sx={{ py: 2 }}>{t('empty')}</Typography>
          ) : (
            <ObservationTable
              rows={rows}
              zones={zonesById}
              guestName={guestName}
              gatewayName={gatewayName}
              selected={selected}
              busy={busy}
              now={now}
              allChecked={allChecked}
              someChecked={chosen.length > 0}
              canSelect={pending.length > 0}
              onToggleAll={toggleAll}
              onToggle={toggle}
              onResolve={one}
              onOpenDetails={setDetail}
              exceptionOf={exceptionActionOf}
              nextFlow={hasNext ? data[OBSERVATION_PAGE_SIZE] : undefined}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
            />
          )}
        </>
      )}
      {detail && (
        <ObservedFlowDialog
          connectionId={connectionId}
          suggestion={detail}
          zones={zonesById}
          source={endName(detail.src_zone_id, detail.src_ip)}
          destination={destinationName(detail, zonesById, guestName, t as (key: string) => string)}
          busy={busy}
          onResolve={(action, prefixLen) => fromDialog(detail, action, prefixLen)}
          guestName={guestName}
          exception={exceptionActionOf(detail)}
          onClose={() => setDetail(null)}
        />
      )}
      {exception && (
        <FlowExceptionDialog
          connectionId={connectionId}
          policy={policy}
          reloadPolicy={reloadPolicy}
          startRun={startRun}
          exception={exception}
          onSaved={exceptionWritten}
          onClose={() => setException(null)}
        />
      )}
    </Box>
  )
}
