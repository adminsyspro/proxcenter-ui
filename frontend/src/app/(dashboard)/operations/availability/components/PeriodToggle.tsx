'use client'

import { useTranslations } from 'next-intl'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'

import { PERIODS, type Period } from '@/lib/availability/period'

interface Props {
  value: Period
  onChange: (period: Period) => void
}

export default function PeriodToggle({ value, onChange }: Props) {
  const t = useTranslations('availability')

  return (
    <ToggleButtonGroup
      exclusive
      size='small'
      value={value}
      aria-label={t('periods.label')}
      onChange={(_, next: Period | null) => { if (next) onChange(next) }}
    >
      {PERIODS.map(p => (
        <ToggleButton key={p} value={p}>
          {t(`periods.${p}`)}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}
