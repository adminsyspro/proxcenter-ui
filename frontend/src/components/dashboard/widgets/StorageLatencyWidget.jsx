'use client'

import React, { useMemo } from 'react'

import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Tooltip, Typography, useTheme } from '@mui/material'

import { useLicense } from '@/contexts/LicenseContext'
import { useAlertThresholds } from '@/hooks/useAlerts'
import { useDiskLatency } from '@/hooks/useDiskLatency'
import { formatLatency } from '@/lib/metrics/latency'

import ConnectionFilter from './ConnectionFilter'
import { widgetColors } from './themeColors'

// The amber of the latency curve in the guest's Disk I/O chart, so the same
// figure reads the same way in both places when no threshold judges it.
const ACCENT = '#f59e0b'

const SEVERITY_COLORS = { ok: '#4caf50', warning: '#ff9800', critical: '#f44336', none: ACCENT }

/**
 * Judges a latency against the guest disk latency thresholds of the alerting.
 * A warning threshold at 0 means the family is off, and the widget then paints
 * every bar in the neutral accent rather than pretending everything is fine.
 */
export function latencySeverity(ms, thresholds) {
  const warning = Number(thresholds?.disk_latency_warning) || 0
  const critical = Number(thresholds?.disk_latency_critical) || 0

  if (warning <= 0) return 'none'
  if (critical > 0 && ms >= critical) return 'critical'
  if (ms >= warning) return 'warning'

  return 'ok'
}

/**
 * The rows of the widget: every storage the orchestrator measured, restricted
 * to the connections whose nodes the dashboard payload lets this user see
 * (`clusters` is not RBAC-filtered, `nodes` is), then to the persisted filter,
 * slowest first.
 */
