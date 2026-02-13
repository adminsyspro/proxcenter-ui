'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Chip, LinearProgress, Typography } from '@mui/material'

function CephStatusWidget({ data, loading }) {
  const t = useTranslations()
  const ceph = data?.ceph

  if (!ceph || !ceph.available) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.notAvailable')}</Alert>
      </Box>
    )
  }

  const healthColor = ceph.health === 'HEALTH_OK' ? '#4caf50' : ceph.health === 'HEALTH_WARN' ? '#ff9800' : '#f44336'

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5, p: 1, overflow: 'auto' }}>
      {/* Health */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>HEALTH</Typography>
        <Chip 
          size='small' 
          label={ceph.health?.replace('HEALTH_', '') || 'UNKNOWN'} 
          sx={{ 
            height: 20, fontSize: 10, fontWeight: 700,
            bgcolor: `${healthColor}22`, color: healthColor
          }} 
        />
      </Box>

      {/* Storage */}
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>{t('storage.title').toUpperCase()}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
          <LinearProgress
            variant='determinate'
            value={ceph.usedPct || 0}
            sx={{
              flex: 1, height: 14, borderRadius: 0, bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': {
                borderRadius: 0,
                bgcolor: (ceph.usedPct || 0) > 80 ? '#f44336' : (ceph.usedPct || 0) > 60 ? '#ff9800' : '#4caf50'
              }
            }}
          />
          <Typography variant='caption' sx={{ fontWeight: 700, minWidth: 35 }}>{ceph.usedPct || 0}%</Typography>
        </Box>
      </Box>

      {/* OSDs */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>OSDs</Typography>
          <Typography variant='body2' sx={{ fontWeight: 700 }}>
            {ceph.osdsUp || 0} / {ceph.osdsTotal || 0}
            <Typography component='span' variant='caption' sx={{ opacity: 0.6, ml: 0.5 }}>up</Typography>
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>PGs</Typography>
          <Typography variant='body2' sx={{ fontWeight: 700 }}>
            {ceph.pgsTotal || 0}
          </Typography>
        </Box>
      </Box>

      {/* I/O */}
      {(ceph.readBps > 0 || ceph.writeBps > 0) && (
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          <Box>
            <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>READ</Typography>
            <Typography variant='body2' sx={{ fontWeight: 700, fontSize: 12 }}>
              {formatBps(ceph.readBps)}
            </Typography>
          </Box>
          <Box>
            <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>WRITE</Typography>
            <Typography variant='body2' sx={{ fontWeight: 700, fontSize: 12 }}>
              {formatBps(ceph.writeBps)}
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}

function formatBps(bps) {
  if (!bps || bps === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bps) / Math.log(k))

  
return parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default React.memo(CephStatusWidget)
