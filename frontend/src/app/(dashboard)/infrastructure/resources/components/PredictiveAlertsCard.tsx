'use client'

import { Box, Skeleton, Stack, Tooltip, Typography } from '@mui/material'
import { useLocale, useTranslations } from 'next-intl'

import { gradientColorAt } from '../../inventory/components/UsageBar'
import type { PredictiveAlert } from '../types'
import { COLORS } from '../constants'
import { formatPct } from '../helpers'
import { SectionCard } from './cockpit/ui'

const FORECAST_DAYS = 30

const clampPct = (value: number) => Math.min(100, Math.max(0, value))

const ARC_START = 150
const ARC_SWEEP = 240
const SIZE = 132
// Rendered size: the dials grow with the card, up to this.
const DIAL_MAX = 172
const STROKE = 11
const RADIUS = (SIZE - STROKE) / 2 - 4
const CENTER = SIZE / 2

const pointAt = (pct: number, radius = RADIUS) => {
  const angle = ((ARC_START + (ARC_SWEEP * clampPct(pct)) / 100) * Math.PI) / 180

  return { x: CENTER + radius * Math.cos(angle), y: CENTER + radius * Math.sin(angle) }
}

/** The arc of the dial between two percentages. */
function arcPath(fromPct: number, toPct: number): string {
  const from = pointAt(fromPct)
  const to = pointAt(toPct)
  const largeArc = (ARC_SWEEP * (toPct - fromPct)) / 100 > 180 ? 1 : 0

  return `M ${from.x} ${from.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${to.x} ${to.y}`
}

// The full 240 degree arc; partial arcs are the same path dashed (pathLength 100).
const ARC_PATH = arcPath(0, 100)

/**
 * Round gauge: usage now in the gradient colour at that value, the next 30 days
 * as a faded extension, and the arc past the critical threshold tinted red, the
 * way a rev counter marks its red zone.
 */
