'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, Chip, CircularProgress, useTheme, alpha } from '@mui/material'

function HaStatusWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const [haData, setHaData] = useState(null)
  const [loadingHa, setLoadingHa] = useState(true)

  const fetchHa = useCallback(async () => {
    try {
      const connRes = await fetch('/api/v1/connections?type=pve')
      if (!connRes.ok) return
      const connJson = await connRes.json()
      const connections = connJson?.data || []

      const allResources = []
      const allGroups = []

      await Promise.all(connections.map(async (conn) => {
        try {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/ha`)
          if (res.ok) {
            const json = await res.json()
            const d = json?.data || {}
            ;(d.resources || []).forEach(r => allResources.push({ ...r, connectionName: conn.name }))
            ;(d.groups || []).forEach(g => allGroups.push({ ...g, connectionName: conn.name }))
          }
        } catch {
          // skip
        }
      }))

      setHaData({ resources: allResources, groups: allGroups })
    } catch {
      // ignore
    } finally {
      setLoadingHa(false)
    }
  }, [])

  useEffect(() => {
    fetchHa()
    const interval = setInterval(fetchHa, 60000)
    return () => clearInterval(interval)
  }, [fetchHa])

  if (loadingHa) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const resources = haData?.resources || []
  const groups = haData?.groups || []

  if (resources.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Typography variant='caption' sx={{ opacity: 0.6 }}>
          {t('dashboard.noHaResources')}
        </Typography>
      </Box>
    )
  }

  // Count by state
  const stateCounts = {}
  resources.forEach(r => {
    const state = r.state || r.status || 'unknown'
    stateCounts[state] = (stateCounts[state] || 0) + 1
  })

  const stateColors = {
    started: theme.palette.success.main,
    stopped: theme.palette.action.disabled,
    error: theme.palette.error.main,
    fence: theme.palette.error.main,
    freeze: theme.palette.info.main,
    migrate: theme.palette.warning.main,
    relocate: theme.palette.warning.main,
    disabled: theme.palette.action.disabled,
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5, p: 1.5, overflow: 'auto' }}>
      {/* Header stats */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant='caption' sx={{ fontWeight: 700, fontSize: 12 }}>
          {t('dashboard.haResources', { count: resources.length })}
        </Typography>
        <Typography variant='caption' sx={{ opacity: 0.5 }}>
          {t('dashboard.haGroups', { count: groups.length })}
        </Typography>
      </Box>

      {/* State breakdown */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {Object.entries(stateCounts).map(([state, count]) => {
          const color = stateColors[state] || theme.palette.text.secondary
          return (
            <Chip
              key={state}
              size='small'
              label={`${t(`dashboard.${state}`, { defaultMessage: state })} ${count}`}
              sx={{
                height: 22, fontSize: 10, fontWeight: 700,
                bgcolor: alpha(color, 0.12),
                color: color,
              }}
            />
          )
        })}
      </Box>

      {/* Groups list */}
      {groups.length > 0 && (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <Typography variant='caption' sx={{ opacity: 0.5, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
            {t('dashboard.haGroups', { count: groups.length })}
          </Typography>
          {groups.map((group, idx) => (
            <Box
              key={`${group.group}-${idx}`}
              sx={{
                py: 0.5,
                borderBottom: idx < groups.length - 1 ? '1px solid' : 'none',
                borderColor: 'divider',
              }}
            >
              <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11 }}>
                {group.group}
              </Typography>
              {group.nodes && (
                <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 10, display: 'block' }}>
                  {group.nodes}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

export default React.memo(HaStatusWidget)
