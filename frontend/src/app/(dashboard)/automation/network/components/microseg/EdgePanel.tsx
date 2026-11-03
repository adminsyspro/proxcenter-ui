'use client'

import { useContext, useState } from 'react'
import { Alert, Box, Button, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'
import { serviceTitle, serviceTokensTitle } from '@/lib/network/serviceNames'

import { OneLine } from './dialogParts'
import { MapNamesContext, isSampled, observedHits, type EdgeT } from './FlowEdge'
import FlowSummary, { flowService } from './FlowSummary'
import { ObservedKindGlyph, ResolveActions, ServiceHits, useResolveSuggestions } from './observationParts'
import PolicyPager, { usePaged } from './PolicyPager'
import type { PanelEdgeData } from './zoneGraph'
import { formatWhen } from './summaryModel'

const ROWS_PER_PAGE = 5

type Props = {
  edgeId: string
  source: string
  target: string
  data: PanelEdgeData
  /** The names of the two ends ("web-1 (web)", "web", "Unknown / External"). */
  from: string
  to: string
  zonesById: Map<string, MicrosegZone>
  unapplied: ReadonlySet<string> | null
  connectionId: string
  version: number
  reloadPolicy: () => Promise<unknown>
  reloadSuggestions: () => Promise<unknown>
  onResolved: (action: SuggestionAction) => void
  onClose: () => void
  onEdit: () => void
}

function ObservedRow({ s, example, zonesById, busy, onResolve }: {
  s: MicrosegSuggestion
  /** "Example: web-1 → db-1" when the edge is drawn between guests. */
  example: string | null
  zonesById: Map<string, MicrosegZone>
  busy: boolean
  onResolve: (action: SuggestionAction) => void
}) {
  const t = useTranslations('microsegPilot.overview')
  const to = useTranslations('microsegPilot.observation')
  const tp = useTranslations('microsegPilot.policy')
  const te = useTranslations('microsegPilot.overview.edge')
  const names = useContext(MapNamesContext)
  const format = useFormatter()
  const [open, setOpen] = useState(false)
  const when = (iso: string) => formatWhen(format, iso)
  const service = serviceTitle(s.proto, s.dport)
  const zoneName = (id: string) => zonesById.get(id)?.name ?? to('deletedZone')
  const source = s.src_zone_id ? zoneName(s.src_zone_id) : s.src_ip || to('unknownEndpoint')
  const destination = zoneName(s.dst_zone_id)
  const accept = t('flowPanel.acceptAs', { from: s.src_zone_id ? source : to('unknownEndpoint'), to: destination, service })

  return (
    <Box role='listitem' aria-label={to('rowLabel', { source, destination })} sx={{ borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 40, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <ObservedKindGlyph kind={s.kind} />
        <Tooltip title={`${source} → ${destination}`}>
          <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{`${source} → ${destination}`}</Typography>
        </Tooltip>
        <ServiceHits suggestion={s} />
        <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} acceptLabel={accept} />
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 5, pb: 1, minWidth: 0 }}>
          <OneLine text={observedHits(te as EdgeT, { ...names, zone: zoneName }, s, to('unknownEndpoint'), example !== null)} />
          {example && <OneLine text={example} />}
          <OneLine text={t('flowPanel.addresses', { from: s.src_ip || to('unknownEndpoint'), to: s.dst_ip || to('unknownEndpoint') })} />
          <OneLine text={to('detail.firstSeen', { time: when(s.first_seen) })} />
          <OneLine text={to('detail.lastSeen', { time: when(s.last_seen) })} />
          <OneLine text={t('flowPanel.status', { status: to(`status.${s.status}`) })} />
        </Box>
      </Collapse>
    </Box>
  )
}

/**
 * The edge clicked on the map. An observed one lists its flows (addresses, hits, first and last seen, status) with
 * the three ways out of the Observation sub-tab (one line per flow, details under the chevron), same semantics: accept as a flow of the zones, accept as a CIDR,
 * dismiss; a 409 re-reads the draft and the list. An allowed one lists its flows, the ones not applied yet marked.
 * A cell of the matrix is a pair with both: the observed section, then the allowed one.
 */
