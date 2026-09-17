'use client'

import React from 'react'

import { Alert, Box, Button, Chip, Popover, Stack, TextField, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import {
  RRD_MAX_LOOKBACK_SECONDS,
  RRD_MIN_STEP_SECONDS,
  clampRrdWindow,
  stepSecondsForTimeframe,
  timeframeForWindow,
  type RrdRangeMeta,
  type RrdTimeframe,
  type RrdWindow
} from '@/lib/metrics/rrdRange'

export type MetricsRangeValue = { timeframe: RrdTimeframe; window: RrdWindow | null }

type Props = {
  timeframe: RrdTimeframe
  window?: RrdWindow | null
  /** What the route actually served, to report the real resolution. */
  meta?: RrdRangeMeta | null
  onChange: (value: MetricsRangeValue) => void
  /** Hide the custom entry where the data source cannot honour a window. */
  allowCustom?: boolean
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * A datetime-local field is read by the browser as local time, so its value
 * has to be built from the local getters: a UTC slice would shift the window
 * by the timezone offset on every round-trip (same trap as BroadcastTab).
 */
function toInputValue(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function fromInputValue(value: string): number | null {
  if (!value) return null
  const ms = Date.parse(value)

  if (Number.isNaN(ms)) return null

  return Math.floor(ms / 1000)
}

function formatWindowBound(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Chips for the five Proxmox archives plus a custom window. The presets are
 * the historical row, kept identical so every Performance card keeps its look;
 * the custom entry is what lets an operator land on a past incident instead of
 * a rolling window that always ends now.
 */
export default function MetricsRangeSelector({
  timeframe,
  window: activeWindow,
  meta,
  onChange,
  allowCustom = true
}: Props) {
  const t = useTranslations()
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  const [fromValue, setFromValue] = React.useState('')
  const [toValue, setToValue] = React.useState('')

  const presets: { label: string; value: RrdTimeframe }[] = [
    { label: '1h', value: 'hour' },
    { label: '24h', value: 'day' },
    { label: t('inventory.rrd7d'), value: 'week' },
    { label: t('inventory.rrd30d'), value: 'month' },
    { label: t('inventory.rrd1y'), value: 'year' }
  ]

  function formatStep(seconds: number): string {
    if (seconds >= 3_600) return t('metricsRange.stepHours', { n: Math.round(seconds / 3_600) })
    if (seconds >= 60) return t('metricsRange.stepMinutes', { n: Math.round(seconds / 60) })

    return t('metricsRange.stepSeconds', { n: Math.round(seconds) })
  }

  function openPicker(event: React.MouseEvent<HTMLElement>) {
    const now = Math.floor(Date.now() / 1000)
    const fallback = activeWindow ?? { from: now - 3_600, to: now }

    setFromValue(toInputValue(fallback.from))
    setToValue(toInputValue(fallback.to))
    setAnchorEl(event.currentTarget)
  }

  const draftFrom = fromInputValue(fromValue)
  const draftTo = fromInputValue(toValue)
  const draftValid = draftFrom != null && draftTo != null && draftTo > draftFrom

  // Everything the picker warns about is derived from the draft, so the
  // operator learns the limit before spending a round-trip on it.
  const draftStep = draftValid ? stepSecondsForTimeframe(timeframeForWindow({ from: draftFrom, to: draftTo })) : null
  const draftTooShort = draftValid && draftTo - draftFrom < RRD_MIN_STEP_SECONDS
  const draftTruncated = draftValid && clampRrdWindow({ from: draftFrom, to: draftTo }).truncated

  function apply() {
    if (!draftValid) return
    const { window: clamped } = clampRrdWindow({ from: draftFrom, to: draftTo })

    onChange({ timeframe: timeframeForWindow(clamped), window: clamped })
    setAnchorEl(null)
  }

  function clear() {
    onChange({ timeframe, window: null })
  }

  const effectiveStep = meta?.stepSeconds ?? stepSecondsForTimeframe(timeframe)

  // Only a custom window can come back empty or clamped, and saying so beats
  // a chart that silently draws nothing.
  let notice: string | null = null

  if (activeWindow && meta) {
    if (meta.points === 0) notice = t('metricsRange.empty')
    else if (meta.truncated)
      notice = t('metricsRange.beyondRetention', { days: Math.round(RRD_MAX_LOOKBACK_SECONDS / 86_400) })
  }

  return (
    <Stack spacing={0.25} alignItems='flex-end'>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
        {presets.map(opt => {
          const selected = !activeWindow && timeframe === opt.value

          return (
            <Chip
              key={opt.value}
              label={opt.label}
              size='small'
              onClick={() => onChange({ timeframe: opt.value, window: null })}
              sx={{
                height: 24,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: selected ? 'primary.main' : 'action.hover',
                color: selected ? 'primary.contrastText' : 'text.secondary',
                '&:hover': { bgcolor: selected ? 'primary.dark' : 'action.selected' },
                cursor: 'pointer'
              }}
            />
          )
        })}

        {allowCustom ? (
          <Tooltip
            title={
              activeWindow
                ? t('metricsRange.resolution', { step: formatStep(effectiveStep) })
                : t('metricsRange.dragHint')
            }
          >
            <Chip
              icon={<i className='ri-calendar-schedule-line' style={{ fontSize: 13 }} />}
              label={
                activeWindow
                  ? `${formatWindowBound(activeWindow.from)} → ${formatWindowBound(activeWindow.to)}`
                  : t('metricsRange.custom')
              }
              size='small'
              onClick={openPicker}
              onDelete={activeWindow ? clear : undefined}
              data-testid='metrics-range-custom'
              sx={{
                height: 24,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: activeWindow ? 'primary.main' : 'action.hover',
                color: activeWindow ? 'primary.contrastText' : 'text.secondary',
                '& .MuiChip-icon': { color: 'inherit', ml: 0.75 },
                '& .MuiChip-deleteIcon': { color: 'inherit', fontSize: 14 },
                '&:hover': { bgcolor: activeWindow ? 'primary.dark' : 'action.selected' },
                cursor: 'pointer'
              }}
            />
          </Tooltip>
        ) : null}

        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <Stack spacing={1.5} sx={{ p: 2, width: 340 }}>
            <Typography fontWeight={700} fontSize={13}>
              {t('metricsRange.custom')}
            </Typography>

            <TextField
              size='small'
              type='datetime-local'
              label={t('metricsRange.from')}
              value={fromValue}
              onChange={e => setFromValue(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              size='small'
              type='datetime-local'
              label={t('metricsRange.to')}
              value={toValue}
              onChange={e => setToValue(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />

            {draftValid && draftStep != null ? (
              <Typography variant='caption' color='text.secondary'>
                {t('metricsRange.resolution', { step: formatStep(draftStep) })}
              </Typography>
            ) : null}

            {!draftValid && fromValue && toValue ? (
              <Alert severity='error'>{t('metricsRange.invalidOrder')}</Alert>
            ) : null}

            {draftTooShort && draftStep != null ? (
              <Alert severity='warning'>{t('metricsRange.tooShort', { step: formatStep(RRD_MIN_STEP_SECONDS) })}</Alert>
            ) : null}

            {draftTruncated ? (
              <Alert severity='warning'>
                {t('metricsRange.beyondRetention', { days: Math.round(RRD_MAX_LOOKBACK_SECONDS / 86_400) })}
              </Alert>
            ) : null}

            <Stack direction='row' spacing={1} justifyContent='flex-end'>
              {activeWindow ? (
                <Button
                  size='small'
                  onClick={() => {
                    clear()
                    setAnchorEl(null)
                  }}
                >
                  {t('metricsRange.reset')}
                </Button>
              ) : null}
              <Button size='small' variant='contained' disabled={!draftValid} onClick={apply}>
                {t('metricsRange.apply')}
              </Button>
            </Stack>
          </Stack>
        </Popover>
      </Box>

      {notice ? (
        <Typography variant='caption' color='warning.main' data-testid='metrics-range-notice'>
          {notice}
        </Typography>
      ) : null}
    </Stack>
  )
}
