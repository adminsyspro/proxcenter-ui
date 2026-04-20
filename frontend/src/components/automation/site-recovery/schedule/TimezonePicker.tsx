'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Autocomplete, TextField } from '@mui/material'

interface Props {
  value: string
  onChange: (tz: string) => void
  disabled?: boolean
}

export default function TimezonePicker({ value, onChange, disabled }: Props) {
  const t = useTranslations()
  const zones = useMemo(() => {
    try {
      const list = (Intl as any).supportedValuesOf?.('timeZone') as string[] | undefined
      return list?.length ? list : ['UTC', 'Europe/Paris', 'Europe/London', 'America/New_York']
    } catch {
      return ['UTC']
    }
  }, [])

  return (
    <Autocomplete
      value={value || null}
      onChange={(_, v) => onChange(v ?? '')}
      options={zones}
      disabled={disabled}
      size='small'
      renderInput={(params) => <TextField {...params} label={t('siteRecovery.schedule.timezone')} />}
    />
  )
}
