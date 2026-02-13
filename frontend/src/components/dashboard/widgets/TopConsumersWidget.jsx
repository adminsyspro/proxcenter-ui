'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, LinearProgress, Typography, useTheme } from '@mui/material'

function TopConsumersWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main
  const topCpu = data?.topCpu || []
  const topRam = data?.topRam || []

  if (topCpu.length === 0 && topRam.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, p: 1, overflow: 'auto' }}>
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, mb: 1, display: 'block' }}>
          TOP {t('monitoring.cpu').toUpperCase()}
        </Typography>
        {topCpu.slice(0, 10).map((vm, idx) => (
          <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography variant='caption' sx={{ 
              width: 100, fontWeight: 500, overflow: 'hidden', 
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 
            }}>
              {vm.name}
            </Typography>
            <Box sx={{ flex: 1 }}>
              <LinearProgress
                variant='determinate'
                value={Math.min(vm.value, 100)}
                sx={{
                  height: 14, borderRadius: 0, bgcolor: 'rgba(255,255,255,0.08)',
                  '& .MuiLinearProgress-bar': { borderRadius: 0, bgcolor: primaryColor }
                }}
              />
            </Box>
            <Typography variant='caption' sx={{ width: 32, textAlign: 'right', fontSize: 10 }}>
              {vm.value}%
            </Typography>
          </Box>
        ))}
      </Box>
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, mb: 1, display: 'block' }}>
          TOP {t('monitoring.memory').toUpperCase()}
        </Typography>
        {topRam.slice(0, 10).map((vm, idx) => (
          <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Typography variant='caption' sx={{
              width: 100, fontWeight: 500, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11
            }}>
              {vm.name}
            </Typography>
            <Box sx={{ flex: 1 }}>
              <LinearProgress
                variant='determinate'
                value={Math.min(vm.value, 100)}
                sx={{
                  height: 14, borderRadius: 0, bgcolor: 'rgba(255,255,255,0.08)',
                  '& .MuiLinearProgress-bar': { borderRadius: 0, bgcolor: primaryColor }
                }}
              />
            </Box>
            <Typography variant='caption' sx={{ width: 32, textAlign: 'right', fontSize: 10 }}>
              {vm.value}%
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default React.memo(TopConsumersWidget)
