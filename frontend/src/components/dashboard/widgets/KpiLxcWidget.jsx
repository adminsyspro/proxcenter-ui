'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

function KpiLxcWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const secondaryColor = theme.palette.secondary.main
  const summary = data?.summary || {}

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', p: 1 }}>
      <Box sx={{
        width: 44, height: 44, borderRadius: 2,
        bgcolor: `${secondaryColor}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, mr: 1.5
      }}>
        <i className='ri-instance-line' style={{ fontSize: 22, color: secondaryColor }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          LXC ({t('common.active').toLowerCase()} / {t('common.total').toLowerCase()})
        </Typography>
        <Typography variant='h6' sx={{ fontWeight: 800, color: secondaryColor, lineHeight: 1.2 }}>
          {summary.lxcRunning || 0} / {summary.lxcTotal || 0}
        </Typography>
      </Box>
    </Box>
  )
}

export default React.memo(KpiLxcWidget)
