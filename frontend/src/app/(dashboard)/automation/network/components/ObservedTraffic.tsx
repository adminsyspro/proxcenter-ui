'use client'

import { paletteAlpha } from './paletteAlpha'
import { Box, ButtonBase, Chip, Link, Skeleton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography, alpha, darken, lighten, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import PostureCard from './PostureCard'
import type { BlockPhase } from './dashboardModel'
import type { SuggestionKind } from '@/lib/microseg/types'

import { observedTokens, type PostureDistribution, type ServicePart, type ServiceRow, type ServiceStatus, type Share } from './dashboardPosture'
import type { ObservedService } from './microseg/microsegTabTypes'
import { EDGE_COLORS } from './microseg/zoneGraph'

/** The colours of the map: allowed green, not covered red, blocked blue. */
const STATUS_COLOR: Record<ServiceStatus, string> = { allowed: EDGE_COLORS.allowed, not_covered: EDGE_COLORS.unprotected, blocked: EDGE_COLORS.blocked }
/** The words of the tiles above the table: a flow not covered while its zone observes is one that would be blocked. */
const STATUS_LABEL: Record<ServiceStatus, string> = { allowed: 'postureAllowed', not_covered: 'postureWouldBlock', blocked: 'postureBlocked' }
/** The type of observed flow of a status; the allowed flows are not observed ones. */
const STATUS_KIND: Partial<Record<ServiceStatus, SuggestionKind>> = { not_covered: 'would_block', blocked: 'blocked' }

const TILE_SX = { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', alignItems: 'stretch', textAlign: 'left', gap: 0.5, p: 1.5, borderRadius: 2, minWidth: 0 } as const

/** One figure of the distribution; with `onClick` the whole tile is a button that opens what the figure counts. */
function Tile({ testId, label, value, caption, hint, color, onClick }: { testId: string; label: string; value: string; caption: string; hint?: string; color: string; onClick?: () => void }) {
  const theme = useTheme()
  const bgcolor = paletteAlpha(theme, 'text.primary', 0.035)
  const content = (
    <>
      {/* Up to two lines: a title is never cut when five tiles share a row. */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
        <Typography
          variant='caption'
          sx={{ textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 10, lineHeight: 1.3, color: 'text.secondary', fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', flex: '1 1 auto', minWidth: 0 }}
        >
          {label}
        </Typography>
        {onClick && <Box component='i' className='ri-arrow-right-up-line' aria-hidden sx={{ fontSize: 14, lineHeight: 1, color: 'text.disabled', flexShrink: 0 }} />}
      </Box>
      <Typography sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15, color }} data-testid={`${testId}-value`}>{value}</Typography>
      {/* The caption in full when it is cut, or what it means when it needs saying. */}
      <Tooltip title={hint ?? caption}>
        <Typography variant='caption' color='text.secondary' noWrap>{caption}</Typography>
      </Tooltip>
    </>
  )
  if (!onClick) return <Box data-testid={testId} sx={{ ...TILE_SX, bgcolor }}>{content}</Box>
  return (
    <ButtonBase
      data-testid={testId}
      onClick={onClick}
      sx={{ ...TILE_SX, bgcolor, font: 'inherit', transition: 'background-color 0.15s', '&:hover, &.Mui-focusVisible': { bgcolor: paletteAlpha(theme, 'text.primary', 0.08) } }}
    >
      {content}
    </ButtonBase>
  )
}

/**
 * The tiles spread over the whole card: as many per row as hold 180 px (five on a wide card, 3 + 2 or 2 + 2 + 1 when
 * narrower), the rows of equal height filling the card's height (no empty band under them).
 */
const TILE_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))',
  gridAutoRows: '1fr',
  alignContent: 'stretch',
  gap: 1.5,
  flex: '1 1 auto',
} as const

const textOf = (color: string, mode: 'light' | 'dark') => (mode === 'dark' ? lighten(color, 0.3) : darken(color, 0.2))

/**
 * "Observed traffic distribution": where the hits come from, and the allowed, would-be-blocked and blocked flows (five
 * tiles). The three tiles of flows open what they count: the Policy for the allowed ones, the Observation list on
 * their type for the others.
 */
