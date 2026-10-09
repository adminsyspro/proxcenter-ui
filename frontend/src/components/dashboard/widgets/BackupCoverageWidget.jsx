'use client'

import React, { useEffect, useState } from 'react'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Typography, useTheme } from '@mui/material'

const GUEST_STATUS_COLORS = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }

/**
 * Guests covered by no PVE backup job (roadmap#48), as a dashboard tile: the
 * count, then the first uncovered guests, one line each. The full list with
 * filters and details lives on the Backups page. Fetches its own data: the
 * coverage is not part of the dashboard payload.
 */
function BackupCoverageWidget() {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/backups/coverage')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(json => {
        if (!cancelled) setData(json?.data && !Array.isArray(json.data) ? json.data : { guests: [] })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [])

  const guests = data?.guests || []
  const count = data?.summary?.uncovered ?? guests.length

  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 'var(--proxcenter-card-radius)', p: 1.5,
        display: 'flex', flexDirection: 'column', minHeight: 0,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)', boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      {!data && !failed ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress size={20} /></Box>
      ) : failed ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography variant='caption' sx={{ opacity: 0.65 }}>{t('backups.coverage.loadError')}</Typography>
        </Box>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography variant='h4' sx={{ fontWeight: 800, color: count > 0 ? '#ff9800' : '#4caf50' }}>{count}</Typography>
            <Typography variant='caption' sx={{ opacity: 0.65 }}>
              {count > 0 ? t('dashboard.widgetBackupCoverage.uncovered') : t('backups.coverage.allCovered')}
            </Typography>
          </Box>

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {guests.map(g => (
              <Box key={`${g.connId}:${g.vmid}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.5, whiteSpace: 'nowrap', minWidth: 0 }}>
                <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className={g.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
                  <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: GUEST_STATUS_COLORS[g.status] || '#616161', border: `1px solid ${dotBorder}` }} />
                </Box>
                <Typography variant='caption' title={g.name} sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, minWidth: 40 }}>{g.name}</Typography>
                <Typography variant='caption' sx={{ opacity: 0.5, flexShrink: 0 }}>({g.vmid})</Typography>
                <Typography variant='caption' sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', ml: 'auto', pl: 1 }}>
                  {t(`backups.coverage.reasons.${g.reason}`)}
                </Typography>
              </Box>
            ))}
          </Box>

          {count > 0 && (
            <Box sx={{ pt: 1, textAlign: 'right' }}>
              <Link href='/operations/backups' style={{ fontSize: '0.75rem', color: theme.palette.primary.main, textDecoration: 'none' }}>
                {t('dashboard.widgetBackupCoverage.viewAll')}
              </Link>
            </Box>
          )}
        </>
      )}
    </Box>
  )
}

export default React.memo(BackupCoverageWidget)
