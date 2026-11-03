'use client'

import { memo, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Box, Chip, Tooltip, Typography, alpha, type Theme } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { CellTone, CellView, ObservedChip } from './matrixModel'
import { EDGE_COLORS } from './zoneGraph'

const CELL_MIN_H = 68
const TONE_TINT: Record<CellTone, number> = { unprotected: 0.12, blocked: 0.12, allowed: 0.05 }

function cellBackground(theme: Theme, view: CellView | null, diagonal: boolean): string {
  if (view) return alpha(EDGE_COLORS[view.tone], TONE_TINT[view.tone])
  if (diagonal) return `repeating-linear-gradient(45deg, transparent 0 6px, ${alpha(theme.palette.text.primary, 0.05)} 6px 8px)`
  return 'transparent'
}

type ChipItem = { key: string; label: string; tip: string }

/** A line of chips: the first `shown` ones, then "+N" with the whole list in its tooltip. */
function ChipLine({ items, color, dashed, draft, shown }: { items: ChipItem[]; color: string; dashed: boolean; draft?: boolean; shown: number }) {
  if (!items.length) return null
  const first = items.slice(0, shown)
  const rest = items.length - first.length
  let borderStyle = dashed ? 'dashed' : 'solid'
  if (draft) borderStyle = 'dotted'
  const sx = { height: 20, maxWidth: 110, borderColor: color, borderStyle, bgcolor: 'background.paper', '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem', fontWeight: 600 } }
  return (
    <Box sx={{ display: 'flex', gap: 0.5, minWidth: 0, flexWrap: 'nowrap' }}>
      {first.map(item => (
        <Tooltip key={item.key} title={item.tip}>
          <Chip size='small' variant='outlined' label={item.label} sx={{ ...sx, minWidth: 0 }} />
        </Tooltip>
      ))}
      {rest > 0 && (
        <Tooltip title={items.map(i => i.tip).join(', ')}>
          <Chip size='small' variant='outlined' label={`+${rest}`} sx={{ ...sx, flexShrink: 0 }} />
        </Tooltip>
      )}
    </Box>
  )
}

/** What a cell holds: the hits in its corner, the allowed ports, the unprotected ones, the blocked ones. */
function CellBody({ view, chips }: { view: CellView; chips: number }) {
  const t = useTranslations('microsegPilot.overview.matrix')
  const allowed = view.services.map(s => ({ key: s, label: s, tip: s }))
  const chip = (c: ObservedChip) => ({ key: c.service, label: c.service, tip: t('observedChip', { service: c.service, count: c.hits }) })
  return (
    <>
      {view.hits > 0 && (
        <Typography variant='caption' fontWeight={700} sx={{ position: 'absolute', top: 2, right: 6, color: EDGE_COLORS[view.tone] }}>
          {t('hits', { count: view.hits })}
        </Typography>
      )}
      <ChipLine items={allowed} color={EDGE_COLORS.allowed} dashed={false} draft={view.draft} shown={chips} />
      <ChipLine items={view.observedChips.filter(c => c.kind === 'unprotected').map(c => chip(c))} color={EDGE_COLORS.unprotected} dashed shown={chips} />
      <ChipLine items={view.observedChips.filter(c => c.kind === 'blocked').map(c => chip(c))} color={EDGE_COLORS.blocked} dashed shown={chips} />
    </>
  )
}

/** The handlers of the grid: one set for every cell, each reading the cell from its data attributes. */
export type CellHandlers = {
  onEnter: (event: MouseEvent<HTMLElement>) => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onClick: (event: MouseEvent<HTMLElement>) => void
  onKey: (event: KeyboardEvent<HTMLElement>) => void
}

export type MatrixCellProps = {
  id: string
  r: number
  c: number
  rowId: string
  colId: string
  /** Null: nothing between the two ends (with these checkboxes). The same object as long as the cell does not change. */
  view: CellView | null
  aria: string
  selected: boolean
  /** The cell that takes the Tab stop of the grid (roving tabindex). */
  tabbable: boolean
  diagonal: boolean
  /** Chips shown per line. */
  chips: number
  handlers: CellHandlers
}

/**
 * A cell of the matrix. Its props are plain values and handlers shared by the whole grid, so a cell renders again
 * only when it changes: lighting a row and a column is done by the grid's CSS, not by the cells.
 */
export function MatrixCellView({ id, r, c, rowId, colId, view, aria, selected, tabbable, diagonal, chips, handlers }: MatrixCellProps) {
  return (
    <Box
      role='gridcell'
      data-id={id}
      data-cell={`${r}:${c}`}
      data-row={rowId}
      data-col={colId}
      data-tone={view?.tone ?? ''}
      tabIndex={tabbable ? 0 : -1}
      aria-label={aria}
      aria-selected={selected}
      onMouseEnter={handlers.onEnter}
      onFocus={handlers.onFocus}
      onClick={handlers.onClick}
      onKeyDown={handlers.onKey}
      sx={theme => ({
        position: 'relative', minHeight: CELL_MIN_H, minWidth: 0, p: 0.75, pt: 2.25, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 0.5, justifyContent: 'center',
        borderBottom: 1, borderRight: 1, borderColor: 'divider', cursor: view ? 'pointer' : 'default',
        background: cellBackground(theme, view, diagonal),
        outline: selected ? `2px solid ${theme.palette.primary.main}` : 'none', outlineOffset: -2,
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      })}
    >
      {view ? <CellBody view={view} chips={chips} /> : <Typography variant='caption' color='text.disabled' aria-hidden sx={{ textAlign: 'center' }}>·</Typography>}
    </Box>
  )
}

const MatrixCell = memo(MatrixCellView)
export default MatrixCell