export default function EdgePanel({ edgeId, source, target, data, from, to, zonesById, unapplied, connectionId, version, reloadPolicy, reloadSuggestions, onResolved, onClose, onEdit }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const observedKind = data.kind === 'unprotected' || data.kind === 'blocked'
  const tokens = [...new Set([...data.flows, ...data.observed].map(f => flowService(f)))].sort()
  const servicesTip = tokens.length ? serviceTokensTitle(tokens) : data.label
  const observed = observedKind || data.observed.length > 0
  const allowed = !observedKind || data.flows.length > 0
  const names = useContext(MapNamesContext)
  const example = observedKind && isSampled(source, target) ? t('edge.example', { from: names.short(source), to: names.short(target) }) : null
  const title = example ?? `${from} → ${to}`
  const observedPage = usePaged(data.observed, ROWS_PER_PAGE)
  const flowsPage = usePaged(data.flows, ROWS_PER_PAGE)
  const { busy, failure, clearFailure, resolve: resolveIds } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)

  async function resolve(id: string, action: SuggestionAction) {
    const outcome = await resolveIds([id], action)
    if (outcome?.resolved) onResolved(action)
  }

  return (
    <Box
      component='aside'
      aria-label={t('flowPanel.label', { from, to })}
      data-edge={edgeId}
      sx={{ width: { xs: '100%', lg: 400 }, flexShrink: 0, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, p: 2, maxHeight: 560, overflowY: 'auto' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Box component='span' aria-hidden sx={{ width: 18, borderTop: `2px ${data.kind === 'unprotected' || data.kind === 'outside' ? 'dashed' : 'solid'} ${data.color}`, flexShrink: 0 }} />
        <Tooltip title={title}>
          <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{title}</Typography>
        </Tooltip>
        <Chip size='small' variant='outlined' label={t(`legend.${data.kind === 'outside' ? 'allowed' : data.kind}`)} sx={{ flexShrink: 0 }} />
        <IconButton size='small' aria-label={t('panel.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>
      <Tooltip title={servicesTip}>
        <Typography noWrap variant='body2' color='text.secondary'>{data.label}</Typography>
      </Tooltip>
      {failure && <Alert severity='error' onClose={clearFailure} sx={{ mt: 1.5 }}>{failure}</Alert>}

      {observed && (
        <>
          {example && <OneLine text={t('flowPanel.sampleNote')} />}
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1.5 }}>{t('flowPanel.observed')}</Typography>
          <Box role='list'>
            {observedPage.rows.map(s => (
              <ObservedRow key={s.id} s={s} example={example} zonesById={zonesById} busy={busy} onResolve={action => resolve(s.id, action)} />
            ))}
          </Box>
          <PolicyPager count={observedPage.count} page={observedPage.page} size={observedPage.size} onPage={observedPage.setPage} />
        </>
      )}
      {allowed && (
        <>
          <Box sx={{ display: 'flex', gap: 1, my: 1.5 }}>
            <Button size='small' variant='outlined' startIcon={<i className='ri-pencil-line' />} onClick={onEdit}>{t('panel.editInPolicy')}</Button>
          </Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('flowPanel.allowed')}</Typography>
          <Box role='list'>
            {flowsPage.rows.map(f => (
              <Box role='listitem' key={f.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28, minWidth: 0 }}>
                <FlowSummary flow={f} zonesById={zonesById} />
                {unapplied?.has(f.id) && (
                  <Tooltip title={t('edge.draft')}><Chip size='small' color='warning' variant='outlined' label={t('flowPanel.draft')} sx={{ flexShrink: 0 }} /></Tooltip>
                )}
              </Box>
            ))}
          </Box>
          <PolicyPager count={flowsPage.count} page={flowsPage.page} size={flowsPage.size} onPage={flowsPage.setPage} />
        </>
      )}
    </Box>
  )
}
