'use client'

import { useTranslations } from 'next-intl'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { ScheduleMode } from './types'

interface Props {
  value: ScheduleMode
  onChange: (m: ScheduleMode) => void
  disabled?: boolean
}

export default function ModeToggle({ value, onChange, disabled }: Props) {
  const t = useTranslations()
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      onChange={(_, v) => { if (v) onChange(v) }}
      size='small'
      disabled={disabled}
      fullWidth
    >
      <ToggleButton value='rpo' sx={{ textTransform: 'none', gap: 0.5 }}>
        <i className='ri-timer-flash-line' /> {t('siteRecovery.schedule.modeRpo')}
      </ToggleButton>
      <ToggleButton value='scheduled' sx={{ textTransform: 'none', gap: 0.5 }}>
        <i className='ri-calendar-schedule-line' /> {t('siteRecovery.schedule.modeScheduled')}
      </ToggleButton>
    </ToggleButtonGroup>
  )
}
