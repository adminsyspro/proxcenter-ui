'use client'

import { useEffect, useState } from 'react'

import dynamic from 'next/dynamic'

import { useTranslations } from 'next-intl'

import {
  Alert, Box, Chip, Collapse, IconButton, Paper, Skeleton, Stack, Tooltip, Typography,
} from '@mui/material'

import type { DcEntry } from './MyDatacentersMapInner'

const COLLAPSE_KEY = 'myVdc.mapCollapsed'

// Leaflet must run client-side only — SSR breaks on `window` access.
const MyDatacentersMapInner = dynamic(() => import('./MyDatacentersMapInner'), {
  ssr: false,
  loading: () => <Skeleton variant="rounded" height={320} />,
})

interface Props {
  vdcId: string
}

const REFRESH_MS = 60_000

const STATUS_COLORS = {
  online: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
} as const

export default function MyDatacentersMapCard({ vdcId }: Props) {
  const t = useTranslations()
  const [datacenters, setDatacenters] = useState<DcEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Default collapsed: the map is large and most users only need it on demand.
  // If the user has explicitly toggled before, honour their persisted choice.
  const [collapsed, setCollapsed] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(COLLAPSE_KEY)

    if (stored !== null) setCollapsed(stored === '1')
  }, [])

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev

      if (typeof window !== 'undefined') {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      }


return next
    })
  }

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/datacenters`, { cache: 'no-store' })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()

        if (!cancelled) {
          setDatacenters(Array.isArray(json?.data) ? json.data : [])
          setError(null)
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const interval = setInterval(() => { void load() }, REFRESH_MS)


return () => { cancelled = true; clearInterval(interval) }
  }, [vdcId])

  const totalRunningVms = datacenters.reduce((s, d) => s + d.runningVmCount, 0)
  const totalVms = datacenters.reduce((s, d) => s + d.vmCount, 0)

  const statusCounts = datacenters.reduce(
    (acc, d) => { acc[d.status]++;

return acc },
    { online: 0, degraded: 0, offline: 0 } as Record<DcEntry['status'], number>,
  )

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        onClick={toggleCollapsed}
        sx={{ mb: collapsed ? 0 : 1.5, cursor: 'pointer', userSelect: 'none' }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <i className="ri-shield-check-line" />
          <Typography variant="subtitle1" fontWeight={600}>
            {t('myVdc.cockpit.mapTitle')}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} alignItems="center">
          {!loading && datacenters.length > 0 && (
            <>
              {statusCounts.online > 0 && (
                <Chip
                  size="small"
                  label={`${statusCounts.online} ${t('myVdc.cockpit.mapOnline')}`}
                  sx={{ bgcolor: `${STATUS_COLORS.online}22`, color: STATUS_COLORS.online, height: 22, fontSize: 10, fontWeight: 600 }}
                />
              )}
              {statusCounts.degraded > 0 && (
                <Chip
                  size="small"
                  label={`${statusCounts.degraded} ${t('myVdc.cockpit.mapDegraded')}`}
                  sx={{ bgcolor: `${STATUS_COLORS.degraded}22`, color: STATUS_COLORS.degraded, height: 22, fontSize: 10, fontWeight: 600 }}
                />
              )}
              {statusCounts.offline > 0 && (
                <Chip
                  size="small"
                  label={`${statusCounts.offline} ${t('myVdc.cockpit.mapOffline')}`}
                  sx={{ bgcolor: `${STATUS_COLORS.offline}22`, color: STATUS_COLORS.offline, height: 22, fontSize: 10, fontWeight: 600 }}
                />
              )}
              <Chip
                size="small"
                variant="outlined"
                label={t('myVdc.cockpit.mapVmsRunning', { running: totalRunningVms, total: totalVms })}
                sx={{ height: 22, fontSize: 10 }}
              />
            </>
          )}
          <Tooltip title={collapsed ? t('common.showMore') : t('common.showLess')}>
            <IconButton
              size="small"
              onClick={e => { e.stopPropagation(); toggleCollapsed() }}
              sx={{ p: 0.5 }}
            >
              <i className={collapsed ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'} style={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      <Collapse in={!collapsed}>
        {error ? (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>{error}</Alert>
        ) : null}

        {loading ? (
          <Skeleton variant="rounded" height={320} />
        ) : datacenters.length === 0 ? (
          <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1, opacity: 0.6 }}>
            <i className="ri-map-pin-line" style={{ fontSize: 32 }} />
            <Typography variant="caption" color="text.secondary">{t('myVdc.cockpit.mapEmpty')}</Typography>
          </Box>
        ) : (
          <MyDatacentersMapInner datacenters={datacenters} />
        )}
      </Collapse>
    </Paper>
  )
}
