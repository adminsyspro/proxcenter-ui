'use client'

// Small pieces shared by the drill history and the schedules list.

import { Fragment, type ReactNode } from 'react'

import { Box, Typography } from '@mui/material'

import { LOADER_ICON } from '@/lib/backups/restoreDrills/display'
import type { DrillEvent } from '@/lib/backups/restoreDrills/types'

/** Spins the in-progress glyph; any other icon stays still. */
export function spinSx(icon: string) {
  if (icon !== LOADER_ICON) return {}
  return {
    '@keyframes drillSpin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
    animation: 'drillSpin 1s linear infinite',
  }
}

export function eventColor(level: string): string {
  if (level === 'error') return 'error.main'
  if (level === 'warning') return 'warning.main'
  return 'text.primary'
}

export function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Typography variant='body2' color='text.secondary'>{label}</Typography>
      <Typography variant='body2' component='div' sx={{ overflowWrap: 'anywhere' }}>{children}</Typography>
    </>
  )
}

/** An event journal: the one place of the tab that uses a monospace font. */
export function EventLog({ events, testId }: { events: DrillEvent[]; testId: string }) {
  return (
    <Box
      component='pre'
      data-testid={testId}
      sx={{
        m: 0, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontFamily: 'monospace', fontSize: 12,
        maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}
    >
      {events.map((ev, i) => (
        <Fragment key={`${ev.ts}-${i}`}>
          <Box component='span' sx={{ color: eventColor(ev.level) }}>
            {`${ev.ts} ${ev.level.toUpperCase().padEnd(7)} ${ev.stage ? `[${ev.stage}] ` : ''}${ev.message}`}
          </Box>
          {'\n'}
        </Fragment>
      ))}
    </Box>
  )
}
