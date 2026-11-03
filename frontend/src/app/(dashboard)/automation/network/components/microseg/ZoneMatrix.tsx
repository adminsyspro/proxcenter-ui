'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Chip, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, type Theme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { cellId, cellView, sortEnds, type CellTone, type CellView, type MatrixEnd, type MatrixModel, type MatrixSort, type ObservedChip } from './matrixModel'
import { EDGE_COLORS, EXTERNAL_ID, type FlowFilters } from './zoneGraph'
import { ZoneShield } from './ZoneNode'

const SORT_KEY = 'microseg.map.matrixSort'
/** Chips drawn per line of a cell; a "+N" chip stands for the others. */
const CHIPS_SHOWN = 2
const HEAD_W = 190
const CELL_MIN_W = 150
const CELL_MIN_H = 68

/** The sort of the matrix, kept in this browser (a blocked storage just means by name). */
function useMatrixSort(): [MatrixSort, (next: MatrixSort) => void] {
  const [sort, setSort] = useState<MatrixSort>(() => {
    try {
      return window.localStorage.getItem(SORT_KEY) === 'layer' ? 'layer' : 'name'
    } catch {
      return 'name'
    }
  })
  const change = useCallback((next: MatrixSort) => {
    setSort(next)
    try {
      window.localStorage.setItem(SORT_KEY, next)
    } catch {
      // Storage refused: the choice lasts as long as the page.
    }
  }, [])
  return [sort, change]
}

const TONE_TINT: Record<CellTone, number> = { unprotected: 0.12, blocked: 0.12, allowed: 0.05 }

function cellBackground(theme: Theme, view: CellView | null, diagonal: boolean): string {
  if (view) return alpha(EDGE_COLORS[view.tone], TONE_TINT[view.tone])
  if (diagonal) return `repeating-linear-gradient(45deg, transparent 0 6px, ${alpha(theme.palette.text.primary, 0.05)} 6px 8px)`
  return 'transparent'
}

type Highlight = { row: string | null; col: string | null }

const lit = (h: Highlight, row: string | null, col: string | null) => (row !== null && h.row === row) || (col !== null && h.col === col)

type Names = { end: (e: MatrixEnd) => string }

