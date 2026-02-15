'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme, alpha } from '@mui/material'

function QuickActionsWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()

  const actions = [
    { icon: 'ri-computer-line', label: t('dashboard.createVm'), href: '/infrastructure/inventory?action=createVm', color: theme.palette.primary.main },
    { icon: 'ri-terminal-box-line', label: t('dashboard.createLxc'), href: '/infrastructure/inventory?action=createLxc', color: theme.palette.secondary.main },
    { icon: 'ri-server-line', label: t('dashboard.viewInventory'), href: '/infrastructure/inventory', color: theme.palette.info.main },
    { icon: 'ri-shield-check-line', label: t('dashboard.viewBackups'), href: '/operations/backups', color: theme.palette.success.main },
    { icon: 'ri-alarm-warning-line', label: t('dashboard.viewAlerts'), href: '/operations/alerts', color: theme.palette.warning.main },
    { icon: 'ri-calendar-event-line', label: t('dashboard.viewEvents'), href: '/operations/events', color: theme.palette.error.main },
  ]

  return (
    <Box sx={{
      height: '100%',
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gridTemplateRows: 'repeat(2, 1fr)',
      gap: 1,
      p: 1,
    }}>
      {actions.map((action) => (
        <Box
          key={action.href}
          onClick={() => router.push(action.href)}
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.75,
            borderRadius: 2,
            cursor: 'pointer',
            bgcolor: alpha(action.color, 0.06),
            border: `1px solid ${alpha(action.color, 0.12)}`,
            transition: 'all 0.2s ease',
            '&:hover': {
              bgcolor: alpha(action.color, 0.12),
              transform: 'translateY(-2px)',
              boxShadow: `0 4px 12px ${alpha(action.color, 0.15)}`,
            }
          }}
        >
          <Box sx={{
            width: 36, height: 36, borderRadius: '50%',
            bgcolor: alpha(action.color, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={action.icon} style={{ fontSize: 18, color: action.color }} />
          </Box>
          <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 10, textAlign: 'center', lineHeight: 1.2 }}>
            {action.label}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export default React.memo(QuickActionsWidget)
