'use client'

import { Fragment, useMemo, useState, type ReactNode } from 'react'

import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TablePagination from '@mui/material/TablePagination'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import { GuestGlyph, NodeGlyph } from './glyphs'

/** One guest that no node other than its own can run. */
export interface PinnedGuest {
  connection_id: string
  vmid: number
  name: string
  node: string
  reason: string
}

/** One set of nodes the guests of a cluster can move between. */
export interface BalancingDomain {
  connection_id: string
  nodes: string[]
  guests: number
  spread: number
  /** What segmented this domain: 'network' (bridge or SDN VNet), 'storage'. */
  constraints?: string[]
}

/** One resource that narrows where a guest can run, and where it exists. */
export interface PlacementLimit {
  kind: 'network' | 'storage' | string
  resource: string
  /** The SDN zone carrying a VNet's restriction. */
  zone?: string
  nodes: string[]
}

/** One running guest that fewer nodes than the cluster can run. */
export interface RestrictedGuest {
  connection_id: string
  vmid: number
  name: string
  type?: string
  node: string
  /** The nodes that can run it, its own included, sorted. */
  nodes: string[]
  limits: PlacementLimit[]
}

/** One running guest automatic balancing leaves alone on purpose. */
export interface ExcludedGuest {
  connection_id: string
  vmid: number
  name: string
  type?: string
  node: string
  reason: 'tag' | 'local_disks' | 'guest_type' | string
  detail?: string
}

interface Props {
  pinnedGuests: PinnedGuest[]
  balancingDomains: BalancingDomain[]
  restrictedGuests?: RestrictedGuest[]
  excludedGuests?: ExcludedGuest[]
  connectionNames: Record<string, string>
  /** Current guest status keyed `connId:vmid`, for the status dots. */
  vmStatus?: Record<string, string>
  /** Current node status keyed `connId:node` (online, maintenance, ...). */
  nodeStatus?: Record<string, string>
}

// One grid per list so a long name never shifts the columns of its neighbours;
// the last column takes what is left and ends with an ellipsis.
const DOMAIN_COLUMNS = 'minmax(0, 1fr) 96px 96px'
const RESTRICTED_COLUMNS = '260px 150px 240px minmax(0, 1fr)'
const EXCLUDED_COLUMNS = '260px 150px minmax(0, 1fr)'
const PAGE_SIZES = [20, 50, 100]

const domainKey = (nodes: string[]) => [...nodes].sort().join(',')

/**
 * How placement is shaped on a cluster, guest by guest.
 *
 * A cluster where a bridge, an SDN zone or a storage exists on part of the
 * nodes is a valid shape: the guests that use it simply have fewer places to
 * go, and load is balanced inside each group of nodes. This card names those
 * guests and the resource behind each one, so the operator does not have to
 * guess, and keeps the warning tone for the only operational limit worth it:
 * a guest no other node can run. It renders nothing on a cluster with no
 * placement restriction, which is the common case.
 */
