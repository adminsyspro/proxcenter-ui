'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { Box, Card, Skeleton, Typography } from '@mui/material'
import { alpha, darken, decomposeColor, getContrastRatio, getLuminance, lighten, useTheme, type Theme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import { NodeGlyph, OsdGlyph, osdGlyphState } from '@/components/ui/glyphs'
import { pveStatusOfHost } from '@/lib/ceph/osdTable'
import type { HealthTarget } from '@/lib/ceph/cephHealthLinks'
import type { TrendState } from '@/lib/ceph/overview'

export { SectionCard } from '@/app/(dashboard)/infrastructure/resources/components/cockpit/ui'

/*
   Visual primitives of the Ceph cockpit. Colour is kept for states (ok, warning,
   error) and for the I/O series, the same everywhere: they all derive from the
   primary colour of the current theme (see `toneColor`). Figures are tabular,
   in the field's font.
*/

/*
   Fill chain. From `lg` the cockpit takes the whole height <main> leaves (every
   node of the chain is a flex column that grows into the free space); under
   `lg` the flow stays natural. Nodes grow from their content height, so a tab
   taller than the window simply makes the page scroll: nothing is clipped.
*/

/** A node of the fill chain: grows into the free height, children stack in a column. */
export const fillColumnLg = (theme: Theme) => ({
  [theme.breakpoints.up('lg')]: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' },
})

/** A node of the fill chain that keeps its own display (a grid): only grows. */
export const fillGrowLg = (theme: Theme) => ({
  [theme.breakpoints.up('lg')]: { flex: '1 1 auto', minHeight: 0 },
})

/** A wrapper whose single card goes down to the bottom of the wrapper, its content staying at the top. */
export const fillCardLg = (theme: Theme) => ({
  [theme.breakpoints.up('lg')]: {
    flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column',
    '& > .MuiCard-root': { height: 'auto', flex: '1 1 auto' },
  },
})

export type IoTone = 'read' | 'write' | 'recovery' | 'neutral' | 'warning'
export type DotState = 'ok' | 'warn' | 'error' | 'muted'
type StateKey = 'success' | 'warning' | 'error' | 'info' | 'primary'

/** Tabular figures: columns of numbers line up and a ticking value does not jiggle. */
export const TABULAR = { fontVariantNumeric: 'tabular-nums' } as const

type LoosePalette = { customColors?: Record<string, string | undefined> }

/** Palette of the theme as CSS variables when the app theme provides them, so the dark scheme follows. */
function palette(theme: Theme) {
  return (theme.vars?.palette ?? theme.palette) as Theme['palette'] & LoosePalette
}

/** Minimum contrast of a series line on the card surface (WCAG non-text, 3:1). */
export const SERIES_MIN_CONTRAST = 3

/** Minimum contrast ratio between the read and the write series (their luminance gap). */
export const SERIES_MIN_GAP = 1.6

/** Minimum contrast ratio between the recovery series and each of the two others. */
const RECOVERY_MIN_GAP = 1.3

/** Hue distance (degrees) under which the primary colour reads as the warning colour. */
const WARNING_HUE_RANGE = 25

const STEP = 0.025
const MAX_STEPS = 38

type Direction = 'lighten' | 'darken'

function shade(color: string, direction: Direction, amount: number): string {
  return direction === 'lighten' ? lighten(color, amount) : darken(color, amount)
}

/** Hue (0-360) of a colour, NaN for a grey. */
export function hueOf(color: string): number {
  const [r, g, b] = decomposeColor(color).values.map(v => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min

  if (d < 0.02) return Number.NaN

  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4

  return (h * 60 + 360) % 360
}

/** Smallest angle between two hues, in degrees. */
export function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 360

  return d > 180 ? 360 - d : d
}

/** Real surface colour of the cards (the contrast is computed on a value, not on a CSS variable). */
function surfaceOf(theme: Theme): string {
  const paper = theme.palette.background.paper

  try {
    getLuminance(paper)

    return paper
  } catch {
    return theme.palette.mode === 'dark' ? '#1E1E2D' : '#FFFFFF'
  }
}

/**
   First shade of `base`, searched step by step in `directions` order (the first
   direction that has a solution wins), that satisfies `accept`. Falls back to the
   base when nothing fits.
*/
function searchShade(base: string, directions: Direction[], accept: (c: string) => boolean): string {
  for (const direction of directions) {
    for (let i = 0; i <= MAX_STEPS; i++) {
      const c = i === 0 ? base : shade(base, direction, i * STEP)

      if (accept(c)) return c
    }
  }

  return base
}

export interface SeriesColors {
  read: string
  write: string
  recovery: string
}

/**
   Colours of the I/O series, derived from the primary colour of the theme (so
   they follow the preset the user picked) and adjusted in lightness until they
   hold up on the card surface. Real colour values, not CSS variables, since they
   are computed.
   - read: the primary, lightened or darkened (by its own luminance, not by the
     mode) until it reaches 3:1 on the surface;
   - write: same hue, with a minimal luminance gap against read, on the side that
     has the most room (away from the surface);
   - recovery: a third step of the same hue, apart from both.
*/
export function seriesColors(theme: Theme): SeriesColors {
  const surface = surfaceOf(theme)
  const primary = theme.palette.primary.main
  const onSurface = (c: string) => getContrastRatio(c, surface) >= SERIES_MIN_CONTRAST

  const baseDirections: Direction[] = getLuminance(primary) > 0.4 ? ['darken', 'lighten'] : ['lighten', 'darken']
  const read = searchShade(primary, baseDirections, onSurface)

  // Away from the surface first: that is where the contrast is gained.
  const away: Direction = getLuminance(surface) > 0.5 ? 'darken' : 'lighten'
  const toward: Direction = away === 'darken' ? 'lighten' : 'darken'
  const write = searchShade(read, [away, toward], c => onSurface(c) && getContrastRatio(c, read) >= SERIES_MIN_GAP)
  const writeSide: Direction = getLuminance(write) < getLuminance(read) ? 'darken' : 'lighten'
  const other: Direction = writeSide === 'darken' ? 'lighten' : 'darken'
  const recovery = searchShade(
    read,
    [other, writeSide],
    c => onSurface(c) && getContrastRatio(c, read) >= RECOVERY_MIN_GAP && getContrastRatio(c, write) >= RECOVERY_MIN_GAP,
  )

  return { read, write, recovery }
}

/** Solid colour of an I/O series (see `seriesColors`), or of a state. */
export function toneColor(theme: Theme, tone: IoTone): string {
  switch (tone) {
    case 'read':
    case 'write':
    case 'recovery':
      return seriesColors(theme)[tone]
    case 'warning':
      return palette(theme).warning.main
    default:
      return palette(theme).text.secondary
  }
}

/**
   Colour of the "unclean PGs" series: a state, so `warning`, unless the primary
   is itself close to the warning hue (the orange of the brand), where it would be
   mistaken for the read series: then `error`.
*/
export function uncleanColor(theme: Theme): string {
  const warning = theme.palette.warning.main
  const gap = hueGap(hueOf(theme.palette.primary.main), hueOf(warning))
  const close = Number.isFinite(gap) && gap < WARNING_HUE_RANGE
  const p = palette(theme)

  return close ? p.error.main : p.warning.main
}

/** A state colour at low opacity (halo, badge background), through the channel variable when there is one. */
export function softColor(theme: Theme, key: StateKey, opacity: number): string {
  const channel = theme.vars?.palette[key].mainChannel

  return channel ? `rgb(${channel} / ${opacity})` : alpha(theme.palette[key].main, opacity)
}

const DOT_COLOR: Record<DotState, string> = {
  ok: 'success.main',
  warn: 'warning.main',
  error: 'error.main',
  muted: 'text.disabled',
}

/** Dot of a Ceph health status: HEALTH_OK, HEALTH_WARN, HEALTH_ERR, anything else muted. */
export function healthDot(status: string | null | undefined): DotState {
  if (status === 'HEALTH_OK') return 'ok'
  if (status === 'HEALTH_WARN') return 'warn'
  if (status === 'HEALTH_ERR') return 'error'

  return 'muted'
}

export function StateDot({ state, size = 8, label }: { state: DotState; size?: number; label?: string }) {
  const theme = useTheme()

  return (
    <Box
      component='span'
      data-testid='state-dot'
      data-state={state}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'inline-block',
        flex: 'none',
        bgcolor: DOT_COLOR[state],
        // Only an error calls for a halo: it is the one state that must catch the eye in a list.
        ...(state === 'error' && { boxShadow: `0 0 0 3px ${softColor(theme, 'error', 0.16)}` }),
      }}
    />
  )
}

