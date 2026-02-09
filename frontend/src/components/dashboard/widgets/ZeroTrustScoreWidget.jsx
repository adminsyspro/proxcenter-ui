'use client'

import React from 'react'
import { Box, Typography, Chip, CircularProgress, alpha, Stack, Tooltip } from '@mui/material'
import { useFirewallScores } from '@/hooks/useZeroTrust'

function ZeroTrustScoreWidget({ data, loading, config }) {
  const { data: clusters = [], isLoading: loadingData } = useFirewallScores(60000)

  if (loadingData) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (clusters.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Aucun cluster PVE</Typography>
      </Box>
    )
  }

  // Global average score
  const avgScore = Math.round(clusters.reduce((acc, c) => acc + c.score, 0) / clusters.length)
  const avgColor = avgScore >= 80 ? '#22c55e' : avgScore >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5, overflow: 'hidden' }}>
      {/* Header with global score */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Zero Trust
        </Typography>
        <Chip
          label={`Score: ${avgScore}`}
          size="small"
          sx={{
            height: 20,
            fontSize: 10,
            fontWeight: 700,
            bgcolor: alpha(avgColor, 0.15),
            color: avgColor
          }}
        />
      </Box>

      {/* Clusters list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        <Stack spacing={0.75}>
          {clusters.map((cluster) => {
            const color = cluster.score >= 80 ? '#22c55e' : cluster.score >= 50 ? '#f59e0b' : '#ef4444'

            return (
              <Box
                key={cluster.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: alpha(color, 0.05),
                  border: `1px solid ${alpha(color, 0.2)}`
                }}
              >
                <Tooltip title={cluster.enabled ? 'Firewall actif' : 'Firewall inactif'}>
                  <Box sx={{
                    width: 28,
                    height: 28,
                    borderRadius: 1,
                    bgcolor: alpha(color, 0.15),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <i className={cluster.enabled ? 'ri-shield-check-line' : 'ri-shield-cross-line'}
                       style={{ fontSize: 14, color }} />
                  </Box>
                </Tooltip>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', lineHeight: 1.2 }}>
                    {cluster.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 9 }}>
                    IN: {cluster.policyIn} • OUT: {cluster.policyOut}
                  </Typography>
                </Box>
                <Box sx={{
                  minWidth: 32,
                  textAlign: 'center',
                  px: 0.5,
                  py: 0.25,
                  borderRadius: 0.5,
                  bgcolor: alpha(color, 0.15)
                }}>
                  <Typography variant="caption" sx={{ fontWeight: 900, color, fontSize: 11 }}>
                    {cluster.score}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Stack>
      </Box>
    </Box>
  )
}

export default React.memo(ZeroTrustScoreWidget)