const PlacementConstraintsCard = ({
  pinnedGuests,
  balancingDomains,
  restrictedGuests = [],
  excludedGuests = [],
  connectionNames,
  vmStatus = {},
  nodeStatus = {}
}: Props) => {
  const t = useTranslations()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const clusters = useMemo(() => {
    const byCluster = <T extends { connection_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>()

      for (const row of rows) {
        const list = map.get(row.connection_id) || []

        list.push(row)
        map.set(row.connection_id, list)
      }

      return map
    }

    const domainsByCluster = byCluster(balancingDomains)
    const pinnedByCluster = byCluster(pinnedGuests)
    const restrictedByCluster = byCluster(restrictedGuests)
    const excludedByCluster = byCluster(excludedGuests)

    // A cluster is listed when placement is not uniform there (several
    // domains, a restricted or a pinned guest) or when the operator excluded
    // a guest by tag. A local-disk or guest-type exclusion alone does not
    // list a cluster: that would put the card on nearly every cluster.
    const ids = new Set<string>()

    for (const [id, domains] of domainsByCluster) {
      if (domains.length > 1) ids.add(id)
    }

    for (const id of pinnedByCluster.keys()) ids.add(id)
    for (const id of restrictedByCluster.keys()) ids.add(id)

    for (const [id, guests] of excludedByCluster) {
      if (guests.some(g => g.reason === 'tag')) ids.add(id)
    }

    return [...ids]
      .sort((a, b) => (connectionNames[a] || a).localeCompare(connectionNames[b] || b))
      .map(id => {
        const domains = [...(domainsByCluster.get(id) || [])].sort((a, b) => b.nodes.length - a.nodes.length)
        const restricted = restrictedByCluster.get(id) || []
        const pinned = pinnedByCluster.get(id) || []
        const restrictedKeys = new Set(restricted.map(g => domainKey(g.nodes)))

        // An orchestrator older than the per-guest report sends only the
        // pinned list: keep showing it, the restricted list covers it
        // otherwise (a pinned guest is a restricted guest with one node).
        const restrictedVmids = new Set(restricted.map(g => g.vmid))
        const legacyPinned = pinned.filter(g => !restrictedVmids.has(g.vmid))

        // Every node named by a domain: a domain covering them all is the
        // unrestricted one, where the guests are free to move anywhere.
        const everyNode = new Set(domains.flatMap(d => d.nodes))

        return {
          id,
          name: connectionNames[id] || id.slice(0, 12),
          domains: domains.map(domain => ({
            ...domain,
            key: domainKey(domain.nodes),
            wholeCluster: domain.nodes.length === everyNode.size,
            guestsNamed: restricted.filter(g => domainKey(g.nodes) === domainKey(domain.nodes))
          })),
          // Restricted guests whose node set matches no domain (the domain
          // list may have been filtered by scope) are still listed.
          orphanRestricted: restricted.filter(g => !domains.some(d => domainKey(d.nodes) === domainKey(g.nodes))),
          hasRestrictedKeys: restrictedKeys.size > 0,
          legacyPinned,
          pinnedCount: pinned.length + restricted.filter(g => g.nodes.length === 1 && !pinned.some(p => p.vmid === g.vmid)).length,
          excluded: excludedByCluster.get(id) || []
        }
      })
  }, [pinnedGuests, balancingDomains, restrictedGuests, excludedGuests, connectionNames])

  if (clusters.length === 0) return null

  // The warning tone is reserved for the one operational limit: a guest that
  // no other node can run cannot be evacuated for maintenance.
  const hasPinned = clusters.some(c => c.pinnedCount > 0)

  const limitShort = (limit: PlacementLimit) => {
    if (limit.kind === 'storage') return t('drsPage.limitStorageShort', { resource: limit.resource })
    if (limit.zone) return t('drsPage.limitVnetShort', { resource: limit.resource, zone: limit.zone })

    return t('drsPage.limitBridgeShort', { resource: limit.resource })
  }

  // The nodes where the resource exists are not on the line: they go in the tooltip.
  const limitText = (limit: PlacementLimit) => {
    const nodes = limit.nodes.join(', ')

    if (limit.kind === 'storage') return t('drsPage.limitStorage', { resource: limit.resource, nodes })
    if (limit.zone) return t('drsPage.limitVnet', { resource: limit.resource, zone: limit.zone, nodes })

    return t('drsPage.limitBridge', { resource: limit.resource, nodes })
  }

  const exclusionShort = (guest: ExcludedGuest) => {
    if (guest.reason === 'tag') return t('drsPage.excludedTagShort', { tag: guest.detail || 'pxc_ignore' })
    if (guest.reason === 'local_disks') return t('drsPage.excludedLocalDisksShort', { storages: guest.detail || '' })

    return t('drsPage.excludedGuestTypeShort')
  }

  const exclusionText = (guest: ExcludedGuest) => {
    if (guest.reason === 'tag') return t('drsPage.excludedByTag', { tag: guest.detail || 'pxc_ignore' })
    if (guest.reason === 'local_disks') return t('drsPage.excludedLocalDisks', { storages: guest.detail || '' })

    return t('drsPage.excludedGuestType')
  }

  const exclusionIcon = (reason: string) =>
    reason === 'tag' ? 'ri-price-tag-3-line' : reason === 'local_disks' ? 'ri-hard-drive-2-line' : 'ri-filter-off-line'

  const node = (connId: string, name: string) => (
    <Box key={name} component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <NodeGlyph status={nodeStatus[`${connId}:${name}`]} dark={dark} dotBorder={dotBorder} />
      <Typography variant='body2' component='span' noWrap>{name}</Typography>
    </Box>
  )

  const guest = (connId: string, row: { vmid: number; name: string; type?: string }, warn = false) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <GuestGlyph type={row.type} status={vmStatus[`${connId}:${row.vmid}`]} dotBorder={dotBorder} />
      <Typography variant='body2' noWrap sx={{ fontWeight: 500, color: warn ? 'warning.main' : 'text.primary' }}>
        {row.name}
      </Typography>
      <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>#{row.vmid}</Typography>
    </Box>
  )

  const cell = (children: ReactNode) => (
    <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1.5, overflow: 'hidden' }}>{children}</Box>
  )

  const headerRow = (columns: string, labels: string[]) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: columns, gap: 2, px: 1, pb: 0.5, borderBottom: 1, borderColor: 'divider' }}>
      {labels.map(label => (
        <Typography key={label} variant='caption' color='text.secondary' sx={{ fontWeight: 600 }} noWrap>{label}</Typography>
      ))}
    </Box>
  )

  const rowSx = (columns: string) => ({
    display: 'grid',
    gridTemplateColumns: columns,
    gap: 2,
    alignItems: 'center',
    px: 1,
    py: 0.75,
    borderBottom: 1,
    borderColor: 'divider',
    '&:last-of-type': { borderBottom: 0 }
  })

  const section = (title: string, icon: string, body: ReactNode) => (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant='overline' color='text.secondary' sx={{ display: 'flex', alignItems: 'center', gap: 0.75, lineHeight: 2 }}>
        <i className={icon} style={{ fontSize: 14 }} />
        {title}
      </Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Box sx={{ minWidth: 640 }}>{body}</Box>
      </Box>
    </Box>
  )

  return (
    <Card variant='outlined' sx={{ borderRadius: 2, borderColor: hasPinned ? 'warning.main' : 'divider' }}>
      <CardContent>
        <Typography variant='subtitle2' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-route-line' style={{ fontSize: 18 }} />
          {t('drsPage.placementConstraints')}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>
          {t('drsPage.placementConstraintsDesc')}
        </Typography>

        <Stack spacing={2} sx={{ mt: 2 }}>
          {clusters.map((cluster, index) => {
            const restricted = [...cluster.domains.flatMap(d => d.guestsNamed), ...cluster.orphanRestricted]

            return (
              <Box key={cluster.id}>
                {index > 0 && <Divider sx={{ mb: 2 }} />}
                <Typography variant='body2' sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-server-line' style={{ fontSize: 16, opacity: 0.8 }} />
                  {cluster.name}
                </Typography>

                {cluster.domains.length > 0 && section(t('drsPage.balancingDomainsTitle'), 'ri-git-branch-line', (
                  <>
                    {headerRow(DOMAIN_COLUMNS, [t('drsPage.colNodes'), t('drsPage.colGuests'), t('drsPage.colSpread')])}
                    {cluster.domains.map(domain => (
                      <Box key={domain.key} sx={rowSx(DOMAIN_COLUMNS)}>
                        {cell(
                          <>
                            {domain.nodes.map(n => node(cluster.id, n))}
                            {domain.wholeCluster && (
                              <Typography variant='caption' color='success.main' noWrap>{t('drsPage.domainWholeCluster')}</Typography>
                            )}
                            {domain.nodes.length === 1 && (
                              <Typography variant='caption' color='warning.main' noWrap>{t('drsPage.domainNoTarget')}</Typography>
                            )}
                          </>
                        )}
                        <Typography variant='body2'>{t('drsPage.domainGuests', { count: domain.guests })}</Typography>
                        <Typography variant='body2' color='text.secondary'>
                          {domain.nodes.length > 1 ? t('drsPage.spreadPts', { value: domain.spread.toFixed(1) }) : ''}
                        </Typography>
                      </Box>
                    ))}
                  </>
                ))}

                {restricted.length > 0 && section(t('drsPage.restrictedGuestsTitle'), 'ri-signpost-line', (
                  <>
                    {headerRow(RESTRICTED_COLUMNS, [t('drsPage.colGuest'), t('drsPage.colNode'), t('drsPage.colCanMoveTo'), t('drsPage.colLimitedBy')])}
                    <PagedRows rows={restricted} rowKey={g => `${g.connection_id}-${g.vmid}`} render={g => {
                      const pinned = g.nodes.length === 1
                      const others = g.nodes.filter(n => n !== g.node)

                      return (
                        <Box sx={rowSx(RESTRICTED_COLUMNS)} data-vmid={g.vmid}>
                          {guest(cluster.id, g, pinned)}
                          {cell(node(cluster.id, g.node))}
                          {cell(pinned
                            ? (
                              <Typography variant='body2' color='warning.main' sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} noWrap>
                                <i className='ri-error-warning-line' style={{ fontSize: 14 }} />
                                {t('drsPage.domainNoTarget')}
                              </Typography>
                            )
                            : others.map(n => node(cluster.id, n)))}
                          {cell(g.limits.map(limit => (
                            <Tooltip key={`${limit.kind}-${limit.resource}`} title={limitText(limit)} arrow>
                              <Typography variant='body2' color='text.secondary' noWrap sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                                <i className={limit.kind === 'storage' ? 'ri-hard-drive-2-line' : 'ri-git-branch-line'} style={{ fontSize: 14 }} />
                                {limitShort(limit)}
                              </Typography>
                            </Tooltip>
                          )))}
                        </Box>
                      )
                    }} />
                  </>
                ))}

                {cluster.legacyPinned.length > 0 && section(t('drsPage.pinnedGuestsTitle'), 'ri-error-warning-line', (
                  <>
                    {headerRow(EXCLUDED_COLUMNS, [t('drsPage.colGuest'), t('drsPage.colNode'), t('drsPage.reason')])}
                    <PagedRows rows={cluster.legacyPinned} rowKey={g => `${g.connection_id}-${g.vmid}`} render={g => (
                      <Box sx={rowSx(EXCLUDED_COLUMNS)} data-vmid={g.vmid}>
                        {guest(cluster.id, g, true)}
                        {cell(node(cluster.id, g.node))}
                        <Typography variant='body2' color='text.secondary' noWrap>{g.reason}</Typography>
                      </Box>
                    )} />
                  </>
                ))}

                {cluster.excluded.length > 0 && section(t('drsPage.excludedGuestsTitle'), 'ri-pause-circle-line', (
                  <>
                    {headerRow(EXCLUDED_COLUMNS, [t('drsPage.colGuest'), t('drsPage.colNode'), t('drsPage.reason')])}
                    <PagedRows rows={cluster.excluded} rowKey={g => `${g.connection_id}-${g.vmid}-${g.reason}`} render={g => (
                      <Box sx={rowSx(EXCLUDED_COLUMNS)} data-vmid={g.vmid}>
                        {guest(cluster.id, g)}
                        {cell(node(cluster.id, g.node))}
                        <Tooltip title={exclusionText(g)} arrow>
                          <Typography variant='body2' color='text.secondary' noWrap sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            <i className={exclusionIcon(g.reason)} style={{ fontSize: 14 }} />
                            {exclusionShort(g)}
                          </Typography>
                        </Tooltip>
                      </Box>
                    )} />
                  </>
                ))}
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}

/** A list that pages itself past 20 rows, with the usual 20/50/100 choice. */
function PagedRows<T>({ rows, rowKey, render }: { rows: T[]; rowKey: (row: T) => string; render: (row: T) => ReactNode }) {
  const t = useTranslations()
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(PAGE_SIZES[0])
  const paged = rows.length > PAGE_SIZES[0]
  const visible = paged ? rows.slice(page * size, page * size + size) : rows

  return (
    <>
      {visible.map(row => <Fragment key={rowKey(row)}>{render(row)}</Fragment>)}
      {paged && (
        <TablePagination
          component='div'
          count={rows.length}
          page={page}
          rowsPerPage={size}
          rowsPerPageOptions={PAGE_SIZES}
          labelRowsPerPage={t('common.rowsPerPage')}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={e => { setSize(Number(e.target.value)); setPage(0) }}
        />
      )}
    </>
  )
}

export default PlacementConstraintsCard
