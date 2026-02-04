'use client'

import { useState, useEffect } from 'react'

import { Box, Typography, Chip, CircularProgress, alpha, Switch, Stack } from '@mui/material'

export default function ZeroTrustFirewallWidget({ data, loading, config }) {
  const [firewallData, setFirewallData] = useState(null)
  const [connectionName, setConnectionName] = useState('')
  const [loadingData, setLoadingData] = useState(true)

  useEffect(() => {
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

        setConnectionName(pveConn.name)

        // Fetch firewall options
        const fwRes = await fetch(`/api/v1/firewall/cluster/${pveConn.id}?type=options`)

        if (fwRes?.ok) {
          const fwJson = await fwRes.json()

          setFirewallData(fwJson)
        }
      } catch (err) {
        console.error('ZeroTrustFirewallWidget error:', err)
      } finally {
        setLoadingData(false)
      }
    }

    fetchData()
    const interval = setInterval(fetchData, 30000)

    
return () => clearInterval(interval)
  }, [])

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
              height: 18, 
              fontSize: 9, 
              fontWeight: 600,
              bgcolor: policyIn === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15),
              color: policyIn === 'DROP' ? '#ef4444' : '#22c55e'
            }}
          />
          <Chip 
            label={`OUT: ${policyOut}`}
            size="small"
            sx={{ 
              height: 18, 
              fontSize: 9, 
              fontWeight: 600,
              bgcolor: policyOut === 'DROP' ? alpha('#ef4444', 0.15) : alpha('#22c55e', 0.15),
              color: policyOut === 'DROP' ? '#ef4444' : '#22c55e'
            }}
          />
        </Stack>
      </Box>
    </Box>
  )
}
