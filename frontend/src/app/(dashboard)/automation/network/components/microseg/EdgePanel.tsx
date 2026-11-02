'use client'

import { useState } from 'react'
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'

import { OneLine, isVersionConflict, writeErrorMessage } from './dialogParts'
import FlowSummary from './FlowSummary'
import PolicyPager, { usePaged } from './PolicyPager'
import type { MapEdgeData } from './zoneGraph'

const ROWS_PER_PAGE = 5

type Props = {
  edgeId: string
  data: MapEdgeData
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

function ObservedRow({ s, from, to, zonesById, busy, onResolve }: {
  s: MicrosegSuggestion
  from: string
  to: string
  zonesById: Map<string, MicrosegZone>
  busy: boolean
  onResolve: (action: SuggestionAction) => void
}) {
  const t = useTranslations('microsegPilot.overview.flowPanel')
  const to_ = useTranslations('microsegPilot.observation')
  const format = useFormatter()
  const when = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
  }
  const service = s.dport ? `${s.proto}/${s.dport}` : s.proto
  const srcZone = s.src_zone_id ? zonesById.get(s.src_zone_id)?.name ?? to_('deletedZone') : ''
  const dstZone = zonesById.get(s.dst_zone_id)?.name ?? to_('deletedZone')
  const withIp = (name: string, ip: string) => (ip && !name.includes(ip) ? `${name} (${ip})` : name)
  const accept = t('acceptAs', { from: srcZone || to_('unknownEndpoint'), to: dstZone, service })

  return (
    <Box role='listitem' aria-label={`${service} ${to_('rowLabel', { source: from, destination: to })}`} sx={{ py: 1, borderBottom: 1, borderColor: 'divider', minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography noWrap fontWeight={600} sx={{ flexShrink: 0 }}>{service}</Typography>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{to_('hits', { count: s.hits })}</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size='small' variant='outlined' label={to_(`status.${s.status}`)} sx={{ flexShrink: 0 }} />
      </Box>
      <OneLine text={to_('detail.source', { value: withIp(from, s.src_ip) })} />
      <OneLine text={to_('detail.destination', { value: withIp(to, s.dst_ip) })} />
      <OneLine text={to_('detail.firstSeen', { time: when(s.first_seen) })} />
      <OneLine text={to_('detail.lastSeen', { time: when(s.last_seen) })} />
      <Box sx={{ display: 'flex', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
        <Tooltip title={s.src_zone_id ? accept : to_('acceptNoZone')}>
          <span style={{ minWidth: 0, maxWidth: '100%' }}>
            <Button size='small' variant='contained' disabled={busy || !s.src_zone_id} onClick={() => onResolve('accept')} sx={{ maxWidth: '100%' }}>
              <Box component='span' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{accept}</Box>
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={s.src_ip ? '' : to_('acceptCidrNoIp')}>
          <span><Button size='small' variant='outlined' disabled={busy || !s.src_ip} onClick={() => onResolve('accept_cidr')} sx={{ whiteSpace: 'nowrap' }}>{to_('acceptCidr')}</Button></span>
        </Tooltip>
        <Button size='small' color='inherit' disabled={busy} onClick={() => onResolve('dismiss')} sx={{ whiteSpace: 'nowrap' }}>{to_('dismiss')}</Button>
      </Box>
    </Box>
  )
}

/**
 * The edge clicked on the map. An observed one lists its flows (addresses, hits, first and last seen, status) with
 * the three ways out of the Observation sub-tab, same semantics: accept as a flow of the zones, accept as a CIDR,
 * dismiss; a 409 re-reads the draft and the list. An allowed one lists its flows, the ones not applied yet marked.
 */
export default function EdgePanel({ edgeId, data, from, to, zonesById, unapplied, connectionId, version, reloadPolicy, reloadSuggestions, onResolved, onClose, onEdit }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const tAll = useTranslations()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const observed = data.kind === 'unprotected' || data.kind === 'blocked'
  const observedPage = usePaged(data.observed, ROWS_PER_PAGE)
  const flowsPage = usePaged(data.flows, ROWS_PER_PAGE)

  async function resolve(id: string, action: SuggestionAction) {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      await microsegApi(connectionId).resolveSuggestions({ version, ids: [id], action })
      onResolved(action)
    } catch (e) {
      setFailure(writeErrorMessage(tAll as (key: string) => string, e))
      if (!isVersionConflict(e)) {
        setBusy(false)
        return
      }
    }
    await Promise.all([reloadPolicy().catch(() => undefined), reloadSuggestions().catch(() => undefined)])
    setBusy(false)
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
        <Tooltip title={`${from} → ${to}`}>
          <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{`${from} → ${to}`}</Typography>
        </Tooltip>
        <Chip size='small' variant='outlined' label={t(`legend.${data.kind === 'outside' ? 'allowed' : data.kind}`)} sx={{ flexShrink: 0 }} />
        <IconButton size='small' aria-label={t('panel.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>
      <Tooltip title={data.label}>
        <Typography noWrap variant='body2' color='text.secondary'>{data.label}</Typography>
      </Tooltip>
      {failure && <Alert severity='error' onClose={() => setFailure(null)} sx={{ mt: 1.5 }}>{failure}</Alert>}

      {observed ? (
        <>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1.5 }}>{t('flowPanel.observed')}</Typography>
          <Box role='list'>
            {observedPage.rows.map(s => (
              <ObservedRow key={s.id} s={s} from={from} to={to} zonesById={zonesById} busy={busy} onResolve={action => resolve(s.id, action)} />
            ))}
          </Box>
          <PolicyPager count={observedPage.count} page={observedPage.page} size={observedPage.size} onPage={observedPage.setPage} />
        </>
      ) : (
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
