'use client'

import { Box, Slider } from '@mui/material'

import { SYNC_INTERVAL_STEPS_SEC, formatSyncInterval, syncIntervalStepIndex } from '@/lib/migration/warm/sync-interval'

/**
 * The slider of the interval between two syncs, on the steps every surface
 * offers (1 min to 24 h). The end marks are centred on their tick: the padding
 * keeps "1 min" and "24 h" inside the panel.
 */
export default function SyncIntervalSlider({ valueSec, onChange, label, disabled }: {
  valueSec: number | null | undefined
  onChange: (seconds: number) => void
  /** Accessible name of the slider. */
  label: string
  disabled?: boolean
}) {
  const text = (i: number) => formatSyncInterval(SYNC_INTERVAL_STEPS_SEC[i])

  return (
    <Box sx={{ px: 3 }}>
      <Slider
        size="small"
        disabled={disabled}
        value={syncIntervalStepIndex(valueSec)}
        onChange={(_, val) => onChange(SYNC_INTERVAL_STEPS_SEC[Math.round(val as number)])}
        min={0}
        max={SYNC_INTERVAL_STEPS_SEC.length - 1}
        step={1}
        marks={[0, 4, 6, 8, 11].map(i => ({ value: i, label: text(i) }))}
        valueLabelDisplay="auto"
        valueLabelFormat={text}
        getAriaValueText={text}
        aria-label={label}
      />
    </Box>
  )
}