const pct1 = (ratio: number) => Math.round(ratio * 1000) / 10

/**
 * Fill gauge with the cluster's real thresholds drawn on it: a tick at nearfull and
 * one at full. The fill stays neutral below nearfull and only then takes a state colour.
 */
export function ThresholdBar({ value, max, nearfull, full, size = 'md' }: {
  value: number
  max: number
  nearfull: number
  full: number
  size?: 'sm' | 'md'
}) {
  const t = useTranslations('cephCockpit')
  const ratio = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0
  const tone = ratio >= full ? 'error' : ratio >= nearfull ? 'warn' : 'neutral'
  const height = size === 'sm' ? 6 : 8
  const fill = tone === 'error' ? 'error.main' : tone === 'warn' ? 'warning.main' : 'text.secondary'

  return (
    <Box
      role='meter'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={t('ui.thresholdBar', { used: pct1(ratio), nearfull: pct1(nearfull), full: pct1(full) })}
      sx={{ position: 'relative', height, borderRadius: height / 2, bgcolor: 'divider', my: '3px' }}
    >
      <Box
        data-testid='threshold-fill'
        data-tone={tone}
        sx={{ position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 'inherit', bgcolor: fill, transition: 'width 300ms ease' }}
        style={{ width: `${pct1(ratio)}%` }}
      />
      {[nearfull, full].map((mark, i) => (
        <Box
          key={i === 0 ? 'nearfull' : 'full'}
          data-testid='threshold-marker'
          aria-hidden
          sx={{ position: 'absolute', top: -3, bottom: -3, width: 2, ml: '-1px', borderRadius: 1, bgcolor: 'text.disabled' }}
          style={{ left: `${pct1(mark)}%` }}
        />
      ))}
    </Box>
  )
}

