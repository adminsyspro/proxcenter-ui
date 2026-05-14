'use client'

// Structured editor for PVE backup schedule expressions. The PVE field
// accepts a calendar event spec (`HH:MM`, `daily HH:MM`, `mon,wed,fri
// HH:MM`, `*-*-15 HH:MM`, `*/15`, ...). A free-text input was the
// previous behaviour and required tenants to know the syntax. This
// component compiles the four common cases into a small UI:
//
//   - frequency: daily / weekly / monthly
//   - time: HH:MM (HTML time input)
//   - days: weekly only — multi-select Mon..Sun
//   - day of month: monthly only — 1..28 (28 to be safe across months)
//
// An "Advanced" toggle exposes the raw string for power users (provider
// side mostly). On read, parseSchedule maps the existing expression to
// one of the structured shapes when possible; anything we can't parse
// falls into Advanced so the user keeps editing what they already had.

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// PVE accepts both `daily HH:MM` and bare `HH:MM` for the daily case.
// We emit the bare form because it round-trips through the parser
// without the `daily ` prefix surviving when the user toggles modes.
const TIME_RE = /^(\d{2}):(\d{2})$/
const DAILY_RE = /^(?:daily\s+)?(\d{2}:\d{2})$/
const WEEKLY_RE = /^([a-z]{3}(?:,[a-z]{3})*)\s+(\d{2}:\d{2})$/i
const WEEKLY_RANGE_RE = /^([a-z]{3})\.\.([a-z]{3})\s+(\d{2}:\d{2})$/i
const MONTHLY_RE = /^\*-\*-(\d{1,2})\s+(\d{2}:\d{2})$/

/**
 * Parse a PVE schedule string into a structured shape, or fall back to
 * { frequency: 'advanced', raw } if no pattern matches. Exported so
 * callers can use it independently if they need to (e.g. a list view
 * that wants to display "Daily at 02:00").
 */
export function parseSchedule(expr) {
  const s = String(expr || '').trim()

  if (!s) return { frequency: 'daily', time: '00:00', days: [], dayOfMonth: 1, advanced: false, raw: '' }

  // Bare HH:MM or `daily HH:MM`
  const dailyMatch = s.match(DAILY_RE)

  if (dailyMatch && TIME_RE.test(dailyMatch[1])) {
    return { frequency: 'daily', time: dailyMatch[1], days: [], dayOfMonth: 1, advanced: false, raw: s }
  }

  // mon..fri HH:MM — expand range to explicit days for the toggle group.
  const rangeMatch = s.match(WEEKLY_RANGE_RE)

  if (rangeMatch) {
    const start = WEEKDAYS.indexOf(rangeMatch[1].toLowerCase())
    const end = WEEKDAYS.indexOf(rangeMatch[2].toLowerCase())

    if (start >= 0 && end >= start) {
      return {
        frequency: 'weekly',
        time: rangeMatch[3],
        days: WEEKDAYS.slice(start, end + 1),
        dayOfMonth: 1,
        advanced: false,
        raw: s,
      }
    }
  }

  // mon,wed,fri HH:MM
  const weeklyMatch = s.match(WEEKLY_RE)

  if (weeklyMatch) {
    const days = weeklyMatch[1].toLowerCase().split(',').filter(d => WEEKDAYS.includes(d))

    if (days.length > 0) {
      return { frequency: 'weekly', time: weeklyMatch[2], days, dayOfMonth: 1, advanced: false, raw: s }
    }
  }

  // *-*-DD HH:MM
  const monthlyMatch = s.match(MONTHLY_RE)

  if (monthlyMatch) {
    const dom = Number.parseInt(monthlyMatch[1], 10)

    if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
      return { frequency: 'monthly', time: monthlyMatch[2], days: [], dayOfMonth: dom, advanced: false, raw: s }
    }
  }

  // Anything else: keep as-is in advanced mode.
  return { frequency: 'daily', time: '00:00', days: [], dayOfMonth: 1, advanced: true, raw: s }
}

export function serializeSchedule(state) {
  if (state.advanced) return state.raw || ''
  if (state.frequency === 'daily') return state.time || '00:00'

  if (state.frequency === 'weekly') {
    const days = (state.days || []).filter(d => WEEKDAYS.includes(d))

    if (days.length === 0) return state.time || '00:00'

    // Preserve the canonical Mon..Sun order so the string is stable.
    const ordered = WEEKDAYS.filter(d => days.includes(d))


return `${ordered.join(',')} ${state.time || '00:00'}`
  }

  if (state.frequency === 'monthly') {
    const dom = Math.max(1, Math.min(31, Number.parseInt(state.dayOfMonth, 10) || 1))


return `*-*-${String(dom).padStart(2, '0')} ${state.time || '00:00'}`
  }


return state.time || '00:00'
}