/** A line of chips: the first ones, then "+N" with the whole list in its tooltip. */
function ChipLine({ items, color, dashed, draft }: { items: Array<{ key: string; label: string; tip: string }>; color: string; dashed: boolean; draft?: boolean }) {
  if (!items.length) return null
  const shown = items.slice(0, CHIPS_SHOWN)
  const rest = items.length - shown.length
  let borderStyle = dashed ? 'dashed' : 'solid'
  if (draft) borderStyle = 'dotted'
  const sx = { height: 20, maxWidth: 110, borderColor: color, borderStyle, bgcolor: 'background.paper', '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem', fontWeight: 600 } }
  return (
    <Box sx={{ display: 'flex', gap: 0.5, minWidth: 0, flexWrap: 'nowrap' }}>
      {shown.map(item => (
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

/** The head of a column or of a row: a zone (a button that opens its panel), Unknown / External or Outside. */
function EndHead({ end, name, onSelectZone }: { end: MatrixEnd; name: string; onSelectZone: (zoneId: string) => void }) {
  const t = useTranslations('microsegPilot.overview.matrix')
  const zone = end.zone
  const icon = end.id === EXTERNAL_ID ? 'ri-global-line' : 'ri-cloud-line'
  return (
    <Tooltip title={name}>
      <Box
        component={zone ? 'button' : 'span'}
        type={zone ? 'button' : undefined}
        aria-label={zone ? t('openZone', { name }) : undefined}
        onClick={zone ? () => onSelectZone(zone.id) : undefined}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, width: '100%', border: 0, p: 0, bgcolor: 'transparent',
          color: 'inherit', font: 'inherit', textAlign: 'left', cursor: zone ? 'pointer' : 'default',
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2, borderRadius: 0.5 },
        }}
      >
        {zone ? (
          <ZoneShield color={zone.color || 'currentColor'} state={zone.state} />
        ) : <i className={icon} style={{ fontSize: 16, flexShrink: 0, opacity: 0.7 }} />}
        <Typography component='span' noWrap fontWeight={600} sx={{ flex: '1 1 0', minWidth: 0, fontSize: '0.85rem' }}>{name}</Typography>
      </Box>
    </Tooltip>
  )
}

function CellBody({ view }: { view: CellView }) {
  const t = useTranslations('microsegPilot.overview.matrix')
  const allowed = view.services.map(s => ({ key: s, label: s, tip: s }))
  const chip = (c: ObservedChip) => ({ key: c.service, label: c.service, tip: t('observedChip', { service: c.service, count: c.hits }) })
  return (
    <>
      {view.hits > 0 && (
        <Typography variant='caption' fontWeight={700} sx={{ position: 'absolute', top: 2, right: 6, color: EDGE_COLORS[view.tone === 'allowed' ? 'unprotected' : view.tone] }}>
          {t('hits', { count: view.hits })}
        </Typography>
      )}
      <ChipLine items={allowed} color={EDGE_COLORS.allowed} dashed={false} draft={view.draft} />
      <ChipLine items={view.observedChips.filter(c => c.kind === 'unprotected').map(c => chip(c))} color={EDGE_COLORS.unprotected} dashed />
      <ChipLine items={view.observedChips.filter(c => c.kind === 'blocked').map(c => chip(c))} color={EDGE_COLORS.blocked} dashed />
    </>
  )
}

type Props = {
  model: MatrixModel
  filters: FlowFilters
  unapplied: ReadonlySet<string> | null
  /** The id of the cell whose panel is open, and the node id of the zone whose panel is open. */
  selectedCell: string | null
  selectedZone: string | null
  onSelectCell: (cellId: string) => void
  onSelectZone: (zoneId: string) => void
  names: Names
}

/**
 * The matrix rendering, for any number of zones: sources down, destinations across, sticky heads. A cell lists the
 * allowed ports of its pair (green), the observed ones no flow allows (red dashed when unprotected, blue dashed when
 * blocked) and the hits, its background tinted red or blue when such traffic was seen. The pointer or the keyboard
 * on a cell lights its row and its column; a click, enter or space opens the flow panel of the pair; the arrows move
 * between cells. A click on a zone head opens its panel.
 */
export default function ZoneMatrix({ model, filters, unapplied, selectedCell, selectedZone, onSelectCell, onSelectZone, names }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const tEdge = useTranslations('microsegPilot.overview.edge')
  const [sort, setSort] = useMatrixSort()
  const [hover, setHover] = useState<Highlight>({ row: null, col: null })
  const [active, setActive] = useState({ r: 0, c: 0 })
  const grid = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => sortEnds(model.rows, sort), [model.rows, sort])
  const cols = useMemo(() => sortEnds(model.cols, sort), [model.cols, sort])
  const views = useMemo(
    () => new Map([...model.cells.values()].map(cell => [cell.id, cellView(cell, filters, unapplied)])),
    [model.cells, filters, unapplied],
  )
  const highlight: Highlight = hover.row || hover.col ? hover : { row: selectedZone, col: selectedZone }

  const ariaOf = (row: MatrixEnd, col: MatrixEnd, view: CellView | null) => {
    const parts: string[] = []
    if (view?.services.length) parts.push(tEdge('allowed', { services: view.services.join(', ') }))
    if (view?.unprotected) parts.push(tEdge('countUnprotected', { count: view.unprotected }))
    if (view?.blocked) parts.push(tEdge('countBlocked', { count: view.blocked }))
    if (view?.hits) parts.push(t('matrix.hits', { count: view.hits }))
    return tEdge('aria', { from: names.end(row), to: names.end(col), services: parts.length ? parts.join(', ') : t('matrix.noFlow') })
  }

  const focusCell = (r: number, c: number) => {
    const next = { r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(cols.length - 1, c)) }
    setActive(next)
    grid.current?.querySelector<HTMLElement>(`[data-cell="${next.r}:${next.c}"]`)?.focus()
  }
  const MOVES: Record<string, (r: number, c: number) => [number, number]> = {
    ArrowUp: (r, c) => [r - 1, c], ArrowDown: (r, c) => [r + 1, c], ArrowLeft: (r, c) => [r, c - 1], ArrowRight: (r, c) => [r, c + 1],
    Home: r => [r, 0], End: r => [r, cols.length - 1],
  }
  const onCellKey = (event: KeyboardEvent, r: number, c: number, view: CellView | null) => {
    const move = MOVES[event.key]
    if (move) {
      event.preventDefault()
      focusCell(...move(r, c))
    } else if ((event.key === 'Enter' || event.key === ' ') && view) {
      event.preventDefault()
      onSelectCell(view.id)
    }
  }

  const sticky = { position: 'sticky', bgcolor: 'background.paper', borderColor: 'divider' } as const
  const headLit = (on: boolean) => (on ? { bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.08) } : {})

  return (
    <Box sx={{ height: '100%', overflow: 'auto' }} onMouseLeave={() => setHover({ row: null, col: null })}>
      <Box
        ref={grid}
        role='grid'
        aria-label={t('matrix.label')}
        aria-rowcount={rows.length + 1}
        aria-colcount={cols.length + 1}
        sx={{ display: 'grid', gridTemplateColumns: `${HEAD_W}px repeat(${cols.length}, minmax(${CELL_MIN_W}px, 1fr))`, minWidth: 'max-content' }}
      >
        <Box role='row' sx={{ display: 'contents' }}>
          <Box role='columnheader' sx={{ ...sticky, top: 0, left: 0, zIndex: 3, borderBottom: 1, borderRight: 1, p: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <ToggleButtonGroup exclusive size='small' value={sort} aria-label={t('matrix.sort')} onChange={(_e, next: MatrixSort | null) => { if (next) setSort(next) }} sx={{ '& .MuiToggleButton-root': { px: 0.75, py: 0.25 } }}>
              <Tooltip title={t('matrix.sortName')}><ToggleButton value='name' aria-label={t('matrix.sortName')}><i className='ri-sort-alphabet-asc' aria-hidden /></ToggleButton></Tooltip>
              <Tooltip title={t('matrix.sortLayer')}><ToggleButton value='layer' aria-label={t('matrix.sortLayer')}><i className='ri-flow-chart' aria-hidden /></ToggleButton></Tooltip>
            </ToggleButtonGroup>
            <Typography noWrap variant='caption' color='text.secondary'>{t('matrix.corner')}</Typography>
          </Box>
          {cols.map(col => (
            <Box key={col.id} role='columnheader' sx={{ ...sticky, top: 0, zIndex: 2, borderBottom: 1, borderRight: 1, px: 1, display: 'flex', alignItems: 'flex-end', pb: 1, minWidth: 0, ...headLit(lit(highlight, null, col.id)) }}>
              <EndHead end={col} name={names.end(col)} onSelectZone={onSelectZone} />
            </Box>
          ))}
        </Box>
        {rows.map((row, r) => (
          <Box key={row.id} role='row' sx={{ display: 'contents' }}>
            <Box role='rowheader' sx={{ ...sticky, left: 0, zIndex: 1, borderBottom: 1, borderRight: 1, px: 1, display: 'flex', alignItems: 'center', minWidth: 0, ...headLit(lit(highlight, row.id, null)) }}>
              <EndHead end={row} name={names.end(row)} onSelectZone={onSelectZone} />
            </Box>
            {cols.map((col, c) => {
              const id = cellId(row.id, col.id)
              const view = views.get(id) ?? null
              const on = lit(highlight, row.id, col.id)
              return (
                <Box
                  key={col.id}
                  role='gridcell'
                  data-cell={`${r}:${c}`}
                  data-tone={view?.tone ?? ''}
                  tabIndex={active.r === r && active.c === c ? 0 : -1}
                  aria-label={ariaOf(row, col, view)}
                  aria-selected={selectedCell === id}
                  onMouseEnter={() => setHover({ row: row.id, col: col.id })}
                  onFocus={() => { setActive({ r, c }); setHover({ row: row.id, col: col.id }) }}
                  onClick={() => { setActive({ r, c }); if (view) onSelectCell(id) }}
                  onKeyDown={event => onCellKey(event, r, c, view)}
                  sx={theme => ({
                    position: 'relative', minHeight: CELL_MIN_H, minWidth: 0, p: 0.75, pt: 2.25, boxSizing: 'border-box',
                    display: 'flex', flexDirection: 'column', gap: 0.5, justifyContent: 'center',
                    borderBottom: 1, borderRight: 1, borderColor: 'divider', cursor: view ? 'pointer' : 'default',
                    background: cellBackground(theme, view, row.id === col.id),
                    boxShadow: on ? `inset 0 0 0 9999px ${alpha(theme.palette.primary.main, 0.06)}` : 'none',
                    outline: selectedCell === id ? `2px solid ${theme.palette.primary.main}` : 'none', outlineOffset: -2,
                    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
                  })}
                >
                  {view ? <CellBody view={view} /> : <Typography variant='caption' color='text.disabled' aria-hidden sx={{ textAlign: 'center' }}>·</Typography>}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
