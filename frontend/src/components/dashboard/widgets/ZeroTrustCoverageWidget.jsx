'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { Box, Typography, LinearProgress, CircularProgress, alpha, Stack } from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'

export default function ZeroTrustCoverageWidget({ data, loading, config }) {
  const t = useTranslations('firewall')
  const { isEnterprise } = useLicense()
  const [vmData, setVmData] = useState([])
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
    // En mode Community, pas d'orchestrator pour le firewall
    if (!isEnterprise) {
      setLoadingData(false)
      return
    }

    const fetchData = async () => {
      try {
        // Get first PVE connection
        const connRes = await fetch('/api/v1/connections')
        const connJson = await connRes.json()
        const pveConn = connJson.data?.find(c => c.type === 'pve')

        if (!pveConn) {
          setLoadingData(false)

          return
        }

        // Fetch VMs
        const vmsRes = await fetch(`/api/v1/vms?connId=${pveConn.id}`)

        if (vmsRes?.ok) {
          const vmsJson = await vmsRes.json()
          const guests = vmsJson?.data?.vms || []

          // Check firewall and rules for each VM (simplified - first 30)
          const vmChecks = await Promise.all(
            guests.slice(0, 30).map(async (vm) => {
              try {
                const [configRes, rulesRes] = await Promise.all([
                  fetch(`/api/v1/connections/${pveConn.id}/guests/${vm.type}/${vm.node}/${vm.vmid}/config`),
                  fetch(`/api/v1/firewall/vms/${pveConn.id}/${vm.node}/${vm.type}/${vm.vmid}?type=rules`).catch(() => null)
                ])
                
                let firewallEnabled = false

                if (configRes.ok) {
                  const configJson = await configRes.json()
                  const config = configJson?.data || {}

                  for (let i = 0; i < 10; i++) {
                    const netConfig = config[`net${i}`]

                    if (netConfig && typeof netConfig === 'string' && netConfig.includes('firewall=1')) {
                      firewallEnabled = true
                      break
                    }
                  }
                }

                let rules = []
                let hasSG = false

                if (rulesRes?.ok) {
                  rules = await rulesRes.json()

                  if (Array.isArray(rules)) {
                    hasSG = rules.some(r => r.type === 'group')
                  }
                }

                return { 
                  ...vm, 
                  firewallEnabled, 
                  hasRules: Array.isArray(rules) && rules.length > 0,
                  hasSG 
                }
              } catch {
                return { ...vm, firewallEnabled: false, hasRules: false, hasSG: false }
              }
            })
          )

          setVmData(vmChecks)
        }
      } catch (err) {
        console.error('ZeroTrustCoverageWidget error:', err)
      } finally {
        setLoadingData(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 60000)

    return () => clearInterval(interval)
  }, [isEnterprise])

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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>Protection</Typography>
            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 10 }}>{Math.round(protectionRate)}%</Typography>
          </Box>
          <LinearProgress 
            variant="determinate" 
            value={protectionRate} 
            sx={{ 
              height: 6, 
              borderRadius: 3,
              bgcolor: alpha('#ef4444', 0.15),
              '& .MuiLinearProgress-bar': { bgcolor: '#22c55e', borderRadius: 3 }
            }} 
          />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>Micro-segmentation</Typography>
            <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 10 }}>{Math.round(sgRate)}%</Typography>
          </Box>
          <LinearProgress 
            variant="determinate" 
            value={sgRate} 
            sx={{ 
              height: 6, 
              borderRadius: 3,
              bgcolor: alpha('#888', 0.15),
              '& .MuiLinearProgress-bar': { bgcolor: '#8b5cf6', borderRadius: 3 }
            }} 
          />
        </Box>
      </Box>
    </Box>
  )
}
