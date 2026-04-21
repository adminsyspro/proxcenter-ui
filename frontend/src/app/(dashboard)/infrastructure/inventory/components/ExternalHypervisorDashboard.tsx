'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { PieChart, Pie, Cell, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import type { DetailsPayload, InventorySelection } from '../types'

type ExtTypeInfo = NonNullable<DetailsPayload['extTypeInfo']>

interface ExternalHypervisorDashboardProps {
  extTypeInfo: ExtTypeInfo
  onSelect?: (sel: InventorySelection) => void
}

export default function ExternalHypervisorDashboard({ extTypeInfo: info, onSelect }: ExternalHypervisorDashboardProps) {
  const t = useTranslations()
  const theme = useTheme()

  const allVms = info.hosts.flatMap((h: any) => h.vms)
  const runningVms = allVms.filter((v: any) => v.status === 'running')
  const stoppedVms = allVms.filter((v: any) => v.status !== 'running')
  const totalCpu = allVms.reduce((s: number, v: any) => s + (v.cpu || 0), 0)
  const totalRamGB = allVms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024
  const totalDiskGB = allVms.reduce((s: number, v: any) => s + (v.committed || 0), 0) / 1073741824

  // Migration stats
  const migrations = info.migrations || []
  const migCompleted = migrations.filter((j: any) => j.status === 'completed').length
  const migFailed = migrations.filter((j: any) => j.status === 'failed').length
  const migRunning = migrations.filter((j: any) => !['completed', 'failed', 'cancelled'].includes(j.status)).length
  const totalMigratedGB = migrations.filter((j: any) => j.status === 'completed' && j.totalBytes).reduce((s: number, j: any) => s + Number(j.totalBytes), 0) / 1073741824

  // Donut chart data — VM status
  const vmStatusData = [
    { name: t('inventoryPage.extDashboard.running'), value: runningVms.length, color: theme.palette.success.main },
    { name: t('inventoryPage.extDashboard.stopped'), value: stoppedVms.length, color: theme.palette.grey[400] },
  ].filter(d => d.value > 0)

  // Donut chart data — Migration status
  const migStatusData = [
    { name: t('inventoryPage.extDashboard.completed'), value: migCompleted, color: theme.palette.success.main },
    { name: t('inventoryPage.extDashboard.failed'), value: migFailed, color: theme.palette.error.main },
    { name: t('inventoryPage.extDashboard.inProgress'), value: migRunning, color: theme.palette.primary.main },
  ].filter(d => d.value > 0)

  // Bar chart data — resources per host
  const hostBarData = info.hosts.map((h: any) => ({
    name: h.connectionName.length > 12 ? h.connectionName.substring(0, 12) + '…' : h.connectionName,
    vms: h.vms.length,
    cpu: h.vms.reduce((s: number, v: any) => s + (v.cpu || 0), 0),
    ram: Math.round(h.vms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024),
  }))

  const statCards = [
    { icon: 'ri-server-line', label: t('inventoryPage.extDashboard.hosts'), value: info.hosts.length, color: theme.palette.warning.main },
    { icon: 'ri-computer-line', label: t('inventoryPage.extDashboard.totalVms'), value: allVms.length, color: theme.palette.primary.main },
    { icon: 'ri-swap-line', label: t('inventoryPage.extDashboard.migrated'), value: migCompleted, color: theme.palette.info.main },
    { icon: 'ri-hard-drive-3-line', label: t('inventoryPage.extDashboard.dataTransferred'), value: `${totalMigratedGB.toFixed(1)} GB`, color: theme.palette.secondary.main },
  ]

  return (
    <>
    {/* Stats cards */}
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5 }}>
      {statCards.map((s) => (
        <Card key={s.label} variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 1.5, bgcolor: alpha(s.color, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className={s.icon} style={{ fontSize: 18, color: s.color }} />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700} fontSize={18} lineHeight={1}>{s.value}</Typography>
              <Typography variant="caption" sx={{ opacity: 0.6, fontSize: 10 }}>{s.label}</Typography>
            </Box>
          </CardContent>
        </Card>
      ))}
    </Box>

    {/* Donut charts row — VM Status + Migration Status */}
    <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
      {/* VM Status donut */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-computer-line" style={{ fontSize: 16, opacity: 0.5 }} />
            {t('inventoryPage.extDashboard.vmStatus')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ width: 100, height: 100, flexShrink: 0 }}>
              <ChartContainer>
                <PieChart>
                  <Pie data={vmStatusData} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} strokeWidth={0}>
                    {vmStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </Box>
            <Stack spacing={0.75} sx={{ flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main' }} />
                <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.running')}</Typography>
                <Typography variant="body2" fontSize={12} fontWeight={700}>{runningVms.length}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'grey.400' }} />
                <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.stopped')}</Typography>
                <Typography variant="body2" fontSize={12} fontWeight={700}>{stoppedVms.length}</Typography>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" fontSize={12} fontWeight={700} sx={{ flex: 1 }}>Total</Typography>
                <Typography variant="body2" fontSize={12} fontWeight={700}>{allVms.length}</Typography>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

      {/* Migration Status donut */}
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-swap-line" style={{ fontSize: 16, opacity: 0.5 }} />
            {t('inventoryPage.extDashboard.migrationStats')}
          </Typography>
          {migrations.length === 0 ? (
            <Box sx={{ height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="body2" fontSize={12} sx={{ opacity: 0.4 }}>{t('inventoryPage.extDashboard.noMigrations')}</Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{ width: 100, height: 100, flexShrink: 0 }}>
                <ChartContainer>
                  <PieChart>
                    <Pie data={migStatusData} dataKey="value" cx="50%" cy="50%" innerRadius={28} outerRadius={45} paddingAngle={2} strokeWidth={0}>
                      {migStatusData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </Box>
              <Stack spacing={0.75} sx={{ flex: 1 }}>
                {migCompleted > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main' }} />
                    <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.completed')}</Typography>
                    <Typography variant="body2" fontSize={12} fontWeight={700}>{migCompleted}</Typography>
                  </Box>
                )}
                {migFailed > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' }} />
                    <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.failed')}</Typography>
                    <Typography variant="body2" fontSize={12} fontWeight={700}>{migFailed}</Typography>
                  </Box>
                )}
                {migRunning > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'primary.main' }} />
                    <Typography variant="body2" fontSize={12} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.inProgress')}</Typography>
                    <Typography variant="body2" fontSize={12} fontWeight={700}>{migRunning}</Typography>
                  </Box>
                )}
                <Divider sx={{ my: 0.5 }} />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontSize={12} fontWeight={700} sx={{ flex: 1 }}>{t('inventoryPage.extDashboard.dataTransferred')}</Typography>
                  <Typography variant="body2" fontSize={12} fontWeight={700}>{totalMigratedGB.toFixed(1)} GB</Typography>
                </Box>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>

    {/* Resources per host — bar chart */}
    {info.hosts.length > 1 && (
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-bar-chart-2-line" style={{ fontSize: 16, opacity: 0.5 }} />
            {t('inventoryPage.extDashboard.resourcesPerHost')}
          </Typography>
          <Box sx={{ height: 180 }}>
            <ChartContainer>
              <BarChart data={hostBarData} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.5)} />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${theme.palette.divider}`, background: theme.palette.background.paper }} />
                <Bar dataKey="vms" name="VMs" fill={theme.palette.primary.main} radius={[3, 3, 0, 0]} />
                <Bar dataKey="cpu" name="vCPU" fill={theme.palette.warning.main} radius={[3, 3, 0, 0]} />
                <Bar dataKey="ram" name="RAM (GB)" fill={theme.palette.info.main} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </Box>
        </CardContent>
      </Card>
    )}

    {/* Global resources summary */}
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-cpu-line" style={{ fontSize: 16, opacity: 0.5 }} />
          {t('inventoryPage.extDashboard.resources')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700}>{totalCpu}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>vCPU</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700}>{totalRamGB.toFixed(1)}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>GB RAM</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={700}>{totalDiskGB.toFixed(1)}</Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>GB {t('inventoryPage.extDashboard.diskUsage')}</Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>

    {/* Hosts list with VM counts */}
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.5 }} />
          {t('inventoryPage.extDashboard.hosts')}
        </Typography>
        <Stack spacing={0}>
          {info.hosts.map((host: any) => {
            const hostRunning = host.vms.filter((v: any) => v.status === 'running').length
            const hostCpu = host.vms.reduce((s: number, v: any) => s + (v.cpu || 0), 0)
            const hostRamGB = host.vms.reduce((s: number, v: any) => s + (v.memory_size_MiB || 0), 0) / 1024
            return (
              <Box
                key={host.connectionId}
                onClick={() => onSelect?.({ type: 'ext', id: host.connectionId })}
                sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' }, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderRadius: 1, px: 0.5 }}
              >
                {info.hypervisorType === 'hyperv'
                  ? <img src="/images/hyperv-logo.svg" alt="" width={16} height={16} style={{ opacity: 0.7 }} />
                  : <img src={info.hypervisorType === 'xcpng' ? '/images/xcpng-logo.svg' : info.hypervisorType === 'hyperv' ? '/images/hyperv-logo.svg' : info.hypervisorType === 'nutanix' ? '/images/nutanix-logo.svg' : '/images/esxi-logo.svg'} alt="" width={16} height={16} style={{ opacity: 0.7 }} />
                }
                <Typography variant="body2" fontSize={12} fontWeight={600} sx={{ flex: 1 }} noWrap>{host.connectionName}</Typography>
                <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap' }}>
                  {host.vms.length} VMs · {hostRunning} up · {hostCpu} vCPU · {hostRamGB.toFixed(1)} GB
                </Typography>
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>

    {/* Recent migrations */}
    {migrations.length > 0 && (
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="body2" fontWeight={700} fontSize={12} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-history-line" style={{ fontSize: 16, opacity: 0.5 }} />
            {t('inventoryPage.extDashboard.recentMigrations')}
          </Typography>
          <Stack spacing={0}>
            {migrations.slice(0, 10).map((mig: any) => (
              <Box key={mig.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: mig.status === 'completed' ? 'success.main' : mig.status === 'failed' ? 'error.main' : 'primary.main' }} />
                <Typography variant="body2" fontSize={12} fontWeight={600} noWrap sx={{ minWidth: 0, flex: 1 }}>{mig.sourceVmName || mig.sourceVmId}</Typography>
                <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{'\u2192'} {mig.targetNode}</Typography>
                <Typography variant="caption" fontSize={10} sx={{ opacity: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{mig.totalBytes ? `${(Number(mig.totalBytes) / 1073741824).toFixed(1)} GB` : '--'}</Typography>
                {mig.completedAt && <Typography variant="caption" fontSize={10} sx={{ opacity: 0.4, whiteSpace: 'nowrap', flexShrink: 0 }}>{new Date(mig.completedAt).toLocaleDateString()}</Typography>}
                <Chip size="small" label={mig.status === 'completed' ? t('inventoryPage.esxiMigration.completed') : mig.status === 'failed' ? t('inventoryPage.esxiMigration.failed') : `${mig.progress || 0}%`} sx={{ height: 20, fontSize: 10, fontWeight: 700, flexShrink: 0, bgcolor: mig.status === 'completed' ? 'success.main' : mig.status === 'failed' ? 'error.main' : 'primary.main', color: '#fff' }} />
              </Box>
            ))}
          </Stack>
        </CardContent>
      </Card>
    )}
    </>
  )
}
