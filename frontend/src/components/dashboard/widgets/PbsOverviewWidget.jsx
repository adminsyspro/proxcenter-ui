'use client'

import React, { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, Tooltip as RTooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { widgetColors } from './themeColors'
import { mapTimeRange, sliceToRange, formatTime } from './timeRangeUtils'

// ─── Circular Gauge (animated) ───────────────────────────────────────────────
function CircularGauge({ value, label, size = 50, strokeWidth = 4, color, sublabel, isDark = true }) {
  const c = widgetColors(isDark)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [mounted, setMounted] = useState(false)
  const offset = mounted ? circumference - (value / 100) * circumference : circumference

  useEffect(() => { const t = setTimeout(() => setMounted(true), 50);

 

return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={c.surfaceSubtle} strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
            {value}%
          </Typography>
        </Box>
      </Box>
      <Typography sx={{ fontSize: 8, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      {sublabel && <Typography sx={{ fontSize: 8, opacity: 0.5, fontFamily: '"JetBrains Mono", monospace', mt: -0.25 }}>{sublabel}</Typography>}
    </Box>
  )
}


function IoTooltip({ active, payload, isDark }) {
  if (!active || !payload?.length) return null
  const time = formatTime(payload)
  const c = widgetColors(isDark)

  
return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 90, color: c.tooltipText }}>
      <div style={{ background: '#3b82f6', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-speed-line' style={{ fontSize: 10 }} /> IO / NET {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px' }}>
        {payload.map(e => (
          <div key={e.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <span style={{ color: e.color, fontWeight: 700 }}>{e.name}</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{formatRate(e.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getGaugeColor(value) {
  if (value >= 90) return '#f44336'
  if (value >= 75) return '#ff9800'
  
return '#4caf50'
}

function formatBytes(bytes) {
  if (!bytes) return '0'
  const gb = bytes / (1024 * 1024 * 1024)

  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  
return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

function formatRate(bytes) {
  if (bytes == null || bytes === 0) return '0 B/s'
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`
  
return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB/s`
}

// ─── PBS Server Card ─────────────────────────────────────────────────────────
function PbsCard({ server, theme, t, rrdData }) {
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const usagePct = server.usagePct || 0
  const hasErrors = server.backupsError > 0

  const totalBackups = server.backups24h || 0
  const okBackups = server.backupsOk || 0
  const errorBackups = server.backupsError || 0
  const successRate = totalBackups > 0 ? Math.round((okBackups / totalBackups) * 100) : 100

  const verifyTotal = server.verifyTotal || 0
  const verifyOk = server.verifyOk || 0
  const verifyError = server.verifyError || 0

  const hasRrd = rrdData && rrdData.length > 2

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5, p: 1.5, display: 'flex', flexDirection: 'column',
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        '&:hover': { borderColor: c.surfaceActive, boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Box sx={{ position: 'relative', width: 18, height: 18, flexShrink: 0 }}>
          <i className='ri-shield-check-line' style={{ fontSize: 16, opacity: 0.6 }} />
          <Box sx={{
            position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%',
            bgcolor: hasErrors ? '#f44336' : '#4caf50',
            border: '1.5px solid', borderColor: c.dotBorder
          }} />
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {server.name}
        </Typography>
        <Typography sx={{ fontSize: 9, opacity: 0.65, fontFamily: '"JetBrains Mono", monospace' }}>
          {server.datastores} DS
        </Typography>
      </Box>

      {/* Gauges + Stats centered */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
        {/* Gauges: Storage + Backup success rate */}
        <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
          <CircularGauge value={usagePct} label={t('storage.title')} size={56} strokeWidth={5} color={getGaugeColor(usagePct)} sublabel={`${formatBytes(server.totalUsed)} / ${formatBytes(server.totalSize)}`} isDark={isDark} />
          <CircularGauge value={successRate} label="Backups" size={56} strokeWidth={5} color={successRate >= 100 ? '#4caf50' : successRate >= 80 ? '#ff9800' : '#f44336'} sublabel={`${okBackups}/${totalBackups}`} isDark={isDark} />
        </Box>

        {/* Stats: OK / Failed / Verify */}
        <Box sx={{ display: 'flex', justifyContent: 'space-around', gap: 0.5 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: '#4caf50', lineHeight: 1 }}>
              {okBackups}
            </Typography>
            <Typography sx={{ fontSize: 8, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>OK 24h</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: errorBackups > 0 ? '#f44336' : 'text.disabled', lineHeight: 1 }}>
              {errorBackups}
            </Typography>
            <Typography sx={{ fontSize: 8, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>{t('jobs.failed')}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: verifyError > 0 ? '#ff9800' : '#2196f3', lineHeight: 1 }}>
              {verifyOk}{verifyError > 0 && <span style={{ color: '#f44336', fontSize: 10 }}>/{verifyError}</span>}
            </Typography>
            <Typography sx={{ fontSize: 8, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase' }}>
              <i className='ri-verified-badge-fill' style={{ fontSize: 8, marginRight: 2 }} />Verify
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Sparklines pushed to bottom */}
      <Box sx={{ mt: 'auto' }}>
        <Typography sx={{ fontSize: 8, opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>IO / NET</Typography>
        <Box sx={{ height: 80, width: '100%', mb: 1 }}>
          {hasRrd ? (
            <ChartContainer>
              <AreaChart data={rrdData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <RTooltip content={<IoTooltip isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="diskread" name="Disk R" stroke="#ab47bc" fill="#ab47bc" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="diskwrite" name="Disk W" stroke="#ec4899" fill="#ec4899" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="netin" name="Net In" stroke="#4caf50" fill="#4caf50" fillOpacity={0.6} strokeWidth={1} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="netout" name="Net Out" stroke="#f97316" fill="#f97316" fillOpacity={0.6} strokeWidth={1} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}>
              <Typography sx={{ fontSize: 9 }}>...</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function PbsOverviewWidget({ data, loading, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const pbs = data?.pbs || {}
  const servers = pbs.serverDetails || []
  const [rrdByServer, setRrdByServer] = useState({})

  const serversKey = servers.map(s => s.id).join(',')

  // Fetch RRD data for each PBS server
  useEffect(() => {
    if (!servers.length) return
    const controller = new AbortController()
    let cancelled = false

    Promise.all(
      servers.map(async (server) => {
        try {
          const res = await fetch(
            `/api/v1/pbs/${encodeURIComponent(server.id)}/rrd?timeframe=${mapTimeRange(timeRange).rrdTimeframe}`,
            { cache: 'no-store', signal: controller.signal }
          )

          if (!res.ok) return null
          const json = await res.json()
          const points = sliceToRange((json?.data || []).filter(p => p && p.time), timeRange)

          
return { id: server.id, data: points }
        } catch { return null }
      })
    ).then(results => {
      if (cancelled) return
      const map = {}

      for (const r of results) { if (r && r.data.length > 0) map[r.id] = r.data }
      setRrdByServer(map)
    })

    return () => { cancelled = true; controller.abort() }
  }, [serversKey, timeRange]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pbs.servers || pbs.servers === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.65 }}>
        <i className='ri-shield-check-line' style={{ fontSize: 28, marginBottom: 4 }} />
        <Typography variant='caption'>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{
      height: '100%', overflow: 'auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gridAutoRows: '1fr',
      gap: 1, p: 0.5,
    }}>
      {servers.map((server, idx) => (
        <PbsCard key={server.id || idx} server={server} theme={theme} t={t} rrdData={rrdByServer[server.id] || []} />
      ))}
    </Box>
  )
}

export default React.memo(PbsOverviewWidget)
