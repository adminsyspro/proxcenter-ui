'use client'

import { useEffect } from 'react'

import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'

import 'leaflet/dist/leaflet.css'

import { Box, Stack, Typography, useTheme } from '@mui/material'

import { countryFlagUrl } from '@/lib/utils/countries'
import { CountryFlag } from '@/components/ui/CountryFlag'

export interface DcEntryNode {
  name: string
  status: string | null
  vmCount: number
  runningVmCount: number
}

export interface DcEntry {
  id: string
  name: string
  locationLabel: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  comment: string | null
  nodeCount: number
  vmCount: number
  runningVmCount: number
  status: 'online' | 'degraded' | 'offline'
  nodes: DcEntryNode[]
}

const STATUS_COLORS = {
  online: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
} as const

function buildPinHtml(dc: DcEntry): string {
  const color = STATUS_COLORS[dc.status]
  const stoppedCount = dc.vmCount - dc.runningVmCount
  const flagUrl = countryFlagUrl(dc.country, 20)


return `
    <div style="position: relative; display: flex; flex-direction: column; align-items: center; pointer-events: auto;">
      <div style="
        background: rgba(15, 23, 42, 0.92);
        color: #fff;
        border: 1.5px solid ${color};
        border-radius: 8px;
        padding: 6px 10px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 11px;
        line-height: 1.3;
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        white-space: nowrap;
        min-width: 110px;
      ">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; margin-bottom: 2px;">
          <span style="
            width: 8px; height: 8px; border-radius: 50%;
            background: ${color};
            box-shadow: 0 0 6px ${color};
          "></span>
          ${flagUrl ? `<img src="${flagUrl}" alt="" style="width: 16px; height: auto; border-radius: 2px; vertical-align: middle;" />` : ''}
          ${dc.name}
        </div>
        <div style="opacity: 0.8; font-size: 10px;">
          ${dc.runningVmCount}/${dc.vmCount} VM${dc.vmCount > 1 ? 's' : ''} running
          ${stoppedCount > 0 ? ` · <span style="color:${STATUS_COLORS.degraded}">${stoppedCount} off</span>` : ''}
        </div>
      </div>
      <div style="
        width: 0; height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 8px solid ${color};
        margin-top: -1px;
      "></div>
    </div>
  `
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (positions.length === 0) return

    if (positions.length === 1) {
      map.setView(positions[0], 5)

return
    }

    const bounds = L.latLngBounds(positions)

    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 })
  }, [map, positions])

return null
}

interface Props {
  datacenters: DcEntry[]
}

export default function MyDatacentersMapInner({ datacenters }: Props) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'

  const tileAttribution = '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'

  const positions: [number, number][] = datacenters
    .filter(d => d.latitude != null && d.longitude != null)
    .map(d => [d.latitude!, d.longitude!])

  if (positions.length === 0) {
    return (
      <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, opacity: 0.6 }}>
        <i className="ri-map-pin-line" style={{ fontSize: 32 }} />
        <Typography variant="caption" color="text.secondary">
          No datacenter has lat/lon configured for this vDC.
        </Typography>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        height: 320,
        borderRadius: 1,
        overflow: 'hidden',

        // Theme-aware Leaflet popup. Default styling uses pure white which
        // looks broken in dark mode. We retarget the global Leaflet classes
        // here (their CSS is loaded via leaflet.css) so they pick up the
        // current MUI palette.
        '& .leaflet-popup-content-wrapper': {
          bgcolor: 'background.paper',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: 3,
        },
        '& .leaflet-popup-tip': {
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
        },
        '& .leaflet-popup-content': {
          color: 'text.primary',
        },
        '& .leaflet-container a.leaflet-popup-close-button': {
          color: 'text.secondary',
          '&:hover': { color: 'text.primary' },
        },
      }}
    >
      <MapContainer
        center={positions[0]}
        zoom={5}
        style={{ width: '100%', height: '100%' }}
        zoomControl
        scrollWheelZoom={false}
      >
        <TileLayer url={tileUrl} attribution={tileAttribution} />
        <FitBounds positions={positions} />
        {datacenters
          .filter(d => d.latitude != null && d.longitude != null)
          .map(dc => (
            <Marker
              key={dc.id}
              position={[dc.latitude!, dc.longitude!]}
              icon={L.divIcon({
                html: buildPinHtml(dc),
                className: '',
                iconSize: [120, 50],
                iconAnchor: [60, 50],
              })}
            >
              <Popup>
                {/* Tenant-facing popup: geo + capacity only. Nodes are an
                    implementation detail of the provider — abstracted out
                    of /my-vdc by design. */}
                <Stack spacing={0.5} sx={{ minWidth: 220 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    {dc.country && <CountryFlag code={dc.country} size={20} />}
                    <Typography variant="subtitle2" fontWeight={700}>{dc.name}</Typography>
                  </Stack>
                  {dc.locationLabel && (
                    <Typography variant="caption" color="text.secondary">{dc.locationLabel}</Typography>
                  )}
                  <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                    <Box>
                      <Typography variant="caption" color="text.secondary">VMs running</Typography>
                      <Typography variant="body2" fontWeight={600}>
                        {dc.runningVmCount}/{dc.vmCount}
                      </Typography>
                    </Box>
                    {dc.country && (
                      <Box>
                        <Typography variant="caption" color="text.secondary">Region</Typography>
                        <Typography variant="body2" fontWeight={600}>{dc.country.toUpperCase()}</Typography>
                      </Box>
                    )}
                  </Stack>

                  {dc.comment && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                      {dc.comment}
                    </Typography>
                  )}
                </Stack>
              </Popup>
            </Marker>
          ))}
      </MapContainer>
    </Box>
  )
}