function ForecastDial({ current, predicted, threshold }: { current: number; predicted: number; threshold: number }) {
  const now = clampPct(current)
  const later = clampPct(Math.max(current, predicted))
  const critical = clampPct(threshold)

  return (
    <Box component="svg" viewBox={`0 0 ${SIZE} ${SIZE}`} sx={{ width: '100%', maxWidth: DIAL_MAX, display: 'block', mx: 'auto' }} aria-hidden>
      <Box component="path" d={ARC_PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round"
        sx={{ stroke: theme => (theme.palette.mode === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)') }} />
      {critical < 100 && (
        // Its own arc, round at the end like the track (a dashed one would leave the track's round end grey).
        <path d={arcPath(critical, 100)} fill="none" strokeWidth={STROKE} strokeLinecap="round" stroke={COLORS.error} strokeOpacity={0.3} />
      )}
      {later > now && (
        <path d={ARC_PATH} fill="none" strokeWidth={STROKE} pathLength={100} strokeDasharray={`0 ${now} ${later - now} 100`} stroke={gradientColorAt(later)} strokeOpacity={0.35} />
      )}
      {now > 0 && (
        <path d={ARC_PATH} fill="none" strokeWidth={STROKE} strokeLinecap="round" pathLength={100} strokeDasharray={`${now} 100`} stroke={gradientColorAt(now)} />
      )}
    </Box>
  )
}

const RESOURCE_ICON: Record<string, { icon: string; color: string }> = {
  cpu: { icon: 'ri-cpu-line', color: COLORS.cpu },
  ram: { icon: 'ri-ram-2-line', color: COLORS.ram },
  storage: { icon: 'ri-hard-drive-3-line', color: COLORS.storage },
}

export default function PredictiveAlertsCard({ alerts, loading }: { alerts: PredictiveAlert[]; loading?: boolean }) {
  const t = useTranslations()
  const locale = useLocale()
  const points = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)

  const label = (resource: string) => {
    if (resource === 'cpu') return 'CPU'
    if (resource === 'ram') return t('monitoring.memory')
    if (resource === 'storage') return t('storage.title')

    return resource
  }

  const runway = (alert: PredictiveAlert) => {
    if (alert.daysToThreshold === null) return { text: t('resources.forecastCard.beyond'), color: 'text.secondary' }
    if (alert.daysToThreshold <= 0) return { text: t('resources.forecastCard.crossed', { threshold: alert.threshold }), color: COLORS.error }

    let color = 'text.secondary'
    if (alert.daysToThreshold <= 30) color = COLORS.error
    else if (alert.daysToThreshold <= 90) color = COLORS.warning

    return { text: t('resources.forecastCard.runway', { days: alert.daysToThreshold, threshold: alert.threshold }), color }
  }

  const trendLabel: Record<string, string> = {
    accelerating: t('resources.accelerating'),
    decelerating: t('resources.decelerating'),
    linear: t('resources.linear'),
    stable: t('resources.stable'),
  }

  // What the forecast missed by, 14 days ahead, when rerun from past days.
  const errors = alerts.map(a => a.forecastError).filter((e): e is number => typeof e === 'number').map(e => Math.round(e * 10) / 10)
  let measured = ''
  if (errors.length > 0) {
    const min = Math.min(...errors)
    const max = Math.max(...errors)

    measured = min === max
      ? t('resources.forecastCard.errorOne', { value: points(min) })
      : t('resources.forecastCard.error', { min: points(min), max: points(max) })
  }

  return (
    <SectionCard
      icon="ri-time-line"
      title={t('resources.forecastCard.title', { days: FORECAST_DAYS })}
      subtitle={t('resources.forecastCard.subtitle')}
      action={measured && !loading ? (
        <Tooltip title={t('resources.forecastCard.errorExplain')} arrow>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ cursor: 'help' }}>{measured}</Typography>
        </Tooltip>
      ) : undefined}
      fill
    >
      {loading ? (
        <Stack direction="row" spacing={2} sx={{ flex: 1, alignItems: 'center' }}>
          {[0, 1, 2].map(i => <Skeleton key={i} variant="circular" width={110} height={110} sx={{ mx: 'auto' }} />)}
        </Stack>
      ) : (
        <>
          <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5, alignItems: 'center' }}>
            {alerts.map(alert => {
              const { text, color } = runway(alert)
              const slope = (alert.predictedValue - alert.currentValue) / FORECAST_DAYS
              const hint = (
                <Box sx={{ fontSize: '0.75rem' }}>
                  {alert.trendType && <div>{t('resources.forecastCard.trend', { type: trendLabel[alert.trendType] ?? alert.trendType })}</div>}
                  <div>{t('resources.forecastCard.slope', { value: `${slope >= 0 ? '+' : ''}${slope.toFixed(2)}` })}</div>
                  {typeof alert.forecastError === 'number' && <div>{t('resources.forecastCard.errorHint', { value: points(alert.forecastError) })}</div>}
                </Box>
              )

              return (
                <Tooltip key={alert.resource} title={hint} arrow>
                  <Stack alignItems="center" sx={{ cursor: 'help', minWidth: 0 }}>
                    <Box sx={{ position: 'relative', width: '100%', maxWidth: DIAL_MAX }}>
                      <ForecastDial current={alert.currentValue} predicted={alert.predictedValue} threshold={alert.threshold} />
                      <Stack alignItems="center" justifyContent="center" sx={{ position: 'absolute', inset: 0, pb: 0.5 }}>
                        {RESOURCE_ICON[alert.resource] && (
                          <i className={RESOURCE_ICON[alert.resource].icon} aria-hidden style={{ fontSize: 20, color: RESOURCE_ICON[alert.resource].color, marginBottom: 2 }} />
                        )}
                        <Typography variant="h5" fontWeight={800} sx={{ lineHeight: 1.1 }}>{formatPct(alert.currentValue)}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>{`→ ${formatPct(alert.predictedValue)}`}</Typography>
                      </Stack>
                    </Box>
                    <Typography variant="body2" fontWeight={700} noWrap sx={{ mt: -1 }}>{label(alert.resource)}</Typography>
                    <Typography variant="caption" fontWeight={600} noWrap sx={{ color, maxWidth: '100%' }}>{text}</Typography>
                  </Stack>
                </Tooltip>
              )
            })}
          </Box>
          <Stack direction="row" spacing={2} sx={{ mt: 1.5, color: 'text.secondary' }} flexWrap="wrap" useFlexGap>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box sx={{ width: 14, height: 8, borderRadius: 0.5, bgcolor: gradientColorAt(50) }} />
              <Typography variant="caption">{t('resources.forecastCard.legendNow')}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box sx={{ width: 14, height: 8, borderRadius: 0.5, bgcolor: gradientColorAt(50), opacity: 0.35 }} />
              <Typography variant="caption">{t('resources.forecastCard.legendForecast', { days: FORECAST_DAYS })}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box sx={{ width: 14, height: 8, borderRadius: 0.5, bgcolor: COLORS.error, opacity: 0.3 }} />
              <Typography variant="caption">{t('resources.forecastCard.legendThreshold')}</Typography>
            </Stack>
          </Stack>
        </>
      )}
    </SectionCard>
  )
}
