'use client'

import { useTranslations } from 'next-intl'
import { Box, Chip, Typography } from '@mui/material'

export default function ClustersListWidget({ data, loading }) {
  const t = useTranslations()
  const clusters = (data?.clusters || []).filter(c => c.isCluster)

  if (clusters.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1, p: 1, overflow: 'auto' }}>
      {clusters.map((cluster, idx) => (
        <Box 
          key={idx}
          sx={{ 
            p: 1.5, borderRadius: 1.5, bgcolor: 'action.hover',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant='body2' sx={{ fontWeight: 700, fontSize: 13 }}>{cluster.name}</Typography>
            <Typography variant='caption' sx={{ opacity: 0.6, fontSize: 10 }}>
              {cluster.nodes} {t('inventory.nodes').toLowerCase()} • {cluster.onlineNodes} {t('common.online').toLowerCase()}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
            {cluster.quorum && (
              <Chip 
                size='small' 
                label='Quorum' 
                color={cluster.quorum.quorate ? 'success' : 'error'} 
                sx={{ fontSize: 9, height: 18 }} 
              />
            )}
            {cluster.cephHealth && (
              <Chip 
                size='small' 
                label={cluster.cephHealth.replace('HEALTH_', '')} 
                color={cluster.cephHealth === 'HEALTH_OK' ? 'success' : cluster.cephHealth === 'HEALTH_WARN' ? 'warning' : 'error'} 
                sx={{ fontSize: 9, height: 18 }} 
              />
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
