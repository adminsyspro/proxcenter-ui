'use client'

import React, { useEffect, useState } from 'react'

import { Box, Card, CardContent, CircularProgress, Collapse, IconButton, Stack, TablePagination, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import { PAGE_SIZES, STICKY_PAGER_SX } from '@/components/ui/PagedRows'
import { pageOf } from '@/lib/paging'

import { GRADIENT_GLASS, gradientSx } from '../../../inventory/components/UsageBar'
import { COLORS } from '../../constants'

export function usageColor(pct: number, warning: number, critical: number): string {
  if (pct >= critical) return COLORS.error
  if (pct >= warning) return COLORS.warning
  return COLORS.success
}

/**
 * Track + fill of a usage gauge, with the progressive green to red gradient of the
 * inventory gauges: the colour comes from how far the fill goes.
 */
function GaugeTrack({ pct, height }: { pct: number; height: number }) {
  const fill = Math.min(100, Math.max(0, pct))

  return (
    <Box sx={{
      position: 'relative', height, overflow: 'hidden', borderRadius: 0.5,
      bgcolor: theme => (theme.palette.mode === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'),
    }}>
      <Box aria-hidden sx={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fill}%`, ...gradientSx(fill), transition: 'width 300ms ease',
        '&::after': { content: '""', position: 'absolute', inset: 0, background: GRADIENT_GLASS, pointerEvents: 'none' },
      }} />
    </Box>
  )
}

/**
 * Usage percentage with its gauge. The gauge colour is progressive; the figure
 * turns orange or red once it passes the configured warning or critical threshold.
 */
export function UsageBar({ pct, warning, critical, width = 120 }: { pct: number; warning: number; critical: number; width?: number }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: width }}>
      <Box sx={{ flex: 1 }}><GaugeTrack pct={pct} height={8} /></Box>
      <Typography variant="body2" sx={{ minWidth: 44, textAlign: 'right', fontWeight: 600, color: pct >= warning ? usageColor(pct, warning, critical) : 'text.primary' }}>
        {Math.round(pct)}%
      </Typography>
    </Stack>
  )
}

/**
 * Card with an icon title and an optional right-hand slot, shared by every cockpit
 * section. With `onToggle`, the header folds the body away: `open` says whether it
 * shows.
 */
export function SectionCard({ id, icon, title, subtitle, action, children, flush = false, fill = false, open = true, onToggle }: {
  /** Anchor the "To handle" list scrolls to. */
  id?: string
  /** The body takes the card's whole height (a card beside a taller one). */
  fill?: boolean
  icon: string
  title: string
  subtitle?: string
  action?: React.ReactNode
  children: React.ReactNode
  /** Body edge to edge (a table), the header keeping its padding. */
  flush?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const t = useTranslations()
  const foldable = Boolean(onToggle)

  return (
    <Card id={id} variant="outlined" sx={{ height: '100%', scrollMarginTop: 88, ...(fill && { display: 'flex', flexDirection: 'column' }) }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 }, ...(flush && { px: 0 }), ...(fill && { flex: 1, display: 'flex', flexDirection: 'column' }) }}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1.5}
          onClick={onToggle}
          sx={{ mb: open ? 2 : 0, px: flush ? 2.5 : 0, transition: 'margin 150ms', ...(foldable && { cursor: 'pointer', userSelect: 'none' }) }}
        >
          <Box sx={{ width: 32, height: 32, borderRadius: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(COLORS.primary, 0.1), color: COLORS.primary, flexShrink: 0 }}>
            <i className={icon} style={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap>{title}</Typography>
            {subtitle && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>{subtitle}</Typography>}
          </Box>
          {action}
          {foldable && (
            <IconButton
              size="small"
              aria-expanded={open}
              aria-label={open ? t('resources.cockpit.collapse') : t('resources.cockpit.expand')}
              onClick={e => { e.stopPropagation(); onToggle?.() }}
            >
              <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 20 }} />
            </IconButton>
          )}
        </Stack>
        {foldable ? <Collapse in={open} unmountOnExit>{children}</Collapse> : children}
      </CardContent>
    </Card>
  )
}

/** A row the "To handle" list points at; `nonce` tells two clicks on the same row apart. */
export type RowFocus = { key: string; nonce: number }

/** Highlight of the row a "To handle" item points at: a short pulse, then it fades. */
export function focusRowSx(active: boolean) {
  return active
    ? {
        '@keyframes cockpitFocus': {
          '0%, 60%': { backgroundColor: alpha(COLORS.primary, 0.18) },
          '100%': { backgroundColor: 'transparent' },
        },
        animation: 'cockpitFocus 2.4s ease-out',
      }
    : {}
}

/**
 * Paging for a table: hands one page of rows to `children`, pager under the table
 * past 20 rows. `focusIndex` turns to the page holding that row.
 */
export function PagedTable<T>({ items, children, focusIndex, focusNonce }: {
  items: T[]
  children: (rows: T[]) => React.ReactNode
  focusIndex?: number
  focusNonce?: number
}) {
  const t = useTranslations()
  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(PAGE_SIZES[0])
  const { rows, page: current } = pageOf(items, page, perPage)

  // A new focus turns the page during render (no effect, no extra commit).
  const [seenNonce, setSeenNonce] = useState(focusNonce)
  if (focusNonce !== seenNonce) {
    setSeenNonce(focusNonce)
    if (focusIndex !== undefined && focusIndex >= 0) setPage(Math.floor(focusIndex / perPage))
  }

  return (
    <>
      {children(rows)}
      {items.length > PAGE_SIZES[0] && (
        <TablePagination
          component="div"
          count={items.length}
          page={current}
          onPageChange={(_e, p) => setPage(p)}
          rowsPerPage={perPage}
          onRowsPerPageChange={e => { setPerPage(Number(e.target.value)); setPage(0) }}
          rowsPerPageOptions={PAGE_SIZES}
          labelRowsPerPage={t('common.rowsPerPage')}
          sx={STICKY_PAGER_SX}
        />
      )}
    </>
  )
}

export function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 4, color: 'text.secondary' }}>
      <i className={icon} style={{ fontSize: 28, opacity: 0.5 }} />
      <Typography variant="body2" color="text.secondary">{text}</Typography>
    </Stack>
  )
}

export function formatDays(t: ReturnType<typeof useTranslations>, days: number | null | undefined): string {
  if (days === null || days === undefined) return t('resources.cockpit.beyondHorizon')
  if (days <= 0) return t('resources.cockpit.crossed')

  return t('resources.cockpit.daysShort', { days })
}

/**
 * Wait for a model answer, which takes from seconds to a minute. A spinner with a
 * plain sentence and the time already spent, so a slow answer does not read as a
 * hung page; no fake progress steps, the model gives none.
 */
export function AiPending({ title, hint, testId }: { title: string; hint: string; testId?: string }) {
  const t = useTranslations()
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)

    return () => clearInterval(timer)
  }, [])

  return (
    <Stack data-testid={testId} aria-busy="true" role="status" alignItems="center" spacing={1.25} sx={{ py: 5, textAlign: 'center' }}>
      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 0.5 }}>
        <CircularProgress variant="determinate" value={100} size={48} thickness={3} sx={{ color: alpha(COLORS.primary, 0.15) }} />
        <CircularProgress size={48} thickness={3} sx={{ color: COLORS.primary, position: 'absolute', left: 0 }} />
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.primary }}>
          <i className="ri-sparkling-line" style={{ fontSize: 20 }} />
        </Box>
      </Box>
      <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460 }}>{hint}</Typography>
      {seconds >= 3 && (
        <Typography variant="caption" color="text.secondary">{t('resources.cockpit.aiElapsed', { seconds })}</Typography>
      )}
    </Stack>
  )
}

/** Why, then what to do, on one line (it wraps when long): the reading of one risk or lever. */
export function Conclusion({ explanation, action }: { explanation: string; action: string }) {
  if (!explanation && !action) return null

  return (
    <Typography variant="body2" color="text.secondary">
      {explanation}
      {explanation && action && ' '}
      {action && (
        <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, whiteSpace: 'normal' }}>
          <i className="ri-arrow-right-line" aria-hidden style={{ fontSize: 15, color: COLORS.primary, verticalAlign: '-2px', marginRight: 4 }} />
          {action}
        </Box>
      )}
    </Typography>
  )
}
