'use client'

import { useMemo, useState } from 'react'
import { Box, Tooltip, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import { serviceTokensTitle } from '@/lib/network/serviceNames'

import type { MatrixEnd, MatrixModel } from './matrixModel'
import { BAR_W, FILL_ENTER_WIDTH, FILL_MIN_WIDTH, FOOT, HEAD, buildSankey, type Ribbon, type SankeyLayout, type SankeyNode } from './sankeyModel'
import { useBoxSize } from './useBoxSize'
import { EDGE_COLORS, EXTERNAL_ID, type FlowFilters } from './zoneGraph'
import { onKeys } from './ZoneNode'

const MAX_NAME = 22

type Side = 'source' | 'target'
type Focus = { ribbon: string } | { node: string; side: Side } | null
type LabelAt = { bar: number; dot: number; text: number; anchor: 'start' | 'end' }

/** Where the bar, the dot and the name of a node go: left of the bar on the left, right of it on the right. */
function labelAt(side: Side, layout: Pick<SankeyLayout, 'leftX' | 'rightX'>): LabelAt {
  if (side === 'source') return { bar: layout.leftX, dot: layout.leftX - 12, text: layout.leftX - 22, anchor: 'end' }
  return { bar: layout.rightX, dot: layout.rightX + BAR_W + 12, text: layout.rightX + BAR_W + 22, anchor: 'start' }
}

const short = (name: string) => (name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name)

/** A ribbon or a node that has the keyboard focus is outlined in the primary colour. */
const FOCUS_SX = (color: string) => ({
  '& [data-ribbon]:focus-visible': { filter: `drop-shadow(0 0 2px ${color}) drop-shadow(0 0 2px ${color})` },
  '& [data-node]:focus-visible rect': { stroke: color, strokeWidth: 2 },
})

type NodeBarProps = {
  node: SankeyNode
  side: Side
  at: LabelAt
  name: string
  color: string
  /** The label of the button that opens the zone panel; null for Unknown / External and Outside. */
  openLabel: string | null
  hitsLabel: string | null
  onOpen: (zoneId: string) => void
  onFocus: (focus: Focus) => void
}

/** A node: its bar (as tall as its ribbons), its dot and name, its hits under the name; a zone opens its panel. */
function NodeBar({ node: n, side, at, name, color, openLabel, hitsLabel, onOpen, onFocus }: NodeBarProps) {
  const theme = useTheme()
  const y = HEAD + n.y
  const mid = y + n.height / 2
  const zone = n.zone
  const button = zone && openLabel
    ? { role: 'button', tabIndex: 0, 'aria-label': openLabel, onClick: () => onOpen(zone.id), onKeyDown: onKeys(() => onOpen(zone.id)), style: { cursor: 'pointer', outline: 'none' } }
    : { 'aria-label': name }
  const lightUp = () => onFocus({ node: n.id, side })
  return (
    <g data-node={`${side}:${n.id}`} {...button} onMouseEnter={lightUp} onMouseLeave={() => onFocus(null)} onFocus={lightUp} onBlur={() => onFocus(null)}>
      <title>{name}</title>
      <rect x={at.bar} y={y} width={BAR_W} height={Math.max(n.height, 2)} rx={2} fill={color} />
      <circle cx={at.dot} cy={mid} r={5} fill={color} />
      {/* The name, and under it the hits of a node that has some: the label column stays narrow. */}
      <text x={at.text} y={hitsLabel ? mid - 7 : mid} textAnchor={at.anchor} dominantBaseline='central' fontSize={13} fontWeight={600} fill={theme.palette.text.primary}>
        {short(name)}
      </text>
      {hitsLabel && (
        <text x={at.text} y={mid + 9} textAnchor={at.anchor} dominantBaseline='central' fontSize={11} fill={theme.palette.text.secondary}>
          {hitsLabel}
        </text>
      )}
    </g>
  )
}

/** The ribbons lit: the one hovered, the ones of a hovered node, else the selected pair, else the selected zone. */
function litRibbons(layout: SankeyLayout, focus: Focus, selectedCell: string | null, selectedZone: string | null): Set<string> | null {
  if (focus) {
    if ('ribbon' in focus) return new Set([focus.ribbon])
    const { node, side } = focus
    return new Set(layout.ribbons.filter(r => r[side] === node).map(r => r.id))
  }
  if (selectedCell) return new Set(layout.ribbons.filter(r => r.cell === selectedCell).map(r => r.id))
  if (selectedZone) return new Set(layout.ribbons.filter(r => r.source === selectedZone || r.target === selectedZone).map(r => r.id))
  return null
}

/** A targeted guest on the diagram: the node id of its zone and the ribbons its observed flows ride on. */
export type SankeyTarget = { zone: string | null; ribbons: ReadonlySet<string> }

type RibbonState = 'target' | 'lit' | 'dim'
const RIBBON_OPACITY: Record<RibbonState, number> = { target: 0.85, lit: 0.55, dim: 0.1 }

/** A target locks the diagram: its ribbons stand out, the other ribbons of its zone stay, the rest is dimmed. */
function ribbonState(r: Ribbon, lit: Set<string> | null, target: SankeyTarget | null): RibbonState {
  if (target) {
    if (target.ribbons.has(r.id)) return 'target'
    return target.zone && (r.source === target.zone || r.target === target.zone) ? 'lit' : 'dim'
  }
  return !lit || lit.has(r.id) ? 'lit' : 'dim'
}

type Props = {
  /** The pairs of the matrix: the diagram lays them out for the size of the map box (re-laid out when it changes). */
  model: MatrixModel
  filters: FlowFilters
  /** The cell (pair) whose flow panel is open, and the node id of the zone whose panel is open. */
  selectedCell: string | null
  selectedZone: string | null
  onSelectCell: (cellId: string) => void
  onSelectZone: (zoneId: string) => void
  names: { end: (e: Pick<MatrixEnd, 'kind' | 'zone'>) => string }
  target?: SankeyTarget | null
}

/**
 * The Sankey rendering: the sources on the left, the destinations on the right, a ribbon per pair and kind, the
 * observed ones wider with more hits (red unprotected, blue blocked), the allowed ones thin and green (they have no
 * counter, the note says so). Hovering a ribbon or a node lights it and dims the rest; a click (or enter) on a
 * ribbon opens the flow panel of its pair, on a zone its panel.
 */
export default function ZoneSankey({ model, filters, selectedCell, selectedZone, onSelectCell, onSelectZone, names, target = null }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const theme = useTheme()
  const [focus, setFocus] = useState<Focus>(null)
  // The box under the hint line: the diagram fills it (below FILL_MIN_WIDTH, or before it is measured, the compact
  // drawing scales to its width instead).
  const [measure, size] = useBoxSize<HTMLDivElement>()
  // Hysteresis: the diagram starts filling the box at FILL_ENTER_WIDTH and keeps filling it down to FILL_MIN_WIDTH, so a
  // box that wavers around the threshold (a scrollbar appearing) does not flip between the two drawings.
  const [filling, setFilling] = useState(false)
  const fillNow = !!size && size.width >= (filling ? FILL_MIN_WIDTH : FILL_ENTER_WIDTH)
  if (fillNow !== filling) setFilling(fillNow)
  const layout = useMemo(() => buildSankey(model, filters, fillNow ? size : null), [model, filters, size, fillNow])
  const lit = litRibbons(layout, focus, selectedCell, selectedZone)
  const byWidth = useMemo(() => [...layout.ribbons].sort((a, b) => b.width - a.width), [layout.ribbons])
  const height = HEAD + layout.height + FOOT
  const endKind = (id: string, side: Side) => {
    if (id === EXTERNAL_ID) return 'external' as const
    return side === 'target' && !id.startsWith('zone:') ? 'outside' as const : 'zone' as const
  }
  const nameOf = (n: Pick<SankeyNode, 'id' | 'zone'>, side: Side) => names.end({ kind: endKind(n.id, side), zone: n.zone })
  const nodeOf = new Map([...layout.sources.map(n => [`s:${n.id}`, n] as const), ...layout.targets.map(n => [`t:${n.id}`, n] as const)])

  const ribbonTip = (r: Ribbon) => {
    const from = nameOf(nodeOf.get(`s:${r.source}`)!, 'source')
    const to = nameOf(nodeOf.get(`t:${r.target}`)!, 'target')
    const amount = r.hits ? t('matrix.hits', { count: r.hits }) : t('sankey.flows', { count: r.count })
    const legend = t(r.kind === 'outside' ? 'legend.allowed' : `legend.${r.kind}`)
    const services = serviceTokensTitle(r.services)
    const line = `${legend}: ${services}`
    return { title: `${from} → ${to}`, line, amount, aria: t('edge.aria', { from, to, services: `${line}, ${amount}` }) }
  }

  const nodeBar = (n: SankeyNode, side: Side) => (
    <NodeBar
      key={`${side}:${n.id}`}
      node={n}
      side={side}
      at={labelAt(side, layout)}
      name={nameOf(n, side)}
      color={n.zone?.color || theme.palette.text.disabled}
      openLabel={n.zone ? t('matrix.openZone', { name: nameOf(n, side) }) : null}
      hitsLabel={n.hits > 0 ? t('matrix.hits', { count: n.hits }) : null}
      onOpen={onSelectZone}
      onFocus={setFocus}
    />
  )

  if (!layout.ribbons.length) {
    return <Typography color='text.secondary' sx={{ p: 2 }}>{t('sankey.empty')}</Typography>
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5, boxSizing: 'border-box', ...FOCUS_SX(theme.palette.primary.main) }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, minWidth: 0, flexShrink: 0 }}>
        <Box component='i' className='ri-information-line' aria-hidden sx={{ color: 'text.secondary', flexShrink: 0 }} />
        <Tooltip title={t('sankey.note')}>
          <Typography noWrap variant='caption' color='text.secondary' sx={{ minWidth: 0 }}>{t('sankey.note')}</Typography>
        </Tooltip>
      </Box>
      <Box ref={measure} data-testid='sankey-box' sx={{ flex: '1 1 auto', minHeight: 0, minWidth: 0, overflow: 'auto' }}>
        {/* A named figure, not an image: its ribbons and zones are buttons that assistive technology must reach. */}
        <Box component='figure' aria-label={t('sankey.label')} sx={{ m: 0 }}>
          <svg
            viewBox={`0 0 ${layout.width} ${height}`}
            width={layout.fill ? layout.width : '100%'}
            height={layout.fill ? height : undefined}
            data-fill={layout.fill ? 'true' : 'false'}
            style={layout.fill ? { display: 'block' } : { display: 'block', maxWidth: 1100, margin: '0 auto' }}
          >
            <text x={layout.leftX + BAR_W / 2} y={14} textAnchor='middle' fontSize={12} fill={theme.palette.text.secondary}>{t('sankey.sources')}</text>
            <text x={layout.rightX + BAR_W / 2} y={14} textAnchor='middle' fontSize={12} fill={theme.palette.text.secondary}>{t('sankey.destinations')}</text>
            <g>
              {/* The widest first: a thin ribbon (an allowed flow) is drawn over the wide ones and stays clickable. */}
              {byWidth.map(r => {
                const ya = HEAD + r.y0 + r.width / 2
                const yb = HEAD + r.y1 + r.width / 2
                const x0 = layout.leftX + BAR_W
                const xm = (x0 + layout.rightX) / 2
                const state = ribbonState(r, lit, target)
                const on = state !== 'dim'
                const tip = ribbonTip(r)
                const d = `M ${x0} ${ya} C ${xm} ${ya}, ${xm} ${yb}, ${layout.rightX} ${yb}`
                return (
                  <Tooltip
                    key={r.id}
                    followCursor
                    title={(
                      <Box>
                        <Typography variant='caption' fontWeight={600} sx={{ display: 'block' }}>{tip.title}</Typography>
                        <Typography variant='caption' sx={{ display: 'block' }}>{tip.line}</Typography>
                        <Typography variant='caption' sx={{ display: 'block' }}>{tip.amount}</Typography>
                      </Box>
                    )}
                  >
                    <g>
                      <path
                        data-ribbon={r.id}
                        data-state={state}
                        role='button'
                        tabIndex={0}
                        aria-label={tip.aria}
                        aria-pressed={selectedCell === r.cell}
                        d={d}
                        fill='none'
                        stroke={EDGE_COLORS[r.kind]}
                        strokeWidth={r.width}
                        strokeOpacity={RIBBON_OPACITY[state]}
                        style={{ cursor: 'pointer', transition: 'stroke-opacity 150ms', outline: 'none' }}
                        onClick={() => onSelectCell(r.cell)}
                        onKeyDown={onKeys(() => onSelectCell(r.cell))}
                        onMouseEnter={() => setFocus({ ribbon: r.id })}
                        onMouseLeave={() => setFocus(null)}
                        onFocus={() => setFocus({ ribbon: r.id })}
                        onBlur={() => setFocus(null)}
                      />
                      {/* Unprotected traffic is dashed red, like in the legend of the toolbar. */}
                      {r.kind === 'unprotected' && (
                        <path data-dash={r.id} d={d} fill='none' stroke={EDGE_COLORS.unprotected} strokeWidth={2} strokeDasharray='6 4' strokeOpacity={on ? 1 : 0.2} pointerEvents='none' aria-hidden />
                      )}
                    </g>
                  </Tooltip>
                )
              })}
            </g>
            {layout.sources.map(n => nodeBar(n, 'source'))}
            {layout.targets.map(n => nodeBar(n, 'target'))}
          </svg>
        </Box>
      </Box>
    </Box>
  )
}
