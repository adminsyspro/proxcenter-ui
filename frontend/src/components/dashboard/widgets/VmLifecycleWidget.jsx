'use client'

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, LinearProgress, CircularProgress, useTheme, alpha } from '@mui/material'

function timeAgo(ts) {
  if (!ts) return ''
  const now = Date.now() / 1000
  const diff = Math.floor(now - ts)

  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function VmLifecycleWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const [auditEvents, setAuditEvents] = useState([])
  const [loadingAudit, setLoadingAudit] = useState(true)

  const fetchAudit = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/audit?category=vm&limit=10')
      if (res.ok) {
        const json = await res.json()
        setAuditEvents(json?.data || json?.logs || [])
      }
    } catch {
      // ignore
    } finally {
      setLoadingAudit(false)
    }
  }, [])

  useEffect(() => {
    fetchAudit()
    const interval = setInterval(fetchAudit, 60000)
    return () => clearInterval(interval)
  }, [fetchAudit])

  // Age distribution from vmList + lxcList using uptime as proxy
  const ageBuckets = useMemo(() => {
    const vms = data?.vmList || []
    const lxcs = data?.lxcList || []
    const all = [...vms, ...lxcs]

    const buckets = [
      { label: t('dashboard.lessThan7d'), max: 7 * 86400, count: 0, color: theme.palette.success.main },
      { label: t('dashboard.lessThan30d'), max: 30 * 86400, count: 0, color: theme.palette.success.light },
      { label: t('dashboard.lessThan90d'), max: 90 * 86400, count: 0, color: theme.palette.info.main },
      { label: t('dashboard.lessThan1y'), max: 365 * 86400, count: 0, color: theme.palette.warning.main },
      { label: t('dashboard.moreThan1y'), max: Infinity, count: 0, color: theme.palette.error.main },
    ]

    all.forEach(vm => {
      const uptime = vm.uptime || 0
      for (const bucket of buckets) {
        if (uptime < bucket.max) {
          bucket.count++
          break
        }
      }
    })

    const total = all.length || 1
    buckets.forEach(b => { b.pct = Math.round((b.count / total) * 100) })

    return buckets
  }, [data?.vmList, data?.lxcList, t, theme])

  const recentEvents = auditEvents.slice(0, 5)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, overflow: 'auto' }}>
      {/* Recent Activity */}
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
          {t('dashboard.recentActivity')}
        </Typography>
        {loadingAudit ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
            <CircularProgress size={16} />
          </Box>
        ) : recentEvents.length === 0 ? (
          <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 10 }}>
            {t('common.noData')}
          </Typography>
        ) : (
          recentEvents.map((event, idx) => {
            const isCreate = event.action === 'create' || event.action === 'clone'
            const isDelete = event.action === 'delete' || event.action === 'destroy'
            const color = isCreate ? theme.palette.success.main : isDelete ? theme.palette.error.main : theme.palette.info.main
            const actionLabel = isCreate ? t('dashboard.created') : isDelete ? t('dashboard.removed') : (event.action || '?')
            const ts = event.timestamp || event.createdAt

            return (
              <Box
                key={`${event.id || idx}`}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1,
                  py: 0.4,
                  borderBottom: idx < recentEvents.length - 1 ? '1px solid' : 'none',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{
                  width: 6, height: 6, borderRadius: '50%',
                  bgcolor: color, flexShrink: 0,
                }} />
                <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 10, color }}>
                  {actionLabel}
                </Typography>
                <Typography variant='caption' sx={{ fontSize: 10, flex: 1, minWidth: 0 }} noWrap>
                  {event.resourceId || event.details?.vmid || ''}
                </Typography>
                {ts && (
                  <Typography variant='caption' sx={{ opacity: 0.4, fontSize: 9, flexShrink: 0 }}>
                    {timeAgo(typeof ts === 'string' ? new Date(ts).getTime() / 1000 : ts)}
                  </Typography>
                )}
              </Box>
            )
          })
        )}
      </Box>

      {/* Age Distribution */}
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
          {t('dashboard.vmAge')}
        </Typography>
        {ageBuckets.map((bucket) => (
          <Box key={bucket.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant='caption' sx={{ fontSize: 10, width: 36, textAlign: 'right', opacity: 0.7, flexShrink: 0 }}>
              {bucket.label}
            </Typography>
            <Box sx={{ flex: 1, position: 'relative' }}>
              <LinearProgress
                variant='determinate'
                value={bucket.pct}
                sx={{
                  height: 14, borderRadius: 1, bgcolor: 'action.hover',
                  '& .MuiLinearProgress-bar': { borderRadius: 1, bgcolor: bucket.color }
                }}
              />
              <Typography variant='caption' sx={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: '#fff', lineHeight: 1,
                textShadow: '0 0 2px rgba(0,0,0,0.5)',
              }}>
                {bucket.count}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default React.memo(VmLifecycleWidget)
