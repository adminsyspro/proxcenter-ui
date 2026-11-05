'use client'

// Pieces shared by the rows of the vDC dialog's Quotas tab: the label and
// switch that open each row, and the column sizes the GPU contingent lines
// align on.
import type { ReactNode } from 'react'

import { FormControlLabel, Switch, Typography } from '@mui/material'

export const QUOTA_ROW_SX = { display: 'flex', alignItems: 'center', gap: 2 } as const
export const QUOTA_LABEL_SX = { minWidth: 130 } as const
export const QUOTA_SWITCH_SX = { minWidth: 120 } as const
export const QUOTA_INPUT_SX = { width: 120 } as const
// The usage column on the right of a row.
export const QUOTA_TRAIL_WIDTH = 220
export const QUOTA_TRAIL_SX = { ml: 'auto', minWidth: QUOTA_TRAIL_WIDTH } as const

// A small MUI Select renders 38 px against 35.9 px for a small TextField; this
// pins both to the same line height.
export const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

export function QuotaRowLead({
  label,
  checked,
  caption,
  onChange,
  disabled,
  ariaLabel,
}: {
  label: ReactNode
  checked: boolean
  caption: ReactNode
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <>
      <Typography variant="body2" sx={QUOTA_LABEL_SX}>
        {label}
      </Typography>
      <FormControlLabel
        control={
          <Switch
            size="small"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            slotProps={ariaLabel ? { input: { 'aria-label': ariaLabel } } : undefined}
          />
        }
        label={<Typography variant="caption">{caption}</Typography>}
        sx={QUOTA_SWITCH_SX}
      />
    </>
  )
}
