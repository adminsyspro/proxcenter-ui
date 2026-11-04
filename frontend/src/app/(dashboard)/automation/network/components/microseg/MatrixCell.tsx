'use client'

import { memo, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Box, Chip, Tooltip, Typography, alpha, type Theme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { serviceTokenLabel, serviceTokenTitle } from '@/lib/network/serviceNames'

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
  const allowed = view.services.map(s => ({ key: s, label: serviceTokenLabel(s), tip: serviceTokenTitle(s) }))
  const chip = (c: ObservedChip) => ({ key: c.service, label: serviceTokenLabel(c.service), tip: t('observedChip', { service: serviceTokenTitle(c.service), count: c.hits }) })
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
/**
 * The grid line of the matrix: the theme's own divider (a faint tint of the text colour in the dark theme). It is
 * written as a full `1px solid <colour>` so no later shorthand resets the colour to the text colour, and it reads
 * the CSS variable because MUI's alpha() cannot recolour the dark theme's `rgb(var(...) / 0.12)` divider.
 */
export const gridLine = (theme: Theme): string => theme.vars?.palette.divider ?? theme.palette.divider

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
  /** The name of the marker of a cell whose observed flows the targeted guest is an end of (none: no marker). */
  marker?: string
}

/** The small marker of a cell the targeted guest has observed flows in. */
function TargetMarker({ label }: { label: string }) {
  return (
    <Tooltip title={label}>
      <Box component='span' role='img' aria-label={label} data-marker='target' sx={{ position: 'absolute', top: 2, left: 6, display: 'inline-flex', color: 'primary.main' }}>
        <i className='ri-focus-3-line' style={{ fontSize: 14 }} aria-hidden />
      </Box>
    </Tooltip>
  )
}

/**
 * A cell of the matrix. Its props are plain values and handlers shared by the whole grid, so a cell renders again
 * only when it changes: lighting a row and a column is done by the grid's CSS, not by the cells.
 */
export function MatrixCellView({ id, r, c, rowId, colId, view, aria, selected, tabbable, diagonal, chips, handlers, marker }: MatrixCellProps) {
  return (
    <Box
      role='gridcell'
      data-id={id}
      data-cell={`${r}:${c}`}
      data-row={rowId}
      data-col={colId}
      data-tone={view?.tone ?? ''}
      data-target={marker ? 'true' : undefined}
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
        borderBottom: `1px solid ${gridLine(theme)}`, borderRight: `1px solid ${gridLine(theme)}`, cursor: view ? 'pointer' : 'default',
        background: cellBackground(theme, view, diagonal),
        outline: selected ? `2px solid ${theme.palette.primary.main}` : 'none', outlineOffset: -2,
        '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
      })}
    >
      {marker && <TargetMarker label={marker} />}
      {view ? <CellBody view={view} chips={chips} /> : <Typography variant='caption' color='text.disabled' aria-hidden sx={{ textAlign: 'center' }}>·</Typography>}
    </Box>
  )
}

const MatrixCell = memo(MatrixCellView)
export default MatrixCell
