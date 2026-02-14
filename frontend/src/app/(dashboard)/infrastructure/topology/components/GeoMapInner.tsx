'use client'

import { useEffect } from 'react'

import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'

import 'leaflet/dist/leaflet.css'

import type { InventoryCluster } from '../types'

// Status → color mapping
const statusColors: Record<string, string> = {
  online: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
}

function getUsageColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#22c55e'
}

function computeClusterStats(conn: InventoryCluster) {
  const totalNodes = conn.nodes.length
  const onlineNodes = conn.nodes.filter((n) => n.status === 'online').length
  const totalVms = conn.nodes.reduce((sum, n) => sum + n.guests.length, 0)
  const runningVms = conn.nodes.reduce(
    (sum, n) => sum + n.guests.filter((g) => g.status === 'running').length,
    0
  )

  let cpuSum = 0
  let cpuCount = 0
  let memUsed = 0
  let memTotal = 0

  for (const node of conn.nodes) {
    if (node.cpu != null) {
      cpuSum += node.cpu
      cpuCount++
    }
    if (node.mem != null) memUsed += node.mem
    if (node.maxmem != null) memTotal += node.maxmem
  }

  const cpuPct = cpuCount > 0 ? Math.round((cpuSum / cpuCount) * 100) : 0
  const ramPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0

  return { totalNodes, onlineNodes, totalVms, runningVms, cpuPct, ramPct }
}

function svgGauge(pct: number, color: string, label: string, size = 36) {
  const r = (size - 4) / 2
  const c = Math.PI * 2 * r
  const dash = (pct / 100) * c
  const cx = size / 2
  const cy = size / 2

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="3"
      stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 3}" text-anchor="middle" dominant-baseline="central"
      fill="#fff" font-size="8" font-weight="700">${pct}%</text>
    <text x="${cx}" y="${cy + 7}" text-anchor="middle" dominant-baseline="central"
      fill="rgba(255,255,255,0.5)" font-size="6">${label}</text>
  </svg>`
}

function createEnrichedIcon(conn: InventoryCluster) {
  const color = statusColors[conn.status] || '#6b7280'
  const stats = computeClusterStats(conn)
  const label = conn.locationLabel || conn.name
  const truncName = label.length > 20 ? label.slice(0, 19) + '…' : label

  const cpuColor = getUsageColor(stats.cpuPct)
  const ramColor = getUsageColor(stats.ramPct)

  const html = `<div style="
    display:flex;align-items:center;gap:8px;
    background:rgba(30,30,45,0.94);
    border:2px solid ${color};
    border-radius:12px;
    padding:8px 12px;
    box-shadow:0 4px 16px rgba(0,0,0,0.5);
    white-space:nowrap;
    cursor:pointer;
    min-width:180px;
  ">
    <div style="
      width:10px;height:10px;flex-shrink:0;
      background:${color};
      border-radius:50%;
      box-shadow:0 0 8px ${color};
    "></div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:12px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;">${truncName}</div>
      <div style="display:flex;gap:10px;font-size:10px;color:rgba(255,255,255,0.7);margin-top:2px;">
        <span>${stats.totalNodes} PVE</span>
        <span>${stats.runningVms}/${stats.totalVms} VM</span>
      </div>
    </div>
    <div style="display:flex;gap:4px;flex-shrink:0;">
      ${svgGauge(stats.cpuPct, cpuColor, 'CPU')}
      ${svgGauge(stats.ramPct, ramColor, 'RAM')}
    </div>
  </div>`

  return L.divIcon({
    className: '',
    iconSize: [260, 64],
    iconAnchor: [130, 32],
    html,
  })
}

// Auto-fit bounds to all markers
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (positions.length === 0) return

    if (positions.length === 1) {
      map.setView(positions[0], 10)
    } else {
      const bounds = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]))
      map.fitBounds(bounds, { padding: [80, 80], maxZoom: 12 })
    }
  }, [map, positions])

  return null
}

interface GeoMapInnerProps {
  connections: InventoryCluster[]
  onSelectCluster: (cluster: InventoryCluster | null) => void
}

// Spread overlapping markers in a circle around their shared position
function computeOffsets(connections: InventoryCluster[]): Map<string, [number, number]> {
  const offsets = new Map<string, [number, number]>()
  const groups = new Map<string, string[]>()

  for (const conn of connections) {
    if (conn.latitude == null || conn.longitude == null) continue
    const key = `${conn.latitude.toFixed(5)},${conn.longitude.toFixed(5)}`

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(conn.id)
  }

  for (const ids of groups.values()) {
    if (ids.length <= 1) continue
    const spread = 0.005 // ~500m offset radius
    const angleStep = (2 * Math.PI) / ids.length

    ids.forEach((id, i) => {
      const angle = angleStep * i - Math.PI / 2
      offsets.set(id, [
        Math.sin(angle) * spread,
        Math.cos(angle) * spread,
      ])
    })
  }

  return offsets
}

export default function GeoMapInner({ connections, onSelectCluster }: GeoMapInnerProps) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'

  const tileAttribution = isDark
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

  const positions: [number, number][] = connections
    .filter((c) => c.latitude != null && c.longitude != null)
    .map((c) => [c.latitude!, c.longitude!])

  const offsets = computeOffsets(connections)

  return (
    <MapContainer
      center={positions[0] || [48.8566, 2.3522]}
      zoom={5}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
      zoomControl={true}
    >
      <TileLayer url={tileUrl} attribution={tileAttribution} />
      <FitBounds positions={positions} />

      {connections.map((conn) => {
        if (conn.latitude == null || conn.longitude == null) return null
        const offset = offsets.get(conn.id)
        const lat = conn.latitude + (offset ? offset[0] : 0)
        const lng = conn.longitude + (offset ? offset[1] : 0)

        return (
          <Marker
            key={conn.id}
            position={[lat, lng]}
            icon={createEnrichedIcon(conn)}
            eventHandlers={{
              click: () => onSelectCluster(conn),
            }}
          />
        )
      })}
    </MapContainer>
  )
}
