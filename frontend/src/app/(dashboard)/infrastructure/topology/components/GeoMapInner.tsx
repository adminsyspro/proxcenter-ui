'use client'

import { useEffect } from 'react'

import { Box, Typography } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

import 'leaflet/dist/leaflet.css'

import type { InventoryCluster } from '../types'

// Status → color mapping
const statusColors: Record<string, string> = {
  online: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
}

function createClusterIcon(status: string) {
  const color = statusColors[status] || '#6b7280'

  return L.divIcon({
    className: '',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
    html: `<div style="
      width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      background:${color};
      border:3px solid rgba(255,255,255,0.9);
      border-radius:50%;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
    ">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
        <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/>
      </svg>
    </div>`,
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
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 })
    }
  }, [map, positions])

  return null
}

interface GeoMapInnerProps {
  connections: InventoryCluster[]
}

export default function GeoMapInner({ connections }: GeoMapInnerProps) {
  const theme = useTheme()
  const t = useTranslations('topology')
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

        const totalNodes = conn.nodes.length
        const totalVms = conn.nodes.reduce((sum, n) => sum + n.guests.length, 0)
        const runningVms = conn.nodes.reduce(
          (sum, n) => sum + n.guests.filter((g) => g.status === 'running').length,
          0
        )

        // Compute average CPU/RAM usage
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

        return (
          <Marker
            key={conn.id}
            position={[conn.latitude, conn.longitude]}
            icon={createClusterIcon(conn.status)}
          >
            <Popup>
              <Box sx={{ minWidth: 200, p: 0.5 }}>
                <Typography variant='subtitle2' sx={{ fontWeight: 700, mb: 0.5 }}>
                  {conn.name}
                </Typography>
                {conn.locationLabel && (
                  <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>
                    <i className='ri-map-pin-2-fill' style={{ fontSize: 12, marginRight: 4 }} />
                    {conn.locationLabel}
                  </Typography>
                )}
                <Box
                  sx={{
                    display: 'inline-block',
                    px: 1,
                    py: 0.25,
                    borderRadius: 1,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#fff',
                    bgcolor: statusColors[conn.status] || '#6b7280',
                    mb: 1,
                  }}
                >
                  {conn.status.toUpperCase()}
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mt: 0.5 }}>
                  <Typography variant='caption'>
                    {t('nodes')}: <strong>{totalNodes}</strong>
                  </Typography>
                  <Typography variant='caption'>
                    {t('vms')}: <strong>{runningVms}/{totalVms}</strong>
                  </Typography>
                  <Typography variant='caption'>
                    CPU: <strong>{cpuPct}%</strong>
                  </Typography>
                  <Typography variant='caption'>
                    RAM: <strong>{ramPct}%</strong>
                  </Typography>
                </Box>
              </Box>
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
