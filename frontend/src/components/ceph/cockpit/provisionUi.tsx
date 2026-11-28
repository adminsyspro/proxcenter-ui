'use client'

import { useId, type ReactNode } from 'react'
import { Box, MenuItem, TextField, Typography } from '@mui/material'

/*
   Building blocks of the Ceph provisioning dialogs (ui#1450): one setting per
   line, its label on the left and its control on the right, every control of
   a dialog starting on the same vertical line.
*/

/** A small MUI Select is 38 px high where a small input is 35.9 px: this aligns them. */
export const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

export const FORM_LABEL_COLUMN = 190

export function FormRow({ label, htmlFor, labelId, children, testId }: Readonly<{
  label: ReactNode
  htmlFor?: string
  labelId?: string
  children: ReactNode
  testId?: string
}>) {
  return (
    <Box data-testid={testId} sx={{ display: 'grid', gridTemplateColumns: `${FORM_LABEL_COLUMN}px minmax(0, 1fr)`, alignItems: 'center', columnGap: 2, minHeight: 40 }}>
      <Typography component='label' id={labelId} htmlFor={htmlFor} variant='body2' color='text.secondary' noWrap>
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>{children}</Box>
    </Box>
  )
}

/** A number field on one form line. */
export function NumberRow({ label, value, onChange, min, max, step, disabled, width = 120, suffix }: Readonly<{
  label: string
  value: string
  onChange: (value: string) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  width?: number
  suffix?: ReactNode
}>) {
  const id = useId()
  return (
    <FormRow label={label} htmlFor={id}>
      <TextField
        id={id}
        size='small'
        type='number'
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        slotProps={{ htmlInput: { min, max, step } }}
        sx={{ width }}
      />
      {suffix}
    </FormRow>
  )
}

/** A select on one form line, labelled by the line's label. */
export function SelectRow<T extends string>({ label, value, options, onChange, disabled, width = 240 }: Readonly<{
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  width?: number
}>) {
  const labelId = useId()
  return (
    <FormRow label={label} labelId={labelId}>
      <TextField
        select
        size='small'
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value as T)}
        slotProps={{ select: { labelId, SelectDisplayProps: { 'aria-labelledby': labelId } as object } }}
        sx={{ width, ...SMALL_SELECT_SX }}
      >
        {options.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
      </TextField>
    </FormRow>
  )
}