/**
 * Trend lines of one or more series on one shared scale (read and write side by side
 * keep their real proportion). The scale starts at zero, so a flat series is drawn
 * flat and a small rise is not blown up into a peak. A series under 2 points is left
 * out; with none left, nothing is drawn. `minExtent` is a floor for the top of the axis.
 */
export function SparkLines({ series, height = 28, minExtent = 0 }: { series: { data: number[]; tone: IoTone; dashed?: boolean }[]; height?: number; minExtent?: number }) {
  const theme = useTheme()
  const drawn = series
    .filter(s => s.data.length >= 2)
    .map(s => ({ tone: s.tone, dashed: s.dashed === true, values: s.data.map(v => (Number.isFinite(v) && v > 0 ? v : 0)) }))

  if (drawn.length === 0) return null

  // The axis always starts at 0 and spans at least `minExtent`: a tiny swing on a quiet series stays small.
  const max = Math.max(minExtent, ...drawn.flatMap(s => s.values))
  const pad = 2
  const pointsOf = (values: number[]) => values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100
      const y = max > 0 ? height - pad - (v / max) * (height - 2 * pad) : height - pad

      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`
    })
    .join(' ')

  return (
    <Box
      component='svg'
      data-testid='sparkline'
      aria-hidden
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio='none'
      sx={{ display: 'block', width: '100%', height }}
    >
      {drawn.map((s, i) => (
        <polyline
          key={`${s.tone}-${i}`}
          points={pointsOf(s.values)}
          fill='none'
          strokeWidth={1.6}
          strokeLinejoin='round'
          strokeLinecap='round'
          vectorEffect='non-scaling-stroke'
          strokeDasharray={s.dashed ? '4 3' : undefined}
          style={{ stroke: toneColor(theme, s.tone) }}
        />
      ))}
    </Box>
  )
}

/** Trend line of one series (see SparkLines). Under 2 points, nothing. */
export function Sparkline({ data, tone, height = 28, minExtent }: { data: number[]; tone: IoTone; height?: number; minExtent?: number }) {
  return <SparkLines series={[{ data, tone }]} height={height} minExtent={minExtent} />
}

/** Uppercase caption above a figure. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Typography
      component='div'
      sx={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary', lineHeight: 1.6 }}
    >
      {children}
    </Typography>
  )
}

/**
 * One headline figure: label, value (with an optional unit), a sub line, an optional
 * slot (a gauge) and the trend. `empty` says "no data" instead of a value or a curve.
 */
export function StatTile({ label, value, unit, sub, series, tone = 'neutral', empty = false, children }: {
  label: string
  value: string
  unit?: string
  sub?: ReactNode
  series?: number[]
  tone?: IoTone
  empty?: boolean
  children?: ReactNode
}) {
  const t = useTranslations('cephCockpit')

  return (
    <Card variant='outlined' sx={{ px: 2, py: 1.75, height: '100%' }}>
      <Eyebrow>{label}</Eyebrow>
      {empty ? (
        <Typography variant='body2' sx={{ color: 'text.disabled', mt: 0.75 }}>{t('ui.noData')}</Typography>
      ) : (
        <>
          <Typography component='div' sx={{ ...TABULAR, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.3 }}>
            {value}
            {unit && <Box component='span' sx={{ fontSize: 13, fontWeight: 500, color: 'text.secondary', ml: 0.5 }}>{unit}</Box>}
          </Typography>
          {sub && <Typography component='div' variant='caption' color='text.secondary' sx={{ ...TABULAR, display: 'block' }}>{sub}</Typography>}
          {children && <Box sx={{ mt: 1.25 }}>{children}</Box>}
          {series && series.length >= 2 && (
            <Box sx={{ mt: 1.25 }}>
              <Sparkline data={series} tone={tone} />
            </Box>
          )}
        </>
      )}
    </Card>
  )
}

type Translate = ReturnType<typeof useTranslations<'cephCockpit'>>

/** "4 s", "3 min", "2 h", "5 d" from a duration in ms. */
export function formatAge(t: Translate, ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))

  if (s < 60) return t('age.seconds', { count: s })
  if (s < 3600) return t('age.minutes', { count: Math.floor(s / 60) })
  if (s < 86_400) return t('age.hours', { count: Math.floor(s / 3600) })

  return t('age.days', { count: Math.floor(s / 86_400) })
}

/** A ratio as a percentage in the locale's format ("82%", "82 %"): one formatter for every percentage of the cockpit. */
export function usePercent(): (ratio: number, digits?: number) => string {
  const format = useFormatter()

  return useCallback(
    (ratio: number, digits = 0) => format.number(Number.isFinite(ratio) ? ratio : 0, { style: 'percent', maximumFractionDigits: digits }),
    [format],
  )
}

/**
 * The value held since its key last changed: a value rebuilt on every poll with the same
 * content keeps its identity, so the memoised children below it do not render again.
 */
export function useStableByKey<T>(value: T, key: string): T {
  const [held, setHeld] = useState({ key, value })

  if (held.key !== key) {
    setHeld({ key, value })

    return value
  }

  return held.value
}

/** Current time, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)

    return () => clearInterval(id)
  }, [intervalMs])

  return now
}

/** What a health link points at, as its label: `osd.3`, a pool name, Flags, or the tab. */
export function targetLabel(t: Translate, target: HealthTarget): string {
  if (target.item?.kind === 'osd') return `osd.${target.item.id}`
  if (target.item) return target.item.name
  if (target.focus === 'flags') return t('target.flags')

  return t(`tabs.${target.tab}`)
}

/* Drawer parts shared by the OSD and pool sheets. */

/** Whether the target of a key is a field the arrows belong to. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null

  if (!el || el === (globalThis as unknown as HTMLElement)) return false

  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable === true || ['combobox', 'listbox', 'slider'].includes(el.getAttribute?.('role') ?? '')
}

export function Tag({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'info' | 'warning' | 'error' }) {
  const color = tone === 'neutral' ? 'text.secondary' : tone === 'ok' ? 'success.main' : `${tone}.main`

  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 600, lineHeight: 1.7, px: 0.875, borderRadius: 1, border: '1px solid', borderColor: 'divider', color, whiteSpace: 'nowrap' }}>
      {children}
    </Box>
  )
}

export function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1, borderTop: '1px solid', borderColor: 'divider', fontSize: 12.5 }}>
      <Box component='span' sx={{ color: 'text.secondary', flex: 'none' }}>{label}</Box>
      <Box component='span' sx={{ ...TABULAR, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  )
}

/**
 * The curve zone of a tile. In Live, the curve itself (nothing under 2 points). Over a
 * stored period: a skeleton while it loads, "History unavailable" when the orchestrator
 * has none (404, older release) or fails, "No data yet over 24 h" under 2 points.
 * Never an empty frame that says nothing.
 */
export function TrendSlot({ state, enough, period, children, t, height = 28 }: { state: TrendState; enough: boolean; period: string; children: ReactNode; t: Translate; height?: number }) {
  if (state === 'live' || (state === 'ready' && enough)) return <>{children}</>
  if (state === 'loading') return <Skeleton data-testid='trend-loading' variant='rounded' height={height} />

  return (
    <Box
      data-testid={state === 'unavailable' ? 'trend-unavailable' : 'trend-empty'}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height, color: 'text.disabled' }}
    >
      <i className={state === 'unavailable' ? 'ri-history-line' : 'ri-time-line'} style={{ fontSize: 14 }} aria-hidden />
      <Typography component='span' variant='caption' sx={{ color: 'inherit' }} noWrap>
        {state === 'unavailable' ? t('overview.trend.unavailable') : t('overview.trend.notEnough', { period })}
      </Typography>
    </Box>
  )
}


/** Theme inputs of the product glyphs: the logo variant and the border of the status dot. */
function useGlyphTheme() {
  const theme = useTheme()

  return { dark: theme.palette.mode === 'dark', dotBorder: theme.palette.background.paper }
}

/** Node glyph of a CRUSH host: the Proxmox logo, the dot is the PVE status of the node the host resolves to (grey when none). */
export function HostGlyph({ host, inventory }: { host: string; inventory: { pveNodes?: readonly string[]; pveNodeStatus?: Record<string, string> } | null | undefined }) {
  const { dark, dotBorder } = useGlyphTheme()

  return <NodeGlyph status={pveStatusOfHost(host, inventory) ?? 'unknown'} dark={dark} dotBorder={dotBorder} />
}

/** OSD glyph: the disk icon, the dot is up and in (green), up and out (orange), down (red). */
export function CephOsdGlyph({ osd }: { osd: { up?: boolean; in?: boolean } | undefined }) {
  const { dotBorder } = useGlyphTheme()
  const t = useTranslations('cephCockpit')
  const key = osdGlyphState(osd)

  return <OsdGlyph osd={osd} dotBorder={dotBorder} label={t(`osd.glyph.${key}`)} />
}
