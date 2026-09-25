'use client'

import { useCallback, useState } from 'react'
import { Box, Typography } from '@mui/material'

export type ChartSeriesToggle = { key: string; label: string; color: string }

type Props = {
  title: string
  series: ChartSeriesToggle[]
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
}

/**
 * Header of an ExpandableChart whose legend doubles as a show/hide switch per
 * series (#1011): a pressed toggle draws its series, an unpressed one hides
 * it, so a chart carrying several curves on the same axes can be read one
 * curve at a time.
 */
export default function ChartSeriesToggles({ title, series, hidden, onToggle }: Props) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
      <Typography variant="caption" fontWeight={600}>{title}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        {series.map(s => {
          const visible = !hidden.has(s.key)

          return (
            <Box
              key={s.key}
              component="button"
              type="button"
              aria-pressed={visible}
              onClick={() => onToggle(s.key)}
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 0.5,
                border: 'none', background: 'none', cursor: 'pointer', p: 0, px: 0.5,
                borderRadius: 0.5, font: 'inherit', fontSize: 10, lineHeight: 1.6, color: 'text.secondary',
                opacity: visible ? 1 : 0.45, textDecoration: visible ? 'none' : 'line-through',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
              {s.label}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** The hidden series of one chart and the toggle its legend calls. */
export function useHiddenSeries(): [ReadonlySet<string>, (key: string) => void] {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback((key: string) => setHidden(prev => {
    const next = new Set(prev)

    if (next.has(key)) next.delete(key)
    else next.add(key)

    return next
  }), [])

  return [hidden, toggle]
}
