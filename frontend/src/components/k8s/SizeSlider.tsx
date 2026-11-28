'use client'

// Cores / memory / disk sizing control of the Kubernetes deployment wizard,
// also used to size the workers added to a deployed cluster.

import { Box, InputAdornment, Slider, Stack, TextField, Typography } from '@mui/material'

export const CORES_MARKS = [1, 2, 4, 8, 16, 32]
export const MEMORY_MARKS = [2048, 4096, 8192, 16384, 32768, 65536]
export const DISK_MARKS = [10, 20, 40, 80, 160, 320, 640]

export const formatCores = (v: number) => `${v} ${v === 1 ? 'vCPU' : 'vCPUs'}`
export const formatMemory = (v: number) => {
  if (v < 1024) return `${v} MB`
  const digits = v % 1024 === 0 ? 0 : 1
  return `${(v / 1024).toFixed(digits)} GB`
}
export const formatDisk = (v: number) => `${v} GB`

/** Log-style slider (marks + free-typed override), mirroring DeployWizard's
 *  cores/memory/disk sliders. Declared at module scope (not inside a render
 *  body) so its component identity stays stable across re-renders and typed
 *  inputs do not lose focus. */
export function SizeSlider({
  label,
  value,
  min,
  marks,
  unit,
  onChange,
  formatValue,
}: {
  label: string
  value: number
  min: number
  marks: number[]
  unit?: string
  onChange: (v: number) => void
  formatValue: (v: number) => string
}) {
  const sliderMax = marks[marks.length - 1]

  const valueToSlider = (v: number) => {
    for (let i = marks.length - 1; i >= 0; i--) {
      if (v >= marks[i]) {
        const upper = marks[Math.min(i + 1, marks.length - 1)]
        return upper === marks[i] ? i : i + (v - marks[i]) / (upper - marks[i])
      }
    }
    return 0
  }
  const sliderToValue = (pos: number) => {
    const idx = Math.floor(pos)
    const frac = pos - idx
    if (idx >= marks.length - 1) return marks[marks.length - 1]
    const raw = marks[idx] + frac * (marks[idx + 1] - marks[idx])
    return Math.max(min, Math.round(raw))
  }

  const slotProps: Record<string, unknown> = { htmlInput: { min } }
  if (unit) {
    slotProps.input = {
      endAdornment: (
        <InputAdornment position="end" sx={{ '& p': { fontSize: 11, opacity: 0.6 } }}>
          {unit}
        </InputAdornment>
      ),
    }
  }

  return (
    <Box sx={{ px: 1.5 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 600 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {formatValue(value)}
        </Typography>
      </Stack>
      <Stack direction="row" alignItems="center" spacing={5}>
        <Box sx={{ flex: 1, pr: 2 }}>
          <Slider
            size="small"
            value={valueToSlider(Math.min(value, sliderMax))}
            min={0}
            max={marks.length - 1}
            step={0.01}
            onChange={(_, v) => onChange(sliderToValue(v as number))}
            marks={marks.map((m, i) => ({ value: i, label: formatValue(m) }))}
            valueLabelDisplay="auto"
            valueLabelFormat={() => formatValue(value)}
            sx={{ '& .MuiSlider-markLabel': { fontSize: '0.65rem' } }}
          />
        </Box>
        <TextField
          size="small"
          type="number"
          value={value}
          onChange={e => onChange(Math.max(min, Number.parseInt(e.target.value, 10) || min))}
          slotProps={slotProps}
          sx={{ width: 120 }}
        />
      </Stack>
    </Box>
  )
}
