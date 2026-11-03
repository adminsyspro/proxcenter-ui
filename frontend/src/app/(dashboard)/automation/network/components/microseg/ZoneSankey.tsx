'use client'

import { useState, type KeyboardEvent } from 'react'
import { Box, Tooltip, Typography, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MatrixEnd } from './matrixModel'
import type { Ribbon, SankeyLayout, SankeyNode } from './sankeyModel'
import { EDGE_COLORS, EXTERNAL_ID } from './zoneGraph'

/** The drawing, in its own units (the SVG scales to the width of the map): labels, bars, then the ribbons between. */
const W = 960
const LABEL_W = 210
const BAR_W = 12
const HEAD = 30
const LEFT_X = LABEL_W
const RIGHT_X = W - LABEL_W - BAR_W
const MAX_NAME = 22

type Side = 'source' | 'target'
type Focus = { ribbon: string } | { node: string; side: Side } | null

/** Where the dot and the name of a node go: left of the bar on the left, right of it on the right. */
const LABEL_AT: Record<Side, { bar: number; dot: number; text: number; anchor: 'start' | 'end' }> = {
  source: { bar: LEFT_X, dot: LEFT_X - 12, text: LEFT_X - 22, anchor: 'end' },
  target: { bar: RIGHT_X, dot: RIGHT_X + BAR_W + 12, text: RIGHT_X + BAR_W + 22, anchor: 'start' },
}

const short = (name: string) => (name.length > MAX_NAME ? `${name.slice(0, MAX_NAME - 1)}…` : name)
const onKeys = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

type NodeBarProps = {
  node: SankeyNode
  side: Side
  name: string
  color: string
  /** The label of the button that opens the zone panel; null for Unknown / External and Outside. */
  openLabel: string | null
  hitsLabel: string | null
  onOpen: (zoneId: string) => void
  onFocus: (focus: Focus) => void
}

/** A node: its bar (as tall as its ribbons), its dot and name, its hits under the name; a zone opens its panel. */
function NodeBar({ node: n, side, name, color, openLabel, hitsLabel, onOpen, onFocus }: NodeBarProps) {
  const theme = useTheme()
  const at = LABEL_AT[side]
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

type Props = {
  layout: SankeyLayout
  /** The cell (pair) whose flow panel is open, and the node id of the zone whose panel is open. */
  selectedCell: string | null
  selectedZone: string | null
  onSelectCell: (cellId: string) => void
  onSelectZone: (zoneId: string) => void
  names: { end: (e: Pick<MatrixEnd, 'kind' | 'zone'>) => string }
}

/**
 * The Sankey rendering: the sources on the left, the destinations on the right, a ribbon per pair and kind, the
 * observed ones wider with more hits (red unprotected, blue blocked), the allowed ones thin and green (they have no
 * counter, the note says so). Hovering a ribbon or a node lights it and dims the rest; a click (or enter) on a
 * ribbon opens the flow panel of its pair, on a zone its panel.
 */
export default function ZoneSankey({ layout, selectedCell, selectedZone, onSelectCell, onSelectZone, names }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const theme = useTheme()
  const [focus, setFocus] = useState<Focus>(null)
  const lit = litRibbons(layout, focus, selectedCell, selectedZone)
  const height = HEAD + layout.height + 16
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
    const services = r.services.join(', ')
    return { title: `${from} → ${to}`, line: `${legend}: ${services}`, amount, aria: t('edge.aria', { from, to, services: `${services}, ${amount}` }) }
  }

  const nodeBar = (n: SankeyNode, side: Side) => (
    <NodeBar
      key={`${side}:${n.id}`}
      node={n}
      side={side}
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
    <Box sx={{ height: '100%', overflow: 'auto', p: 1.5, boxSizing: 'border-box' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, minWidth: 0 }}>
        <Box component='i' className='ri-information-line' aria-hidden sx={{ color: 'text.secondary', flexShrink: 0 }} />
        <Tooltip title={t('sankey.note')}>
          <Typography noWrap variant='caption' color='text.secondary' sx={{ minWidth: 0 }}>{t('sankey.note')}</Typography>
        </Tooltip>
      </Box>
      <svg role='img' aria-label={t('sankey.label')} viewBox={`0 0 ${W} ${height}`} width='100%' style={{ display: 'block', maxWidth: 1100, margin: '0 auto' }}>
        <text x={LEFT_X + BAR_W / 2} y={14} textAnchor='middle' fontSize={12} fill={theme.palette.text.secondary}>{t('sankey.sources')}</text>
        <text x={RIGHT_X + BAR_W / 2} y={14} textAnchor='middle' fontSize={12} fill={theme.palette.text.secondary}>{t('sankey.destinations')}</text>
        <g>
          {layout.ribbons.map(r => {
            const ya = HEAD + r.y0 + r.width / 2
            const yb = HEAD + r.y1 + r.width / 2
            const x0 = LEFT_X + BAR_W
            const xm = (x0 + RIGHT_X) / 2
            const on = !lit || lit.has(r.id)
            const tip = ribbonTip(r)
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
                <path
                  data-ribbon={r.id}
                  role='button'
                  tabIndex={0}
                  aria-label={tip.aria}
                  aria-pressed={selectedCell === r.cell}
                  d={`M ${x0} ${ya} C ${xm} ${ya}, ${xm} ${yb}, ${RIGHT_X} ${yb}`}
                  fill='none'
                  stroke={EDGE_COLORS[r.kind]}
                  strokeWidth={r.width}
                  strokeOpacity={on ? 0.55 : 0.1}
                  style={{ cursor: 'pointer', transition: 'stroke-opacity 150ms', outline: 'none' }}
                  onClick={() => onSelectCell(r.cell)}
                  onKeyDown={onKeys(() => onSelectCell(r.cell))}
                  onMouseEnter={() => setFocus({ ribbon: r.id })}
                  onMouseLeave={() => setFocus(null)}
                  onFocus={() => setFocus({ ribbon: r.id })}
                  onBlur={() => setFocus(null)}
                />
              </Tooltip>
            )
          })}
        </g>
        {layout.sources.map(n => nodeBar(n, 'source'))}
        {layout.targets.map(n => nodeBar(n, 'target'))}
      </svg>
    </Box>
  )
}
