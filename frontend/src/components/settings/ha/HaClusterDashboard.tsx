'use client'

import { useCallback, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  keyframes,
} from '@mui/material'
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('ha')
  const { data: cluster, isLoading, error, mutate } = useHaCluster(true)
  const { data: haConfig, mutate: mutateConfig } = useHaConfig()
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncResult, setSyncResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  const handleSyncModeChange = useCallback(async (_: any, value: string | null) => {
    if (!value) return
    const strict = value === 'strict'
    setSyncLoading(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/v1/ha/sync-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strict }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSyncResult({ type: 'success', message: data.message || t('dashboard.syncModeUpdated') })
        mutate()
      } else {
        setSyncResult({ type: 'error', message: data.error || t('dashboard.failedStatus', { status: res.status }) })
      }
    } catch (e: any) {
      setSyncResult({ type: 'error', message: e.message || t('common.requestFailed') })
    } finally {
      setSyncLoading(false)
    }
  }, [mutate, t])

  const maintenanceIPs = useMemo(() => {
    if (!haConfig?.nodes) return new Set<string>()
    return new Set(haConfig.nodes.filter(n => n.maintenance).map(n => n.ip))
  }, [haConfig])

  const nodeNames = useMemo(
    () => cluster?.patroni.members.map(m => m.name) || [],
    [cluster]
  )

  if (isLoading) {
    return <Box sx={{ p: 3, textAlign: 'center' }}><Typography>{t('dashboard.loading')}</Typography></Box>
  }

  if (error || !cluster) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">
          {t('dashboard.loadFailed')} {error?.message || t('dashboard.orchestratorUnavailable')}
        </Alert>
      </Box>
    )
  }

  const availableCount = cluster.patroni.members.filter(m =>
    (m.state === 'running' || m.state === 'streaming') && !maintenanceIPs.has(m.host)
  ).length
  const totalNodes = haConfig?.nodes?.length || cluster.patroni.members.length || 3
  const healthStatus = availableCount >= totalNodes ? 'healthy' : availableCount >= 2 ? 'degraded' : 'critical'

  const leader = cluster.patroni.members.find(m => m.role === 'leader')
  const isSyncMode = cluster.patroni.syncMode !== 'off'
  const currentSyncStrict = cluster.patroni.syncMode === 'synchronous_mode_strict'
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
          {t('dashboard.versionMismatch', { versions: [...versions].join(', ') })}
        </Alert>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5">{t('dashboard.title')}</Typography>
          <Chip
            label={healthStatus === 'healthy' ? t('dashboard.healthHealthy') : healthStatus === 'critical' ? t('dashboard.healthCritical') : t('dashboard.healthDegraded')}
            size="small"
            color={healthStatus === 'healthy' ? 'success' : healthStatus === 'critical' ? 'error' : 'warning'}
          />
          {cluster.patroni.paused && (
            <Chip label={t('dashboard.failoverPaused')} size="small" color="warning" />
          )}
        </Box>
        <Button variant="outlined" size="small" onClick={() => mutate()}>
          {t('dashboard.refresh')}
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
              maintenanceLocked={maintenanceIPs.size > 0 && !maintenanceIPs.has(member.host)}
              leaderName={leader?.name}
              onSwitchover={switchoverCandidates.has(member.name) ? () => mutate() : undefined}
              onRefresh={() => { mutate(); mutateConfig() }}
            />
          </Box>
        ))}
      </Box>

      {/* Sync Mode */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('syncMode')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {currentSyncStrict ? t('syncStrictDesc') : t('syncAvailabilityDesc')}
              </Typography>
            </Box>
            <ToggleButtonGroup
              value={currentSyncStrict ? 'strict' : 'availability'}
              exclusive
              onChange={handleSyncModeChange}
              size="small"
              disabled={syncLoading}
            >
              <ToggleButton value="strict">
                <Tooltip title={t('syncStrictDesc')}>
                  <span>{t('syncStrict')}</span>
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="availability">
                <Tooltip title={t('syncAvailabilityDesc')}>
                  <span>{t('syncAvailability')}</span>
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {syncResult && (
            <Alert severity={syncResult.type} sx={{ mt: 1 }} onClose={() => setSyncResult(null)}>
              {syncResult.message}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Service Grid */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>{t('dashboard.serviceHealth')}</Typography>
          <HaServiceGrid services={cluster.services} nodeNames={nodeNames} />
        </CardContent>
      </Card>
    </Box>
  )
}
