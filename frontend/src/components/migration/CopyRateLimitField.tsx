'use client'

// One copy rate cap (lib/migration/warm/copy-rate): its label and the cap in
// force, a slider for the usual range and a field to type any value directly. Shared by
// the migration dialogs, the live change dialog and the connection dialog.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Slider, TextField, Tooltip, Typography } from '@mui/material'

import {
  COPY_RATE_MAX_MBPS, COPY_RATE_MIN_MBPS, COPY_RATE_SLIDER_MARKS, COPY_RATE_SLIDER_MAX, COPY_RATE_SLIDER_STEP, COPY_RATE_UNLIMITED,
} from '@/lib/migration/warm/copy-rate'

/** What the field holds: digits only, empty meaning unlimited. Null when it is not a cap. */
function parseField(text: string): number | null {
  const s = text.trim()
  if (s === '') return COPY_RATE_UNLIMITED
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return n === COPY_RATE_UNLIMITED || (n >= COPY_RATE_MIN_MBPS && n <= COPY_RATE_MAX_MBPS) ? n : null
}

const textOf = (mbps: number) => (mbps > 0 ? String(mbps) : '')

export default function CopyRateLimitField({ label, value, onChange, help, testId, disabled, onValidityChange }: Readonly<{
  label: string
  /** MB/s; 0 = unlimited. */
  value: number
  onChange: (mbps: number) => void
  help?: string
  testId: string
  disabled?: boolean
  /** Told whether the typed text is a cap: an invalid text is never passed on, so the caller must not submit meanwhile. */
  onValidityChange?: (valid: boolean) => void
}>) {
  const t = useTranslations()
  const [text, setText] = useState(textOf(value))
  const invalid = parseField(text) === null

  // Follow a value changed from outside (slider, reset) unless the field already says it.
  useEffect(() => {
    setText(prev => (parseField(prev) === value ? prev : textOf(value)))
  }, [value])

  const onText = (next: string) => {
    setText(next)
    const n = parseField(next)
    onValidityChange?.(n !== null)
    if (n !== null) onChange(n)
  }

  // Same layout as the downtime budget of the migration dialogs: the label and
  // the cap in force on a title line, the slider and a narrow field under it.
  return (
    <Box sx={{ px: 0.5 }} data-testid={`${testId}-block`}>
      <Box data-testid={`${testId}-head`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Typography variant="body2">{label}</Typography>
        {help && (
          <Tooltip title={help} arrow placement="top">
            <i className="ri-question-line" aria-label={help} style={{ fontSize: 14, opacity: 0.6 }} />
          </Tooltip>
        )}
        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }} data-testid={`${testId}-value`}>
          {value > 0 ? `${value} ${t('copyRate.unit')}` : t('copyRate.unlimited')}
        </Typography>
      </Box>
      <Box data-testid={`${testId}-row`} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {/* The end labels grow inwards from their tick ("Unlimited" is long, and
            longer in some languages), so they never pass the edge of the panel. */}
        <Box sx={{ flex: 1, px: 2 }}>
          <Slider
            size="small"
            sx={{
              [`& .MuiSlider-markLabel[data-index="0"]`]: { transform: 'translateX(-8px)' },
              [`& .MuiSlider-markLabel[data-index="${COPY_RATE_SLIDER_MARKS.length - 1}"]`]: { transform: 'translateX(calc(-100% + 8px))' },
            }}
            disabled={disabled}
            value={Math.min(value, COPY_RATE_SLIDER_MAX)}
            min={0}
            max={COPY_RATE_SLIDER_MAX}
            step={COPY_RATE_SLIDER_STEP}
            marks={COPY_RATE_SLIDER_MARKS.map(v => ({ value: v, label: v === 0 ? t('copyRate.unlimited') : `${v}` }))}
            onChange={(_e, v) => onChange(v as number)}
            slotProps={{ input: { 'aria-label': label, 'data-testid': `${testId}-slider` } as any }}
          />
        </Box>
        {/* Any value up to the maximum, beyond the slider's range; empty = unlimited. */}
        <TextField
          size="small"
          disabled={disabled}
          value={text}
          onChange={e => onText(e.target.value)}
          label={t('copyRate.unit')}
          error={invalid}
          sx={{ width: 110, flexShrink: 0 }}
          slotProps={{
            inputLabel: { shrink: true },
            htmlInput: { inputMode: 'numeric', 'aria-label': label, 'aria-invalid': invalid, 'data-testid': `${testId}-input` },
          }}
        />
      </Box>
    </Box>
  )
}
