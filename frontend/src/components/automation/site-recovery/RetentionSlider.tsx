'use client'

import { Box, Slider, Typography } from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'

// The slider covers the practical range; the field stays authoritative up to
// the backend cap of 500 and pins the slider at its max beyond SLIDER_MAX.
const SLIDER_MAX = 50

const MARKS = [2, 10, 25, 50].map(v => ({ value: v, label: String(v) }))

interface RetentionSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  helperText?: string
}

export default function RetentionSlider({ label, value, onChange, helperText }: RetentionSliderProps) {
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 0.5 }}>
        <Typography variant='body2' sx={{ fontWeight: 500 }}>{label}</Typography>
        <NumericTextField
          type='number'
          size='small'
          value={value}
          onChange={onChange}
          fallback={3}
          min={2}
          max={500}
          sx={{ width: 120 }}
          inputProps={{ min: 2, max: 500, 'aria-label': label }}
        />
      </Box>
      <Slider
        aria-label={label}
        value={Math.min(value, SLIDER_MAX)}
        onChange={(_, val) => onChange(val as number)}
        min={2}
        max={SLIDER_MAX}
        step={1}
        marks={MARKS}
        valueLabelDisplay='auto'
        sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
      />
      {helperText && (
        <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>{helperText}</Typography>
      )}
    </Box>
  )
}