/**
 * Controlled component. `value` is the PVE schedule string, `onChange`
 * receives the new string each time the structured pieces change.
 */
export default function BackupSchedulePicker({ value, onChange, disabled = false }) {
  const t = useTranslations()

  // Initial parse — re-run only when `value` is meaningfully different
  // from what we last produced, so flipping the structured controls
  // doesn't fight the parent's onChange round-trip.
  const initial = useMemo(() => parseSchedule(value), [value])
  const [frequency, setFrequency] = useState(initial.frequency)
  const [time, setTime] = useState(initial.time)
  const [days, setDays] = useState(initial.days)
  const [dayOfMonth, setDayOfMonth] = useState(initial.dayOfMonth)
  const [advanced, setAdvanced] = useState(initial.advanced)
  const [raw, setRaw] = useState(initial.raw)

  // External value change → re-sync (e.g. dialog opened on a different
  // job). We only re-sync when the incoming value doesn't already match
  // what we'd produce — otherwise the controls would flicker.
  useEffect(() => {
    const reproduced = serializeSchedule({ frequency, time, days, dayOfMonth, advanced, raw })

    if (reproduced === (value ?? '')) return
    const parsed = parseSchedule(value)

    setFrequency(parsed.frequency)
    setTime(parsed.time)
    setDays(parsed.days)
    setDayOfMonth(parsed.dayOfMonth)
    setAdvanced(parsed.advanced)
    setRaw(parsed.raw)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Push every structured change up.
  const emit = (next) => {
    const merged = { frequency, time, days, dayOfMonth, advanced, raw, ...next }

    onChange?.(serializeSchedule(merged))
  }

  if (advanced) {
    return (
      <Stack spacing={1}>
        <FormControlLabel
          control={<Switch checked={advanced} onChange={(_, v) => { setAdvanced(v); emit({ advanced: v }) }} disabled={disabled} />}
          label={t('backups.scheduleAdvanced')}
        />
        <TextField
          size="small"
          label={t('backups.scheduleRaw')}
          value={raw}
          onChange={(e) => { setRaw(e.target.value); emit({ raw: e.target.value }) }}
          placeholder="*/15  ·  daily 02:00  ·  mon..fri 03:00"
          helperText={t('backups.scheduleRawHelp')}
          disabled={disabled}
          fullWidth
        />
      </Stack>
    )
  }

  return (
    <Stack spacing={1.5}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <FormControl size="small" disabled={disabled}>
          <InputLabel>{t('backups.scheduleFrequency')}</InputLabel>
          <Select
            value={frequency}
            onChange={(e) => { setFrequency(e.target.value); emit({ frequency: e.target.value }) }}
            label={t('backups.scheduleFrequency')}
          >
            <MenuItem value="daily">{t('backups.scheduleDaily')}</MenuItem>
            <MenuItem value="weekly">{t('backups.scheduleWeekly')}</MenuItem>
            <MenuItem value="monthly">{t('backups.scheduleMonthly')}</MenuItem>
          </Select>
        </FormControl>

        <TextField
          size="small"
          type="time"
          label={t('backups.scheduleTime')}
          value={time}
          onChange={(e) => { setTime(e.target.value); emit({ time: e.target.value }) }}
          disabled={disabled}
          InputLabelProps={{ shrink: true }}
        />
      </Box>

      {frequency === 'weekly' && (
        <Box>
          <Typography variant="caption" sx={{ display: 'block', mb: 0.5, opacity: 0.7 }}>
            {t('backups.scheduleDays')}
          </Typography>
          <ToggleButtonGroup
            size="small"
            value={days}
            onChange={(_, next) => { setDays(next || []); emit({ days: next || [] }) }}
            disabled={disabled}
          >
            {WEEKDAYS.map(d => (
              <ToggleButton key={d} value={d} sx={{ textTransform: 'capitalize', minWidth: 44 }}>
                {t(`backups.weekday.${d}`)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>
      )}

      {frequency === 'monthly' && (
        <TextField
          size="small"
          type="number"
          label={t('backups.scheduleDayOfMonth')}
          value={dayOfMonth}
          onChange={(e) => {
            const v = Math.max(1, Math.min(31, Number.parseInt(e.target.value, 10) || 1))

            setDayOfMonth(v)
            emit({ dayOfMonth: v })
          }}
          inputProps={{ min: 1, max: 31 }}
          disabled={disabled}
          sx={{ maxWidth: 200 }}
          helperText={t('backups.scheduleDayOfMonthHelp')}
        />
      )}

      <FormControlLabel
        control={<Switch size="small" checked={advanced} onChange={(_, v) => { setAdvanced(v); emit({ advanced: v }) }} disabled={disabled} />}
        label={<Typography variant="caption">{t('backups.scheduleAdvanced')}</Typography>}
      />
    </Stack>
  )
}
