'use client'

import { useTranslations } from 'next-intl'
import { Box, MenuItem, Select, Stack, Typography } from '@mui/material'
import ModeToggle from './ModeToggle'
import FrequencyPicker from './FrequencyPicker'
import TimezonePicker from './TimezonePicker'
import SchedulePreview from './SchedulePreview'
import { defaultSchedule, defaultTimezone, type ScheduleBuilderValue, type ScheduleSpec } from './types'

interface Props {
  value: ScheduleBuilderValue
  onChange: (v: ScheduleBuilderValue) => void
  disabled?: boolean
}

const RPO_PRESETS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
  { value: 86400, label: '24h' },
]

export default function ScheduleBuilder({ value, onChange, disabled }: Props) {
  const t = useTranslations()

  const setMode = (mode: 'rpo' | 'scheduled') => {
    if (mode === 'scheduled' && !value.scheduleSpec) {
      onChange({ ...value, mode, scheduleSpec: defaultSchedule(), timezone: value.timezone || defaultTimezone() })
      return
    }
    onChange({ ...value, mode })
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={2}>
        <ModeToggle value={value.mode} onChange={setMode} disabled={disabled} />

        {value.mode === 'rpo' && (
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.rpoTarget')}</Typography>
            <Select
              value={value.rpoTargetSeconds}
              onChange={e => onChange({ ...value, rpoTargetSeconds: Number(e.target.value) })}
              size='small' fullWidth disabled={disabled}
            >
              {RPO_PRESETS.map(p => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </Select>
          </Box>
        )}

        {value.mode === 'scheduled' && value.scheduleSpec && (
          <>
            <FrequencyPicker
              value={value.scheduleSpec}
              onChange={(spec: ScheduleSpec) => onChange({ ...value, scheduleSpec: spec })}
              disabled={disabled}
            />
            <TimezonePicker
              value={value.timezone}
              onChange={tz => onChange({ ...value, timezone: tz })}
              disabled={disabled}
            />
            <SchedulePreview spec={value.scheduleSpec} timezone={value.timezone} />
          </>
        )}
      </Stack>
    </Box>
  )
}
