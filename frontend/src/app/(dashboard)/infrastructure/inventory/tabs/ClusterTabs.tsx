'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  Menu,
  MenuItem,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  Tooltip as MuiTooltip,
  useTheme,
} from '@mui/material'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import { formatBytes } from '@/utils/format'
import NodesTable, { NodeRow, BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import ClusterFirewallTab from '@/components/ClusterFirewallTab'
import BackupJobsPanel from '../BackupJobsPanel'
import CveTab from '@/components/CveTab'
import SnapshotsTab from '@/components/SnapshotsTab'
import RollingUpdateWizard from '@/components/RollingUpdateWizard'

import type { InventorySelection, DetailsPayload, RrdTimeframe, SeriesPoint, Status } from '../types'
import { formatBps, formatTime, formatUptime, parseMarkdown, parseNodeId, parseVmId, cpuPct, pct, buildSeriesFromRrd, fetchRrd, tagColor } from '../helpers'
import { AreaPctChart, AreaBpsChart2 } from '../components/RrdCharts'
import VCenterSummary from '../components/VCenterSummary'
import HaGroupDialog from '../HaGroupDialog'
import HaRuleDialog from '../HaRuleDialog'
import { AddIcon } from '../components/IconWrappers'

export default function ClusterTabs(props: any) {
  const t = useTranslations()

  const {
    allVms,
    cephTrends,
    clusterActionError,
    clusterActionLoading,
    clusterCephData,
    clusterCephLoading,
    clusterCephPerf,
    clusterCephPerfFiltered,
    clusterCephTimeframe,
    clusterConfig,
    clusterConfigLoading,
    clusterHaGroups,
    clusterHaLoading,
    clusterHaResources,
    clusterHaRules,
    clusterNotesContent,
    clusterNotesEditMode,
    clusterNotesLoading,
    clusterNotesSaving,
    clusterPveMajorVersion,
    clusterStorageData,
    clusterStorageLoading,
    clusterTab,
    createClusterDialogOpen,
    cveAvailable,
    data,
    error,
    expandedClusterNodes,
    favorites,
    handleCreateCluster,
    handleJoinCluster,
    handleNodeBulkAction,
    handleSaveClusterNotes,
    handleTableMigrate,
    handleTableVmAction,
    joinClusterDialogOpen,
    joinClusterInfo,
    joinClusterPassword,
    joinInfoDialogOpen,
    loading,
    localVmsDialogNode,
    localVmsDialogOpen,
    migratingVmIds,
    newClusterLinks,
    newClusterName,
    nodeLocalVms,
    nodeUpdates,
    onSelect,
    primaryColor,
    rollingUpdateAvailable,
    rollingUpdateWizardOpen,
    selection,
    setClusterActionError,
    setClusterCephTimeframe,
    setClusterNotesContent,
    setClusterNotesEditMode,
    setClusterTab,
    setCreateClusterDialogOpen,
    setDeleteHaGroupDialog,
    setDeleteHaRuleDialog,
    setEditingHaGroup,
    setEditingHaRule,
    setExpandedClusterNodes,
    setHaGroupDialogOpen,
    setHaRuleDialogOpen,
    setHaRuleType,
    setJoinClusterDialogOpen,
    setJoinClusterInfo,
    setJoinClusterPassword,
    setJoinInfoDialogOpen,
    setLocalVmsDialogNode,
    setLocalVmsDialogOpen,
    setNewClusterLinks,
    setNewClusterName,
    setNodeLocalVms,
    setNodeUpdates,
    setRollingUpdateWizardOpen,
    setUpdatesDialogNode,
    setUpdatesDialogOpen,
    toggleFavorite,
    updatesDialogNode,
    updatesDialogOpen,
  } = props

  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'stable' }) => {
    if (trend === 'up') return <i className="ri-arrow-up-line" style={{ color: '#4caf50', fontSize: 14 }} />
    if (trend === 'down') return <i className="ri-arrow-down-line" style={{ color: '#f44336', fontSize: 14 }} />
    return <i className="ri-arrow-right-line" style={{ color: '#9e9e9e', fontSize: 14 }} />
  }

  return (
    <>
          {/* Onglets pour Cluster: Summary / Nodes / VMs / HA / Backups / Notes / Ceph / Storage / Firewall / Rolling Update / Cluster */}
          {selection?.type === 'cluster' && data.nodesData ? (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Tabs
                value={clusterTab}
                onChange={(_e, v) => setClusterTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-dashboard-line" style={{ fontSize: 16 }} />
                      Summary
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-server-line" style={{ fontSize: 16 }} />
                      Nodes
                      <Chip size="small" label={data.nodesData.length} sx={{ height: 18, fontSize: 11 }} />
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-computer-line" style={{ fontSize: 16 }} />
                      {t('inventory.vms')}
                      {data.vmsCount !== undefined && (
                        <Chip size="small" label={data.vmsCount} sx={{ height: 18, fontSize: 11 }} />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-check-line" style={{ fontSize: 16 }} />
                      High Availability
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-calendar-schedule-line" style={{ fontSize: 16 }} />
                      Backups
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-camera-line" style={{ fontSize: 16 }} />
                      Snapshots
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-file-text-line" style={{ fontSize: 16 }} />
                      Notes
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-database-2-line" style={{ fontSize: 16 }} />
                      Ceph
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      Storage
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
                      Firewall
                    </Box>
                  }
                />
                <Tab
                  disabled={!rollingUpdateAvailable}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: rollingUpdateAvailable ? 1 : 0.4 }}>
                      <i className="ri-refresh-line" style={{ fontSize: 16 }} />
                      Rolling Update
                      {!rollingUpdateAvailable && (
                        <Chip
                          size="small"
                          label="Enterprise"
                          sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 600,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            ml: 0.5,
                            '& .MuiChip-label': { px: 0.75 }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
                <Tab
                  disabled={!cveAvailable}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: cveAvailable ? 1 : 0.4 }}>
                      <i className="ri-shield-cross-line" style={{ fontSize: 16 }} />
                      CVE
                      {!cveAvailable && (
                        <Chip
                          size="small"
                          label="Enterprise"
                          sx={{
                            height: 18,
                            fontSize: '0.6rem',
                            fontWeight: 600,
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            ml: 0.5,
                            '& .MuiChip-label': { px: 0.75 }
                          }}
                        />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                      Cluster
                    </Box>
                  }
                />
              </Tabs>
              
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, display: 'flex', flexDirection: 'column' }}>
                {/* Onglet Summary - Index 0 */}
                {clusterTab === 0 && (
                  <Box sx={{ p: 2, overflow: 'auto' }}>
                    {/* Ligne 1: Health, Guests, Resources */}
                    <Box sx={{ 
                      display: 'grid', 
                      gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, 
                      gap: 2,
                      mb: 2
                    }}>
                      {/* Section Health */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                          <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                            Health
                          </Typography>
                          <Grid container spacing={3}>
                              {/* Status */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Status</Typography>
                                <Box sx={{ 
                                  width: 48, 
                                  height: 48, 
                                  borderRadius: '50%', 
                                  bgcolor: data.status === 'ok' ? 'success.main' : data.status === 'warn' ? 'warning.main' : 'error.main', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  mx: 'auto',
                                  mb: 1
                                }}>
                                  <i className={data.status === 'ok' ? "ri-check-line" : "ri-alert-line"} style={{ fontSize: 24, color: '#fff' }} />
                                </Box>
                                <Typography variant="caption" sx={{ display: 'block' }}>
                                  Cluster: {data.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  Quorate: Yes
                                </Typography>
                              </Grid>
                              {/* Nodes */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Nodes</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                    <Typography variant="body2">Online</Typography>
                                    <Typography variant="body2" fontWeight={700}>
                                      {(data.nodesData as any[])?.filter((n: any) => n.status === 'online').length || 0}
                                    </Typography>
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
                                    <Typography variant="body2">Offline</Typography>
                                    <Typography variant="body2" fontWeight={700}>
                                      {(data.nodesData as any[])?.filter((n: any) => n.status !== 'online').length || 0}
                                    </Typography>
                                  </Box>
                                </Box>
                              </Grid>
                              {/* Ceph */}
                              <Grid size={4} sx={{ textAlign: 'center' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Ceph</Typography>
                                <Box sx={{ 
                                  width: 48, 
                                  height: 48, 
                                  borderRadius: '50%', 
                                  bgcolor: data.cephHealth === 'HEALTH_OK' ? 'success.main' : 
                                           data.cephHealth === 'HEALTH_WARN' ? 'warning.main' : 
                                           data.cephHealth ? 'error.main' : 'action.disabledBackground',
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'center',
                                  mx: 'auto',
                                  mb: 1
                                }}>
                                  <i className={data.cephHealth ? "ri-check-line" : "ri-question-line"} style={{ fontSize: 24, color: '#fff' }} />
                                </Box>
                                <Typography variant="caption">
                                  {data.cephHealth === 'HEALTH_OK' ? 'Healthy' : 
                                   data.cephHealth === 'HEALTH_WARN' ? 'Warning' : 
                                   data.cephHealth ? 'Error' : 'N/A'}
                                </Typography>
                              </Grid>
                            </Grid>
                          </CardContent>
                        </Card>

                      {/* Section Guests */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                            <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                              Guests
                            </Typography>
                            <Grid container spacing={2}>
                              {/* Virtual Machines */}
                              <Grid size={6}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>Virtual Machines</Typography>
                                {(() => {
                                  const allVms = (data as any).allVms || []
                                  const qemuVms = allVms.filter((v: any) => v.type === 'qemu')
                                  const running = qemuVms.filter((v: any) => v.status === 'running').length
                                  const stopped = qemuVms.filter((v: any) => v.status === 'stopped').length
                                  const templates = qemuVms.filter((v: any) => v.template).length
                                  return (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                        <Typography variant="body2">Running</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{running}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                        <Typography variant="body2">Stopped</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{stopped}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'transparent', border: '1px solid', borderColor: 'text.disabled' }} />
                                        <Typography variant="body2">Templates</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{templates}</Typography>
                                      </Box>
                                    </Box>
                                  )
                                })()}
                              </Grid>
                              {/* LXC Containers */}
                              <Grid size={6}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>LXC Containers</Typography>
                                {(() => {
                                  const allVms = (data as any).allVms || []
                                  const lxcVms = allVms.filter((v: any) => v.type === 'lxc')
                                  const running = lxcVms.filter((v: any) => v.status === 'running').length
                                  const stopped = lxcVms.filter((v: any) => v.status === 'stopped').length
                                  return (
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                                        <Typography variant="body2">Running</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{running}</Typography>
                                      </Box>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                        <Typography variant="body2">Stopped</Typography>
                                        <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }}>{stopped}</Typography>
                                      </Box>
                                    </Box>
                                  )
                                })()}
                              </Grid>
                            </Grid>
                          </CardContent>
                        </Card>

                      {/* Section Resources */}
                      <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent sx={{ p: 2 }}>
                          <Typography variant="subtitle2" color="primary" fontWeight={700} sx={{ mb: 2 }}>
                            Resources
                          </Typography>
                          <Grid container spacing={3}>
                              {(() => {
                                // Utiliser data.metrics qui contient les vraies valeurs
                                const cpuPercent = data.metrics?.cpu?.pct || 0
                                const memPercent = data.metrics?.ram?.pct || 0
                                const usedMem = data.metrics?.ram?.used || 0
                                const totalMem = data.metrics?.ram?.max || 0
                                const storagePercent = data.metrics?.storage?.pct || 0
                                const usedStorage = data.metrics?.storage?.used || 0
                                const totalStorage = data.metrics?.storage?.max || 0
                                
                                // Compter les CPU totaux depuis nodesData
                                const nodes = (data.nodesData as any[]) || []
                                const totalCpuCores = nodes.length > 0 ? nodes.length * 8 : 0 // Approximation, ou utiliser les vraies valeurs si disponibles
                                
                                return (
                                  <>
                                    {/* CPU */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>CPU</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={cpuPercent}
                                          size={80}
                                          thickness={22}
                                          sx={{ color: cpuPercent > 80 ? 'error.main' : cpuPercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{cpuPercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {nodes.length} nodes
                                      </Typography>
                                    </Grid>
                                    {/* Memory */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Memory</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={memPercent}
                                          size={80}
                                          thickness={22}
                                          sx={{ color: memPercent > 80 ? 'error.main' : memPercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{memPercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {formatBytes(usedMem)} of {formatBytes(totalMem)}
                                      </Typography>
                                    </Grid>
                                    {/* Storage */}
                                    <Grid size={{ xs: 12, md: 4 }} sx={{ textAlign: 'center' }}>
                                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>Storage</Typography>
                                      <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                                        <CircularProgress
                                          variant="determinate"
                                          value={storagePercent}
                                          size={80}
                                          thickness={22}
                                          sx={{ color: storagePercent > 80 ? 'error.main' : storagePercent > 60 ? 'warning.main' : 'success.main' }}
                                        />
                                        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                          <Typography variant="h6" fontWeight={700}>{storagePercent}%</Typography>
                                        </Box>
                                      </Box>
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        {formatBytes(usedStorage)} of {formatBytes(totalStorage)}
                                      </Typography>
                                    </Grid>
                                  </>
                                )
                              })()}
                            </Grid>
                          </CardContent>
                        </Card>
                    </Box>

                    {/* Section Nodes Table */}
                    <Card variant="outlined">
                      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                        <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                          <Typography variant="subtitle2" color="primary" fontWeight={700}>
                            Nodes
                          </Typography>
                        </Box>
                        <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Online</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Support</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Server Address</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>CPU usage</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Memory usage</TableCell>
                                    <TableCell sx={{ fontWeight: 700 }}>Uptime</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(data.nodesData as any[])?.map((node: any, idx: number) => {
                                    // node.cpu et node.ram sont déjà des pourcentages (0-100)
                                    const cpuPercent = node.cpu || 0
                                    const memPercent = node.ram || 0
                                    const formatUptime = (seconds: number) => {
                                      const days = Math.floor(seconds / 86400)
                                      const hours = Math.floor((seconds % 86400) / 3600)
                                      const mins = Math.floor((seconds % 3600) / 60)
                                      const secs = Math.floor(seconds % 60)
                                      if (days > 0) return `${days} days ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                                      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
                                    }
                                    return (
                                      <TableRow key={idx} hover sx={{ cursor: 'pointer' }} onClick={() => onSelect?.({ type: 'node', id: node.id })}>
                                        <TableCell sx={{ fontWeight: 600 }}>{node.node || node.name}</TableCell>
                                        <TableCell>{idx + 1}</TableCell>
                                        <TableCell>
                                          {node.status === 'maintenance' ? (
                                            <i className="ri-tools-fill" style={{ fontSize: 16, color: '#ff9800' }} />
                                          ) : node.status === 'online' ? (
                                            <i className="ri-check-line" style={{ color: '#4caf50' }} />
                                          ) : (
                                            <i className="ri-close-line" style={{ color: '#f44336' }} />
                                          )}
                                        </TableCell>
                                        <TableCell>
                                          <Chip size="small" label="Community" sx={{ height: 20, fontSize: 10 }} />
                                        </TableCell>
                                        <TableCell sx={{ fontSize: 12 }}>{node.ip || '-'}</TableCell>
                                        <TableCell>
                                          <Box sx={{ position: 'relative', width: 60 }}>
                                            <LinearProgress
                                              variant="determinate"
                                              value={cpuPercent}
                                              sx={{
                                                height: 14,
                                                borderRadius: 0,
                                                bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                                                '& .MuiLinearProgress-bar': {
                                                  borderRadius: 0,
                                                  background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                                                  backgroundSize: cpuPercent > 0 ? `${(100 / cpuPercent) * 100}% 100%` : '100% 100%',
                                                }
                                              }}
                                            />
                                            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{cpuPercent}%</Typography>
                                          </Box>
                                        </TableCell>
                                        <TableCell>
                                          <Box sx={{ position: 'relative', width: 60 }}>
                                            <LinearProgress
                                              variant="determinate"
                                              value={memPercent}
                                              sx={{
                                                height: 14,
                                                borderRadius: 0,
                                                bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                                                '& .MuiLinearProgress-bar': {
                                                  borderRadius: 0,
                                                  background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                                                  backgroundSize: memPercent > 0 ? `${(100 / memPercent) * 100}% 100%` : '100% 100%',
                                                }
                                              }}
                                            />
                                            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{memPercent}%</Typography>
                                          </Box>
                                        </TableCell>
                                        <TableCell sx={{ fontSize: 12 }}>{node.uptime ? formatUptime(node.uptime) : '-'}</TableCell>
                                      </TableRow>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                        </TableContainer>
                      </CardContent>
                    </Card>
                  </Box>
                )}

                {/* Onglet Nodes - Index 1 */}
                {clusterTab === 1 && data.nodesData.length > 0 && (
                  <NodesTable
                    nodes={data.nodesData as NodeRow[]}
                    compact
                    maxHeight="auto"
                    onNodeClick={(node) => {
                      onSelect?.({ type: 'node', id: node.id })
                    }}
                    onBulkAction={handleNodeBulkAction}
                    showMigrateOption={data.nodesData.length > 1}
                  />
                )}

                {/* Onglet VMs - Liste complète avec collapse par node - Index 2 */}
                {clusterTab === 2 && (
                  <Box sx={{ p: 0 }}>
                    {data.nodesData && data.nodesData.length > 0 ? (
                      <Box>
                        {(data.nodesData as NodeRow[]).map((node) => {
                          const nodeVms = (data.allVms || []).filter((vm: any) => vm.node === node.name)
                          const isExpanded = expandedClusterNodes.has(node.name)
                          
                          return (
                            <Box key={node.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
                              {/* Header du node (cliquable pour expand/collapse) */}
                              <Box 
                                sx={{ 
                                  px: 2, 
                                  py: 1.5, 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  justifyContent: 'space-between',
                                  cursor: 'pointer',
                                  '&:hover': { bgcolor: 'action.hover' },
                                  bgcolor: isExpanded ? 'action.selected' : 'transparent'
                                }}
                                onClick={() => {
                                  setExpandedClusterNodes(prev => {
                                    const newSet = new Set(prev)
                                    if (newSet.has(node.name)) {
                                      newSet.delete(node.name)
                                    } else {
                                      newSet.add(node.name)
                                    }
                                    return newSet
                                  })
                                }}
                              >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                  <i 
                                    className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} 
                                    style={{ fontSize: 18, opacity: 0.7 }} 
                                  />
                                  <Box 
                                    sx={{ 
                                      width: 8, 
                                      height: 8, 
                                      borderRadius: '50%', 
                                      bgcolor: node.status === 'online' ? 'success.main' : 'error.main' 
                                    }} 
                                  />
                                  <Typography fontWeight={600}>{node.name}</Typography>
                                  <Chip 
                                    size="small" 
                                    label={`${nodeVms.length} VMs`} 
                                    sx={{ height: 20, fontSize: 11 }} 
                                  />
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                    CPU: {node.cpu?.toFixed(1) || 0}%
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                    RAM: {node.ram?.toFixed(1) || 0}%
                                  </Typography>
                                </Box>
                              </Box>
                              
                              {/* Liste des VMs du node (collapsible) */}
                              {isExpanded && nodeVms.length > 0 && (
                                <Box sx={{ bgcolor: 'background.default' }}>
                                  <VmsTable
                                    vms={nodeVms as VmRow[]}
                                    compact
                                    maxHeight={400}
                                    showActions={true}
                                    onVmClick={(vm) => {
                                      if (vm.template) return
                                      onSelect?.({ type: 'vm', id: vm.id })
                                    }}
                                    onVmAction={handleTableVmAction}
                                    onMigrate={handleTableMigrate}
                                    favorites={favorites}
                                    onToggleFavorite={toggleFavorite}
                                    migratingVmIds={migratingVmIds}
                                  />
                                </Box>
                              )}
                              
                              {isExpanded && nodeVms.length === 0 && (
                                <Box sx={{ px: 4, py: 2, bgcolor: 'background.default', opacity: 0.5 }}>
                                  <Typography variant="body2">No VMs on this node</Typography>
                                </Box>
                              )}
                            </Box>
                          )
                        })}
                      </Box>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-computer-line" style={{ fontSize: 48, marginBottom: 8 }} />
                        <Typography>{t('common.noData')}</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet HA - Index 3 */}
                {clusterTab === 3 && (
                  <Box sx={{ p: 2 }}>
                    {clusterHaLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Badge version PVE */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Chip 
                            size="small" 
                            label={`Proxmox VE ${clusterPveMajorVersion}.x`}
                            color={clusterPveMajorVersion >= 9 ? 'success' : 'default'}
                            sx={{ height: 22 }}
                          />
                          {clusterPveMajorVersion >= 9 && (
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>
                              {t('drs.affinityRules')}
                            </Typography>
                          )}
                        </Box>

                        {/* Section Ressources HA */}
                        <Box>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-stack-line" style={{ fontSize: 18, opacity: 0.7 }} />
                            Ressources ({clusterHaResources.length})
                          </Typography>
                          
                          {clusterHaResources.length === 0 ? (
                            <Alert severity="info" sx={{ py: 1 }}>
                              {t('common.noData')}
                            </Alert>
                          ) : (
                            <Box sx={{ 
                              border: '1px solid', 
                              borderColor: 'divider', 
                              borderRadius: 1,
                              overflow: 'hidden'
                            }}>
                              {/* Header */}
                              <Box sx={{ 
                                display: 'grid', 
                                gridTemplateColumns: clusterPveMajorVersion >= 9 
                                  ? '100px 100px 150px 100px 100px 200px'
                                  : '100px 100px 150px 100px 100px 1fr 200px',
                                gap: 1,
                                px: 1.5,
                                py: 1,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                              }}>
                                <Typography variant="caption">ID</Typography>
                                <Typography variant="caption">State</Typography>
                                <Typography variant="caption">Node</Typography>
                                <Typography variant="caption">Max. Restart</Typography>
                                <Typography variant="caption">Max. Reloc.</Typography>
                                {clusterPveMajorVersion < 9 && <Typography variant="caption">Group</Typography>}
                                <Typography variant="caption">Description</Typography>
                              </Box>
                              {/* Rows */}
                              {clusterHaResources.map((res: any) => (
                                <Box 
                                  key={res.sid}
                                  sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: clusterPveMajorVersion >= 9 
                                      ? '100px 100px 150px 100px 100px 200px'
                                      : '100px 100px 150px 100px 100px 1fr 200px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 0.75,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '&:last-child': { borderBottom: 'none' },
                                    '&:hover': { bgcolor: 'action.hover' }
                                  }}
                                >
                                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'primary.main' }}>
                                    {res.sid}
                                  </Typography>
                                  <Box>
                                    <Chip 
                                      size="small" 
                                      label={res.state || 'started'} 
                                      color={res.state === 'started' || res.state === 'enabled' ? 'success' : res.state === 'ignored' ? 'warning' : 'default'}
                                      sx={{ height: 20, fontSize: 11 }} 
                                    />
                                  </Box>
                                  <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                    {res.node || '-'}
                                  </Typography>
                                  <Typography variant="body2" sx={{ textAlign: 'center' }}>
                                    {res.max_restart ?? 1}
                                  </Typography>
                                  <Typography variant="body2" sx={{ textAlign: 'center' }}>
                                    {res.max_relocate ?? 1}
                                  </Typography>
                                  {clusterPveMajorVersion < 9 && (
                                    <Typography variant="body2" sx={{ color: 'info.main' }}>
                                      {res.group || '-'}
                                    </Typography>
                                  )}
                                  <Typography variant="body2" sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {res.comment || '-'}
                                  </Typography>
                                </Box>
                              ))}
                            </Box>
                          )}
                        </Box>

                        {/* PVE 8: Section Groupes HA */}
                        {clusterPveMajorVersion < 9 && (
                          <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                              <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-group-line" style={{ fontSize: 18, opacity: 0.7 }} />
                                Groupes ({clusterHaGroups.length})
                              </Typography>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => {
                                  setEditingHaGroup(null)
                                  setHaGroupDialogOpen(true)
                                }}
                              >
                                {t('common.create')}
                              </Button>
                            </Box>
                            
                            {clusterHaGroups.length === 0 ? (
                              <Alert severity="info" sx={{ py: 1 }}>
                                {t('common.noData')}
                              </Alert>
                            ) : (
                              <Box sx={{ 
                                border: '1px solid', 
                                borderColor: 'divider', 
                                borderRadius: 1,
                                overflow: 'hidden'
                              }}>
                                {/* Header */}
                                <Box sx={{ 
                                  display: 'grid', 
                                  gridTemplateColumns: '150px 80px 80px 1fr 200px 80px',
                                  gap: 1,
                                  px: 1.5,
                                  py: 1,
                                  bgcolor: 'action.hover',
                                  borderBottom: '1px solid',
                                  borderColor: 'divider',
                                  '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                                }}>
                                  <Typography variant="caption">Group</Typography>
                                  <Typography variant="caption">Restricted</Typography>
                                  <Typography variant="caption">Nofailback</Typography>
                                  <Typography variant="caption">Nodes</Typography>
                                  <Typography variant="caption">Comment</Typography>
                                  <Typography variant="caption" sx={{ textAlign: 'center' }}>Actions</Typography>
                                </Box>
                                {/* Rows */}
                                {clusterHaGroups.map((group: any) => (
                                  <Box 
                                    key={group.group}
                                    sx={{ 
                                      display: 'grid', 
                                      gridTemplateColumns: '150px 80px 80px 1fr 200px 80px',
                                      gap: 1,
                                      px: 1.5,
                                      py: 0.75,
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      '&:last-child': { borderBottom: 'none' },
                                      '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                  >
                                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                      {group.group}
                                    </Typography>
                                    <Typography variant="body2">
                                      {group.restricted ? 'Yes' : 'No'}
                                    </Typography>
                                    <Typography variant="body2">
                                      {group.nofailback ? 'Yes' : 'No'}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {group.nodes || '-'}
                                    </Typography>
                                    <Typography variant="body2" sx={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {group.comment || '-'}
                                    </Typography>
                                    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                      <MuiTooltip title={t('common.edit')}>
                                        <IconButton 
                                          size="small" 
                                          onClick={() => {
                                            setEditingHaGroup(group)
                                            setHaGroupDialogOpen(true)
                                          }}
                                        >
                                          <i className="ri-edit-line" style={{ fontSize: 16 }} />
                                        </IconButton>
                                      </MuiTooltip>
                                      <MuiTooltip title={t('common.delete')}>
                                        <IconButton 
                                          size="small" 
                                          color="error"
                                          onClick={() => setDeleteHaGroupDialog(group)}
                                        >
                                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                        </IconButton>
                                      </MuiTooltip>
                                    </Box>
                                  </Box>
                                ))}
                              </Box>
                            )}
                          </Box>
                        )}

                        {/* PVE 9+: Section Affinity Rules */}
                        {clusterPveMajorVersion >= 9 && (
                          <>
                            {/* Node Affinity Rules */}
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-node-tree" style={{ fontSize: 18, opacity: 0.7 }} />
                                  Node Affinity Rules ({clusterHaRules.filter((r: any) => r.type === 'node-affinity').length})
                                </Typography>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<AddIcon />}
                                  onClick={() => {
                                    setHaRuleType('node-affinity')
                                    setEditingHaRule(null)
                                    setHaRuleDialogOpen(true)
                                  }}
                                >
                                  {t('common.add')}
                                </Button>
                              </Box>
                              
                              {clusterHaRules.filter((r: any) => r.type === 'node-affinity').length === 0 ? (
                                <Alert severity="info" sx={{ py: 1 }}>
                                  {t('common.noData')}
                                </Alert>
                              ) : (
                                <Box sx={{ 
                                  border: '1px solid', 
                                  borderColor: 'divider', 
                                  borderRadius: 1,
                                  overflow: 'hidden'
                                }}>
                                  {/* Header */}
                                  <Box sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '60px 80px 80px 1fr 1fr 80px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 1,
                                    bgcolor: 'action.hover',
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                                  }}>
                                    <Typography variant="caption">Enabled</Typography>
                                    <Typography variant="caption">State</Typography>
                                    <Typography variant="caption">Strict</Typography>
                                    <Typography variant="caption">HA Resources</Typography>
                                    <Typography variant="caption">Nodes</Typography>
                                    <Typography variant="caption" sx={{ textAlign: 'center' }}>Actions</Typography>
                                  </Box>
                                  {/* Rows */}
                                  {clusterHaRules.filter((r: any) => r.type === 'node-affinity').map((rule: any) => (
                                    <Box 
                                      key={rule.rule}
                                      sx={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '60px 80px 80px 1fr 1fr 80px',
                                        gap: 1,
                                        px: 1.5,
                                        py: 0.75,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        '&:last-child': { borderBottom: 'none' },
                                        '&:hover': { bgcolor: 'action.hover' }
                                      }}
                                    >
                                      <Box>
                                        <Chip 
                                          size="small" 
                                          label={rule.state === 'disabled' ? 'No' : 'Yes'} 
                                          color={rule.state === 'disabled' ? 'default' : 'success'}
                                          sx={{ height: 20, fontSize: 11 }} 
                                        />
                                      </Box>
                                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                        {rule.state || 'enabled'}
                                      </Typography>
                                      <Typography variant="body2">
                                        {rule.strict ? 'Yes' : 'No'}
                                      </Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {rule.resources || '-'}
                                      </Typography>
                                      <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {rule.nodes || '-'}
                                      </Typography>
                                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                        <MuiTooltip title={t('common.edit')}>
                                          <IconButton 
                                            size="small" 
                                            onClick={() => {
                                              setHaRuleType('node-affinity')
                                              setEditingHaRule(rule)
                                              setHaRuleDialogOpen(true)
                                            }}
                                          >
                                            <i className="ri-edit-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            onClick={() => setDeleteHaRuleDialog(rule)}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Box>
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>

                            {/* Resource Affinity Rules */}
                            <Box>
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                                <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-links-line" style={{ fontSize: 18, opacity: 0.7 }} />
                                  Resource Affinity Rules ({clusterHaRules.filter((r: any) => r.type === 'resource-affinity').length})
                                </Typography>
                                <Button
                                  size="small"
                                  variant="contained"
                                  startIcon={<AddIcon />}
                                  onClick={() => {
                                    setHaRuleType('resource-affinity')
                                    setEditingHaRule(null)
                                    setHaRuleDialogOpen(true)
                                  }}
                                >
                                  {t('common.add')}
                                </Button>
                              </Box>
                              
                              {clusterHaRules.filter((r: any) => r.type === 'resource-affinity').length === 0 ? (
                                <Alert severity="info" sx={{ py: 1 }}>
                                  {t('common.noData')}
                                </Alert>
                              ) : (
                                <Box sx={{ 
                                  border: '1px solid', 
                                  borderColor: 'divider', 
                                  borderRadius: 1,
                                  overflow: 'hidden'
                                }}>
                                  {/* Header */}
                                  <Box sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '60px 80px 120px 1fr 80px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 1,
                                    bgcolor: 'action.hover',
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '& > *': { fontWeight: 600, fontSize: 12, opacity: 0.8 }
                                  }}>
                                    <Typography variant="caption">Enabled</Typography>
                                    <Typography variant="caption">State</Typography>
                                    <Typography variant="caption">Affinity</Typography>
                                    <Typography variant="caption">HA Resources</Typography>
                                    <Typography variant="caption" sx={{ textAlign: 'center' }}>Actions</Typography>
                                  </Box>
                                  {/* Rows */}
                                  {clusterHaRules.filter((r: any) => r.type === 'resource-affinity').map((rule: any) => (
                                    <Box 
                                      key={rule.rule}
                                      sx={{ 
                                        display: 'grid', 
                                        gridTemplateColumns: '60px 80px 120px 1fr 80px',
                                        gap: 1,
                                        px: 1.5,
                                        py: 0.75,
                                        borderBottom: '1px solid',
                                        borderColor: 'divider',
                                        '&:last-child': { borderBottom: 'none' },
                                        '&:hover': { bgcolor: 'action.hover' }
                                      }}
                                    >
                                      <Box>
                                        <Chip 
                                          size="small" 
                                          label={rule.state === 'disabled' ? 'No' : 'Yes'} 
                                          color={rule.state === 'disabled' ? 'default' : 'success'}
                                          sx={{ height: 20, fontSize: 11 }} 
                                        />
                                      </Box>
                                      <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                        {rule.state || 'enabled'}
                                      </Typography>
                                      <Chip 
                                        size="small" 
                                        label={rule.affinity === 'positive' ? 'Keep Together' : 'Keep Separate'} 
                                        color={rule.affinity === 'positive' ? 'info' : 'warning'}
                                        sx={{ height: 20, fontSize: 10 }} 
                                      />
                                      <Typography variant="body2" sx={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {rule.resources || '-'}
                                      </Typography>
                                      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5 }}>
                                        <MuiTooltip title={t('common.edit')}>
                                          <IconButton 
                                            size="small" 
                                            onClick={() => {
                                              setHaRuleType('resource-affinity')
                                              setEditingHaRule(rule)
                                              setHaRuleDialogOpen(true)
                                            }}
                                          >
                                            <i className="ri-edit-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            onClick={() => setDeleteHaRuleDialog(rule)}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Box>
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          </>
                        )}
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Backups - Index 4 */}
                {clusterTab === 4 && (
                  <BackupJobsPanel connectionId={selection?.id?.split(':')[0] || ''} />
                )}

                {/* Onglet Snapshots - Index 5 */}
                {clusterTab === 5 && (
                  <Box sx={{ overflow: 'auto' }}>
                    <SnapshotsTab connectionId={selection?.id?.split(':')[0] || ''} />
                  </Box>
                )}

                {/* Onglet Notes - Index 6 */}
                {clusterTab === 6 && (
                  <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-file-text-line" style={{ fontSize: 20 }} />
                        Datacenter Notes
                      </Typography>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<i className="ri-edit-line" />}
                        onClick={() => setClusterNotesEditMode(!clusterNotesEditMode)}
                      >
                        {clusterNotesEditMode ? 'Cancel' : 'Edit'}
                      </Button>
                    </Box>
                    
                    {clusterNotesLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : clusterNotesEditMode ? (
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <TextField
                          multiline
                          fullWidth
                          minRows={10}
                          value={clusterNotesContent}
                          onChange={(e) => setClusterNotesContent(e.target.value)}
                          placeholder="Enter datacenter notes here... (supports Markdown)"
                          sx={{ flex: 1, fontFamily: 'monospace' }}
                        />
                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                          <Button
                            variant="contained"
                            startIcon={<i className="ri-save-line" />}
                            onClick={handleSaveClusterNotes}
                            disabled={clusterNotesSaving}
                          >
                            {clusterNotesSaving ? 'Saving...' : 'Save'}
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      <Box 
                        sx={{ 
                          flex: 1, 
                          p: 2, 
                          bgcolor: 'background.paper', 
                          border: '1px solid', 
                          borderColor: 'divider',
                          borderRadius: 1,
                          overflow: 'auto'
                        }}
                      >
                        {clusterNotesContent ? (
                          <Box 
                            dangerouslySetInnerHTML={{ __html: parseMarkdown(clusterNotesContent) }}
                            sx={{ 
                              '& img': { maxWidth: '100%', height: 'auto' },
                              '& a': { color: 'primary.main' },
                              '& table': { borderCollapse: 'collapse', width: '100%' },
                              '& th, & td': { border: '1px solid', borderColor: 'divider', p: 1 },
                              '& h1': { fontSize: '1.8em', fontWeight: 700, mt: 2, mb: 1 },
                              '& h2': { fontSize: '1.5em', fontWeight: 700, mt: 2, mb: 1 },
                              '& h3': { fontSize: '1.2em', fontWeight: 700, mt: 1.5, mb: 0.5 },
                              '& p': { my: 1 },
                              '& ul, & ol': { pl: 3, my: 1 },
                              '& li': { my: 0.5 },
                              '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.9em' },
                              '& pre': { bgcolor: 'grey.900', p: 2, borderRadius: 1, overflow: 'auto', '& code': { bgcolor: 'transparent', p: 0 } },
                              '& blockquote': { borderLeft: '4px solid', borderColor: 'primary.main', pl: 2, ml: 0, opacity: 0.8, fontStyle: 'italic' },
                              '& hr': { border: 'none', borderTop: '1px solid', borderColor: 'divider', my: 2 },
                            }}
                          />
                        ) : (
                          <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                            <i className="ri-file-text-line" style={{ fontSize: 48 }} />
                            <Typography sx={{ mt: 1 }}>No notes</Typography>
                          </Box>
                        )}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Ceph - Index 7 */}
                {clusterTab === 7 && (
                  <Box sx={{ p: 2 }}>
                    {clusterCephLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : clusterCephData ? (
                      <Stack spacing={3}>
                        {/* Health & Status */}
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {/* Health Card - avec Summary comme Proxmox */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Health</Typography>
                              <Box sx={{ display: 'flex', gap: 3 }}>
                                {/* Status avec icône */}
                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 100 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ mb: 1 }}>Status</Typography>
                                  <Box sx={{ 
                                    width: 56, 
                                    height: 56, 
                                    borderRadius: '50%', 
                                    bgcolor: clusterCephData.health?.status === 'HEALTH_OK' ? 'success.main' : 
                                             clusterCephData.health?.status === 'HEALTH_WARN' ? 'warning.main' : 'error.main',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    mb: 1
                                  }}>
                                    <i className={clusterCephData.health?.status === 'HEALTH_OK' ? 'ri-checkbox-circle-fill' : 'ri-alert-fill'} style={{ fontSize: 28, color: 'white' }} />
                                  </Box>
                                  <Typography variant="body2" fontWeight={700}>
                                    {clusterCephData.health?.status || 'Unknown'}
                                  </Typography>
                                </Box>
                                
                                {/* Summary - Warnings/Errors */}
                                <Box sx={{ flex: 1, borderLeft: '1px solid', borderColor: 'divider', pl: 2 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>Summary</Typography>
                                  {clusterCephData._normalized?.healthChecks?.length > 0 ? (
                                    <Box sx={{ maxHeight: 120, overflow: 'auto' }}>
                                      {clusterCephData._normalized.healthChecks.map((check: any, idx: number) => (
                                        <Box key={idx} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                                          <i 
                                            className={check.severity === 'HEALTH_ERR' ? 'ri-close-circle-fill' : 'ri-alert-fill'} 
                                            style={{ 
                                              fontSize: 14, 
                                              color: check.severity === 'HEALTH_ERR' ? '#f44336' : '#ff9800',
                                              marginTop: 2
                                            }} 
                                          />
                                          <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
                                            {check.summary}
                                          </Typography>
                                        </Box>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                      No Warnings/Errors
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                              
                              {/* Ceph Version en bas */}
                              {clusterCephData.version && (
                                <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Ceph Version</Typography>
                                  <Typography variant="body2" fontWeight={600}>{clusterCephData.version}</Typography>
                                </Box>
                              )}
                            </CardContent>
                          </Card>

                          {/* Status Card - OSDs & PGs */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Status</Typography>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>OSDs</Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Chip size="small" label={`${clusterCephData._normalized?.osd?.num_up_osds || clusterCephData.osdmap?.osdmap?.num_up_osds || 0} Up`} color="success" sx={{ height: 20 }} />
                                    <Chip size="small" label={`${clusterCephData._normalized?.osd?.num_in_osds || clusterCephData.osdmap?.osdmap?.num_in_osds || 0} In`} sx={{ height: 20 }} />
                                  </Box>
                                  <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.6 }}>
                                    Total: {clusterCephData._normalized?.osd?.num_osds || clusterCephData.osdmap?.osdmap?.num_osds || 0}
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>PGs</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.num_pgs || 0}
                                  </Typography>
                                  {clusterCephData.pgmap?.pgs_by_state && (
                                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                      {clusterCephData.pgmap.pgs_by_state.map((s: any) => s.state_name).join(', ')}
                                    </Typography>
                                  )}
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        </Box>

                        {/* Services */}
                        <Card variant="outlined">
                          <CardContent>
                            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Services</Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Monitors</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {clusterCephData.monmap?.mons?.map((mon: any) => (
                                    <MuiTooltip 
                                      key={mon.name} 
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Monitor: {mon.name}</Typography>
                                          {mon.addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {mon.addr}</Typography>}
                                          {mon.public_addr && <Typography variant="caption" sx={{ display: 'block' }}>Public: {mon.public_addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#4caf50' }}>Status: running</Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={mon.name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  )) || <Typography variant="body2">—</Typography>}
                                </Box>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Managers</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {clusterCephData.mgrmap?.active_name && (
                                    <MuiTooltip 
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Manager: {clusterCephData.mgrmap.active_name}</Typography>
                                          {clusterCephData.mgrmap.active_addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {clusterCephData.mgrmap.active_addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#4caf50' }}>Status: active</Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={clusterCephData.mgrmap.active_name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  )}
                                  {clusterCephData.mgrmap?.standbys?.map((mgr: any) => (
                                    <MuiTooltip 
                                      key={mgr.name}
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>Manager: {mgr.name}</Typography>
                                          {mgr.addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {mgr.addr}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: '#ff9800' }}>Status: standby</Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={mgr.name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  ))}
                                </Box>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Metadata Servers</Typography>
                                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {(clusterCephData._normalized?.mds?.length > 0 
                                    ? clusterCephData._normalized.mds 
                                    : clusterCephData.fsmap?.by_rank
                                  )?.map((mds: any) => (
                                    <MuiTooltip 
                                      key={mds.name}
                                      title={
                                        <Box sx={{ p: 0.5 }}>
                                          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>MDS: {mds.name}</Typography>
                                          {mds.addr && <Typography variant="caption" sx={{ display: 'block' }}>Address: {mds.addr}</Typography>}
                                          {mds.host && <Typography variant="caption" sx={{ display: 'block' }}>Host: {mds.host}</Typography>}
                                          {mds.rank !== undefined && <Typography variant="caption" sx={{ display: 'block' }}>Rank: {mds.rank}</Typography>}
                                          <Typography variant="caption" sx={{ display: 'block', color: mds.state === 'standby' ? '#ff9800' : '#4caf50' }}>
                                            Status: {mds.state || 'active'}
                                          </Typography>
                                        </Box>
                                      }
                                      arrow
                                    >
                                      <Chip size="small" label={mds.name} icon={<i className="ri-checkbox-circle-fill" style={{ color: '#4caf50' }} />} sx={{ height: 24, cursor: 'pointer' }} />
                                    </MuiTooltip>
                                  )) || <Typography variant="body2">—</Typography>}
                                </Box>
                              </Box>
                            </Box>
                          </CardContent>
                        </Card>

                        {/* Performance & Usage */}
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {/* Usage */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Usage</Typography>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Box sx={{ position: 'relative', width: 100, height: 100 }}>
                                  <CircularProgress
                                    variant="determinate"
                                    value={100}
                                    size={100}
                                    thickness={8}
                                    sx={{ color: 'divider', position: 'absolute' }}
                                  />
                                  <CircularProgress
                                    variant="determinate"
                                    value={clusterCephData.pgmap?.bytes_used && clusterCephData.pgmap?.bytes_total 
                                      ? (clusterCephData.pgmap.bytes_used / clusterCephData.pgmap.bytes_total) * 100 
                                      : 0}
                                    size={100}
                                    thickness={8}
                                    sx={{ color: 'success.main', position: 'absolute' }}
                                  />
                                  <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                                    <Typography variant="h6" fontWeight={700}>
                                      {clusterCephData.pgmap?.bytes_used && clusterCephData.pgmap?.bytes_total 
                                        ? Math.round((clusterCephData.pgmap.bytes_used / clusterCephData.pgmap.bytes_total) * 100) 
                                        : 0}%
                                    </Typography>
                                  </Box>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Used</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.bytes_used ? formatBytes(clusterCephData.pgmap.bytes_used) : '—'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 1 }}>Total</Typography>
                                  <Typography variant="body2" fontWeight={600}>
                                    {clusterCephData.pgmap?.bytes_total ? formatBytes(clusterCephData.pgmap.bytes_total) : '—'}
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>

                          {/* Performance - Données en temps réel */}
                          <Card variant="outlined">
                            <CardContent>
                              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                                Performance
                                <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                                  (live)
                                </Typography>
                              </Typography>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Reads:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.read_bytes_sec ? formatBps(clusterCephPerf.read_bytes_sec) : '0 B/s'}
                                    <TrendIcon trend={cephTrends.read_bytes} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>Writes:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.write_bytes_sec ? formatBps(clusterCephPerf.write_bytes_sec) : '0 B/s'}
                                    <TrendIcon trend={cephTrends.write_bytes} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>IOPS Reads:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.read_op_per_sec?.toLocaleString() || 0}
                                    <TrendIcon trend={cephTrends.read_iops} />
                                  </Typography>
                                </Box>
                                <Box>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>IOPS Writes:</Typography>
                                  <Typography variant="body1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {clusterCephPerf?.write_op_per_sec?.toLocaleString() || 0}
                                    <TrendIcon trend={cephTrends.write_iops} />
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        </Box>

                        {/* Graphiques Performance */}
                        <Card variant="outlined">
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                              <Typography variant="subtitle2" fontWeight={700}>
                                Performance History
                              </Typography>
                              {/* Sélecteur de timeframe */}
                              <Box sx={{ display: 'flex', gap: 0.5 }}>
                                {[
                                  { value: 60, label: '1m' },
                                  { value: 300, label: '5m' },
                                  { value: 600, label: '10m' },
                                  { value: 1800, label: '30m' },
                                  { value: 3600, label: '1h' },
                                ].map(opt => (
                                  <Chip
                                    key={opt.value}
                                    label={opt.label}
                                    size="small"
                                    onClick={() => setClusterCephTimeframe(opt.value)}
                                    sx={{
                                      height: 24,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      bgcolor: clusterCephTimeframe === opt.value ? 'primary.main' : 'action.hover',
                                      color: clusterCephTimeframe === opt.value ? 'primary.contrastText' : 'text.secondary',
                                      '&:hover': { bgcolor: clusterCephTimeframe === opt.value ? 'primary.dark' : 'action.selected' },
                                      cursor: 'pointer',
                                    }}
                                  />
                                ))}
                              </Box>
                            </Box>
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                              {/* Reads Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    Reads:
                                    <TrendIcon trend={cephTrends.read_bytes} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.read_bytes_sec ? formatBps(clusterCephPerf.read_bytes_sec) : '0 B/s'}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [formatBps(value), 'Reads']}
                                      />
                                      <Area 
                                        type="monotone" 
                                        dataKey="read_bytes_sec" 
                                        stroke={primaryColor} 
                                        fill={primaryColor} 
                                        fillOpacity={0.4} 
                                        strokeWidth={1.5} 
                                        isAnimationActive={false} 
                                      />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </Box>
                              </Box>

                              {/* Writes Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    Writes:
                                    <TrendIcon trend={cephTrends.write_bytes} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.write_bytes_sec ? formatBps(clusterCephPerf.write_bytes_sec) : '0 B/s'}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [formatBps(value), 'Writes']}
                                      />
                                      <Area 
                                        type="monotone" 
                                        dataKey="write_bytes_sec" 
                                        stroke={primaryColor} 
                                        fill={primaryColor} 
                                        fillOpacity={0.4} 
                                        strokeWidth={1.5} 
                                        isAnimationActive={false} 
                                      />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </Box>
                              </Box>

                              {/* IOPS Reads Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    IOPS Reads:
                                    <TrendIcon trend={cephTrends.read_iops} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.read_op_per_sec?.toLocaleString() || 0}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [value?.toLocaleString() + ' IOPS', 'Reads']}
                                      />
                                      <Area 
                                        type="monotone" 
                                        dataKey="read_op_per_sec" 
                                        stroke={primaryColor} 
                                        fill={primaryColor} 
                                        fillOpacity={0.4} 
                                        strokeWidth={1.5} 
                                        isAnimationActive={false} 
                                      />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </Box>
                              </Box>

                              {/* IOPS Writes Graph */}
                              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    IOPS Writes:
                                    <TrendIcon trend={cephTrends.write_iops} />
                                  </Typography>
                                  <Typography variant="caption" fontWeight={700}>
                                    {clusterCephPerf?.write_op_per_sec?.toLocaleString() || 0}
                                  </Typography>
                                </Box>
                                <Box sx={{ height: 100 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={clusterCephPerfFiltered}>
                                      <YAxis hide domain={[0, 'auto']} />
                                      <Tooltip
                                        contentStyle={{ backgroundColor: '#1e1e2f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                                        labelFormatter={(_, payload) => {
                                          if (payload && payload[0]?.payload?.time) {
                                            return new Date(payload[0].payload.time).toLocaleTimeString()
                                          }
                                          return ''
                                        }}
                                        formatter={(value: number) => [value?.toLocaleString() + ' IOPS', 'Writes']}
                                      />
                                      <Area 
                                        type="monotone" 
                                        dataKey="write_op_per_sec" 
                                        stroke={primaryColor} 
                                        fill={primaryColor} 
                                        fillOpacity={0.4} 
                                        strokeWidth={1.5} 
                                        isAnimationActive={false} 
                                      />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </Box>
                              </Box>
                            </Box>
                          </CardContent>
                        </Card>
                      </Stack>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center' }}>
                        <Box sx={{ 
                          width: 80, 
                          height: 80, 
                          borderRadius: '50%', 
                          bgcolor: 'action.hover', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          mx: 'auto',
                          mb: 2
                        }}>
                          <i className="ri-database-2-line" style={{ fontSize: 40, opacity: 0.5 }} />
                        </Box>
                        <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
                          Ceph not installed on this cluster
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.7, mb: 3, maxWidth: 500, mx: 'auto' }}>
                          Ceph is a distributed storage system that provides high availability, scalability, 
                          and excellent performance. Install Ceph on your cluster nodes to enable distributed 
                          storage with RBD, CephFS, and Object Gateway support.
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <Button
                            variant="contained"
                            startIcon={<i className="ri-download-cloud-line" />}
                            disabled
                          >
                            Install Ceph
                          </Button>
                          <Button
                            variant="outlined"
                            startIcon={<i className="ri-external-link-line" />}
                            href="https://pve.proxmox.com/wiki/Deploy_Hyper-Converged_Ceph_Cluster"
                            target="_blank"
                          >
                            Documentation
                          </Button>
                        </Box>
                        <Typography variant="caption" sx={{ display: 'block', mt: 2, opacity: 0.5 }}>
                          Installation wizard coming soon - Use Proxmox VE directly for now
                        </Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Storage - Index 8 */}
                {clusterTab === 8 && (
                  <Box sx={{ p: 0 }}>
                    {clusterStorageLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Box sx={{ width: '100%', overflow: 'auto' }}>
                        <Table size="small" sx={{ minWidth: 800 }}>
                          <TableHead>
                            <TableRow sx={{ bgcolor: 'action.hover' }}>
                              <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Content</TableCell>
                              <TableCell sx={{ fontWeight: 700 }}>Path/Target</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">Shared</TableCell>
                              <TableCell sx={{ fontWeight: 700 }} align="center">Enabled</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {clusterStorageData.length > 0 ? (
                              clusterStorageData.map((storage: any) => (
                                <TableRow key={storage.storage} hover>
                                  <TableCell sx={{ fontWeight: 600 }}>{storage.storage}</TableCell>
                                  <TableCell>
                                    <Chip 
                                      size="small" 
                                      label={storage.type} 
                                      sx={{ 
                                        height: 20, 
                                        fontSize: 11,
                                        bgcolor: storage.type === 'rbd' ? 'info.main' : 
                                                 storage.type === 'cephfs' ? 'secondary.main' :
                                                 storage.type === 'pbs' ? 'warning.main' :
                                                 storage.type === 'dir' ? 'default' : 'action.selected',
                                        color: ['rbd', 'cephfs', 'pbs'].includes(storage.type) ? 'white' : 'inherit'
                                      }} 
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption" sx={{ opacity: 0.9 }}>
                                      {typeof storage.content === 'string' ? storage.content.split(',').join(', ') : (storage.content || '—')}
                                    </Typography>
                                  </TableCell>
                                  <TableCell>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', opacity: 0.8 }}>
                                      {storage.path || storage.server || storage.pool || '—'}
                                    </Typography>
                                  </TableCell>
                                  <TableCell align="center">
                                    {storage.shared ? (
                                      <i className="ri-checkbox-circle-fill" style={{ color: '#4caf50', fontSize: 18 }} />
                                    ) : (
                                      <Typography variant="caption" sx={{ opacity: 0.5 }}>No</Typography>
                                    )}
                                  </TableCell>
                                  <TableCell align="center">
                                    {storage.disable ? (
                                      <i className="ri-close-circle-fill" style={{ color: '#f44336', fontSize: 18 }} />
                                    ) : (
                                      <i className="ri-checkbox-circle-fill" style={{ color: '#4caf50', fontSize: 18 }} />
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))
                            ) : (
                              <TableRow>
                                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                                  <Box sx={{ opacity: 0.5 }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 48 }} />
                                    <Typography sx={{ mt: 1 }}>No storage configured</Typography>
                                  </Box>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Firewall - Index 9 */}
                {clusterTab === 9 && (
                  <ClusterFirewallTab
                    connectionId={selection?.id?.split(':')[0] || ''}
                  />
                )}

                {/* Onglet Rolling Update - Index 10 */}
                {clusterTab === 10 && (
                  <Box sx={{ p: 2 }}>
                    <Stack spacing={3}>
                      {/* Header */}
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-refresh-line" style={{ fontSize: 20 }} />
                          {t('updates.rollingUpdate')}
                        </Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<i className="ri-refresh-line" />}
                          onClick={() => {
                            setNodeUpdates({})
                            setNodeLocalVms({})
                          }}
                        >
                          {t('updates.refresh')}
                        </Button>
                      </Box>

                      {/* Description */}
                      <Alert severity="info" icon={<i className="ri-information-line" />}>
                        <Typography variant="body2">
                          {t('updates.rollingUpdateDescription')}
                        </Typography>
                      </Alert>

                      {/* Statut des nœuds */}
                      <Card variant="outlined">
                        <CardContent>
                          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-server-line" style={{ fontSize: 18 }} />
                            {t('updates.nodesStatus')}
                          </Typography>
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>{t('updates.node')}</TableCell>
                                  <TableCell>{t('updates.version')}</TableCell>
                                  <TableCell align="center">{t('updates.vms')}</TableCell>
                                  <TableCell align="center">{t('updates.availableUpdates')}</TableCell>
                                  <TableCell align="center">{t('updates.estimatedTime')}</TableCell>
                                  <TableCell align="center">{t('updates.status')}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {data.nodesData.map((node: any) => {
                                  const nodeUpdate = nodeUpdates[node.node]
                                  // Calcul du temps estimé (réaliste pour rolling update)
                                  const hasKernel = nodeUpdate?.updates?.some((u: any) => 
                                    (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                                    (u.Package || u.package || '').toLowerCase().includes('linux-image') ||
                                    (u.Package || u.package || '').toLowerCase().includes('pve-kernel')
                                  )
                                  const pkgCount = nodeUpdate?.count || 0
                                  const vmCount = node.vms || 0
                                  
                                  // Estimation réaliste:
                                  // - Évacuation VMs: 2min + 30s par VM (migration live)
                                  // - Mode maintenance HA + flags Ceph: 2min
                                  // - Téléchargement paquets: 2min
                                  // - Installation: 5min + 3s par paquet
                                  // - Redémarrage si kernel: 5min
                                  // - Retour nœud + vérifs: 2min
                                  // - Suppression flags + sortie maintenance: 1min
                                  // - Vérification santé Ceph: 3min
                                  // - Buffer sécurité: 2min
                                  const estimatedMinutes = pkgCount > 0 
                                    ? Math.ceil(
                                        2 + Math.ceil(vmCount * 0.5) +  // Évacuation VMs
                                        2 +                             // Maintenance + flags Ceph
                                        2 +                             // Téléchargement
                                        5 + Math.ceil(pkgCount * 3 / 60) + // Installation
                                        (hasKernel ? 5 : 0) +           // Redémarrage
                                        2 +                             // Retour nœud
                                        1 +                             // Sortie maintenance
                                        3 +                             // Check santé Ceph
                                        2                               // Buffer sécurité
                                      )
                                    : 0
                                  return (
                                    <TableRow key={node.node}>
                                      <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.7 }} />
                                          <Typography variant="body2" fontWeight={600}>{node.node}</Typography>
                                        </Box>
                                      </TableCell>
                                      <TableCell align="center">
                                        {nodeUpdate?.loading ? (
                                          <CircularProgress size={14} />
                                        ) : (
                                          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                            {nodeUpdate?.version || '—'}
                                          </Typography>
                                        )}
                                      </TableCell>
                                      <TableCell align="center">
                                        {(() => {
                                          const localVmData = nodeLocalVms[node.node]
                                          const hasBlockingVms = localVmData && localVmData.blockingMigration > 0
                                          const hasLocalWithReplication = localVmData && localVmData.withReplication > 0
                                          
                                          return (
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                              <Chip 
                                                size="small" 
                                                label={node.vms ?? 0} 
                                                sx={{ height: 20, fontSize: 11, minWidth: 32 }}
                                              />
                                              {localVmData?.loading ? (
                                                <CircularProgress size={12} />
                                              ) : hasBlockingVms ? (
                                                <MuiTooltip title={
                                                  <Box>
                                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block' }}>
                                                      {t('updates.localStorageWarning')}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                                                      {localVmData.blockingMigration} VM(s) {t('updates.cannotMigrate')}
                                                    </Typography>
                                                    {hasLocalWithReplication && (
                                                      <Typography variant="caption" sx={{ display: 'block', color: 'success.light' }}>
                                                        {localVmData.withReplication} VM(s) {t('updates.withReplication')}
                                                      </Typography>
                                                    )}
                                                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>
                                                      {t('updates.clickForDetails')}
                                                    </Typography>
                                                  </Box>
                                                }>
                                                  <Chip
                                                    size="small"
                                                    icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 12 }} />}
                                                    label={localVmData.blockingMigration}
                                                    color="error"
                                                    sx={{ 
                                                      height: 20, 
                                                      fontSize: 10, 
                                                      cursor: 'pointer',
                                                      '& .MuiChip-icon': { fontSize: 12, ml: 0.5 }
                                                    }}
                                                    onClick={() => {
                                                      setLocalVmsDialogNode(node.node)
                                                      setLocalVmsDialogOpen(true)
                                                    }}
                                                  />
                                                </MuiTooltip>
                                              ) : localVmData && localVmData.total > 0 && localVmData.canMigrate ? (
                                                <MuiTooltip title={
                                                  <Box>
                                                    <Typography variant="caption" fontWeight={600} sx={{ display: 'block' }}>
                                                      {localVmData.total} VM(s) {t('updates.withLocalStorage')}
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ display: 'block', color: 'success.light' }}>
                                                      {t('updates.allCanMigrate')}
                                                    </Typography>
                                                  </Box>
                                                }>
                                                  <Chip
                                                    size="small"
                                                    icon={<i className="ri-hard-drive-2-line" style={{ fontSize: 12 }} />}
                                                    label={localVmData.total}
                                                    color="warning"
                                                    sx={{ 
                                                      height: 20, 
                                                      fontSize: 10,
                                                      cursor: 'pointer',
                                                      '& .MuiChip-icon': { fontSize: 12, ml: 0.5 }
                                                    }}
                                                    onClick={() => {
                                                      setLocalVmsDialogNode(node.node)
                                                      setLocalVmsDialogOpen(true)
                                                    }}
                                                  />
                                                </MuiTooltip>
                                              ) : null}
                                            </Box>
                                          )
                                        })()}
                                      </TableCell>
                                      <TableCell align="center">
                                        {nodeUpdate?.loading ? (
                                          <CircularProgress size={14} />
                                        ) : node.status !== 'online' ? (
                                          <Typography variant="caption" sx={{ opacity: 0.5 }}>—</Typography>
                                        ) : (
                                          <Chip 
                                            size="small" 
                                            label={nodeUpdate?.count ?? 0}
                                            color={nodeUpdate?.count > 0 ? 'warning' : 'success'}
                                            sx={{ 
                                              height: 24, 
                                              fontSize: 11, 
                                              minWidth: 40,
                                              cursor: nodeUpdate?.count > 0 ? 'pointer' : 'default',
                                              fontWeight: 600
                                            }}
                                            onClick={() => {
                                              if (nodeUpdate?.count > 0) {
                                                setUpdatesDialogNode(node.node)
                                                setUpdatesDialogOpen(true)
                                              }
                                            }}
                                            icon={nodeUpdate?.count > 0 ? <i className="ri-arrow-up-circle-fill" style={{ fontSize: 14 }} /> : <i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                          />
                                        )}
                                      </TableCell>
                                      <TableCell align="center">
                                        {nodeUpdate?.loading ? (
                                          <CircularProgress size={14} />
                                        ) : node.status !== 'online' || pkgCount === 0 ? (
                                          <Typography variant="caption" sx={{ opacity: 0.5 }}>—</Typography>
                                        ) : (
                                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                            <Typography variant="body2" sx={{ fontSize: 12 }}>
                                              ~{estimatedMinutes} min
                                            </Typography>
                                            {hasKernel && (
                                              <MuiTooltip title={t('updates.rebootRequired')}>
                                                <i className="ri-restart-line" style={{ fontSize: 14, color: '#ff9800' }} />
                                              </MuiTooltip>
                                            )}
                                          </Box>
                                        )}
                                      </TableCell>
                                      <TableCell align="center">
                                        {node.status === 'online' ? (
                                          <Chip 
                                            size="small" 
                                            label={t('updates.online')} 
                                            color="success" 
                                            icon={<i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                            sx={{ height: 24 }}
                                          />
                                        ) : (
                                          <Chip 
                                            size="small" 
                                            label={t('updates.offline')} 
                                            color="error"
                                            icon={<i className="ri-close-circle-fill" style={{ fontSize: 14 }} />}
                                            sx={{ height: 24 }}
                                          />
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  )
                                })}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </CardContent>
                      </Card>

                      {/* Résumé */}
                      {Object.keys(nodeUpdates).length > 0 && (
                        (() => {
                          // Calculer le temps total pour tous les nœuds
                          let totalMinutes = 0
                          let nodesWithUpdates = 0
                          let totalReboots = 0
                          
                          data.nodesData?.forEach((node: any) => {
                            const nodeUpdate = nodeUpdates[node.node]
                            if (nodeUpdate && nodeUpdate.count > 0) {
                              nodesWithUpdates++
                              const hasKernel = nodeUpdate.updates?.some((u: any) => 
                                (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                                (u.Package || u.package || '').toLowerCase().includes('linux-image') ||
                                (u.Package || u.package || '').toLowerCase().includes('pve-kernel')
                              )
                              if (hasKernel) totalReboots++
                              const vmCount = node.vms || 0
                              
                              // Estimation réaliste par nœud:
                              // - Évacuation VMs: 2min + 30s par VM
                              // - Mode maintenance HA + flags Ceph: 2min
                              // - Téléchargement paquets: 2min
                              // - Installation: 5min + 3s par paquet
                              // - Redémarrage si kernel: 5min
                              // - Retour nœud + vérifs: 2min
                              // - Suppression flags + sortie maintenance: 1min
                              // - Vérification santé Ceph: 3min
                              // - Buffer sécurité: 2min
                              totalMinutes += Math.ceil(
                                2 + Math.ceil(vmCount * 0.5) +  // Évacuation VMs
                                2 +                             // Maintenance + flags Ceph
                                2 +                             // Téléchargement
                                5 + Math.ceil(nodeUpdate.count * 3 / 60) + // Installation
                                (hasKernel ? 5 : 0) +           // Redémarrage
                                2 +                             // Retour nœud
                                1 +                             // Sortie maintenance
                                3 +                             // Check santé Ceph
                                2                               // Buffer sécurité
                              )
                            }
                          })
                          
                          const totalUpdates = (Object.values(nodeUpdates) as any[]).reduce((sum: number, n: any) => sum + n.count, 0)
                          const hasUpdates = totalUpdates > 0
                          
                          // Formater le temps total
                          const formatTime = (minutes: number) => {
                            if (minutes < 60) return `~${minutes} min`
                            const hours = Math.floor(minutes / 60)
                            const mins = minutes % 60
                            return mins > 0 ? `~${hours}h ${mins}min` : `~${hours}h`
                          }
                          
                          return (
                            <Alert 
                              severity={hasUpdates ? 'warning' : 'success'}
                              icon={hasUpdates ? <i className="ri-error-warning-line" /> : <i className="ri-checkbox-circle-line" />}
                            >
                              <Box>
                                <Typography variant="body2" fontWeight={600}>
                                  {t('updates.summaryUpdates', { 
                                    count: totalUpdates,
                                    nodes: nodesWithUpdates 
                                  })}
                                </Typography>
                                {hasUpdates && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <i className="ri-time-line" style={{ fontSize: 14 }} />
                                      <Typography variant="caption">
                                        {t('updates.totalEstimatedTime')}: {formatTime(totalMinutes)}
                                      </Typography>
                                    </Box>
                                    {totalReboots > 0 && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <i className="ri-restart-line" style={{ fontSize: 14, color: '#ff9800' }} />
                                        <Typography variant="caption">
                                          {t('updates.rebootsRequired', { count: totalReboots })}
                                        </Typography>
                                      </Box>
                                    )}
                                  </Box>
                                )}
                              </Box>
                            </Alert>
                          )
                        })()
                      )}

                      {/* Bouton démarrer le Rolling Update */}
                      {(Object.values(nodeUpdates) as any[]).reduce((sum: number, n: any) => sum + n.count, 0) > 0 ? (
                        <Button
                          variant="contained"
                          color="warning"
                          size="large"
                          startIcon={<i className="ri-play-circle-line" style={{ fontSize: 20 }} />}
                          onClick={() => setRollingUpdateWizardOpen(true)}
                          sx={{ alignSelf: 'flex-start' }}
                        >
                          {t('updates.startRollingUpdate')}
                        </Button>
                      ) : Object.keys(nodeUpdates).length > 0 ? (
                        <Alert severity="success" icon={<i className="ri-checkbox-circle-line" />}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('updates.upToDate')}
                          </Typography>
                        </Alert>
                      ) : null}
                    </Stack>

                    {/* Rolling Update Wizard */}
                    <RollingUpdateWizard
                      open={rollingUpdateWizardOpen}
                      onClose={() => setRollingUpdateWizardOpen(false)}
                      connectionId={selection?.type === 'cluster' ? selection.id : ''}
                      nodes={data.nodesData?.map((n: any) => ({
                        node: n.node,
                        version: nodeUpdates[n.node]?.version || '',
                        vms: n.vms || 0,
                        status: n.status,
                      })) || []}
                      nodeUpdates={nodeUpdates}
                    />

                    {/* Dialog pour afficher les mises à jour */}
                    <Dialog 
                      open={updatesDialogOpen} 
                      onClose={() => setUpdatesDialogOpen(false)}
                      maxWidth="md"
                      fullWidth
                    >
                      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-download-cloud-line" style={{ fontSize: 24, color: '#ff9800' }} />
                        {t('updates.updatesOn', { node: updatesDialogNode })}
                      </DialogTitle>
                      <DialogContent>
                        {updatesDialogNode && nodeUpdates[updatesDialogNode]?.updates?.length > 0 ? (
                          <>
                            {/* Résumé avec détection kernel */}
                            {(() => {
                              const updates = nodeUpdates[updatesDialogNode]?.updates || []
                              const hasKernelUpdate = updates.some((u: any) => 
                                (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                                (u.Package || u.package || '').toLowerCase().includes('linux-image')
                              )
                              return (
                                <Alert 
                                  severity={hasKernelUpdate ? 'warning' : 'info'} 
                                  sx={{ mb: 2 }}
                                  icon={hasKernelUpdate ? <i className="ri-restart-line" style={{ fontSize: 20 }} /> : <i className="ri-information-line" style={{ fontSize: 20 }} />}
                                >
                                  <Box>
                                    <Typography variant="body2" fontWeight={600}>
                                      {updates.length} {t('updates.packagesToUpdate')}
                                    </Typography>
                                    {hasKernelUpdate && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                                        <i className="ri-error-warning-line" style={{ fontSize: 14 }} />
                                        <Typography variant="caption">
                                          {t('updates.rebootRequiredKernel')}
                                        </Typography>
                                      </Box>
                                    )}
                                  </Box>
                                </Alert>
                              )
                            })()}

                            {/* Liste des paquets */}
                            <Box sx={{ 
                              maxHeight: 350, 
                              overflow: 'auto', 
                              border: '1px solid', 
                              borderColor: 'divider', 
                              borderRadius: 1
                            }}>
                              {/* Header */}
                              <Box sx={{ 
                                display: 'grid', 
                                gridTemplateColumns: '1fr 140px 140px',
                                gap: 1,
                                px: 1.5,
                                py: 0.75,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1
                              }}>
                                <Typography variant="caption" fontWeight={600}>{t('updates.package')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.currentVersion')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.newVersion')}</Typography>
                              </Box>
                              {/* Rows */}
                              {nodeUpdates[updatesDialogNode]?.updates.map((upd: any, idx: number) => {
                                const pkgName = upd.Package || upd.package || ''
                                const isKernel = pkgName.toLowerCase().includes('kernel') || pkgName.toLowerCase().includes('linux-image')
                                return (
                                  <Box 
                                    key={idx}
                                    sx={{ 
                                      display: 'grid', 
                                      gridTemplateColumns: '1fr 140px 140px',
                                      gap: 1,
                                      px: 1.5,
                                      py: 0.5,
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      '&:last-child': { borderBottom: 'none' },
                                      '&:hover': { bgcolor: 'action.hover' },
                                      bgcolor: isKernel ? 'rgba(255, 152, 0, 0.1)' : 'transparent'
                                    }}
                                  >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                      {isKernel && (
                                        <i className="ri-restart-line" style={{ fontSize: 12, color: '#ff9800', flexShrink: 0 }} />
                                      )}
                                      <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                                        {pkgName}
                                      </Typography>
                                    </Box>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {upd.OldVersion || upd.old_version || '—'}
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'success.main', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {upd.Version || upd.version || upd.new_version || '—'}
                                    </Typography>
                                  </Box>
                                )
                              })}
                            </Box>
                          </>
                        ) : (
                          <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('updates.upToDate')}</Typography>
                        )}
                      </DialogContent>
                      <DialogActions>
                        <Button onClick={() => setUpdatesDialogOpen(false)}>{t('updates.close')}</Button>
                      </DialogActions>
                    </Dialog>

                    {/* Dialog pour afficher les VMs avec stockage local */}
                    <Dialog 
                      open={localVmsDialogOpen} 
                      onClose={() => setLocalVmsDialogOpen(false)}
                      maxWidth="md"
                      fullWidth
                    >
                      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 24, color: '#f44336' }} />
                        {t('updates.localVmsOn', { node: localVmsDialogNode })}
                      </DialogTitle>
                      <DialogContent>
                        {localVmsDialogNode && nodeLocalVms[localVmsDialogNode]?.vms?.length > 0 ? (
                          <>
                            {/* Résumé */}
                            <Alert 
                              severity={nodeLocalVms[localVmsDialogNode]?.canMigrate ? 'warning' : 'error'} 
                              sx={{ mb: 2 }}
                              icon={<i className="ri-error-warning-line" style={{ fontSize: 20 }} />}
                            >
                              <Box>
                                <Typography variant="body2" fontWeight={600}>
                                  {nodeLocalVms[localVmsDialogNode]?.total} VM(s) {t('updates.withLocalStorage')}
                                </Typography>
                                {nodeLocalVms[localVmsDialogNode]?.blockingMigration > 0 && (
                                  <Box sx={{ mt: 0.5 }}>
                                    <Typography variant="caption" sx={{ display: 'block', color: 'error.light' }}>
                                      <i className="ri-close-circle-fill" style={{ fontSize: 12, marginRight: 4 }} />
                                      {nodeLocalVms[localVmsDialogNode]?.blockingMigration} VM(s) {t('updates.cannotMigrateLive')}
                                    </Typography>
                                  </Box>
                                )}
                                {nodeLocalVms[localVmsDialogNode]?.withReplication > 0 && (
                                  <Typography variant="caption" sx={{ display: 'block', color: 'success.light' }}>
                                    <i className="ri-checkbox-circle-fill" style={{ fontSize: 12, marginRight: 4 }} />
                                    {nodeLocalVms[localVmsDialogNode]?.withReplication} VM(s) {t('updates.withReplication')}
                                  </Typography>
                                )}
                              </Box>
                            </Alert>

                            {/* Stratégies possibles */}
                            {nodeLocalVms[localVmsDialogNode]?.blockingMigration > 0 && (
                              <Alert severity="info" sx={{ mb: 2 }} icon={<i className="ri-lightbulb-line" style={{ fontSize: 20 }} />}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                                  {t('updates.migrationStrategies')}
                                </Typography>
                                <Box component="ul" sx={{ m: 0, pl: 2, '& li': { mb: 0.25 } }}>
                                  <li><Typography variant="caption">{t('updates.strategyShutdown')}</Typography></li>
                                  <li><Typography variant="caption">{t('updates.strategyMoveStorage')}</Typography></li>
                                  <li><Typography variant="caption">{t('updates.strategyReplication')}</Typography></li>
                                  <li><Typography variant="caption">{t('updates.strategyAcceptDowntime')}</Typography></li>
                                </Box>
                              </Alert>
                            )}

                            {/* Liste des VMs */}
                            <Box sx={{ 
                              maxHeight: 300, 
                              overflow: 'auto', 
                              border: '1px solid', 
                              borderColor: 'divider', 
                              borderRadius: 1
                            }}>
                              {/* Header */}
                              <Box sx={{ 
                                display: 'grid', 
                                gridTemplateColumns: '80px 1fr 1fr 100px',
                                gap: 1,
                                px: 1.5,
                                py: 0.75,
                                bgcolor: 'action.hover',
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1
                              }}>
                                <Typography variant="caption" fontWeight={600}>VMID</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.vmName')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.localDisks')}</Typography>
                                <Typography variant="caption" fontWeight={600}>{t('updates.status')}</Typography>
                              </Box>
                              {/* Rows */}
                              {nodeLocalVms[localVmsDialogNode]?.vms.map((vm: any) => (
                                <Box 
                                  key={vm.vmid}
                                  sx={{ 
                                    display: 'grid', 
                                    gridTemplateColumns: '80px 1fr 1fr 100px',
                                    gap: 1,
                                    px: 1.5,
                                    py: 0.5,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    '&:last-child': { borderBottom: 'none' },
                                    '&:hover': { bgcolor: 'action.hover' },
                                    bgcolor: vm.status === 'running' && !vm.hasReplication ? 'rgba(244, 67, 54, 0.1)' : 'transparent'
                                  }}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <i className={vm.type === 'qemu' ? 'ri-computer-line' : 'ri-instance-line'} style={{ fontSize: 14, opacity: 0.7 }} />
                                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
                                      {vm.vmid}
                                    </Typography>
                                  </Box>
                                  <Typography variant="body2" sx={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {vm.name}
                                  </Typography>
                                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                                    {vm.localDisks?.map((disk: string, idx: number) => (
                                      <Chip 
                                        key={idx}
                                        size="small" 
                                        label={disk} 
                                        sx={{ height: 18, fontSize: 10 }}
                                      />
                                    ))}
                                  </Box>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    {vm.status === 'running' ? (
                                      <Chip 
                                        size="small" 
                                        label={vm.hasReplication ? t('updates.replicationOk') : t('updates.running')}
                                        color={vm.hasReplication ? 'success' : 'error'}
                                        icon={vm.hasReplication ? <i className="ri-checkbox-circle-fill" style={{ fontSize: 12 }} /> : <i className="ri-error-warning-fill" style={{ fontSize: 12 }} />}
                                        sx={{ height: 20, fontSize: 10 }}
                                      />
                                    ) : (
                                      <Chip 
                                        size="small" 
                                        label={t('updates.stopped')}
                                        color="default"
                                        sx={{ height: 20, fontSize: 10 }}
                                      />
                                    )}
                                  </Box>
                                </Box>
                              ))}
                            </Box>
                          </>
                        ) : (
                          <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('updates.noLocalVms')}</Typography>
                        )}
                      </DialogContent>
                      <DialogActions>
                        <Button onClick={() => setLocalVmsDialogOpen(false)}>{t('updates.close')}</Button>
                      </DialogActions>
                    </Dialog>
                  </Box>
                )}

                {/* Onglet CVE - Index 11 */}
                {clusterTab === 11 && (
                  <Box sx={{ p: 2, overflow: 'auto' }}>
                    <CveTab connectionId={selection?.id?.split(':')[0] || ''} available={cveAvailable} />
                  </Box>
                )}

                {/* Onglet Cluster - Index 12 */}
                {clusterTab === 12 && (
                  <Box sx={{ p: 2 }}>
                    {clusterConfigLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={3}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-information-line" style={{ fontSize: 20 }} />
                            Cluster Information
                          </Typography>
                          <Stack direction="row" spacing={1}>
                            {clusterConfig?.isCluster && (
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<i className="ri-key-line" />}
                                onClick={() => setJoinInfoDialogOpen(true)}
                              >
                                Join Information
                              </Button>
                            )}
                          </Stack>
                        </Box>

                        {/* Info Cluster ou Standalone */}
                        <Card variant="outlined">
                          <CardContent>
                            {clusterConfig?.isCluster ? (
                              <>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                                  <Chip 
                                    icon={<i className="ri-checkbox-circle-fill" />}
                                    label="Cluster Active" 
                                    color="success" 
                                    size="small"
                                  />
                                  <Typography variant="h6" fontWeight={700}>
                                    {clusterConfig?.clusterName || 'Unnamed Cluster'}
                                  </Typography>
                                </Box>
                                {clusterConfig?.clusterStatus && (
                                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>Config Version</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        {clusterConfig.clusterStatus.version || '—'}
                                      </Typography>
                                    </Box>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>Quorum</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        <Chip 
                                          size="small" 
                                          label={clusterConfig.clusterStatus.quorate ? 'Yes' : 'No'} 
                                          color={clusterConfig.clusterStatus.quorate ? 'success' : 'error'}
                                          sx={{ height: 20, fontSize: 11 }}
                                        />
                                      </Typography>
                                    </Box>
                                    <Box>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>Nodes</Typography>
                                      <Typography variant="body2" fontWeight={600}>
                                        {clusterConfig.clusterStatus.nodes || clusterConfig?.nodes?.length || 0}
                                      </Typography>
                                    </Box>
                                  </Box>
                                )}
                              </>
                            ) : (
                              <Box sx={{ textAlign: 'center', py: 2 }}>
                                <i className="ri-server-line" style={{ fontSize: 48, opacity: 0.3 }} />
                                <Typography variant="body1" sx={{ mt: 1, fontWeight: 600 }}>
                                  Standalone node - no cluster defined
                                </Typography>
                                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                  Create a new cluster or join an existing one
                                </Typography>
                                <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 3 }}>
                                  <Button
                                    variant="contained"
                                    startIcon={<i className="ri-add-circle-line" />}
                                    onClick={() => setCreateClusterDialogOpen(true)}
                                  >
                                    Create Cluster
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    startIcon={<i className="ri-links-line" />}
                                    onClick={() => setJoinClusterDialogOpen(true)}
                                  >
                                    Join Cluster
                                  </Button>
                                </Stack>
                              </Box>
                            )}
                          </CardContent>
                        </Card>

                        {/* Liste des Cluster Nodes */}
                        {clusterConfig?.nodes && clusterConfig.nodes.length > 0 && (
                          <Card variant="outlined">
                            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                                <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-server-line" style={{ fontSize: 18 }} />
                                  Cluster Nodes
                                </Typography>
                              </Box>
                              <Box>
                                {/* Header */}
                                <Box sx={{
                                  display: 'grid',
                                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                                  gap: 2,
                                  px: 2,
                                  py: 1,
                                  bgcolor: 'action.hover',
                                  borderBottom: '1px solid',
                                  borderColor: 'divider'
                                }}>
                                  <Typography variant="caption" fontWeight={600}>Nodename</Typography>
                                  <Typography variant="caption" fontWeight={600}>ID</Typography>
                                  <Typography variant="caption" fontWeight={600}>Status</Typography>
                                  <Typography variant="caption" fontWeight={600}>Votes</Typography>
                                  <Typography variant="caption" fontWeight={600}>IP Address</Typography>
                                </Box>
                                {/* Rows */}
                                {clusterConfig.nodes.map((node: any) => (
                                  <Box
                                    key={node.name}
                                    sx={{
                                      display: 'grid',
                                      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
                                      gap: 2,
                                      px: 2,
                                      py: 1.5,
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      '&:last-child': { borderBottom: 'none' },
                                      '&:hover': { bgcolor: 'action.hover' },
                                      bgcolor: node.local ? 'action.selected' : 'transparent'
                                    }}
                                  >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Box
                                        sx={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: '50%',
                                          bgcolor: node.maintenance ? 'warning.main' : node.online ? 'success.main' : 'error.main'
                                        }}
                                      />
                                      <Typography variant="body2" fontWeight={node.local ? 700 : 400}>
                                        {node.name}
                                        {node.local && <Chip size="small" label="local" sx={{ ml: 1, height: 16, fontSize: 9 }} />}
                                      </Typography>
                                    </Box>
                                    <Typography variant="body2">{node.id}</Typography>
                                    <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center' }}>
                                      {node.maintenance ? (
                                        <i className="ri-tools-fill" style={{ fontSize: 16, color: '#ff9800' }} />
                                      ) : node.online ? (
                                        <Chip size="small" color="success" label="UP" sx={{ height: 20, fontSize: '0.7rem' }} />
                                      ) : (
                                        <Chip size="small" color="error" label="DOWN" sx={{ height: 20, fontSize: '0.7rem' }} />
                                      )}
                                    </Typography>
                                    <Typography variant="body2">1</Typography>
                                    <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                      {node.ip || '—'}
                                    </Typography>
                                  </Box>
                                ))}
                              </Box>
                            </CardContent>
                          </Card>
                        )}
                      </Stack>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          ) : null}

          {/* Dialog Join Information */}
          <Dialog open={joinInfoDialogOpen} onClose={() => setJoinInfoDialogOpen(false)} maxWidth="md" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-key-line" style={{ color: '#2196f3' }} />
              Cluster Join Information
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Copy the Join Information here and use it on the node you want to add.
              </Typography>
              {clusterConfig?.joinInfo && (
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>IP Address:</Typography>
                    <Box sx={{ 
                      mt: 0.5, 
                      p: 1.5, 
                      bgcolor: 'action.hover', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: 14 
                    }}>
                      {clusterConfig.joinInfo.ipAddress || '—'}
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>Fingerprint:</Typography>
                    <Box sx={{ 
                      mt: 0.5, 
                      p: 1.5, 
                      bgcolor: 'action.hover', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: 12,
                      wordBreak: 'break-all'
                    }}>
                      {clusterConfig.joinInfo.fingerprint || '—'}
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" fontWeight={600} sx={{ color: 'text.secondary' }}>Join Information:</Typography>
                    <Box sx={{ 
                      mt: 0.5, 
                      p: 1.5, 
                      bgcolor: 'grey.900', 
                      borderRadius: 1, 
                      fontFamily: 'monospace',
                      fontSize: 11,
                      wordBreak: 'break-all',
                      color: 'grey.300',
                      maxHeight: 120,
                      overflow: 'auto'
                    }}>
                      {clusterConfig.joinInfo.encoded || '—'}
                    </Box>
                  </Box>
                </Stack>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                variant="contained"
                startIcon={<i className="ri-file-copy-line" />}
                onClick={() => {
                  navigator.clipboard.writeText(clusterConfig?.joinInfo?.encoded || '')
                }}
              >
                Copy Information
              </Button>
              <Button onClick={() => setJoinInfoDialogOpen(false)}>
                {t('common.close')}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Dialog Create Cluster */}
          <Dialog open={createClusterDialogOpen} onClose={() => setCreateClusterDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-add-circle-line" style={{ color: '#4caf50' }} />
              Create Cluster
            </DialogTitle>
            <DialogContent>
              {clusterActionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setClusterActionError(null)}>
                  {clusterActionError}
                </Alert>
              )}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <TextField
                  label="Cluster Name"
                  value={newClusterName}
                  onChange={(e) => setNewClusterName(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  placeholder="my-cluster"
                />
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Cluster Network</Typography>
                  {clusterConfig?.networks && clusterConfig.networks.length > 0 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel>Link 0</InputLabel>
                      <Select
                        value={newClusterLinks[0]?.address || ''}
                        onChange={(e) => setNewClusterLinks([{ linkNumber: 0, address: e.target.value }])}
                        label="Link 0"
                      >
                        {clusterConfig.networks.map((net: any) => (
                          <MenuItem key={net.iface} value={net.address}>
                            {net.cidr} - {net.iface} {net.comments && `(${net.comments})`}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      No network interfaces available
                    </Typography>
                  )}
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCreateClusterDialogOpen(false)} disabled={clusterActionLoading}>
                {t('common.cancel')}
              </Button>
              <Button 
                variant="contained" 
                onClick={() => handleCreateCluster(selection?.id?.split(':')[0] || '')}
                disabled={clusterActionLoading || !newClusterName}
              >
                {clusterActionLoading ? <CircularProgress size={20} /> : 'Create'}
              </Button>
            </DialogActions>
          </Dialog>

          {/* Dialog Join Cluster */}
          <Dialog open={joinClusterDialogOpen} onClose={() => setJoinClusterDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-links-line" style={{ color: '#2196f3' }} />
              Cluster Join
            </DialogTitle>
            <DialogContent>
              {clusterActionError && (
                <Alert severity="error" sx={{ mb: 2 }} onClose={() => setClusterActionError(null)}>
                  {clusterActionError}
                </Alert>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-checkbox-circle-line" style={{ color: '#4caf50' }} />
                <Typography variant="body2">
                  Assisted join: Paste encoded cluster join information and enter password.
                </Typography>
              </Box>
              <Stack spacing={2}>
                <TextField
                  label="Information"
                  value={joinClusterInfo}
                  onChange={(e) => setJoinClusterInfo(e.target.value)}
                  size="small"
                  fullWidth
                  multiline
                  rows={4}
                  placeholder="Paste encoded Cluster Information here"
                  required
                />
                <TextField
                  label="Password"
                  type="password"
                  value={joinClusterPassword}
                  onChange={(e) => setJoinClusterPassword(e.target.value)}
                  size="small"
                  fullWidth
                  required
                  helperText="Root password of the node to join"
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setJoinClusterDialogOpen(false)} disabled={clusterActionLoading}>
                {t('common.cancel')}
              </Button>
              <Button 
                variant="contained" 
                onClick={() => handleJoinCluster(selection?.id?.split(':')[0] || '')}
                disabled={clusterActionLoading || !joinClusterInfo || !joinClusterPassword}
              >
                {clusterActionLoading ? <CircularProgress size={20} /> : 'Join'}
              </Button>
            </DialogActions>
          </Dialog>
    </>
  )
}
