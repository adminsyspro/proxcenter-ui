'use client'

// The three drawings of the vDC help tab, in the idiom of TransportModeDiagram:
// a fixed-grid inline SVG scaled to its width, `currentColor` for everything
// Proxmox owns, the primary colour for what ProxCenter creates, dashed strokes
// for what it only reads. Labels come from the message catalogue.

import { Box, useTheme } from '@mui/material'
import { useTranslations } from 'next-intl'

export type HelpDiagramKind = 'vdc' | 'network' | 'stretch'

const VIEW_W = 300
const VIEW_H = 120

const svgSx = {
  width: { xs: '100%', sm: 420 },
  maxWidth: '100%',
  display: 'block',
  color: 'text.secondary',
  '& .accent': { color: 'primary.main' },
  '& text': { fill: 'currentColor' },
  '& .muted': { opacity: 0.7 },
} as const

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Box component="svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={label} sx={svgSx}>
      {children}
    </Box>
  )
}

/** The Proxmox logo NodeIcon draws in front of every node name, per theme. */
function useProxmoxLogo(): string {
  const theme = useTheme()
  return theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'
}

const LOGO = 10

/** A rounded box with a centred label, optionally a second muted line and a Proxmox logo on the left. */
function NodeBox({ x, y, w, h, label, sub, dashed, muted, accent, logo }: {
  x: number; y: number; w: number; h: number; label: string; sub?: string; dashed?: boolean; muted?: boolean; accent?: boolean; logo?: string
}) {
  // With a logo the text is centred in what remains to its right.
  const cx = logo ? x + LOGO + 4 + (w - LOGO - 4) / 2 : x + w / 2
  return (
    <g className={accent ? 'accent' : undefined} opacity={muted ? 0.45 : 1}>
      <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke="currentColor" strokeWidth={accent ? 1.4 : 1} strokeDasharray={dashed ? '3 2' : undefined} opacity={0.85} />
      {logo && <image href={logo} x={x + 4} y={y + (h - LOGO) / 2} width={LOGO} height={LOGO} opacity={0.85} />}
      <text x={cx} y={sub ? y + h / 2 - 2 : y + h / 2 + 3} textAnchor="middle" fontSize={7}>{label}</text>
      {sub && <text x={cx} y={y + h / 2 + 8} textAnchor="middle" fontSize={6} className="muted">{sub}</text>}
    </g>
  )
}

