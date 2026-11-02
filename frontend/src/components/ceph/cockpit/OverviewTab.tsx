'use client'

import { useCallback, useEffect, useMemo, type ReactNode } from 'react'

import { Box, Link, Skeleton, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useFormatter, useTranslations } from 'next-intl'

import {
  binaryUnit, byteRateUnit, osdLatency, recoveryShown, seriesFromBuffer, tileSeriesFromHistory, trendStateOf,
  type TileSeries,
} from '@/lib/ceph/overview'
import type { CephLive, CephRange } from '@/lib/ceph/types'

import type { CockpitTabProps } from './CephCockpit'
import HostMap from './HostMap'
import { useCephHistory } from './hooks/useCephHistory'
import { useHostMapView } from './hooks/useHostMapView'
import { fillColumnLg, SparkLines, TrendSlot, StatTile, TABULAR, ThresholdBar, toneColor, type IoTone } from './ui'

/*
   Overview of the Ceph cockpit, read top to bottom in a few seconds: whether data is
   being rebuilt, the four headline figures with their trend over the period, then the hosts
   and their OSDs, which take the height left. Each object leads to its own sheet.
*/

type Translate = ReturnType<typeof useTranslations<'cephCockpit'>>

const EMPTY_SERIES: TileSeries = { readOps: [], writeOps: [], readBytes: [], writeBytes: [], rawRatio: [], latencyAvg: [] }
const FOCUS_IDS = { flags: 'ceph-overview-hosts' } as const
const HIGHLIGHT_MS = 1600

/** A short legend item: coloured dot and its figure. */
function SeriesValue({ tone, children }: { tone: IoTone; children: ReactNode }) {
  const theme = useTheme()

  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Box component='span' aria-hidden sx={{ width: 7, height: 7, borderRadius: '50%', flex: 'none' }} style={{ background: toneColor(theme, tone) }} />
      {children}
    </Box>
  )
}

function ReadWrite({ read, write, t }: { read: string; write: string; t: Translate }) {
  return (
    <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <SeriesValue tone='read'>{t('overview.tiles.read', { value: read })}</SeriesValue>
      <SeriesValue tone='write'>{t('overview.tiles.write', { value: write })}</SeriesValue>
    </Box>
  )
}

