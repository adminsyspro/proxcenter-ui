'use client'

import { Box, Stack, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { VxlanTransportMode } from '@/lib/vdc/types'

/**
 * Copy of each transport mode: the label of the select, the rule that fills
 * the zone peers, what ProxCenter writes on the nodes, and a scenario.
 * Shared with VdcTab, which renders the labels in the select itself.
 */
export const TRANSPORT_MODE_KEYS: Record<
  VxlanTransportMode,
  { label: string; hint: string; writes: string; example: string }
> = {
  cluster: {
    label: 'vdc.transportModeCluster',
    hint: 'vdc.transportModeClusterHint',
    writes: 'vdc.transportModeClusterWrites',
    example: 'vdc.transportModeClusterExample',
  },
  peers: {
    label: 'vdc.transportModePeers',
    hint: 'vdc.transportModePeersHint',
    writes: 'vdc.transportModePeersWrites',
    example: 'vdc.transportModePeersExample',
  },
  transport: {
    label: 'vdc.transportModeTransport',
    hint: 'vdc.transportModeTransportHint',
    writes: 'vdc.transportModeTransportWrites',
    example: 'vdc.transportModeTransportExample',
  },
}

export interface DiagramNode {
  name: string
  /** The address this node contributes to the zone peers, null when it has none. */
  address: string | null
}

interface Props {
  mode: VxlanTransportMode
  /** Cluster nodes, with the address they contribute in the current mode. */
  nodes: DiagramNode[]
  /** Peers that belong to no node of the cluster: a router, another site. */
  externalPeers: string[]
  /** Transport mode: the VLAN interface carried by every node, e.g. vmbr0.4000. */
  iface?: string | null
  /** Transport mode: the segment the addresses are carved from. */
  segment?: string | null
}

// The drawing is a fixed 300x98 grid scaled to the available width: three
// bands, the VXLAN overlay on top, the nodes in the middle, the network that
// carries the tunnels at the bottom.
const VIEW_W = 300
const VIEW_H = 98
const PAD = 8
const GAP = 8
const BOX_Y = 24
const BOX_H = 30
const BUS_Y = 68
const MAX_BOXES = 5

interface Item {
  name: string
  address: string | null
  /** An endpoint outside the cluster, drawn with a dashed border. */
  external?: boolean
  /** The "+N" box standing for what does not fit. */
  overflow?: boolean
}

/** Keeps a long node name or an IPv6 address inside its box. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Nodes first, then the endpoints outside the cluster, then a "+N" box when
 * the cluster is larger than the drawing. A big cluster keeps one external
 * endpoint visible: that is the part of the picture worth reading.
 */
function layout(nodes: DiagramNode[], externalPeers: string[]): Item[] {
  const ext: Item[] = externalPeers.map((p) => ({ name: '', address: p, external: true }))
  const all: Item[] = [...nodes.map((n) => ({ name: n.name, address: n.address })), ...ext]
  if (all.length <= MAX_BOXES) return all

  const extShown = ext.slice(0, 1)
  const nodeSlots = MAX_BOXES - 1 - extShown.length
  const hidden = nodes.length - nodeSlots + (ext.length - extShown.length)
  return [
    ...nodes.slice(0, nodeSlots).map((n) => ({ name: n.name, address: n.address })),
    ...extShown,
    { name: `+${hidden}`, address: null, overflow: true },
  ]
}

export default function TransportModeDiagram({ mode, nodes, externalPeers, iface, segment }: Props) {
  const t = useTranslations()
  const copy = TRANSPORT_MODE_KEYS[mode]

  // No node answered yet: an outline of three boxes still says what the mode
  // does, so the card never renders empty.
  const placeholder = nodes.length === 0 && externalPeers.length === 0
  const items = placeholder
    ? [{ name: 'node1', address: null }, { name: 'node2', address: null }, { name: 'node3', address: null }]
    : layout(nodes, externalPeers)

  const boxW = (VIEW_W - PAD * 2 - GAP * (items.length - 1)) / items.length
  const centerOf = (i: number) => PAD + i * (boxW + GAP) + boxW / 2
  const firstCenter = centerOf(0)
  const lastCenter = centerOf(items.length - 1)

  // The bottom band names the network the tunnels ride on. Only the transport
  // mode draws a network ProxCenter itself creates, so only that one is
  // solid and accented; a peer list describes a network we never touch.
  const busLabel =
    mode === 'transport'
      ? iface || t('vdc.transportDiagramSegment')
      : mode === 'peers'
        ? t('vdc.transportDiagramLinkPeers')
        : t('vdc.transportDiagramLinkCluster')
  const busDashed = mode !== 'transport'
  const busAccent = mode === 'transport'

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { sm: 'center' },
        gap: 2,
        p: 1.5,
        borderRadius: 1,
        bgcolor: 'action.hover',
      }}
    >
      <Box
        component="svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={t(copy.hint)}
        sx={{
          width: { xs: '100%', sm: 300 },
          flexShrink: 0,
          color: 'text.secondary',
          opacity: placeholder ? 0.45 : 1,
          '& .accent': { color: 'primary.main' },
          '& text': { fill: 'currentColor' },
          '& .muted': { opacity: 0.7 },
        }}
      >
        {/* Overlay band: the tenant VNets, which ride the network below. */}
        <text x={VIEW_W / 2} y={7} textAnchor="middle" fontSize={7} letterSpacing={0.6}>
          VXLAN
        </text>
        <line
          x1={firstCenter}
          y1={13}
          x2={lastCenter}
          y2={13}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="3 3"
          opacity={0.45}
        />
        <line x1={firstCenter} y1={13} x2={firstCenter} y2={BOX_Y} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
        <line x1={lastCenter} y1={13} x2={lastCenter} y2={BOX_Y} stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />

        {items.map((item, i) => {
          const x = PAD + i * (boxW + GAP)
          const cx = centerOf(i)
          return (
            <g key={`${item.name}-${item.address ?? i}`}>
              <rect
                x={x}
                y={BOX_Y}
                width={boxW}
                height={BOX_H}
                rx={3}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray={item.external || item.overflow ? '3 2' : undefined}
                opacity={item.overflow ? 0.6 : 0.85}
              />
              {item.overflow ? (
                <text x={cx} y={BOX_Y + 18} textAnchor="middle" fontSize={8}>
                  {item.name}
                </text>
              ) : (
                <>
                  <text x={cx} y={BOX_Y + 12} textAnchor="middle" fontSize={7.5}>
                    {item.external ? t('vdc.transportDiagramExternal') : clip(item.name, 10)}
                  </text>
                  <text x={cx} y={BOX_Y + 23} textAnchor="middle" fontSize={6.5} className="muted">
                    {item.address ? clip(item.address, 15) : '—'}
                  </text>
                </>
              )}
              {/* Every box hangs off the same network. */}
              <line x1={cx} y1={BOX_Y + BOX_H} x2={cx} y2={BUS_Y} stroke="currentColor" strokeWidth={1} opacity={0.5} />
            </g>
          )
        })}

        <g className={busAccent ? 'accent' : undefined}>
          <line
            x1={PAD}
            y1={BUS_Y}
            x2={VIEW_W - PAD}
            y2={BUS_Y}
            stroke="currentColor"
            strokeWidth={1.5}
            strokeDasharray={busDashed ? '4 3' : undefined}
          />
          <text x={VIEW_W / 2} y={BUS_Y + 12} textAnchor="middle" fontSize={7.5}>
            {clip(busLabel, 34)}
          </text>
        </g>
        {mode === 'transport' && segment && (
          <text x={VIEW_W / 2} y={BUS_Y + 23} textAnchor="middle" fontSize={6.5} className="muted">
            {clip(segment, 34)}
          </text>
        )}
      </Box>

      <Stack spacing={0.75} sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {t(copy.hint)}
        </Typography>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {t(copy.writes)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {t(copy.example)}
        </Typography>
      </Stack>
    </Box>
  )
}
