'use client'

import { useMemo, type ReactNode } from 'react'
import { Alert, Box, Button, Chip, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, SuggestionAction } from '@/lib/microseg/types'
import { serviceLabel, serviceTitle } from '@/lib/network/serviceNames'

import FlowSummary from './FlowSummary'
import { ObservedKindGlyph, ResolveActions, useResolveSuggestions } from './observationParts'
import PolicyPager, { usePaged } from './PolicyPager'
import { targetSuggestions, type TargetFlow, type TargetGuest } from './targetModel'
import { bareIp } from './zoneGraph'
import ZoneStateChip from './ZoneStateChip'

const ROWS_PER_PAGE = 5

type Props = {
  target: TargetGuest
  zonesById: Map<string, MicrosegZone>
  /** The pending observed flows of the map. */
  suggestions: MicrosegSuggestion[]
  flows: MicrosegFlow[]
  /** The guest name of each known address (bare form). */
  peers: ReadonlyMap<string, string>
  connectionId: string
  version: number
  reloadPolicy: () => Promise<unknown>
  reloadSuggestions: () => Promise<unknown>
  onResolved: (action: SuggestionAction) => void
  onOpenZone: (zoneId: string) => void
  onClose: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component='section' aria-label={title} sx={{ mt: 1.5, minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{title}</Typography>
      {children}
    </Box>
  )
}

const Empty = ({ text }: { text: string }) => <Typography variant='body2' color='text.disabled'>{text}</Typography>

/** An observed flow of the guest on one line: direction, peer, service, hits, kind, the three ways out. */
function ObservedLine({ row, peers, zonesById, busy, onResolve }: {
  row: TargetFlow
  peers: ReadonlyMap<string, string>
  zonesById: Map<string, MicrosegZone>
  busy: boolean
  onResolve: (action: SuggestionAction) => void
}) {
  const t = useTranslations('microsegPilot.overview')
  const to = useTranslations('microsegPilot.observation')
  const s = row.suggestion
  const peer = (row.peerIp && peers.get(bareIp(row.peerIp))) || row.peerIp || to('unknownEndpoint')
  const where = t(row.direction === 'out' ? 'target.panel.outgoing' : 'target.panel.incoming', { peer })
  const service = serviceTitle(s.proto, s.dport)
  const zoneName = (id: string) => zonesById.get(id)?.name ?? to('deletedZone')
  const accept = t('flowPanel.acceptAs', { from: s.src_zone_id ? zoneName(s.src_zone_id) : to('unknownEndpoint'), to: zoneName(s.dst_zone_id), service })
  const acceptTip = t('target.panel.acceptTip', { from: s.src_zone_id ? zoneName(s.src_zone_id) : to('unknownEndpoint'), to: zoneName(s.dst_zone_id), service })
  const kind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
  return (
    <Box role='listitem' aria-label={where} data-suggestion={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 36, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <Tooltip title={where}>
        <i className={row.direction === 'out' ? 'ri-arrow-right-up-line' : 'ri-arrow-left-down-line'} style={{ flexShrink: 0 }} aria-hidden />
      </Tooltip>
      <Tooltip title={where}>
        <Typography noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0 }}>{peer}</Typography>
      </Tooltip>
      <Tooltip title={service}>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{serviceLabel(s.proto, s.dport)}</Typography>
      </Tooltip>
      <Typography noWrap variant='body2' color='text.secondary' sx={{ flexShrink: 0 }}>{to('hits', { count: s.hits })}</Typography>
      <Chip
        size='small'
        variant='outlined'
        color={kind === 'blocked' ? 'info' : 'error'}
        icon={<ObservedKindGlyph kind={s.kind} />}
        label={t(`legend.${kind}`)}
        sx={{ flexShrink: 0, maxWidth: 120 }}
      />
      <ResolveActions suggestion={s} busy={busy} onResolve={onResolve} acceptLabel={accept} acceptTip={acceptTip} />
    </Box>
  )
}

/**
 * The guest the map is targeted on: who and where it is, its zone (a button opens the zone panel), the pending
 * observed flows its addresses are the sample source or destination of (in and out, each with the three ways out of
 * the Observation sub-tab), and the allowed flows of its zone. One line per row, five rows per page.
 */
