'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Box, Chip, LinearProgress, Typography } from '@mui/material'

function PbsOverviewWidget({ data, loading }) {
  const t = useTranslations()
  const pbs = data?.pbs || {}

  if (!pbs.servers || pbs.servers === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5, p: 1, overflow: 'auto' }}>
      {/* Stats globales */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>{t('storage.title').toUpperCase()} PBS</Typography>
          <Box sx={{ mt: 0.5 }}>
            <Box sx={{ position: 'relative', mb: 0.5 }}>
              <LinearProgress
                variant='determinate'
                value={pbs.usagePct || 0}
                sx={{
                  height: 14, borderRadius: 0, bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                  '& .MuiLinearProgress-bar': { borderRadius: 0, background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)', backgroundSize: (pbs.usagePct || 0) > 0 ? `${(100 / (pbs.usagePct || 1)) * 100}% 100%` : '100% 100%' }
                }}
              />
              <Typography variant='caption' sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{pbs.usagePct || 0}%</Typography>
            </Box>
            <Typography variant='caption' sx={{ opacity: 0.6, fontSize: 9 }}>
              {pbs.totalUsedFormatted} / {pbs.totalSizeFormatted}
            </Typography>
          </Box>
        </Box>
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, fontSize: 10 }}>{t('dashboard.widgets.activity').toUpperCase()} 24H</Typography>
          <Box sx={{ mt: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
              <i className='ri-checkbox-circle-fill' style={{ color: '#4caf50', fontSize: 12 }} />
              <Typography variant='caption' sx={{ fontSize: 11 }}>Backups OK: <strong>{pbs.backups24h?.ok || 0}</strong></Typography>
            </Box>
            {pbs.backups24h?.error > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                <i className='ri-close-circle-fill' style={{ color: '#f44336', fontSize: 12 }} />
                <Typography variant='caption' sx={{ fontSize: 11, color: '#f44336' }}>{t('jobs.failed')}: <strong>{pbs.backups24h.error}</strong></Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <i className='ri-verified-badge-fill' style={{ color: '#2196f3', fontSize: 12 }} />
              <Typography variant='caption' sx={{ fontSize: 11 }}>Verify: <strong>{pbs.verify24h?.ok || 0}</strong></Typography>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Serveurs PBS */}
      {pbs.serverDetails?.length > 0 && (
        <Box>
          <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, mb: 0.5, display: 'block', fontSize: 10 }}>{t('storage.server').toUpperCase()}</Typography>
          {pbs.serverDetails.map((server, idx) => (
            <Box key={idx} sx={{ 
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
              py: 0.5, borderBottom: '1px solid', borderColor: 'divider' 
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-hard-drive-2-line' style={{ opacity: 0.6, fontSize: 12 }} />
                <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11 }}>{server.name}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant='caption' sx={{ opacity: 0.6, fontSize: 10 }}>{server.datastores} DS</Typography>
                <Chip 
                  size='small' 
                  label={`${server.usagePct}%`} 
                  sx={{ 
                    height: 16, fontSize: 9, fontWeight: 700,
                    bgcolor: server.usagePct > 80 ? '#f4433622' : server.usagePct > 60 ? '#ff980022' : '#4caf5022',
                    color: server.usagePct > 80 ? '#f44336' : server.usagePct > 60 ? '#ff9800' : '#4caf50',
                  }} 
                />
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Erreurs récentes */}
      {pbs.recentErrors?.length > 0 && (
        <Alert severity='warning' sx={{ py: 0.25, '& .MuiAlert-message': { py: 0 } }}>
          <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 10 }}>
            {pbs.recentErrors.length} {t('common.error').toLowerCase()}(s)
          </Typography>
        </Alert>
      )}
    </Box>
  )
}

export default React.memo(PbsOverviewWidget)
