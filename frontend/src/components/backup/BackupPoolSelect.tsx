'use client'

import { useId } from 'react'

import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'

export interface BackupPoolOption {
  poolid: string
  comment?: string | null
}

interface BackupPoolSelectProps {
  label: string
  /** Shown as a disabled entry when the cluster has no resource pool. */
  emptyLabel: string
  value: string
  options: BackupPoolOption[]
  onChange: (pool: string) => void
}

/** The resource pool a pool-based backup job targets. */
export default function BackupPoolSelect({ label, emptyLabel, value, options, onChange }: Readonly<BackupPoolSelectProps>) {
  const labelId = useId()

  return (
    <FormControl fullWidth size="small">
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select labelId={labelId} value={value} onChange={e => onChange(e.target.value)} label={label}>
        {options.length === 0 && (
          <MenuItem value="" disabled>{emptyLabel}</MenuItem>
        )}
        {options.map(p => (
          <MenuItem key={p.poolid} value={p.poolid}>
            {p.comment ? `${p.poolid} (${p.comment})` : p.poolid}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
