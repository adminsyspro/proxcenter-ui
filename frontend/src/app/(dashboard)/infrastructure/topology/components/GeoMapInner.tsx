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

function createEnrichedIcon(conn: InventoryCluster) {
  const color = statusColors[conn.status] || '#6b7280'
  const stats = computeClusterStats(conn)
  const label = conn.locationLabel || conn.name
  const truncName = label.length > 16 ? label.slice(0, 15) + '…' : label

  const cpuColor = getUsageColor(stats.cpuPct)
  const ramColor = getUsageColor(stats.ramPct)

  const html = `<div style="
    display:flex;align-items:center;gap:6px;
    background:rgba(30,30,45,0.92);
    border:2px solid ${color};
    border-radius:10px;
    padding:6px 10px;
    box-shadow:0 2px 12px rgba(0,0,0,0.4);
    white-space:nowrap;
    cursor:pointer;
    min-width:120px;
  ">
    <div style="
      width:10px;height:10px;flex-shrink:0;
      background:${color};
      border-radius:50%;
      box-shadow:0 0 6px ${color};
    "></div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:11px;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;">${truncName}</div>
      <div style="display:flex;gap:8px;font-size:9px;color:rgba(255,255,255,0.7);margin-top:1px;">
        <span>${stats.totalNodes}N</span>
        <span>${stats.runningVms}/${stats.totalVms} VM</span>
      </div>
      <div style="display:flex;gap:4px;margin-top:3px;">
        <div style="flex:1;height:3px;background:rgba(255,255,255,0.15);border-radius:2px;overflow:hidden;">
          <div style="width:${stats.cpuPct}%;height:100%;background:${cpuColor};border-radius:2px;"></div>
        </div>
        <div style="flex:1;height:3px;background:rgba(255,255,255,0.15);border-radius:2px;overflow:hidden;">
          <div style="width:${stats.ramPct}%;height:100%;background:${ramColor};border-radius:2px;"></div>
        </div>
      </div>
      <div style="display:flex;gap:4px;font-size:7px;color:rgba(255,255,255,0.5);margin-top:1px;">
        <span style="flex:1;">CPU ${stats.cpuPct}%</span>
        <span style="flex:1;">RAM ${stats.ramPct}%</span>
      </div>
    </div>
  </div>`

  return L.divIcon({
    className: '',
    iconSize: [140, 56],
    iconAnchor: [70, 28],
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

        return (
          <Marker
            key={conn.id}
            position={[conn.latitude, conn.longitude]}
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
