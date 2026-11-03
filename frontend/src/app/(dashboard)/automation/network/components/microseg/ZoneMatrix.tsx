'use client'

import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { Box, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha, type Theme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { serviceTokensTitle } from '@/lib/network/serviceNames'

import MatrixCell, { type CellHandlers } from './MatrixCell'
import { MATRIX_SORTS, cellId, cellView, sortEnds, type CellView, type MatrixEnd, type MatrixModel, type MatrixSort } from './matrixModel'
import { involvesTarget, type TargetGuest } from './targetModel'
import { useStoredChoice } from './useStoredChoice'
import { EXTERNAL_ID, zoneNodeId, type FlowFilters } from './zoneGraph'
import { ZoneShield } from './ZoneNode'

const SORT_KEY = 'microseg.map.matrixSort'
/** The width of the row heads and the least width of a cell, and the chips per line: smaller when a panel is open. */
const SIZES = { wide: { head: 190, cell: 150, chips: 2 }, narrow: { head: 150, cell: 112, chips: 1 } } as const
/** The least height of a row of cells, and the height the head row takes (the sort buttons and the corner caption). */
export const ROW_MIN_H = 68
const HEAD_ROW_H = 64

/**
 * The tracks of the grid: the head column, then one column per destination and one row per source that share the
 * room left (1fr) above their least size. The grid fills the map; it scrolls only when the least sizes do not fit.
 */
export function matrixTracks(rowCount: number, colCount: number, narrow: boolean) {
  const size = narrow ? SIZES.narrow : SIZES.wide
  return {
    columns: `${size.head}px repeat(${colCount}, minmax(${size.cell}px, 1fr))`,
    rows: `auto repeat(${rowCount}, minmax(${ROW_MIN_H}px, 1fr))`,
    minWidth: size.head + colCount * size.cell,
    minHeight: HEAD_ROW_H + rowCount * ROW_MIN_H,
  }
}

type Names = { end: (e: MatrixEnd) => string }
type Highlight = { row: string | null; col: string | null }

/** An attribute value inside a CSS selector string. */
const attr = (value: string) => value.replace(/["\\]/g, String.raw`\$&`)

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

type Props = {
  model: MatrixModel
  filters: FlowFilters
  unapplied: ReadonlySet<string> | null
  /** The id of the cell whose panel is open, and the node id of the zone whose panel is open. */
  selectedCell: string | null
  selectedZone: string | null
  /** A panel is open beside the matrix: narrower columns, one chip per line. */
  narrow?: boolean
  onSelectCell: (cellId: string) => void
  onSelectZone: (zoneId: string) => void
  names: Names
  /** The targeted guest: the row and the column of its zone stay lit, its cells marked, the others dimmed. */
  target?: TargetGuest | null
}

/** The cells the target dims: those out of the row and the column of its zone that carry none of its flows. */
function targetSx(target: TargetGuest | null | undefined) {
  if (!target) return {}
  const zone = target.zoneId ? attr(zoneNodeId(target.zoneId)) : null
  const keep = zone ? `:not([data-row="${zone}"]):not([data-col="${zone}"])` : ''
  return { [`& [role="gridcell"]${keep}:not([data-target])`]: { opacity: 0.35 } }
}

/**
 * The matrix rendering, for any number of zones: sources down, destinations across, sticky heads. A cell lists the
 * allowed ports of its pair (green), the observed ones no flow allows (red dashed when unprotected, blue dashed when
 * blocked) and the hits, its background tinted red or blue when such traffic was seen. The pointer or the keyboard
 * on a cell lights its row and its column (the grid's CSS does it: no cell renders again); a click, enter or space
 * opens the flow panel of the pair; the arrows move between cells. A click on a zone head opens its panel.
 */
export default function ZoneMatrix({ model, filters, unapplied, selectedCell, selectedZone, narrow = false, onSelectCell, onSelectZone, names, target = null }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const tEdge = useTranslations('microsegPilot.overview.edge')
  const [sort, setSort] = useStoredChoice<MatrixSort>(SORT_KEY, MATRIX_SORTS, 'name')
  const [hover, setHover] = useState<Highlight>({ row: null, col: null })
  const [active, setActive] = useState({ r: 0, c: 0 })
  const grid = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => sortEnds(model.rows, sort), [model.rows, sort])
  const cols = useMemo(() => sortEnds(model.cols, sort), [model.cols, sort])
  const views = useMemo(
    () => new Map([...model.cells.values()].map(cell => [cell.id, cellView(cell, filters, unapplied)])),
    [model.cells, filters, unapplied],
  )
  const size = narrow ? SIZES.narrow : SIZES.wide
  const tracks = matrixTracks(rows.length, cols.length, narrow)
  const targetZone = target?.zoneId ? zoneNodeId(target.zoneId) : null
  const marker = target ? t('target.cellMarker', { name: target.name }) : undefined
  // A target locks the light on the row and the column of its zone: the pointer does not move it.
  let lit: Highlight = hover.row || hover.col ? hover : { row: selectedZone, col: selectedZone }
  if (target) lit = { row: targetZone, col: targetZone }
  // The Tab stop stays on a cell that exists after the grid shrinks (a zone deleted, the other sort).
  const activeR = Math.min(active.r, rows.length - 1)
  const activeC = Math.min(active.c, cols.length - 1)

  const ariaOf = (row: MatrixEnd, col: MatrixEnd, view: CellView | null) => {
    const parts: string[] = []
    if (view?.services.length) parts.push(tEdge('allowed', { services: serviceTokensTitle(view.services) }))
    if (view?.unprotected) parts.push(tEdge('countUnprotected', { count: view.unprotected }))
    if (view?.blocked) parts.push(tEdge('countBlocked', { count: view.blocked }))
    if (view?.hits) parts.push(t('matrix.hits', { count: view.hits }))
    return tEdge('aria', { from: names.end(row), to: names.end(col), services: parts.length ? parts.join(', ') : t('matrix.noFlow') })
  }

  // One set of handlers for every cell: each reads its cell from the data attributes, so the cells keep their props.
  const handlers = useMemo<CellHandlers>(() => {
    const where = (el: HTMLElement) => {
      const [r, c] = (el.dataset.cell ?? '0:0').split(':').map(Number)
      return { r, c, id: el.dataset.id ?? '', open: !!el.dataset.tone }
    }
    const light = (el: HTMLElement) => setHover({ row: el.dataset.row ?? null, col: el.dataset.col ?? null })
    const focusCell = (r: number, c: number) => {
      const next = { r: Math.max(0, Math.min(rows.length - 1, r)), c: Math.max(0, Math.min(cols.length - 1, c)) }
      setActive(next)
      grid.current?.querySelector<HTMLElement>(`[data-cell="${next.r}:${next.c}"]`)?.focus()
    }
    const moves: Record<string, (r: number, c: number) => [number, number]> = {
      ArrowUp: (r, c) => [r - 1, c], ArrowDown: (r, c) => [r + 1, c], ArrowLeft: (r, c) => [r, c - 1], ArrowRight: (r, c) => [r, c + 1],
      Home: r => [r, 0], End: r => [r, cols.length - 1],
    }
    return {
      onEnter: (event: MouseEvent<HTMLElement>) => light(event.currentTarget),
      onFocus: (event: FocusEvent<HTMLElement>) => {
        const { r, c } = where(event.currentTarget)
        setActive({ r, c })
        light(event.currentTarget)
      },
      onClick: (event: MouseEvent<HTMLElement>) => {
        const { r, c, id, open } = where(event.currentTarget)
        setActive({ r, c })
        if (open) onSelectCell(id)
      },
      onKey: (event: KeyboardEvent<HTMLElement>) => {
        const { r, c, id, open } = where(event.currentTarget)
        const move = moves[event.key]
        if (move) {
          event.preventDefault()
          focusCell(...move(r, c))
        } else if ((event.key === 'Enter' || event.key === ' ') && open) {
          event.preventDefault()
          onSelectCell(id)
        }
      },
    }
  }, [rows.length, cols.length, onSelectCell])

  const sticky = { position: 'sticky', bgcolor: 'background.paper', borderColor: 'divider' } as const
  // The lit row and column: one rule on the grid, in a neutral tint (red and blue tell the traffic, orange is the brand).
  const litSx = (theme: Theme) => {
    const tint = alpha(theme.palette.text.primary, 0.06)
    const heads: string[] = []
    const cells: string[] = []
    if (lit.row) {
      heads.push(`& [role="rowheader"][data-row="${attr(lit.row)}"]`)
      cells.push(`& [role="gridcell"][data-row="${attr(lit.row)}"]`)
    }
    if (lit.col) {
      heads.push(`& [role="columnheader"][data-col="${attr(lit.col)}"]`)
      cells.push(`& [role="gridcell"][data-col="${attr(lit.col)}"]`)
    }
    if (!heads.length) return {}
    return { [heads.join(', ')]: { backgroundImage: `linear-gradient(${tint}, ${tint})` }, [cells.join(', ')]: { boxShadow: `inset 0 0 0 9999px ${tint}` } }
  }

  return (
    <Box data-testid='matrix-frame' sx={{ width: '100%', height: '100%', overflow: 'auto' }} onMouseLeave={() => setHover({ row: null, col: null })}>
      <Box
        ref={grid}
        role='grid'
        aria-label={t('matrix.label')}
        aria-rowcount={rows.length + 1}
        aria-colcount={cols.length + 1}
        data-lit-row={lit.row ?? ''}
        data-lit-col={lit.col ?? ''}
        data-target={target ? target.key : undefined}
        data-columns={tracks.columns}
        data-rows={tracks.rows}
        sx={theme => ({
          display: 'grid', gridTemplateColumns: tracks.columns, gridTemplateRows: tracks.rows,
          width: '100%', height: '100%', minWidth: tracks.minWidth, minHeight: tracks.minHeight, boxSizing: 'border-box', ...litSx(theme), ...targetSx(target),
        })}
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
            <Box key={col.id} role='columnheader' data-col={col.id} sx={{ ...sticky, top: 0, zIndex: 2, borderBottom: 1, borderRight: 1, px: 1, display: 'flex', alignItems: 'flex-end', pb: 1, minWidth: 0 }}>
              <EndHead end={col} name={names.end(col)} onSelectZone={onSelectZone} />
            </Box>
          ))}
        </Box>
        {rows.map((row, r) => (
          <Box key={row.id} role='row' sx={{ display: 'contents' }}>
            <Box role='rowheader' data-row={row.id} sx={{ ...sticky, left: 0, zIndex: 1, borderBottom: 1, borderRight: 1, px: 1, display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <EndHead end={row} name={names.end(row)} onSelectZone={onSelectZone} />
            </Box>
            {cols.map((col, c) => {
              const id = cellId(row.id, col.id)
              const view = views.get(id) ?? null
              return (
                <MatrixCell
                  key={col.id}
                  id={id}
                  r={r}
                  c={c}
                  rowId={row.id}
                  colId={col.id}
                  view={view}
                  aria={ariaOf(row, col, view)}
                  selected={selectedCell === id}
                  tabbable={activeR === r && activeC === c}
                  diagonal={row.id === col.id}
                  chips={size.chips}
                  handlers={handlers}
                  marker={target && view?.observed.some(o => involvesTarget(o, target)) ? marker : undefined}
                />
              )
            })}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
