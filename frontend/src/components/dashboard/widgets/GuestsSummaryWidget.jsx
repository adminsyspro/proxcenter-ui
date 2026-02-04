'use client'

import { useTranslations } from 'next-intl'
import { Box, Typography } from '@mui/material'

export default function GuestsSummaryWidget({ data, loading }) {
  const t = useTranslations()
  const guests = data?.guests || {}

  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, p: 1 }}>
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>{t('dashboard.widgets.vms').toUpperCase()}</Typography>
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4caf50' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>Running: <strong>{guests?.vms?.running || 0}</strong></Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#9e9e9e' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>Stopped: <strong>{guests?.vms?.stopped || 0}</strong></Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#2196f3' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>Templates: <strong>{guests?.vms?.templates || 0}</strong></Typography>
          </Box>
        </Box>
      </Box>
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>{t('inventory.containers').toUpperCase()}</Typography>
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4caf50' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>Running: <strong>{guests?.lxc?.running || 0}</strong></Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#9e9e9e' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>Stopped: <strong>{guests?.lxc?.stopped || 0}</strong></Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
