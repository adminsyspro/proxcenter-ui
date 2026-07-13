'use client'

import { useMemo } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Typography,
  keyframes,
} from '@mui/material'

import { useHaCluster, type PatroniMember } from './useHaCluster'
import { useHaConfig } from './useHaConfig'

import HaNodeCard from './HaNodeCard'
import HaServiceGrid from './HaServiceGrid'

const ROLE_ORDER: Record<string, number> = { leader: 0, sync_standby: 1, replica: 2, standby_leader: 1 }

const flowDots = keyframes`
  0%   { opacity: 0.2; transform: translateX(-6px); }
  50%  { opacity: 1;   transform: translateX(0); }
  100% { opacity: 0.2; transform: translateX(6px); }
`

function SyncArrow({ healthy }: { healthy: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', px: 0.5, minWidth: 36 }}>
      <Box sx={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
        {[0, 1, 2].map(i => (
          <Box
            key={i}
            sx={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              bgcolor: healthy ? 'success.main' : 'error.main',
              animation: healthy ? `${flowDots} 1.2s ease-in-out infinite` : 'none',
              animationDelay: `${i * 0.2}s`,
              opacity: healthy ? undefined : 0.4,
            }}
          />
        ))}
        <i
          className="ri-arrow-right-s-line"
          style={{ fontSize: 16, opacity: healthy ? 0.7 : 0.3 }}
        />
      </Box>
    </Box>
  )
}

function sortMembers(members: PatroniMember[]): PatroniMember[] {
  return [...members].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
}

export default function HaClusterDashboard() {
  const { data: cluster, isLoading, error, mutate } = useHaCluster(true)
  const { data: haConfig, mutate: mutateConfig } = useHaConfig()

  const maintenanceIPs = useMemo(() => {
    if (!haConfig?.nodes) return new Set<string>()
    return new Set(haConfig.nodes.filter(n => n.maintenance).map(n => n.ip))
  }, [haConfig])

  const nodeNames = useMemo(
    () => cluster?.patroni.members.map(m => m.name) || [],
    [cluster]
  )

  if (isLoading) {
    return <Box sx={{ p: 3, textAlign: 'center' }}><Typography>Loading cluster status...</Typography></Box>
  }

  if (error || !cluster) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">
          Failed to load cluster status. {error?.message || 'Orchestrator may be unavailable.'}
        </Alert>
      </Box>
    )
  }

  const allHealthy = cluster.patroni.members.every(m =>
    m.state === 'running' || m.state === 'streaming'
  )
  const degradedCount = cluster.patroni.members.filter(m =>
    m.state !== 'running' && m.state !== 'streaming'
  ).length
  const healthStatus = allHealthy ? 'healthy' : degradedCount >= 2 ? 'critical' : 'degraded'

  const leader = cluster.patroni.members.find(m => m.role === 'leader')
  const isSyncMode = cluster.patroni.syncMode !== 'off'
  const switchoverCandidates = new Set(
    cluster.patroni.members
      .filter(m => {
        if (m.role === 'leader' || maintenanceIPs.has(m.host)) return false
        if (isSyncMode) return m.role === 'sync_standby'
        return true
      })
      .map(m => m.name)
  )

  const sorted = sortMembers(cluster.patroni.members)

  const versions = new Set(cluster.patroni.members.map(m => m.version).filter(Boolean))
  const versionMismatch = versions.size > 1

  return (
    <Box sx={{ p: 2 }}>
      {versionMismatch && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Version mismatch detected: nodes are running different versions ({[...versions].join(', ')}).
          A rolling update may be in progress.
        </Alert>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5">HA Cluster</Typography>
          <Chip
            label={healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'critical' ? 'Critical' : 'Degraded'}
            size="small"
            color={healthStatus === 'healthy' ? 'success' : healthStatus === 'critical' ? 'error' : 'warning'}
          />
          {cluster.patroni.paused && (
            <Chip label="Failover Paused" size="small" color="warning" />
          )}
        </Box>
        <Button variant="outlined" size="small" onClick={() => mutate()}>
          Refresh
        </Button>
      </Box>

      {/* Node Cards with sync arrows */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', mb: 3 }}>
        {sorted.map((member, i) => (
          <Box key={member.name} sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
            {i > 0 && (
              <SyncArrow healthy={member.state === 'running' || member.state === 'streaming'} />
            )}
            <HaNodeCard
              member={member}
              vipAddress={cluster.vip.holder === member.name ? cluster.vip.address : undefined}
              maintenance={maintenanceIPs.has(member.host)}
              leaderName={leader?.name}
              onSwitchover={switchoverCandidates.has(member.name) ? () => mutate() : undefined}
              onRefresh={() => { mutate(); mutateConfig() }}
            />
          </Box>
        ))}
      </Box>

      {/* Service Grid */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>Service Health</Typography>
          <HaServiceGrid services={cluster.services} nodeNames={nodeNames} />
        </CardContent>
      </Card>
    </Box>
  )
}
