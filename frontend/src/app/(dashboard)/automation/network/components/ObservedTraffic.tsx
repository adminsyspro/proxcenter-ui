'use client'

import { Box, Chip, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, alpha, darken, lighten, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { serviceTokenLabel, serviceTokenTitle } from '@/lib/network/serviceNames'

import PostureCard from './PostureCard'
import type { BlockPhase } from './dashboardModel'
import type { PostureDistribution, ServiceRow, ServiceStatus, Share } from './dashboardPosture'
import { EDGE_COLORS } from './microseg/zoneGraph'

/** The colours of the map: allowed green, not covered red, blocked blue. */
const STATUS_COLOR: Record<ServiceStatus, string> = { allowed: EDGE_COLORS.allowed, not_covered: EDGE_COLORS.unprotected, blocked: EDGE_COLORS.blocked }
const STATUS_LABEL: Record<ServiceStatus, string> = { allowed: 'postureAllowed', not_covered: 'postureNotCovered', blocked: 'postureBlocked' }

function Tile({ testId, label, value, caption, color, size = 26 }: { testId: string; label: string; value: string; caption: string; color: string; size?: number }) {
  const theme = useTheme()
  return (
    <Box data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.035), minWidth: 0 }}>
      <Typography variant='caption' noWrap sx={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, color: 'text.secondary', fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: size, fontWeight: 700, lineHeight: 1.15, color }} data-testid={`${testId}-value`}>{value}</Typography>
      <Tooltip title={caption}>
        <Typography variant='caption' color='text.secondary' noWrap>{caption}</Typography>
      </Tooltip>
    </Box>
  )
}

const TILE_GRID = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 } as const

const textOf = (color: string, mode: 'light' | 'dark') => (mode === 'dark' ? lighten(color, 0.3) : darken(color, 0.2))

/** "Observed traffic distribution": where the hits come from, and the allowed, would-be-blocked and blocked flows. */
export function TrafficDistribution({ phase, distribution }: { phase: BlockPhase; distribution: PostureDistribution }) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const theme = useTheme()
  const mode = theme.palette.mode
  const percent = (share: Share) => `${Math.round(share.percent)}%`
  const hits = (share: Share) => t('postureHits', { count: share.hits })

  let body: React.ReactNode
  if (phase === 'loading') {
    body = (
      <Box data-testid='distribution-loading' sx={TILE_GRID}>
        {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} variant='rounded' height={86} />)}
      </Box>
    )
  } else if (phase === 'unavailable') {
    body = <Typography variant='body2' color='text.secondary'>{t('postureTrafficUnavailable')}</Typography>
  } else {
    const d = distribution
    const blockedCaption = d.blockedZones.length ? t('postureBlockedIn', { zones: format.list(d.blockedZones, { type: 'conjunction' }) }) : t('postureBlockedNone')
    const none = d.total === 0
    body = (
      <>
        <Box sx={TILE_GRID}>
          <Tile testId='tile-east-west' label={t('postureEastWest')} value={none ? '-' : percent(d.eastWest)} caption={hits(d.eastWest)} color={textOf(EDGE_COLORS.blocked, mode)} />
          <Tile testId='tile-unknown' label={t('postureUnknownSource')} value={none ? '-' : percent(d.unknown)} caption={hits(d.unknown)} color={textOf(EDGE_COLORS.unprotected, mode)} />
          <Tile testId='tile-outside' label={t('postureToOutside')} value={d.outside.hits > 0 ? percent(d.outside) : '-'} caption={t('postureNotFiltered')} color='text.secondary' />
        </Box>
        <Box sx={TILE_GRID}>
          <Tile testId='tile-allowed' size={22} label={t('postureAllowed')} value={t('postureFlows', { count: d.allowed })} caption={t('postureNoCounter')} color={textOf(EDGE_COLORS.allowed, mode)} />
          <Tile testId='tile-would-block' size={22} label={t('postureWouldBlock')} value={t('postureFlows', { count: d.wouldBlock })} caption={t('postureAwaitingDecision')} color={textOf(EDGE_COLORS.unprotected, mode)} />
          <Tile testId='tile-blocked' size={22} label={t('postureBlocked')} value={t('postureFlows', { count: d.blocked })} caption={blockedCaption} color={textOf(EDGE_COLORS.blocked, mode)} />
        </Box>
      </>
    )
  }

  return <PostureCard testId='distribution-card' title={t('postureDistributionTitle')}>{body}</PostureCard>
}

/** "Top services by hits": service (name, raw port in the tooltip), flows, hits, status. */
export function TopServices({ phase, rows }: { phase: BlockPhase; rows: ServiceRow[] }) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const theme = useTheme()

  let body: React.ReactNode
  if (phase === 'loading') {
    body = (
      <Box data-testid='services-loading' sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {[0, 1, 2, 3].map(i => <Skeleton key={i} variant='rounded' height={28} />)}
      </Box>
    )
  } else if (phase === 'unavailable') {
    body = <Typography variant='body2' color='text.secondary'>{t('postureTrafficUnavailable')}</Typography>
  } else if (rows.length === 0) {
    body = <Typography variant='body2' color='text.secondary' data-testid='services-empty'>{t('postureNoServices')}</Typography>
  } else {
    body = (
      <Box sx={{ overflowX: 'auto' }}>
        <Table size='small' data-testid='services-table' sx={{ '& td, & th': { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('postureColService')}</TableCell>
              <TableCell align='right'>{t('postureColFlows')}</TableCell>
              <TableCell align='right'>{t('postureColHits')}</TableCell>
              <TableCell>{t('postureColStatus')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => {
              const color = STATUS_COLOR[row.status]
              return (
                <TableRow key={row.key} data-testid={`service-${row.key}`}>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Tooltip title={serviceTokenTitle(row.token)}>
                      <Typography variant='body2' noWrap sx={{ fontWeight: 600 }}>{serviceTokenLabel(row.token)}</Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align='right'>{format.number(row.flows)}</TableCell>
                  <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                    {row.hits === null ? <Typography variant='body2' color='text.secondary' component='span'>{t('postureNoCounter')}</Typography> : format.number(row.hits)}
                  </TableCell>
                  <TableCell>
                    <Chip size='small' label={t(STATUS_LABEL[row.status])} sx={{ height: 22, fontWeight: 600, bgcolor: alpha(color, 0.14), color: textOf(color, theme.palette.mode) }} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    )
  }

  return <PostureCard testId='services-card' title={t('postureServicesTitle')}>{body}</PostureCard>
}
