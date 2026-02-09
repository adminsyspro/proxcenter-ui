'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Card, CardContent, Typography } from '@mui/material'

function KpiClustersWidget({ data, loading }) {
  const t = useTranslations()
  const summary = data?.summary || {}
  const hasOffline = summary.nodesOffline > 0

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', p: 1 }}>
      <Box sx={{ 
        width: 44, height: 44, borderRadius: 2, 
        bgcolor: hasOffline ? '#f4433618' : '#4caf5018',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, mr: 1.5
      }}>
        <i className='ri-server-line' style={{ fontSize: 22, color: hasOffline ? '#f44336' : '#4caf50' }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('inventory.clusters')} / {t('dashboard.widgets.nodes')}
        </Typography>
        <Typography variant='h6' sx={{ fontWeight: 800, color: hasOffline ? '#f44336' : '#4caf50', lineHeight: 1.2 }}>
          {summary.clusters || 0} / {summary.nodes || 0}
        </Typography>
        <Typography variant='caption' sx={{ opacity: 0.5 }}>
          {hasOffline ? `${summary.nodesOffline} ${t('common.offline').toLowerCase()}` : t('common.online')}
        </Typography>
      </Box>
    </Box>
  )
}

export default React.memo(KpiClustersWidget)
