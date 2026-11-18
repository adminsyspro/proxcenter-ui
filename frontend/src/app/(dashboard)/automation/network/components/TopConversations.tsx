'use client'

import { useMemo } from 'react'
import { Box, Chip, Link, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, alpha, darken, lighten, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegSuggestion, MicrosegZone, SuggestionKind } from '@/lib/microseg/types'

import PostureCard from './PostureCard'
import type { BlockPhase } from './dashboardModel'
import type { Conversation, ConversationPart, RemotePeer } from './dashboardConversations'
import ClusterChip from './microseg/ClusterChip'
import { gatewayNameMap, namedAddress } from './microseg/gatewayNames'
import type { ObservationFocus } from './microseg/microsegTabTypes'
import { destinationName, endpoint } from './microseg/ObservationRow'
import { EDGE_COLORS } from './microseg/zoneGraph'

const KIND_COLOR: Record<SuggestionKind, string> = { would_block: EDGE_COLORS.unprotected, blocked: EDGE_COLORS.blocked }
const KIND_LABEL: Record<SuggestionKind, string> = { would_block: 'postureWouldBlock', blocked: 'postureBlocked' }
const ONE_LINE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const

function KindChip({ part, several }: { part: ConversationPart; several: boolean }) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const theme = useTheme()
  const color = KIND_COLOR[part.kind]
  const name = t(KIND_LABEL[part.kind])
  return (
    <Tooltip title={`${t('postureFlows', { count: part.flows })}, ${t('postureHits', { count: part.hits })}`}>
      <Chip
        size='small'
        label={several ? `${name} · ${format.number(part.hits, { notation: 'compact' })}` : name}
        data-testid={`conversation-part-${part.kind}`}
        sx={{ height: 22, fontWeight: 600, bgcolor: alpha(color, 0.14), color: theme.palette.mode === 'dark' ? lighten(color, 0.3) : darken(color, 0.2) }}
      />
    </Tooltip>
  )
}

/** Names the ends of a flow as the Observation does: a zone, a guest, a zone's gateway, an address or many destinations. */
function useEndNames(zones: readonly MicrosegZone[], guestName: (ip: string) => string | undefined) {
  const t = useTranslations('microsegPilot.observation')
  const tg = useTranslations('microsegPilot.gateway')
  return useMemo(() => {
    const byId = new Map(zones.map(z => [z.id, z]))
    const gateways = gatewayNameMap(zones, names => tg('name', { zones: names }))
    const gatewayName = (ip: string) => (gateways.has(ip) ? namedAddress(ip, gateways) : undefined)
    const named = (ip: string) => gatewayName(ip) ?? guestName(ip)
    return {
      zones: byId,
      // `bare`: an address two other clusters carry, never named after one of their guests.
      source: (s: MicrosegSuggestion, bare = false) => {
        const zoneId = s.src_zone_id || (s.direction === 'out' ? s.src_key : '')
        const name = bare ? gatewayName : named
        return zoneId ? endpoint(zoneId, s.src_ip, byId, t) : (name(s.src_ip) ?? endpoint('', s.src_ip, byId, t))
      },
      destination: (s: MicrosegSuggestion, bare = false) => destinationName(s, byId, ip => (bare ? gatewayName(ip) : named(ip)), t),
    }
  }, [zones, guestName, t, tg])
}

/** The flow a row is named from: the zone of a guest of another cluster put on its end when the engine left it in none. */
function namedSample(c: Conversation): MicrosegSuggestion {
  const peer = c.peer
  if (!peer?.zoneId) return c.sample
  return peer.end === 'src'
    ? (c.sample.src_zone_id ? c.sample : { ...c.sample, src_zone_id: peer.zoneId })
    : (c.sample.dst_zone_id ? c.sample : { ...c.sample, dst_zone_id: peer.zoneId })
}

/** The cluster of the end of a row that is a guest of another cluster (a shared policy), after its name. */
function PeerCluster({ cluster }: { cluster: { id: string; name: string } }) {
  return (
    <Box component='span' data-testid='conversation-peer-cluster' sx={{ display: 'inline-flex', flexShrink: 0, minWidth: 0 }}>
      <ClusterChip connectionId={cluster.id} name={cluster.name} compact />
    </Box>
  )
}

/**
 * "Top conversations": who talks to whom among the observed flows, the busiest pairs of a source and a destination,
 * one way, with their services, flows, hits and types. A row opens the Observation list on the zone it enters (or
 * leaves when outbound); under the table, how many pairs it leaves out and a link to every observed flow.
 */