/** A colour (hex or CSS variable) at a low opacity, for the tinted backgrounds and hairlines. */
const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`

function RecoveryBanner({ live, onShowPerf, t }: { live: CephLive; onShowPerf: () => void; t: Translate }) {
  const theme = useTheme()
  const format = useFormatter()
  const { bytesPerSec, objectsPerSec, degraded, misplaced } = live.recovery
  const active = bytesPerSec > 0
  const accent = active ? toneColor(theme, 'recovery') : (theme.vars?.palette.warning.main ?? theme.palette.warning.main)
  const rate = byteRateUnit(bytesPerSec)
  const figures = [
    active ? `${format.number(bytesPerSec / rate.divisor, { maximumFractionDigits: 1 })} ${rate.unit}` : null,
    active && objectsPerSec > 0 ? t('overview.recovery.objectsRate', { count: format.number(objectsPerSec, { maximumFractionDigits: 0 }) }) : null,
    degraded > 0 ? t('overview.recovery.degraded', { count: degraded }) : null,
    misplaced > 0 ? t('overview.recovery.misplaced', { count: misplaced }) : null,
  ].filter((f): f is string => Boolean(f))

  // State icon first, a faint tint and a hairline of the state colour.
  return (
    <Box
      data-testid='recovery-banner'
      data-active={active ? 'true' : 'false'}
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, px: 2, py: 1.25, border: '1px solid', borderRadius: 1.25 }}
      style={{ background: tint(accent, 6), borderColor: tint(accent, 32) }}
    >
      <Box
        component='span'
        aria-hidden
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: '50%', flex: 'none', fontSize: 17 }}
        style={{ color: accent, background: tint(accent, 14) }}
      >
        <i className={active ? 'ri-loop-right-line' : 'ri-time-line'} />
      </Box>
      <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{active ? t('overview.recovery.title') : t('overview.recovery.waiting')}</Typography>
        <Typography variant='body2' color='text.secondary' sx={TABULAR}>{figures.join(t('ui.separator'))}</Typography>
      </Box>
      <Link component='button' type='button' underline='hover' onClick={onShowPerf} sx={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>
        {t('overview.recovery.showPerf')}
      </Link>
    </Box>
  )
}

/** Wraps the block a health link can scroll to, lights it up briefly when it does, and lets it grow into the free height. */
function Focusable({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Box
      id={id}
      sx={[
        {
          scrollMarginTop: 120, borderRadius: 1.5,
          outline: '2px solid', outlineOffset: 2, outlineColor: 'transparent', transition: 'outline-color 400ms',
          '&[data-focused="true"]': { outlineColor: 'info.main' },
        },
        fillColumnLg,
      ]}
    >
      {children}
    </Box>
  )
}

export default function OverviewTab({ conn, live, inventory, url, enterprise, ratios, focus, osdFlags, onNavigate }: CockpitTabProps) {
  const t = useTranslations('cephCockpit')
  const format = useFormatter()
  const range: CephRange = enterprise ? url.range : 'live'
  const { history, loading: historyLoading, error: historyError } = useCephHistory(conn, range, enterprise)
  const mapView = useHostMapView(url)
  const l = live.live
  const inv = inventory.inventory

  const series = useMemo(() => {
    if (range === 'live') return seriesFromBuffer(live.buffer)

    return history ? tileSeriesFromHistory(history) : EMPTY_SERIES
  }, [range, live.buffer, history])

  // A health link that points at the host map scrolls to it once per click (nonce).
  const nonce = focus?.nonce
  const kind = focus?.kind

  useEffect(() => {
    if (!kind || nonce === undefined) return

    const el = document.getElementById(FOCUS_IDS[kind])

    if (!el) return
    el.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    // The block lights up briefly: a DOM attribute, the highlight is not React state.
    el.dataset.focused = 'true'
    const timer = setTimeout(() => { el.dataset.focused = 'false' }, HIGHLIGHT_MS)

    return () => {
      clearTimeout(timer)
      el.dataset.focused = 'false'
    }
  }, [kind, nonce])

  const num = (v: number, digits = 0) => format.number(v, { maximumFractionDigits: digits, minimumFractionDigits: digits })

  // Raw capacity: the Live read (every 5 s), else the inventory.
  const raw = l && l.raw.total > 0
    ? { used: l.raw.used, total: l.raw.total }
    : inv && inv.capacity.rawTotalBytes > 0 ? { used: inv.capacity.rawUsedBytes, total: inv.capacity.rawTotalBytes } : null
  const io = l?.io ?? (inv
    ? { readOps: inv.performance.readOpsSec, writeOps: inv.performance.writeOpsSec, readBytes: inv.performance.readBytesSec, writeBytes: inv.performance.writeBytesSec }
    : null)
  const latency = inv ? osdLatency(inv.osds.list) : null

  const sizeUnit = raw ? binaryUnit(raw.total) : null
  const trend = range !== 'live' && series.rawRatio.length >= 2
    ? (series.rawRatio[series.rawRatio.length - 1] - series.rawRatio[0]) * 100
    : null
  const rateUnit = io ? byteRateUnit(io.readBytes + io.writeBytes) : null
  const rate = (v: number) => (rateUnit ? num(v / rateUnit.divisor, v / rateUnit.divisor < 10 && v > 0 ? 1 : 0) : '')

  const showPerf = () => onNavigate({ tab: 'perf' })
  // Stable across Live ticks (onNavigate is), so the memoised squares of the dense map do not render again.
  const openOsd = useCallback((id: number) => onNavigate({ tab: 'osd', item: { kind: 'osd', id } }), [onNavigate])

  const trendState = trendStateOf(range, history, historyLoading, historyError)
  const period = range === 'live' ? '' : t(`range.${range}`)
  const slot = (enough: boolean, children: ReactNode) => (
    <TrendSlot state={trendState} enough={enough} period={period} t={t}>{children}</TrendSlot>
  )

  return (
    <Box data-testid='overview-tab' sx={[{ display: 'flex', flexDirection: 'column', gap: 2 }, fillColumnLg]}>
      {l && recoveryShown(l) && <RecoveryBanner live={l} onShowPerf={showPerf} t={t} />}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 1.5 }}>
        <Box data-testid='tile-raw'>
          <StatTile
            label={t('overview.tiles.raw')}
            empty={!raw}
            value={raw ? num((raw.used / raw.total) * 100, 1) : ''}
            unit='%'
            sub={raw && sizeUnit ? (
              <>
                {t('overview.tiles.rawUsed', {
                  used: `${num(raw.used / sizeUnit.divisor, 1)} ${sizeUnit.unit}`,
                  total: `${num(raw.total / sizeUnit.divisor, 1)} ${sizeUnit.unit}`,
                })}
              </>
            ) : undefined}
          >
            {raw && <ThresholdBar value={raw.used} max={raw.total} nearfull={ratios.nearfull} full={ratios.full} />}
            {trendState !== 'live' && (
              <Box sx={{ mt: 1 }}>
                {slot(trend !== null, (
                  <Typography data-testid='raw-trend' component='div' variant='caption' color='text.secondary' sx={{ ...TABULAR, display: 'flex', alignItems: 'center', height: 28 }}>
                    {trend !== null && t('overview.tiles.trend', {
                      delta: format.number(trend, { maximumFractionDigits: 1, minimumFractionDigits: 1, signDisplay: 'exceptZero' }),
                      period,
                    })}
                  </Typography>
                ))}
              </Box>
            )}
          </StatTile>
        </Box>

        <Box data-testid='tile-iops'>
          <StatTile
            label={t('overview.tiles.iops')}
            empty={!io}
            value={io ? num(io.readOps + io.writeOps) : ''}
            sub={io ? <ReadWrite read={num(io.readOps)} write={num(io.writeOps)} t={t} /> : undefined}
          >
            {slot(series.readOps.length >= 2, <SparkLines series={[{ data: series.readOps, tone: 'read' }, { data: series.writeOps, tone: 'write' }]} />)}
          </StatTile>
        </Box>

        <Box data-testid='tile-throughput'>
          <StatTile
            label={t('overview.tiles.throughput')}
            empty={!io}
            value={io ? rate(io.readBytes + io.writeBytes) : ''}
            unit={rateUnit?.unit}
            sub={io ? <ReadWrite read={rate(io.readBytes)} write={rate(io.writeBytes)} t={t} /> : undefined}
          >
            {slot(series.readBytes.length >= 2, <SparkLines series={[{ data: series.readBytes, tone: 'read' }, { data: series.writeBytes, tone: 'write' }]} />)}
          </StatTile>
        </Box>

        <Box data-testid='tile-latency'>
          <StatTile
            label={t('overview.tiles.latency')}
            empty={!latency}
            value={latency ? num(latency.avg, 1) : ''}
            unit={t('overview.tiles.latencyUnit')}
            sub={latency && latency.max > 0 ? t('overview.tiles.latencyMax', { ms: format.number(latency.max, { maximumFractionDigits: 1 }), osd: latency.maxOsd }) : undefined}
          >
            {/* Live: the latency comes from the inventory (120 s), no curve. Over a period, the stored mean. */}
            {trendState !== 'live' && slot(series.latencyAvg.length >= 2, <SparkLines series={[{ data: series.latencyAvg, tone: 'neutral' }]} />)}
          </StatTile>
        </Box>
      </Box>

      <Focusable id={FOCUS_IDS.flags}>
        {inv ? (
          <HostMap
            inventory={inv}
            ratios={ratios}
            onOpenOsd={openOsd}
            hostFlags={osdFlags.hostFlags}
            osdFlags={osdFlags.osdFlags}
            checks={l?.health.checks ?? inv.health.checks}
            problemOnly={url.hosts === 'problem'}
            onProblemOnlyChange={on => url.set({ hosts: on ? 'problem' : 'all' })}
            view={mapView.view}
            onViewChange={mapView.choose}
            action={(
              <Link component='button' type='button' underline='hover' onClick={() => onNavigate({ tab: 'crush' })} sx={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {t('overview.hostMap.crush')}
                <i className='ri-arrow-right-line' aria-hidden />
              </Link>
            )}
          />
        ) : (
          <Skeleton data-testid='host-map-loading' variant='rounded' height={180} />
        )}
      </Focusable>
    </Box>
  )
}