/** One cluster, three nodes; the vDC is the accented part carved out of it. */
function VdcDiagram() {
  const t = useTranslations()
  const logo = useProxmoxLogo()
  const nodeY = 88
  const nodeH = 20
  const nodeW = 84
  const nodeX = [16, 108, 200]
  return (
    <Frame label={t('vdc.helpCreateTitle')}>
      <rect x={8} y={12} width={284} height={102} rx={4} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
      <text x={14} y={22} fontSize={7} letterSpacing={0.5}>{t('vdc.helpDiagramCluster').toUpperCase()}</text>

      <g className="accent">
        <rect x={16} y={28} width={176} height={52} rx={3} fill="none" stroke="currentColor" strokeWidth={1.4} />
        <text x={22} y={38} fontSize={8} fontWeight={600}>{t('vdc.helpDiagramVdc')}</text>
        <text x={22} y={50} fontSize={6.5}>{t('vdc.helpDiagramPool')} · {t('vdc.helpDiagramQuotas')} · {t('vdc.helpDiagramStorages')}</text>
        <rect x={22} y={56} width={164} height={18} rx={2} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" opacity={0.8} />
        <text x={104} y={68} textAnchor="middle" fontSize={6.5}>{t('vdc.helpDiagramZone')} · lan · dmz</text>
      </g>

      {/* The nodes the vDC may use hang off it; the third belongs to the cluster only. */}
      <line x1={58} y1={80} x2={58} y2={nodeY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={150} y1={80} x2={150} y2={nodeY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <NodeBox x={nodeX[0]} y={nodeY} w={nodeW} h={nodeH} label="node1" logo={logo} />
      <NodeBox x={nodeX[1]} y={nodeY} w={nodeW} h={nodeH} label="node2" logo={logo} />
      <NodeBox x={nodeX[2]} y={nodeY} w={nodeW} h={nodeH} label="node3" sub={t('vdc.helpDiagramOtherNode')} muted logo={logo} />
      <text x={104} y={85} textAnchor="middle" fontSize={6} className="muted">{t('vdc.helpDiagramNodesGranted')}</text>
    </Frame>
  )
}

/** What a guest can be attached to: the tenant's VNets, an uplink, a VLAN of a pool. */
function NetworkDiagram() {
  const t = useTranslations()
  const vmY = 8
  const vmH = 16
  const netY = 44
  const netH = 34
  const busY = 104
  return (
    <Frame label={t('vdc.helpNetworkTitle')}>
      {/* Guests, and the network each NIC lands on. */}
      <NodeBox x={30} y={vmY} w={40} h={vmH} label="VM" />
      <NodeBox x={120} y={vmY} w={40} h={vmH} label="VM" />
      <NodeBox x={232} y={vmY} w={40} h={vmH} label="VM" />
      <line x1={50} y1={vmY + vmH} x2={50} y2={netY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={140} y1={vmY + vmH} x2={90} y2={netY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={140} y1={vmY + vmH} x2={166} y2={netY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={252} y1={vmY + vmH} x2={252} y2={netY} stroke="currentColor" strokeWidth={1} opacity={0.5} />

      {/* The tenant's own networks: created by ProxCenter, addressed by its IPAM. */}
      <g className="accent">
        <rect x={8} y={netY} width={112} height={netH} rx={3} fill="none" stroke="currentColor" strokeWidth={1.4} />
        <text x={64} y={netY + 11} textAnchor="middle" fontSize={7} fontWeight={600}>{t('vdc.helpDiagramTenantVnets')}</text>
        <text x={64} y={netY + 21} textAnchor="middle" fontSize={6.5}>lan 10.1.0.0/24</text>
        <text x={64} y={netY + 29} textAnchor="middle" fontSize={6.5}>dmz 10.1.1.0/24</text>
      </g>
      {/* Uplinks and VLAN pools belong to the host: ProxCenter only grants them. */}
      <NodeBox x={128} y={netY} w={76} h={netH} label={t('vdc.helpDiagramSharedBridge')} sub="vmbr0 · WAN" dashed />
      <NodeBox x={212} y={netY} w={80} h={netH} label={t('vdc.helpDiagramVlanPool')} sub="vmbr0 · 100-200" dashed />

      <line x1={64} y1={netY + netH} x2={64} y2={busY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={166} y1={netY + netH} x2={166} y2={busY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={252} y1={netY + netH} x2={252} y2={busY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
      <line x1={8} y1={busY} x2={292} y2={busY} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={150} y={busY + 11} textAnchor="middle" fontSize={7}>{t('vdc.helpDiagramNodes')}</text>
    </Frame>
  )
}

/** Two clusters, one vDC each, the same VNet on both, tunnels between their nodes. */
function StretchDiagram() {
  const t = useTranslations()
  const logo = useProxmoxLogo()
  const frames = [{ x: 8, letter: 'A' }, { x: 172, letter: 'B' }]
  const frameW = 120
  const frameY = 22
  const frameH = 78
  const zoneY = 32
  const zoneH = 20
  const nodeY = 68
  const nodeH = 20
  const busY = 112
  return (
    <Frame label={t('vdc.helpStretchTitle')}>
      <text x={150} y={9} textAnchor="middle" fontSize={7} letterSpacing={0.5}>{t('vdc.helpDiagramOneSegment').toUpperCase()}</text>

      {frames.map(({ x, letter }) => {
        const cx = x + frameW / 2
        return (
          <g key={letter}>
            <rect x={x} y={frameY} width={frameW} height={frameH} rx={4} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="4 3" opacity={0.6} />
            <text x={x + 6} y={frameY + 8} fontSize={6.5} letterSpacing={0.4}>{t('vdc.helpDiagramCluster').toUpperCase()} {letter} · {t('vdc.helpDiagramVdc')}</text>
            <g className="accent">
              <rect x={x + 8} y={zoneY} width={frameW - 16} height={zoneH} rx={3} fill="none" stroke="currentColor" strokeWidth={1.4} />
              <text x={cx} y={zoneY + 9} textAnchor="middle" fontSize={7} fontWeight={600}>backbone · VNI 10002</text>
              <text x={cx} y={zoneY + 17} textAnchor="middle" fontSize={6}>10.77.0.0/24</text>
            </g>
            <line x1={x + 34} y1={zoneY + zoneH} x2={x + 34} y2={nodeY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
            <line x1={x + frameW - 34} y1={zoneY + zoneH} x2={x + frameW - 34} y2={nodeY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
            <NodeBox x={x + 8} y={nodeY} w={52} h={nodeH} label={`node${letter}1`} sub={letter === 'A' ? '10.42.0.101' : '10.42.0.111'} logo={logo} />
            <NodeBox x={x + frameW - 60} y={nodeY} w={52} h={nodeH} label={`node${letter}2`} sub={letter === 'A' ? '10.42.0.102' : '10.42.0.112'} logo={logo} />
            <line x1={x + 34} y1={nodeY + nodeH} x2={x + 34} y2={busY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
            <line x1={x + frameW - 34} y1={nodeY + nodeH} x2={x + frameW - 34} y2={busY} stroke="currentColor" strokeWidth={1} opacity={0.5} />
          </g>
        )
      })}

      {/* The tunnels: the same VNI at both ends, so the two zones are one segment. */}
      <g className="accent">
        <line x1={frames[0].x + frameW - 8} y1={zoneY + zoneH / 2} x2={frames[1].x + 8} y2={zoneY + zoneH / 2} stroke="currentColor" strokeWidth={1.4} strokeDasharray="3 2" />
        <text x={150} y={18} textAnchor="middle" fontSize={6.5}>{t('vdc.helpDiagramTunnels')}</text>
      </g>

      <line x1={8} y1={busY} x2={292} y2={busY} stroke="currentColor" strokeWidth={1.5} strokeDasharray="4 3" />
      <text x={150} y={busY + 7} textAnchor="middle" fontSize={6.5} className="muted">{t('vdc.helpDiagramUnderlay')}</text>
    </Frame>
  )
}

export default function HelpDiagram({ kind }: { kind: HelpDiagramKind }) {
  return (
    <Box sx={{ p: 1.5, mb: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
      {kind === 'vdc' && <VdcDiagram />}
      {kind === 'network' && <NetworkDiagram />}
      {kind === 'stretch' && <StretchDiagram />}
    </Box>
  )
}
