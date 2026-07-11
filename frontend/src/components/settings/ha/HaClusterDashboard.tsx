'use client'

import { useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Collapse,
  Typography,
} from '@mui/material'

import { useHaCluster } from './useHaCluster'
import { useHaConfig } from './useHaConfig'

import HaNodeCard from './HaNodeCard'
import HaServiceGrid from './HaServiceGrid'
import HaOpsPanel from './HaOpsPanel'

export default function HaClusterDashboard() {
  const { data: cluster, isLoading, error, mutate } = useHaCluster(true)
  const { data: haConfig } = useHaConfig()
  const [historyOpen, setHistoryOpen] = useState(false)

  const maintenanceNodes = useMemo(() => {
    if (!haConfig?.nodes) return new Set<string>()
    return new Set(haConfig.nodes.filter(n => n.maintenance).map(n => n.name))
  }, [haConfig])

  const currentNodeName = haConfig?.nodes.find(n => n.isCurrentNode)?.name || ''

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

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5">HA Cluster</Typography>
        <Button variant="outlined" size="small" onClick={() => mutate()}>
          Refresh
        </Button>
      </Box>

      {/* Cluster-level indicators */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Chip
          label={healthStatus === 'healthy' ? 'Healthy' : healthStatus === 'critical' ? 'Critical' : 'Degraded'}
          size="small"
          color={healthStatus === 'healthy' ? 'success' : healthStatus === 'critical' ? 'error' : 'warning'}
        />
        <Chip
          label={`Sync: ${cluster.patroni.syncMode.replace(/_/g, ' ')}`}
          size="small"
          variant="outlined"
        />
        {cluster.patroni.paused && (
          <Chip label="Failover Paused" size="small" color="warning" />
        )}
        <Chip
          label={`etcd: ${cluster.etcd.healthy ? 'healthy' : 'unhealthy'}`}
          size="small"
          color={cluster.etcd.healthy ? 'success' : 'error'}
          variant="outlined"
        />
        <Chip
          label={`VIP: ${cluster.vip.address} (${cluster.vip.holder})`}
          size="small"
          variant="outlined"
        />
      </Box>

      {/* Zone 1: Node Cards */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        {cluster.patroni.members.map(member => (
          <HaNodeCard
            key={member.name}
            member={member}
            isVipHolder={cluster.vip.holder === member.name}
            maintenance={maintenanceNodes.has(member.name)}
          />
        ))}
      </Box>

      {/* Zone 2: Service Grid */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>Service Health</Typography>
          <HaServiceGrid services={cluster.services} nodeNames={nodeNames} />
        </CardContent>
      </Card>

      {/* Zone 3: Ops Panel */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>Operations</Typography>
          <HaOpsPanel
            members={cluster.patroni.members}
            paused={cluster.patroni.paused}
            syncMode={cluster.patroni.syncMode}
            maintenanceNodes={maintenanceNodes}
            currentNodeName={currentNodeName}
            onRefresh={() => mutate()}
          />
        </CardContent>
      </Card>

      {/* Zone 4: Failover History */}
      <Card variant="outlined">
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Failover History ({cluster.history.length})
            </Typography>
            <Button size="small" onClick={() => setHistoryOpen(!historyOpen)}>
              {historyOpen ? 'Hide' : 'Show'}
            </Button>
          </Box>
          <Collapse in={historyOpen}>
            {cluster.history.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No failover events recorded.
              </Typography>
            ) : (
              <Box sx={{ mt: 1, overflowX: 'auto' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 80px', gap: 1, minWidth: 400 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>Timestamp</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>New Leader</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>Reason</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>Timeline</Typography>
                  {cluster.history.map((event, i) => (
                    <Box key={`${event.timeline}-${event.newLeader}-${i}`} sx={{ display: 'contents' }}>
                      <Typography variant="caption">
                        {new Date(event.timestamp).toLocaleString()}
                      </Typography>
                      <Typography variant="caption">{event.newLeader}</Typography>
                      <Typography variant="caption">{event.reason}</Typography>
                      <Typography variant="caption">{event.timeline}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Collapse>
        </CardContent>
      </Card>
    </Box>
  )
}