export default function TopConversations({ phase, rows, total, zones, guestName, peerCluster, onOpen, onOpenAll }: {
  phase: BlockPhase
  rows: Conversation[]
  total: number
  zones: readonly MicrosegZone[]
  /** The guest that carries an address, once the guest list is read. */
  guestName: (ip: string) => string | undefined
  /** The chip of the cluster of a row's end on another cluster (a shared policy); its ID and the name the user sees. */
  peerCluster?: (cluster: RemotePeer['cluster']) => { id: string; name: string }
  onOpen?: (focus: ObservationFocus) => void
  onOpenAll?: () => void
}) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const names = useEndNames(zones, guestName)

  let body: React.ReactNode
  if (phase === 'loading') {
    body = (
      <Box data-testid='conversations-loading' sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} variant='rounded' height={28} />)}
      </Box>
    )
  } else if (phase === 'unavailable') {
    body = <Typography variant='body2' color='text.secondary'>{t('postureTrafficUnavailable')}</Typography>
  } else if (rows.length === 0) {
    body = <Typography variant='body2' color='text.secondary' data-testid='conversations-empty'>{t('postureNoConversations')}</Typography>
  } else {
    body = (
      <Box sx={{ overflowX: 'auto' }}>
        <Table size='small' data-testid='conversations-table' sx={{ tableLayout: 'fixed', minWidth: 760, '& td, & th': { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '22%' }}>{t('postureColSource')}</TableCell>
              <TableCell sx={{ width: '22%' }}>{t('postureColDestination')}</TableCell>
              <TableCell>{t('postureColServices')}</TableCell>
              <TableCell align='right' sx={{ width: 64 }}>{t('postureColFlows')}</TableCell>
              <TableCell align='right' sx={{ width: 104 }}>{t('postureColHits')}</TableCell>
              <TableCell sx={{ width: 250 }}>{t('postureColStatus')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(c => {
              const sample = namedSample(c)
              const bare = !!c.peer && c.peer.cluster === null && !c.peer.zoneId
              const source = names.source(sample, bare && c.peer?.end === 'src')
              const destination = names.destination(sample, bare && c.peer?.end === 'dst')
              const zone = names.zones.get(sample.src_zone_id || sample.src_key)
              const out = c.direction === 'out'
              const services = c.services.join(', ')
              const remote = c.peer && peerCluster ? peerCluster(c.peer.cluster) : null
              const sourceChip = remote && c.peer?.end === 'src' ? remote : null
              return (
                <TableRow
                  key={c.key}
                  hover={!!onOpen}
                  onClick={onOpen ? () => onOpen(c.focus) : undefined}
                  data-testid='conversation-row'
                  sx={{ cursor: onOpen ? 'pointer' : undefined }}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Tooltip title={t(out ? 'postureDirectionOut' : 'postureDirectionIn')}>
                        <Box component='i' className={out ? 'ri-logout-circle-r-line' : 'ri-login-circle-line'} aria-label={t(out ? 'postureDirectionOut' : 'postureDirectionIn')} data-testid={`conversation-way-${c.direction}`} sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                      </Tooltip>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: zone?.color || (sample.src_zone_id ? 'text.disabled' : 'error.main') }} />
                      <Tooltip title={source}><Typography variant='body2' sx={{ fontWeight: 600, ...ONE_LINE, ...(sourceChip ? { minWidth: 0 } : {}) }} data-testid='conversation-source'>{source}</Typography></Tooltip>
                      {sourceChip && <PeerCluster cluster={sourceChip} />}
                    </Box>
                  </TableCell>
                  <TableCell>
                    {remote && c.peer?.end === 'dst' ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                        <Tooltip title={destination}><Typography variant='body2' sx={{ minWidth: 0, ...ONE_LINE }} data-testid='conversation-destination'>{destination}</Typography></Tooltip>
                        <PeerCluster cluster={remote} />
                      </Box>
                    ) : (
                      <Tooltip title={destination}><Typography variant='body2' sx={ONE_LINE} data-testid='conversation-destination'>{destination}</Typography></Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={services}><Typography variant='body2' color='text.secondary' sx={ONE_LINE} data-testid='conversation-services'>{services}</Typography></Tooltip>
                  </TableCell>
                  <TableCell align='right'>{format.number(c.flows)}</TableCell>
                  <TableCell align='right'>{format.number(c.hits)}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap', overflow: 'hidden' }}>
                      {c.parts.map(part => <KindChip key={part.kind} part={part} several={c.parts.length > 1} />)}
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        <Box data-testid='conversations-footer' sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, pt: 1.25 }}>
          {total > rows.length && <Typography variant='caption' color='text.secondary'>{t('postureConversationsShown', { shown: rows.length, total })}</Typography>}
          {onOpenAll && (
            <Link component='button' type='button' variant='caption' underline='hover' onClick={onOpenAll} data-testid='conversations-all' sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}>
              {t('postureServicesAll')}
              <i className='ri-arrow-right-line' aria-hidden />
            </Link>
          )}
        </Box>
      </Box>
    )
  }

  return <PostureCard testId='conversations-card' title={t('postureConversationsTitle')} caption={t('postureConversationsCaption')} grow>{body}</PostureCard>
}
