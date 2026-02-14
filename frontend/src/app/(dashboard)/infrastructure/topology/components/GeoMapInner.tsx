'use client'

import { useEffect, useMemo } from 'react'

import { useTheme } from '@mui/material/styles'
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

  return { totalNodes, totalVms, runningVms, cpuPct, ramPct }
}

function svgGauge(pct: number, color: string, label: string, size = 32) {
  const r = (size - 4) / 2
  const c = Math.PI * 2 * r
  const dash = (pct / 100) * c
  const cx = size / 2
  const cy = size / 2

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2.5"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="2.5"
      stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" dominant-baseline="central"
      fill="#fff" font-size="7" font-weight="700">${pct}%</text>
    <text x="${cx}" y="${cy + 6}" text-anchor="middle" dominant-baseline="central"
      fill="rgba(255,255,255,0.5)" font-size="5.5">${label}</text>
  </svg>`
}

function createSingleConnectionHtml(conn: InventoryCluster) {
  const color = statusColors[conn.status] || '#6b7280'
  const stats = computeClusterStats(conn)
  const cpuColor = getUsageColor(stats.cpuPct)
  const ramColor = getUsageColor(stats.ramPct)

  const name = conn.name.length > 18 ? conn.name.slice(0, 17) + '…' : conn.name
  const location = conn.locationLabel
    ? (conn.locationLabel.length > 22 ? conn.locationLabel.slice(0, 21) + '…' : conn.locationLabel)
    : ''

  return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;" data-conn-id="${conn.id}">
    <div style="
      width:9px;height:9px;flex-shrink:0;
      background:${color};
      border-radius:50%;
      box-shadow:0 0 6px ${color};
    "></div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;">${name}</div>
      ${location ? `<div style="font-size:9px;color:rgba(255,255,255,0.5);overflow:hidden;text-overflow:ellipsis;">${location}</div>` : ''}
      <div style="display:flex;gap:8px;font-size:9px;color:rgba(255,255,255,0.65);margin-top:1px;">
        <span>${stats.totalNodes} PVE</span>
        <span>${stats.runningVms}/${stats.totalVms} VM</span>
      </div>
    </div>
    <div style="display:flex;gap:3px;flex-shrink:0;">
      ${svgGauge(stats.cpuPct, cpuColor, 'CPU')}
      ${svgGauge(stats.ramPct, ramColor, 'RAM')}
    </div>
  </div>`
}

function createGroupedIcon(group: InventoryCluster[]) {
  // Use the worst status color for the border
  const worstStatus = group.some(c => c.status === 'offline') ? 'offline'
    : group.some(c => c.status === 'degraded') ? 'degraded' : 'online'
  const borderColor = statusColors[worstStatus] || '#6b7280'

  const innerHtml = group
    .map((conn, i) => {
      const separator = i < group.length - 1
        ? '<div style="border-top:1px solid rgba(255,255,255,0.1);margin:0;"></div>'
        : ''

      return createSingleConnectionHtml(conn) + separator
    })
    .join('')

  const html = `<div style="
    background:rgba(30,30,45,0.94);
    border:2px solid ${borderColor};
    border-radius:12px;
    padding:4px 12px;
    box-shadow:0 4px 16px rgba(0,0,0,0.5);
    white-space:nowrap;
    cursor:pointer;
    min-width:200px;
  ">${innerHtml}</div>`

  const itemHeight = 46
  const totalHeight = group.length * itemHeight + 8

  return L.divIcon({
    className: '',
    iconSize: [280, totalHeight],
    iconAnchor: [140, totalHeight / 2],
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

// Group connections by identical coordinates
function groupByLocation(connections: InventoryCluster[]) {
  const groups = new Map<string, InventoryCluster[]>()

  for (const conn of connections) {
    if (conn.latitude == null || conn.longitude == null) continue
    const key = `${conn.latitude.toFixed(5)},${conn.longitude.toFixed(5)}`

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(conn)
  }

  return Array.from(groups.entries()).map(([key, conns]) => ({
    key,
    lat: conns[0].latitude!,
    lng: conns[0].longitude!,
    connections: conns,
  }))
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

  const groups = useMemo(() => groupByLocation(connections), [connections])

  return (
    <MapContainer
      center={positions[0] || [48.8566, 2.3522]}
      zoom={5}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
      zoomControl={true}
    >
      <TileLayer url={tileUrl} attribution={tileAttribution} />
      <FitBounds positions={positions} />

      {groups.map((group) => (
        <Marker
          key={group.key}
          position={[group.lat, group.lng]}
          icon={createGroupedIcon(group.connections)}
          eventHandlers={{
            click: (e) => {
              // Find which connection was clicked via the DOM
              const target = e.originalEvent?.target as HTMLElement | null
              const connEl = target?.closest?.('[data-conn-id]') as HTMLElement | null
              const connId = connEl?.getAttribute('data-conn-id')

              if (connId) {
                const conn = group.connections.find(c => c.id === connId)
                if (conn) { onSelectCluster(conn); return }
              }
              // Fallback: open first connection
              onSelectCluster(group.connections[0])
            },
          }}
        />
      ))}
    </MapContainer>
  )
}