export default function TargetPanel({ target, zonesById, suggestions, flows, peers, connectionId, version, reloadPolicy, reloadSuggestions, onResolved, onOpenZone, onClose }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const zone = target.zoneId ? zonesById.get(target.zoneId) ?? null : null
  const observed = useMemo(() => targetSuggestions(suggestions, target), [suggestions, target])
  const allowed = useMemo(() => (zone ? flows.filter(f => f.src_zone_id === zone.id || f.dst_zone_id === zone.id) : []), [flows, zone])
  const observedPage = usePaged(observed, ROWS_PER_PAGE)
  const allowedPage = usePaged(allowed, ROWS_PER_PAGE)
  const { busy, failure, clearFailure, resolve: resolveIds } = useResolveSuggestions(connectionId, version, reloadPolicy, reloadSuggestions)
  const ips = target.ips.length ? t('node.guestIps', { ips: target.ips.join(', ') }) : t('node.guestNoIp')

  async function resolve(id: string, action: SuggestionAction) {
    const outcome = await resolveIds([id], action)
    if (outcome?.resolved) onResolved(action)
  }

  let observedEmpty: string | null = null
  if (!target.ips.length) observedEmpty = t('target.panel.noIps')
  else if (!observed.length) observedEmpty = t('target.panel.noObserved')

  return (
    <Box
      component='aside'
      aria-label={t('target.panel.label', { name: target.name })}
      data-target={target.key}
      sx={{ width: { xs: '100%', lg: 400 }, flexShrink: 0, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, p: 2, maxHeight: 560, overflowY: 'auto', overflowX: 'hidden' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <StatusIcon type='vm' vmType={target.type} status={target.status} />
        <Tooltip title={target.name}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', minWidth: 0 }}>{target.name}</Typography></Tooltip>
        <Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>
          {t('target.panel.where', { type: t(`target.type.${target.type}`), vmid: target.vmid, node: target.node })}
        </Typography>
        <IconButton size='small' aria-label={t('panel.close')} onClick={onClose}><i className='ri-close-line' /></IconButton>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, mt: 1 }}>
        {zone ? (
          <>
            <Chip
              size='small'
              variant='outlined'
              icon={<i className='ri-shield-fill' style={{ color: zone.color || undefined }} />}
              label={zone.name}
              sx={{ minWidth: 0, flex: '0 1 auto' }}
            />
            <ZoneStateChip state={zone.state} />
          </>
        ) : <Chip size='small' variant='outlined' label={t('target.panel.noZone')} sx={{ flexShrink: 0 }} />}
        <Box sx={{ flex: 1 }} />
        {zone && (
          <Button size='small' variant='outlined' startIcon={<i className='ri-shield-line' />} onClick={() => onOpenZone(zone.id)} sx={{ flexShrink: 0 }}>
            {t('target.panel.openZone')}
          </Button>
        )}
      </Box>
      <Tooltip title={ips}>
        <Typography noWrap variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>{ips}</Typography>
      </Tooltip>
      {failure && <Alert severity='error' onClose={clearFailure} sx={{ mt: 1.5 }}>{failure}</Alert>}

      <Section title={t('target.panel.observed')}>
        {observedEmpty && <Empty text={observedEmpty} />}
        <Box role='list'>
          {observedPage.rows.map(row => (
            <ObservedLine key={row.suggestion.id} row={row} peers={peers} zonesById={zonesById} busy={busy} onResolve={action => resolve(row.suggestion.id, action)} />
          ))}
        </Box>
        <PolicyPager count={observedPage.count} page={observedPage.page} size={observedPage.size} onPage={observedPage.setPage} />
      </Section>

      <Section title={t('target.panel.allowed')}>
        {!zone && <Empty text={t('target.panel.noZoneFlows')} />}
        {zone && !allowed.length && <Empty text={t('panel.noFlows')} />}
        <Box role='list'>
          {allowedPage.rows.map(f => (
            <Box role='listitem' key={f.id} sx={{ display: 'flex', alignItems: 'center', minHeight: 28, minWidth: 0 }}>
              <FlowSummary flow={f} zonesById={zonesById} />
            </Box>
          ))}
        </Box>
        <PolicyPager count={allowedPage.count} page={allowedPage.page} size={allowedPage.size} onPage={allowedPage.setPage} />
      </Section>
    </Box>
  )
}
