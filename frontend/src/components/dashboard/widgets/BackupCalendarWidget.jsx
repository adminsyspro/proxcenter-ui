'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Tooltip as MuiTooltip, Typography, useTheme } from '@mui/material'
import { widgetColors } from './themeColors'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getCalendarColor(total, verified, unverified) {
  if (total === 0) return 'rgba(255,255,255,0.04)'
  if (unverified > 0 && verified === 0) return '#f4433690'
  if (unverified > 0) return '#ff980090'
  return total > 10 ? '#4caf50' : total > 5 ? '#4caf50c0' : '#4caf5080'
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function formatSize(bytes) {
  if (!bytes) return '0'
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

// ─── Day Tooltip ─────────────────────────────────────────────────────────────
function DayTooltip({ day, isDark }) {
  if (!day.date) return null
  const dateObj = new Date(day.date + 'T00:00:00')
  const formatted = dateObj.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const c = widgetColors(isDark)
  const labelColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'
  const separatorColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 140, color: c.tooltipText }}>
      <div style={{ background: day.total > 0 ? '#3b82f6' : '#616161', color: '#fff', padding: '4px 10px', fontWeight: 700, fontSize: 11 }}>
        {formatted}
      </div>
      <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: labelColor }}>Total</span>
          <span style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{day.total}</span>
        </div>
        {day.vm > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: labelColor }}>VM</span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{day.vm}</span>
        </div>}
        {day.ct > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: labelColor }}>CT</span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{day.ct}</span>
        </div>}
        {day.host > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: labelColor }}>Host</span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{day.host}</span>
        </div>}
        <div style={{ borderTop: `1px solid ${separatorColor}`, paddingTop: 4, marginTop: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: '#4caf50' }}>Verified</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{day.verified}</span>
          </div>
          {day.unverified > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{ color: '#ff9800' }}>Unverified</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{day.unverified}</span>
          </div>}
        </div>
        {day.size > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.5 }}>
          <span>Size</span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{formatSize(day.size)}</span>
        </div>}
      </div>
    </div>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function BackupCalendarWidget({ data, loading: dashboardLoading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [trendData, setTrendData] = useState(null)
  const [loadingTrends, setLoadingTrends] = useState(false)

  const pbsServers = data?.pbs?.serverDetails || []
  const serversKey = pbsServers.map(s => s.id).join(',')

  useEffect(() => {
    if (!pbsServers.length) return
    setLoadingTrends(true)
    const controller = new AbortController()
    let cancelled = false

    Promise.all(
      pbsServers.map(async (server) => {
        try {
          const res = await fetch(`/api/v1/pbs/${encodeURIComponent(server.id)}/backups/trends?days=30`, { cache: 'no-store', signal: controller.signal })
          if (!res.ok) return null
          const json = await res.json()
          return json?.data?.daily || []
        } catch { return null }
      })
    ).then(results => {
      if (cancelled) return
      const merged = {}
      for (const daily of results) {
        if (!daily) continue
        for (const day of daily) {
          if (!merged[day.date]) merged[day.date] = { date: day.date, total: 0, vm: 0, ct: 0, host: 0, verified: 0, unverified: 0, size: 0 }
          merged[day.date].total += day.total || 0
          merged[day.date].vm += day.vm || 0
          merged[day.date].ct += day.ct || 0
          merged[day.date].host += day.host || 0
          merged[day.date].verified += day.verified || 0
          merged[day.date].unverified += day.unverified || 0
          merged[day.date].size += day.size || 0
        }
      }
      setTrendData(merged)
      setLoadingTrends(false)
    })

    return () => { cancelled = true; controller.abort() }
  }, [serversKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Build calendar grid organized by weeks (rows) x days (cols)
  const { weeks, stats } = useMemo(() => {
    if (!trendData) return { weeks: [], stats: null }

    const days = []
    const now = new Date()

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      const dayOfWeek = (d.getDay() + 6) % 7 // 0=Mon, 6=Sun
      days.push({
        date: dateStr,
        dayOfWeek,
        dayNum: d.getDate(),
        month: d.toLocaleDateString(undefined, { month: 'short' }),
        ...(trendData[dateStr] || { total: 0, vm: 0, ct: 0, host: 0, verified: 0, unverified: 0, size: 0 }),
      })
    }

    // Organize into weeks
    const weeksArr = []
    let currentWeek = new Array(7).fill(null)

    for (const day of days) {
      currentWeek[day.dayOfWeek] = day
      if (day.dayOfWeek === 6) {
        weeksArr.push(currentWeek)
        currentWeek = new Array(7).fill(null)
      }
    }
    // Push remaining partial week
    if (currentWeek.some(d => d !== null)) weeksArr.push(currentWeek)

    const total = days.reduce((s, d) => s + d.total, 0)
    const verified = days.reduce((s, d) => s + d.verified, 0)
    const zeroDays = days.filter(d => d.total === 0).length
    const totalSize = days.reduce((s, d) => s + d.size, 0)

    return { weeks: weeksArr, stats: { total, verified, zeroDays, totalSize } }
  }, [trendData])

  const darkCard = {
    bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    borderRadius: 2.5, p: 1.5,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
  }

  if (!data || dashboardLoading || loadingTrends || !weeks.length) {
    return (
      <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {pbsServers.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, opacity: 0.65 }}>
            <i className='ri-calendar-check-line' style={{ fontSize: 24 }} />
            <Typography sx={{ fontSize: 11 }}>{t('common.noData')}</Typography>
          </Box>
        ) : <CircularProgress size={24} />}
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', ...darkCard, display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          {stats && (
            <>
              <Typography sx={{ fontSize: 10, opacity: 0.6 }}>30d</Typography>
              <Typography sx={{ fontSize: 10, opacity: 0.6 }}>
                <span style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{stats.total}</span> backups
              </Typography>
              <Typography sx={{ fontSize: 10, color: '#4caf50' }}>
                <span style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{stats.verified}</span> verified
              </Typography>
              {stats.zeroDays > 0 && (
                <Typography sx={{ fontSize: 10, color: '#ff9800' }}>{stats.zeroDays}d empty</Typography>
              )}
              {stats.totalSize > 0 && (
                <Typography sx={{ fontSize: 10, opacity: 0.5 }}>{formatSize(stats.totalSize)}</Typography>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* Calendar grid */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5 }}>
        {/* Day name headers */}
        <Box sx={{ display: 'flex', gap: '4px', pl: '32px' }}>
          {DAY_NAMES.map(d => (
            <Box key={d} sx={{ flex: 1, textAlign: 'center' }}>
              <Typography sx={{ fontSize: 9, opacity: 0.4, fontWeight: 600 }}>{d}</Typography>
            </Box>
          ))}
        </Box>

        {/* Weeks */}
        {weeks.map((week, wIdx) => (
          <Box key={wIdx} sx={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Week label */}
            <Box sx={{ width: 28, flexShrink: 0, textAlign: 'right', pr: 0.5 }}>
              {week.find(d => d && (d.dayNum <= 7 || wIdx === 0)) && (
                <Typography sx={{ fontSize: 8, opacity: 0.4 }}>
                  {week.find(d => d)?.month}
                </Typography>
              )}
            </Box>

            {/* Day cells */}
            {week.map((day, dIdx) => {
              if (!day) {
                return <Box key={dIdx} sx={{ flex: 1, aspectRatio: '1', borderRadius: 1 }} />
              }

              const bgColor = getCalendarColor(day.total, day.verified, day.unverified)

              return (
                <MuiTooltip key={dIdx} title={<DayTooltip day={day} isDark={isDark} />} arrow placement="top"
                  slotProps={{ tooltip: { sx: { bgcolor: 'transparent', p: 0, maxWidth: 'none' } }, arrow: { sx: { color: c.tooltipBg } } }}
                >
                  <Box sx={{
                    flex: 1, aspectRatio: '1', borderRadius: 1,
                    bgcolor: bgColor, cursor: 'default',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    transition: 'transform 0.1s',
                    minHeight: 18, maxHeight: 36,
                    '&:hover': { transform: 'scale(1.1)', zIndex: 10, outline: '1px solid rgba(255,255,255,0.4)' },
                  }}>
                    <Typography sx={{ fontSize: 8, opacity: 0.5, lineHeight: 1 }}>{day.dayNum}</Typography>
                    {day.total > 0 && (
                      <Typography sx={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontFamily: '"JetBrains Mono", monospace', lineHeight: 1 }}>
                        {day.total}
                      </Typography>
                    )}
                  </Box>
                </MuiTooltip>
              )
            })}
          </Box>
        ))}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }} />
          <Typography sx={{ fontSize: 8, opacity: 0.5 }}>0</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: '#4caf5080' }} />
          <Typography sx={{ fontSize: 8, opacity: 0.5 }}>1-5</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: '#4caf50c0' }} />
          <Typography sx={{ fontSize: 8, opacity: 0.5 }}>6-10</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: '#4caf50' }} />
          <Typography sx={{ fontSize: 8, opacity: 0.5 }}>10+</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
          <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: '#ff980090' }} />
          <Typography sx={{ fontSize: 8, opacity: 0.5 }}>Unverified</Typography>
        </Box>
      </Box>
    </Box>
  )
}

export default React.memo(BackupCalendarWidget)
