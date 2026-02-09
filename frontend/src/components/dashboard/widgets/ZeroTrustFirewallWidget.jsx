'use client'

import React from 'react'
import { Box, Typography, Chip, CircularProgress, alpha, Stack } from '@mui/material'
import { useClusterFirewallOptions } from '@/hooks/useZeroTrust'

function ZeroTrustFirewallWidget({ data, loading, config }) {
  const { data: firewallData, isLoading: loadingData } = useClusterFirewallOptions(30000)

  if (loadingData) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const isEnabled = firewallData?.enable === 1
  const policyIn = firewallData?.policy_in || 'ACCEPT'
  const policyOut = firewallData?.policy_out || 'ACCEPT'
  const connectionName = firewallData?.connectionName || ''

  return (
    <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', p: 1 }}>
      <Box sx={{
        width: 44, height: 44, borderRadius: 2,
        bgcolor: isEnabled ? alpha('#22c55e', 0.15) : alpha('#ef4444', 0.15),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, mr: 1.5
      }}>
        <i className={isEnabled ? 'ri-shield-check-line' : 'ri-shield-cross-line'}
           style={{ fontSize: 22, color: isEnabled ? '#22c55e' : '#ef4444' }} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Firewall Cluster
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant='body2' sx={{ fontWeight: 700, color: isEnabled ? '#22c55e' : '#ef4444' }}>
            {isEnabled ? '● Actif' : '○ Inactif'}
          </Typography>
          {connectionName && (
            <Chip label={connectionName} size="small" sx={{ height: 16, fontSize: 9 }} />
          )}
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
          <Chip
            label={`IN: ${policyIn}`}
            size="small"
            sx={{
              height: 18, fontSize: 9, fontWeight: 600,
              bgcolor: policyIn === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15),
              color: policyIn === 'DROP' ? '#ef4444' : '#22c55e'
            }}
          />
          <Chip
            label={`OUT: ${policyOut}`}
            size="small"
            sx={{
              height: 18, fontSize: 9, fontWeight: 600,
              bgcolor: policyOut === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15),
              color: policyOut === 'DROP' ? '#ef4444' : '#22c55e'
            }}
          />
        </Stack>
      </Box>
    </Box>
  )
}

export default React.memo(ZeroTrustFirewallWidget)
