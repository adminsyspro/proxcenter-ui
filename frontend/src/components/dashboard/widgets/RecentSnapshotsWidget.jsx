'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, CircularProgress, Chip, useTheme, alpha } from '@mui/material'

function timeAgo(ts) {
  if (!ts) return ''
  const now = Date.now() / 1000
  const diff = Math.floor(now - ts)

  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function RecentSnapshotsWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const [snapshots, setSnapshots] = useState([])
  const [loadingSnaps, setLoadingSnaps] = useState(true)
  const [error, setError] = useState(false)

  const fetchSnapshots = useCallback(async () => {
    try {
      const connRes = await fetch('/api/v1/connections?type=pve')
      if (!connRes.ok) { setError(true); return }
      const connJson = await connRes.json()
      const connections = connJson?.data || []

      const allSnaps = []

      await Promise.all(connections.map(async (conn) => {
        try {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/snapshots`)
          if (res.ok) {
            const json = await res.json()
            const snaps = json?.data?.snapshots || []
            snaps.forEach(s => {
              allSnaps.push({ ...s, connectionName: conn.name })
            })
          }
        } catch {
          // skip this connection
        }
      }))

      allSnaps.sort((a, b) => b.snaptime - a.snaptime)
      setSnapshots(allSnaps.slice(0, 10))
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoadingSnaps(false)
    }
  }, [])

  useEffect(() => {
    fetchSnapshots()
    const interval = setInterval(fetchSnapshots, 60000)
    return () => clearInterval(interval)
  }, [fetchSnapshots])

  if (loadingSnaps) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (error || snapshots.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Typography variant='caption' sx={{ opacity: 0.6 }}>
          {t('dashboard.noSnapshots')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 0.5 }}>
      {snapshots.map((snap, idx) => (
        <Box
          key={`${snap.vmid}-${snap.name}-${idx}`}
          sx={{
            py: 0.75, px: 0.5,
            borderBottom: idx < snapshots.length - 1 ? '1px solid' : 'none',
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          {/* VM/LXC icon */}
          <Box sx={{
            width: 24, height: 24, borderRadius: 1,
            bgcolor: alpha(snap.vmType === 'qemu' ? theme.palette.primary.main : theme.palette.secondary.main, 0.1),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <i
              className={snap.vmType === 'qemu' ? 'ri-computer-line' : 'ri-terminal-box-line'}
              style={{ fontSize: 14, color: snap.vmType === 'qemu' ? theme.palette.primary.main : theme.palette.secondary.main }}
            />
          </Box>

          {/* VM info + snapshot name */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11, display: 'block' }} noWrap>
              {snap.vmid} {snap.vmName}
            </Typography>
            <Typography variant='caption' sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, opacity: 0.6, display: 'block' }} noWrap>
              {snap.name}
            </Typography>
          </Box>

          {/* Time ago */}
          <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 10, flexShrink: 0 }}>
            {timeAgo(snap.snaptime)}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export default React.memo(RecentSnapshotsWidget)
