'use client'

import { useTranslations } from 'next-intl'
import {
  Box, Checkbox, FormControlLabel, IconButton, MenuItem, Select, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material'
import NumericTextField from '@/components/ui/NumericTextField'
import { ALLOWED_INTERVAL_MINUTES, type ScheduleSpec } from './types'

interface Props {
  value: ScheduleSpec
  onChange: (v: ScheduleSpec) => void
  disabled?: boolean
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export default function FrequencyPicker({ value, onChange, disabled }: Props) {
  const t = useTranslations()

  const setMode = (mode: ScheduleSpec['mode']) => {
    if (mode === value.mode) return
    if (mode === 'interval') onChange({ mode: 'interval', everyMinutes: 30 })
    else if (mode === 'hourly') onChange({ mode: 'hourly', everyHours: 2 })
    else if (mode === 'daily') onChange({ mode: 'daily', times: ['03:00'], weekdays: [0, 1, 2, 3, 4, 5, 6] })
    else if (mode === 'weekly') onChange({ mode: 'weekly', weekdays: [0], time: '03:00' })
    else if (mode === 'monthly') onChange({ mode: 'monthly', dayOfMonth: 1, time: '03:00' })
  }

  return (
    <Box>
      <Tabs
        value={value.mode}
        onChange={(_, v) => setMode(v)}
        variant='fullWidth'
        sx={{ minHeight: 36, mb: 2, '& .MuiTab-root': { minHeight: 36, textTransform: 'none' } }}
      >
        <Tab value='interval' label={t('siteRecovery.schedule.freq.interval')} disabled={disabled} />
        <Tab value='hourly' label={t('siteRecovery.schedule.freq.hourly')} disabled={disabled} />
        <Tab value='daily' label={t('siteRecovery.schedule.freq.daily')} disabled={disabled} />
        <Tab value='weekly' label={t('siteRecovery.schedule.freq.weekly')} disabled={disabled} />
        <Tab value='monthly' label={t('siteRecovery.schedule.freq.monthly')} disabled={disabled} />
      </Tabs>

      {value.mode === 'interval' && (
        <Box>
          <Typography variant='caption'>{t('siteRecovery.schedule.interval')}</Typography>
          <Select
            size='small' fullWidth
            value={value.everyMinutes}
            onChange={e => onChange({ ...value, everyMinutes: Number(e.target.value) })}
            disabled={disabled}
          >
            {ALLOWED_INTERVAL_MINUTES.map(minutes => (
              <MenuItem key={minutes} value={minutes}>
                {minutes < 60
                  ? t(minutes === 1
                    ? 'siteRecovery.schedule.labels.intervalMinute'
                    : 'siteRecovery.schedule.labels.intervalMinutes', { n: minutes })
                  : t(minutes === 60
                    ? 'siteRecovery.schedule.labels.intervalHour'
                    : 'siteRecovery.schedule.labels.intervalHours', { n: minutes / 60 })}
              </MenuItem>
            ))}
          </Select>
        </Box>
      )}

      {value.mode === 'hourly' && (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant='caption'>{t('siteRecovery.schedule.everyNHours')}</Typography>
            <NumericTextField
              type='number' size='small' fullWidth
              inputProps={{ min: 1, max: 24 }}
              value={value.everyHours}
              onChange={everyHours => onChange({ ...value, everyHours })}
              fallback={1}
              min={1}
              max={24}
              disabled={disabled}
            />
          </Box>
          <FormControlLabel
            control={
              <Checkbox
                size='small'
                checked={value.windowStart !== undefined}
                onChange={e => onChange({
                  ...value,
                  windowStart: e.target.checked ? 20 : undefined,
                  windowEnd: e.target.checked ? 6 : undefined,
                })}
                disabled={disabled}
              />
            }
            label={<Typography variant='caption'>{t('siteRecovery.schedule.hourWindow')}</Typography>}
          />
          {value.windowStart !== undefined && value.windowEnd !== undefined && (
            <Stack direction='row' spacing={1}>
              <NumericTextField
                type='number' label={t('siteRecovery.schedule.startHour')} size='small'
                inputProps={{ min: 0, max: 23 }}
                value={value.windowStart}
                onChange={windowStart => onChange({ ...value, windowStart })}
                fallback={0}
                min={0}
                max={23}
                disabled={disabled}
              />
              <NumericTextField
                type='number' label={t('siteRecovery.schedule.endHour')} size='small'
                inputProps={{ min: 0, max: 23 }}
                value={value.windowEnd}
                onChange={windowEnd => onChange({ ...value, windowEnd })}
                fallback={0}
                min={0}
                max={23}
                disabled={disabled}
              />
            </Stack>
          )}
        </Stack>
      )}

      {value.mode === 'daily' && (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant='caption'>{t('siteRecovery.schedule.atHours')}</Typography>
            <Stack direction='row' spacing={1} flexWrap='wrap'>
              {value.times.map((time, i) => (
                <Stack key={i} direction='row' alignItems='center' spacing={0.5}>
                  <TextField
                    type='time' size='small' value={time}
                    onChange={e => {
                      const times = [...value.times]
                      times[i] = e.target.value
                      onChange({ ...value, times })
                    }}
                    disabled={disabled}
                  />
                  {value.times.length > 1 && (
                    <IconButton
                      size='small'
                      onClick={() => onChange({ ...value, times: value.times.filter((_, j) => j !== i) })}
                      disabled={disabled}
                    >
                      <i className='ri-close-line' style={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </Stack>
              ))}
              <IconButton
                size='small'
                onClick={() => onChange({ ...value, times: [...value.times, '12:00'] })}
                disabled={disabled}
              >
                <i className='ri-add-line' />
              </IconButton>
            </Stack>
          </Box>
          <WeekdaysSelector
            t={t}
            weekdays={value.weekdays}
            onChange={wd => onChange({ ...value, weekdays: wd })}
            disabled={disabled}
          />
        </Stack>
      )}

      {value.mode === 'weekly' && (
        <Stack spacing={1.5}>
          <WeekdaysSelector
            t={t}
            weekdays={value.weekdays}
            onChange={wd => onChange({ ...value, weekdays: wd })}
            disabled={disabled}
          />
          <TextField
            type='time' size='small' label={t('siteRecovery.schedule.atHours')}
            value={value.time}
            onChange={e => onChange({ ...value, time: e.target.value })}
            disabled={disabled}
          />
        </Stack>
      )}

      {value.mode === 'monthly' && (
        <Stack spacing={1.5}>
          <Box>
            <Typography variant='caption'>{t('siteRecovery.schedule.dayOfMonth')}</Typography>
            <Select
              size='small' fullWidth
              value={value.dayOfMonth}
              onChange={e => onChange({ ...value, dayOfMonth: Number(e.target.value) })}
              disabled={disabled}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                <MenuItem key={d} value={d}>{d}</MenuItem>
              ))}
            </Select>
          </Box>
          <TextField
            type='time' size='small' label={t('siteRecovery.schedule.atHours')}
            value={value.time}
            onChange={e => onChange({ ...value, time: e.target.value })}
            disabled={disabled}
          />
        </Stack>
      )}
    </Box>
  )
}

interface WeekdaysSelectorProps {
  t: ReturnType<typeof useTranslations>
  weekdays: number[]
  onChange: (wd: number[]) => void
  disabled?: boolean
}

function WeekdaysSelector({ t, weekdays, onChange, disabled }: WeekdaysSelectorProps) {
  const toggle = (d: number) => {
    onChange(weekdays.includes(d) ? weekdays.filter(x => x !== d) : [...weekdays, d].sort((a, b) => a - b))
  }
  return (
    <Box>
      <Typography variant='caption'>{t('siteRecovery.schedule.onWeekdays')}</Typography>
      <Stack direction='row' spacing={0.5}>
        {WEEKDAY_KEYS.map((k, d) => (
          <Box
            key={k}
            onClick={() => !disabled && toggle(d)}
            sx={{
              px: 1, py: 0.5, borderRadius: 1, cursor: disabled ? 'default' : 'pointer',
              border: '1px solid', borderColor: weekdays.includes(d) ? 'primary.main' : 'divider',
              bgcolor: weekdays.includes(d) ? 'primary.main' : 'transparent',
              color: weekdays.includes(d) ? 'primary.contrastText' : 'text.primary',
              userSelect: 'none', fontSize: '0.75rem',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {t(`siteRecovery.schedule.days.${k}`)}
          </Box>
        ))}
      </Stack>
    </Box>
  )
}