export function selectStorageRows(index, data, selectedConnections = []) {
  const names = new Map()

  for (const n of data?.nodes || []) {
    const id = n.connectionId || n.connId
    if (id && !names.has(id)) names.set(id, n.connection || n.connName || id)
  }
  for (const c of data?.clusters || []) {
    if (names.has(c.id) && names.get(c.id) === c.id && c.name) names.set(c.id, c.name)
  }

  const wanted = new Set(selectedConnections)
  const rows = []

  for (const [key, s] of index?.storages || []) {
    const sep = key.indexOf(':')
    const connId = sep > 0 ? key.slice(0, sep) : key
    if (!names.has(connId)) continue
    if (wanted.size > 0 && !wanted.has(connId)) continue
    rows.push({ key, connId, connectionName: names.get(connId), ...s })
  }

  rows.sort((a, b) => b.latency_ms - a.latency_ms || a.storage.localeCompare(b.storage))

  return { rows, connections: [...names].map(([id, name]) => ({ id, name })) }
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function StorageLatencyWidget({ data, loading: dashboardLoading, config, onUpdateSettings }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const { isEnterprise } = useLicense()
  const index = useDiskLatency()
  const { data: thresholds } = useAlertThresholds(isEnterprise)

  const selectedSetting = config?.settings?.selectedConnections
  const selectedConnections = useMemo(() => selectedSetting || [], [selectedSetting])

  const handleFilterChange = (next) => {
    if (onUpdateSettings) onUpdateSettings({ selectedConnections: next })
  }

  const { rows, connections } = useMemo(
    () => selectStorageRows(index, data, selectedConnections),
    [index, data, selectedConnections],
  )

  const scaleMs = useMemo(() => rows.reduce((m, r) => Math.max(m, r.latency_ms), 0), [rows])

  if (!isEnterprise) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: '2.2857rem', color: 'var(--mui-palette-warning-main)', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ opacity: 0.75 }}>Enterprise</Typography>
      </Box>
    )
  }

  if (dashboardLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Box
      sx={{
        height: '100%', display: 'flex', flexDirection: 'column', gap: 0.75,
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 'var(--proxcenter-card-radius)', p: 1.5,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)', boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      {/* A noContainer widget shows no title outside edit mode: this line is
          what names the figure on screen. The filter stays mounted on an empty
          list because its selection is persisted and must stay reachable. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <i className='ri-pulse-line' style={{ fontSize: '1rem', color: ACCENT }} />
        <Typography variant='caption' sx={{ fontWeight: 700, fontSize: '0.7857rem', color: c.textPrimary }}>
          {t('dashboard.widgetStorageLatency.title')}
        </Typography>
        <Typography variant='caption' sx={{ fontSize: '0.6429rem', color: c.textMuted }}>ms / I/O</Typography>
        <Box sx={{ ml: 'auto' }}>
          {connections.length > 1 && (
            <ConnectionFilter connections={connections} selected={selectedConnections} onChange={handleFilterChange} t={t} />
          )}
        </Box>
      </Box>

      {rows.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.75, px: 1 }}>
          <Typography variant='caption' sx={{ opacity: 0.65, textAlign: 'center' }}>{t('dashboard.widgetStorageLatency.noData')}</Typography>
          {selectedConnections.length > 0 && (
            <Box
              onClick={() => handleFilterChange([])}
              sx={{
                px: 1, py: 0.25, borderRadius: 1, cursor: 'pointer', fontSize: '0.7143rem', fontWeight: 600,
                color: c.textMuted, bgcolor: c.borderLight,
                '&:hover': { bgcolor: c.surfaceSubtle, color: c.textPrimary },
              }}
            >
              {t('common.reset')}
            </Box>
          )}
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {rows.map((row, idx) => {
            const severity = latencySeverity(row.latency_ms, thresholds)
            const color = SEVERITY_COLORS[severity]
            const pct = scaleMs > 0 ? Math.max(2, Math.round((row.latency_ms / scaleMs) * 100)) : 0

            return (
              <Tooltip
                key={row.key}
                title={
                  <Box>
                    <Typography variant='caption' display='block'>
                      {t('dashboard.widgetStorageLatency.readWrite', { read: formatLatency(row.read_ms), write: formatLatency(row.write_ms) })}
                    </Typography>
                    <Typography variant='caption' display='block'>
                      {t('dashboard.widgetStorageLatency.window', { minutes: index.windowMinutes, avg: formatLatency(row.window_avg_ms), max: formatLatency(row.window_max_ms) })}
                    </Typography>
                    <Typography variant='caption' display='block'>
                      {t('dashboard.widgetStorageLatency.guests', { vms: row.vms, disks: row.disks })}
                    </Typography>
                  </Box>
                }
              >
                <Box
                  data-testid='storage-latency-row'
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1, py: 0.5,
                    borderBottom: idx < rows.length - 1 ? '1px solid' : 'none', borderColor: c.borderLight,
                  }}
                >
                  <i className='ri-hard-drive-2-line' style={{ fontSize: '0.9286rem', opacity: 0.65, flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0, flex: '0 1 40%', display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
                    {/* Two clusters can share a storage name: the connection is the
                        discriminator, so it never shrinks and the storage takes the ellipsis. */}
                    <Typography variant='caption' noWrap sx={{ minWidth: 0, fontWeight: 700, fontSize: '0.7857rem' }}>{row.storage}</Typography>
                    {connections.length > 1 && (
                      <Typography variant='caption' noWrap sx={{ flexShrink: 0, fontSize: '0.6429rem', color: c.textMuted }}>{row.connectionName}</Typography>
                    )}
                  </Box>
                  <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: c.surfaceSubtle, overflow: 'hidden' }}>
                    <Box sx={{ width: `${pct}%`, height: '100%', bgcolor: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </Box>
                  <Typography variant='caption' sx={{ fontWeight: 700, fontSize: '0.7857rem', minWidth: 48, textAlign: 'right', color: severity === 'none' ? c.textPrimary : color }}>
                    {formatLatency(row.latency_ms)}
                  </Typography>
                </Box>
              </Tooltip>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

export default React.memo(StorageLatencyWidget)
