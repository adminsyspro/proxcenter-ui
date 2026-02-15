'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, LinearProgress, CircularProgress, alpha, Stack } from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'
import { useVMFirewallCoverage } from '@/hooks/useZeroTrust'

function ZeroTrustCoverageWidget({ data, loading, config }) {
  const t = useTranslations('firewall')
  const { isEnterprise } = useLicense()
  const { data: vmData = [], isLoading: loadingData } = useVMFirewallCoverage(isEnterprise, 60000)

  if (loadingData) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  // En mode Community, afficher un message
  if (!isEnterprise) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 32, color: 'var(--mui-palette-warning-main)', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ opacity: 0.6 }}>
          Enterprise
        </Typography>
      </Box>
    )
  }

  const total = vmData.length || 1
  const protected_ = vmData.filter(v => v.firewallEnabled).length
  const withRules = vmData.filter(v => v.hasRules).length
  const withSG = vmData.filter(v => v.hasSG).length

  const protectionRate = (protected_ / total) * 100
  const sgRate = (withSG / total) * 100

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5 }}>
      <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, mb: 1.5 }}>
        {t('vmFirewallCoverage')}
      </Typography>

      {/* Stats Row */}
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Box sx={{ flex: 1, textAlign: 'center', p: 1, bgcolor: alpha('#22c55e', 0.1), borderRadius: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 900, color: '#22c55e', lineHeight: 1 }}>{protected_}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9 }}>{t('protectedLabel')}</Typography>
        </Box>
        <Box sx={{ flex: 1, textAlign: 'center', p: 1, bgcolor: alpha('#ef4444', 0.1), borderRadius: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 900, color: '#ef4444', lineHeight: 1 }}>{total - protected_}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9 }}>{t('unprotectedLabel')}</Typography>
        </Box>
        <Box sx={{ flex: 1, textAlign: 'center', p: 1, bgcolor: alpha('#8b5cf6', 0.1), borderRadius: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 900, color: '#8b5cf6', lineHeight: 1 }}>{withSG}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9 }}>{t('withSgLabel')}</Typography>
        </Box>
      </Stack>

      {/* Progress Bars */}
      <Box sx={{ flex: 1 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, mb: 0.5, display: 'block' }}>Protection</Typography>
          <Box sx={{ position: 'relative' }}>
            <LinearProgress
              variant="determinate"
              value={protectionRate}
              sx={{
                height: 14,
                borderRadius: 0,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                '& .MuiLinearProgress-bar': { borderRadius: 0, background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)', backgroundSize: protectionRate > 0 ? `${(100 / protectionRate) * 100}% 100%` : '100% 100%' }
              }}
            />
            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{Math.round(protectionRate)}%</Typography>
          </Box>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10, mb: 0.5, display: 'block' }}>Micro-segmentation</Typography>
          <Box sx={{ position: 'relative' }}>
            <LinearProgress
              variant="determinate"
              value={sgRate}
              sx={{
                height: 14,
                borderRadius: 0,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                '& .MuiLinearProgress-bar': { borderRadius: 0, background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)', backgroundSize: sgRate > 0 ? `${(100 / sgRate) * 100}% 100%` : '100% 100%' }
              }}
            />
            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{Math.round(sgRate)}%</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default React.memo(ZeroTrustCoverageWidget)
