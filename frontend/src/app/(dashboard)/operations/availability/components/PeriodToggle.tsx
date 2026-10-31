'use client'

import { useState } from 'react'

import { useFormatter, useTranslations } from 'next-intl'
import { Box, Button, Popover, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'

import { PERIODS, rangeError, type CustomRange, type Period, type PeriodWindow } from '@/lib/availability/period'

interface Props {
  value: PeriodWindow
  onChange: (period: PeriodWindow) => void
}

const pad = (n: number) => String(n).padStart(2, '0')

/** An instant as a datetime-local input shows it, in the browser's time zone. */
function toInput(iso: string): string {
  const d = new Date(iso)

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The value of a datetime-local input as an ISO instant, '' when empty or unreadable. */
function fromInput(value: string): string {
  const ms = Date.parse(value)

  return Number.isNaN(ms) ? '' : new Date(ms).toISOString()
}

/** The last 7 days: what the range picker offers first. */
function lastWeek(now: Date): CustomRange {
  return { from: new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString(), to: now.toISOString() }
}

/** The periods up to now, and a range picked by hand. */
export default function PeriodToggle({ value, onChange }: Readonly<Props>) {
  const t = useTranslations('availability')
  const format = useFormatter()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState<CustomRange>(() => (typeof value === 'string' ? lastWeek(new Date()) : value))

  const custom = typeof value === 'string' ? null : value
  const error = rangeError(draft, new Date())
  const short = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' })

  const openPicker = (target: HTMLElement) => {
    setDraft(custom ?? lastWeek(new Date()))
    setAnchor(target)
  }

  const apply = () => {
    if (error) return
    onChange(draft)
    setAnchor(null)
  }

  return (
    <>
      <ToggleButtonGroup
        exclusive
        size='small'
        value={custom ? 'custom' : value}
        aria-label={t('periods.label')}
        onChange={(event, next: Period | 'custom' | null) => {
          if (next === 'custom') openPicker(event.currentTarget as HTMLElement)
          else if (next) onChange(next)
        }}
      >
        {PERIODS.map(p => (
          <ToggleButton key={p} value={p}>
            {t(`periods.${p}`)}
          </ToggleButton>
        ))}
        <ToggleButton
          value='custom'
          // A second click on an active range reopens the picker, which ToggleButtonGroup reports as no change.
          onClick={event => { if (custom) openPicker(event.currentTarget) }}
          sx={{ gap: 1 }}
        >
          <i className='ri-calendar-line' aria-hidden='true' />
          {custom ? t('periods.range', { from: short(custom.from), to: short(custom.to) }) : t('periods.custom')}
        </ToggleButton>
      </ToggleButtonGroup>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1 } } }}
      >
        <Box
          component='form'
          role='group'
          aria-label={t('periods.custom')}
          onSubmit={event => { event.preventDefault(); apply() }}
          sx={{ p: 4, pt: 5, width: 320, display: 'flex', flexDirection: 'column', gap: 3 }}
        >
          <TextField
            type='datetime-local'
            size='small'
            label={t('periods.from')}
            value={toInput(draft.from)}
            onChange={e => setDraft(d => ({ ...d, from: fromInput(e.target.value) }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            type='datetime-local'
            size='small'
            label={t('periods.to')}
            value={toInput(draft.to)}
            onChange={e => setDraft(d => ({ ...d, to: fromInput(e.target.value) }))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Typography variant='caption' color={error ? 'error.main' : 'text.secondary'}>
            {t(error ? `periods.error.${error}` : 'periods.rangeHint')}
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size='small' onClick={() => setAnchor(null)}>{t('common.cancel')}</Button>
            <Button size='small' variant='contained' type='submit' disabled={error !== null}>{t('periods.apply')}</Button>
          </Box>
        </Box>
      </Popover>
    </>
  )
}
