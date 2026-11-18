'use client'

import type { MouseEvent } from 'react'
import { Box, Chip } from '@mui/material'

import ConnectionGlyph, { useConnectionKind } from './ConnectionGlyph'

type Props = {
  connectionId: string
  name: string
  /** A short muted note after the name, in the same font ("applies at the next application"). */
  note?: string
  /** The note as a clock icon before the name (named by the note), so a narrow line keeps its room for the names. */
  noteIcon?: boolean
  /** Makes the chip a button (it opens the list of the clusters in the Settings). */
  onClick?: (event: MouseEvent<HTMLElement>) => void
  /** In a one-line row: at most ROW_CHIP_MAX_WIDTH, cut with an ellipsis. */
  compact?: boolean
}

/** The widest a cluster chip gets in a one-line row, so a long cluster name never squeezes the guest's name. */
export const ROW_CHIP_MAX_WIDTH = 160

/**
 * The small pill of a cluster in the lists of a shared policy: neutral (the colours of the screen belong to the zones
 * and to the states), headed by the glyph of its cluster or standalone node. Its title gives the full name (and its
 * note), whatever the chip shows.
 */
export default function ClusterChip({ connectionId, name, note, noteIcon = false, onClick, compact = false }: Readonly<Props>) {
  const kind = useConnectionKind(connectionId)
  const clock = note && noteIcon ? <i className='ri-time-line' role='img' aria-label={note} style={{ flexShrink: 0 }} /> : null
  // MUI sizes a chip icon for one glyph: the box takes the width of its two (the glyph, and the clock of a pending cluster).
  const icon = <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0, '&&': { width: 'auto', height: 'auto' } }}><ConnectionGlyph kind={kind} />{clock}</Box>
  return (
    <Chip
      size='small'
      variant='outlined'
      icon={icon}
      label={note && !noteIcon ? (
        <>
          {name}
          <Box component='span' aria-hidden sx={{ mx: 0.5, opacity: 0.7 }}>·</Box>
          <Box component='span' sx={{ opacity: 0.7 }}>{note}</Box>
        </>
      ) : name}
      onClick={onClick}
      title={note ? `${name} · ${note}` : name}
      sx={{ borderColor: 'divider', color: 'text.primary', bgcolor: 'transparent', maxWidth: compact ? ROW_CHIP_MAX_WIDTH : '100%', flexShrink: compact ? 0 : undefined, fontWeight: 500 }}
    />
  )
}
