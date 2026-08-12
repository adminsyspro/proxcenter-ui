'use client'

import { useTranslations } from 'next-intl'

import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'

import { LOG_LEVELS, resolveLogLevel } from './logLevels'

interface LogLevelSelectProps {
  /** Current value of the rule's PVE `log` parameter. */
  value?: string | null
  onChange: (value: string) => void
  disabled?: boolean
}

/**
 * Log level picker for a single firewall rule (PVE `log` parameter).
 *
 * Shared by every rule dialog — cluster, host, VM/CT and security group —
 * so the nine levels and the `nolog` default are wired the same way
 * everywhere instead of each dialog offering its own subset.
 */
export default function LogLevelSelect({ value, onChange, disabled }: LogLevelSelectProps) {
  const t = useTranslations()
  const label = t('firewall.logLevel')

  // Widened on purpose: keeps the MUI Select generic on `string`, like every
  // other Select in the firewall dialogs.
  const level: string = resolveLogLevel(value)

  return (
    <FormControl fullWidth size="small" disabled={disabled}>
      <InputLabel>{label}</InputLabel>
      <Select value={level} label={label} onChange={(e) => onChange(e.target.value)}>
        {LOG_LEVELS.map(option => (<MenuItem key={option} value={option}>{option}</MenuItem>))}
      </Select>
    </FormControl>
  )
}
