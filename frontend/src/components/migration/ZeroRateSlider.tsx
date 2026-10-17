'use client'

// The thick zeroing cap of warm migrations as a slider (roadmap#45), shared by
// the PVE connection dialog (the cluster's cap) and the migration dialog (an
// override for one run), so both read and move the same way.

import { useTranslations } from 'next-intl'
import { Box, Slider, Tooltip, Typography } from '@mui/material'

import { ZERO_RATE_SLIDER_MARKS, ZERO_RATE_SLIDER_MAX, ZERO_RATE_SLIDER_STEP } from '@/lib/migration/warm/zero-rate'

export default function ZeroRateSlider({ value, onChange, label, help, ariaLabel, testId, valueTestId }: Readonly<{
  /** MB/s; 0 = unlimited. A value above the slider range (set through the API) stays visible, pinned at the end. */
  value: number
  onChange: (mbps: number) => void
  label: string
  help?: string
  ariaLabel: string
  testId: string
  valueTestId: string
}>) {
  const t = useTranslations()
  const unlimited = t('settings.warmZeroRateLimitPlaceholder')

  return (
    <Box>
      <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {label}
        <Box component="span" sx={{ fontWeight: 600 }} data-testid={valueTestId}>
          {value > 0 ? `${value} MB/s` : unlimited}
        </Box>
        {help && (
          <Tooltip title={help} arrow>
            <Box component="i" className="ri-information-line" aria-label={help} sx={{ fontSize: 16, color: 'text.secondary', cursor: 'help' }} />
          </Tooltip>
        )}
      </Typography>
      <Slider
        // Room for the end mark labels ("Unlimited", "2000"), clipped otherwise.
        sx={{ mx: 4, width: 'calc(100% - 64px)' }}
        value={Math.min(value, ZERO_RATE_SLIDER_MAX)}
        min={0}
        max={ZERO_RATE_SLIDER_MAX}
        step={ZERO_RATE_SLIDER_STEP}
        marks={ZERO_RATE_SLIDER_MARKS.map(v => ({ value: v, label: v === 0 ? unlimited : `${v}` }))}
        onChange={(_e, v) => onChange(v as number)}
        slotProps={{ input: { 'aria-label': ariaLabel, 'data-testid': testId } as any }}
      />
    </Box>
  )
}