export function TrafficDistribution({ phase, distribution, onOpenObserved, onOpenUnknown, onOpenPolicy }: {
  phase: BlockPhase
  distribution: PostureDistribution
  onOpenObserved?: (kind: SuggestionKind) => void
  /** Opens the flows whose source is in no zone. */
  onOpenUnknown?: () => void
  onOpenPolicy?: () => void
}) {
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
        {[0, 1, 2, 3, 4].map(i => <Skeleton key={i} variant='rounded' height={86} />)}
      </Box>
    )
  } else if (phase === 'unavailable') {
    body = <Typography variant='body2' color='text.secondary'>{t('postureTrafficUnavailable')}</Typography>
  } else {
    const d = distribution
    const blockedParts = [
      d.blockedZones.length ? t('postureBlockedIn', { zones: format.list(d.blockedZones, { type: 'conjunction' }) }) : '',
      d.blockedOutZones.length ? t('postureBlockedOut', { zones: format.list(d.blockedOutZones, { type: 'conjunction' }) }) : '',
    ].filter(Boolean)
    const blockedCaption = blockedParts.length ? blockedParts.join(', ') : t('postureBlockedNone')
    const none = d.total === 0
    body = (
      <Box sx={TILE_GRID}>
        <Tile testId='tile-east-west' label={t('postureEastWest')} value={none ? '-' : percent(d.eastWest)} caption={hits(d.eastWest)} color={textOf(EDGE_COLORS.blocked, mode)} />
        <Tile testId='tile-unknown' label={t('postureUnknownSource')} value={none ? '-' : percent(d.unknown)} caption={hits(d.unknown)} color={textOf(EDGE_COLORS.unprotected, mode)} onClick={none ? undefined : onOpenUnknown} />
        <Tile testId='tile-allowed' label={t('postureAllowed')} value={t('postureFlows', { count: d.allowed })} caption={t('postureNoCounter')} hint={t('postureNoCounterHint')} color={textOf(EDGE_COLORS.allowed, mode)} onClick={onOpenPolicy} />
        <Tile testId='tile-would-block' label={t('postureWouldBlock')} value={t('postureFlows', { count: d.wouldBlock })} caption={t('postureAwaitingDecision')} color={textOf(EDGE_COLORS.unprotected, mode)} onClick={onOpenObserved && (() => onOpenObserved('would_block'))} />
        <Tile testId='tile-blocked' label={t('postureBlocked')} value={t('postureFlows', { count: d.blocked })} caption={blockedCaption} color={textOf(EDGE_COLORS.blocked, mode)} onClick={onOpenObserved && (() => onOpenObserved('blocked'))} />
      </Box>
    )
  }

  return <PostureCard testId='distribution-card' title={t('postureDistributionTitle')} grow>{body}</PostureCard>
}

/** The part of a service under one status: a chip, with its hits when the service has several parts, that opens what it counts. */
function PartChip({ part, several, onClick }: { part: ServicePart; several: boolean; onClick?: () => void }) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const theme = useTheme()
  const color = STATUS_COLOR[part.status]
  const name = t(STATUS_LABEL[part.status])
  const label = several && part.hits !== null ? `${name} · ${format.number(part.hits, { notation: 'compact' })}` : name
  const flows = t('postureFlows', { count: part.flows })
  const tip = part.hits === null ? flows : `${flows}, ${t('postureHits', { count: part.hits })}`
  return (
    <Tooltip title={tip}>
      <Chip
        size='small'
        label={label}
        onClick={onClick}
        data-testid={`service-part-${part.status}`}
        sx={{ height: 22, fontWeight: 600, bgcolor: alpha(color, 0.14), color: textOf(color, theme.palette.mode), '&.MuiChip-clickable:hover': { bgcolor: alpha(color, 0.24) } }}
      />
    </Tooltip>
  )
}

/**
 * "Top services by hits": service (name, raw port in the tooltip), flows, hits, and its status or statuses. The name
 * opens the Observation list on the service, a status on the service and that type of flow; an allowed status opens
 * the Policy. Under the table, how many services it leaves out and a link to every observed flow.
 */
export function TopServices({ phase, rows, total, onOpenService, onOpenPolicy, onOpenAll }: {
  phase: BlockPhase
  rows: ServiceRow[]
  /** Every service seen, the rows being the busiest of them. */
  total?: number
  onOpenService?: (service: ObservedService, kind?: SuggestionKind) => void
  onOpenPolicy?: () => void
  /** Opens the Observation list, unfiltered. */
  onOpenAll?: () => void
}) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()

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
              const observed = observedTokens(row)
              const service = { label: row.label, tokens: observed }
              const openService = onOpenService && observed.length > 0 ? () => onOpenService(service) : undefined
              const openPart = (part: ServicePart) => {
                const kind = STATUS_KIND[part.status]
                if (!kind) return onOpenPolicy
                return onOpenService && (() => onOpenService({ label: row.label, tokens: part.tokens }, kind))
              }
              const name = <Typography variant='body2' noWrap sx={{ fontWeight: 600 }}>{row.label}</Typography>
              return (
                <TableRow key={row.key} data-testid={`service-${row.key}`}>
                  <TableCell sx={{ maxWidth: 200 }}>
                    <Tooltip title={row.tokens.join(', ')}>
                      {openService
                        ? <Link component='button' type='button' color='inherit' underline='hover' onClick={openService} data-testid={`service-open-${row.key}`} sx={{ display: 'block', maxWidth: '100%', textAlign: 'left' }}>{name}</Link>
                        : name}
                    </Tooltip>
                  </TableCell>
                  <TableCell align='right'>{format.number(row.flows)}</TableCell>
                  <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                    {row.hits === null
                      ? <Tooltip title={t('postureNoCounterHint')}><Typography variant='body2' color='text.secondary' component='span'>{t('postureNoCounter')}</Typography></Tooltip>
                      : format.number(row.hits)}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {row.parts.map(part => <PartChip key={part.status} part={part} several={row.parts.filter(p => p.hits !== null).length > 1} onClick={openPart(part)} />)}
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {(onOpenAll || (total ?? 0) > rows.length) && (
          <Box data-testid='services-footer' sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1, pt: 1.25 }}>
            {(total ?? 0) > rows.length && <Typography variant='caption' color='text.secondary'>{t('postureServicesShown', { shown: rows.length, total: total ?? 0 })}</Typography>}
            {onOpenAll && (
              <Link component='button' type='button' variant='caption' underline='hover' onClick={onOpenAll} data-testid='services-all' sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 600 }}>
                {t('postureServicesAll')}
                <i className='ri-arrow-right-line' aria-hidden />
              </Link>
            )}
          </Box>
        )}
      </Box>
    )
  }

  return <PostureCard testId='services-card' title={t('postureServicesTitle')}>{body}</PostureCard>
}
