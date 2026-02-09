'use client'

import React from 'react'
import { Box, Typography, Chip, CircularProgress, alpha, Stack } from '@mui/material'
import { useClusterSecurityGroups } from '@/hooks/useZeroTrust'

const GROUP_COLORS = [
  '#22c55e', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4',
  '#ec4899', '#10b981', '#6366f1', '#f97316'
]

function ZeroTrustSecurityGroupsWidget({ data, loading, config }) {
  const { data: clustersData = [], isLoading: loadingData } = useClusterSecurityGroups(60000)

  if (loadingData) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const totalGroups = clustersData.reduce((acc, c) => acc + c.groups.length, 0)

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', p: 1.5, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant='caption' sx={{ opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Security Groups
        </Typography>
        <Chip
          label={`${totalGroups} groupes`}
          size="small"
          sx={{ height: 18, fontSize: 9 }}
        />
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {clustersData.length > 0 ? (
          <Stack spacing={1.5}>
            {clustersData.map((cluster) => (
              <Box key={cluster.id}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: 10, mb: 0.5, display: 'block' }}>
                  {cluster.name}
                </Typography>
                {cluster.groups.length > 0 ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {cluster.groups.map((sg, index) => {
                      const color = GROUP_COLORS[index % GROUP_COLORS.length]
                      const isBase = sg.group?.startsWith('sg-base-')

                      return (
                        <Chip
                          key={sg.group}
                          size="small"
                          icon={isBase ? <i className="ri-lock-line" style={{ fontSize: 9, marginLeft: 4 }} /> : undefined}
                          label={sg.group?.length > 12 ? sg.group.slice(0, 12) + '...' : sg.group}
                          sx={{
                            height: 20,
                            fontSize: 9,
                            borderLeft: `2px solid ${color}`,
                            bgcolor: isBase ? alpha('#8b5cf6', 0.05) : 'transparent',
                          }}
                        />
                      )
                    })}
                    {cluster.groups.length === 10 && (
                      <Chip label="..." size="small" sx={{ height: 20, fontSize: 9 }} />
                    )}
                  </Box>
                ) : (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 9 }}>
                    Aucun groupe
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Aucun cluster PVE
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default React.memo(ZeroTrustSecurityGroupsWidget)
