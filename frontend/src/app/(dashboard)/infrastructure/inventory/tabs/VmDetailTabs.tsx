'use client'

import React from 'react'
import { useTranslations, useLocale } from 'next-intl'
import dynamic from 'next/dynamic'

import {
  Alert,
  Box,
  Breadcrumbs,
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
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
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
import { formatDateTime } from '@/lib/i18n/date'
import VmFirewallTab from '@/components/VmFirewallTab'
import { useLicense, Features } from '@/contexts/LicenseContext'
const AddDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddDiskDialog })), { ssr: false })
const AddNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.AddNetworkDialog })), { ssr: false })
const EditDiskDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditDiskDialog })), { ssr: false })
const EditNetworkDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditNetworkDialog })), { ssr: false })
const EditScsiControllerDialog = dynamic(() => import('@/components/HardwareModals').then(mod => ({ default: mod.EditScsiControllerDialog })), { ssr: false })

import type { InventorySelection, DetailsPayload, RrdTimeframe, SeriesPoint, Status } from '../types'
import { formatBps, formatTime, formatUptime, parseMarkdown, parseNodeId, parseVmId, cpuPct, pct, buildSeriesFromRrd, fetchRrd, tagColor } from '../helpers'
import { AreaPctChart, AreaBpsChart2 } from '../components/RrdCharts'
import VCenterSummary from '../components/VCenterSummary'
import { SaveIcon, AddIcon, CloseIcon } from '../components/IconWrappers'

export default function VmDetailTabs(props: any) {
  const t = useTranslations()
  const locale = useLocale()

  const {
    addCephReplicationDialogOpen,
    addReplicationDialogOpen,
    availableTargetNodes,
    backToArchives,
    backToBackupsList,
    backups,
    backupsError,
    backupsLoading,
    backupsStats,
    backupsWarnings,
    balloon,
    balloonEnabled,
    browseArchive,
    canPreview,
    canShowRrd,
    cephClusters,
    cephClustersLoading,
    cephReplicationJobs,
    cephReplicationSchedule,
    compatibleStorages,
    cpuCores,
    cpuLimit,
    cpuLimitEnabled,
    cpuModified,
    cpuSockets,
    cpuType,
    createSnapshot,
    data,
    deleteReplicationId,
    deleteSnapshot,
    detailTab,
    downloadFile,
    error,
    exploreWithPveStorage,
    explorerArchive,
    explorerArchives,
    explorerError,
    explorerFiles,
    explorerLoading,
    explorerMode,
    explorerPath,
    explorerSearch,
    filteredExplorerFiles,
    haComment,
    haConfig,
    haEditing,
    haError,
    haGroup,
    haGroups,
    haLoading,
    haMaxRelocate,
    haMaxRestart,
    haSaving,
    haState,
    loadBackupContent,
    loadBackupContentViaPbs,
    loadHaConfig,
    loadNotes,
    loadTasks,
    loading,
    localTags,
    memory,
    memoryModified,
    navigateToBreadcrumb,
    navigateToFolder,
    navigateUp,
    newSnapshotDesc,
    newSnapshotName,
    newSnapshotRam,
    notesEditing,
    notesError,
    notesLoading,
    notesSaving,
    previewFile,
    primaryColor,
    primaryColorLight,
    removeHaConfig,
    replicationComment,
    replicationJobs,
    replicationLoading,
    replicationRateLimit,
    replicationSchedule,
    replicationTargetNode,
    rollbackSnapshot,
    rrdError,
    rrdLoading,
    saveCpuConfig,
    saveHaConfig,
    saveMemoryConfig,
    saveNotes,
    savingCpu,
    savingMemory,
    savingReplication,
    selectedBackup,
    selectedCephCluster,
    selectedPveStorage,
    selectedVmIsCluster,
    selection,
    series,
    setAddCephReplicationDialogOpen,
    setAddDiskDialogOpen,
    setAddNetworkDialogOpen,
    setAddReplicationDialogOpen,
    setBackupCompress,
    setBackupMode,
    setBackupNote,
    setBackupStorage,
    setBackupStorages,
    setBalloon,
    setBalloonEnabled,
    setCephClusters,
    setCephReplicationSchedule,
    setCpuCores,
    setCpuLimit,
    setCpuLimitEnabled,
    setCpuSockets,
    setCpuType,
    setCreateBackupDialogOpen,
    setDeleteReplicationId,
    setDetailTab,
    setEditDiskDialogOpen,
    setEditNetworkDialogOpen,
    setEditOptionDialog,
    setEditScsiControllerDialogOpen,
    setExplorerArchive,
    setExplorerArchives,
    setExplorerFiles,
    setExplorerSearch,
    setHaComment,
    setHaEditing,
    setHaGroup,
    setHaMaxRelocate,
    setHaMaxRestart,
    setHaState,
    setMemory,
    setNewSnapshotDesc,
    setNewSnapshotName,
    setNewSnapshotRam,
    setNotesEditing,
    setReplicationComment,
    setReplicationLoaded,
    setReplicationRateLimit,
    setReplicationSchedule,
    setReplicationTargetNode,
    setSavingReplication,
    setSelectedBackup,
    setSelectedCephCluster,
    setSelectedDisk,
    setSelectedNetwork,
    setSelectedPveStorage,
    setShowCreateSnapshot,
    setTasksLoaded,
    setTf,
    setVmNotes,
    showCreateSnapshot,
    snapshotActionBusy,
    snapshots,
    snapshotsError,
    snapshotsLoading,
    sourceCephAvailable,
    tags,
    tasks,
    tasksError,
    tasksLoading,
    tf,
    vmNotes,
  } = props

  return (
    <>
          {/* Onglets pour VMs: Résumé / Matériel / Options / Historique / Sauvegardes / Snapshots / Notes / HA */}
          {selection?.type === 'vm' && (
            <>
              <Tabs
                value={detailTab}
                onChange={(_e, v) => setDetailTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider' }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-dashboard-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.summary')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-cpu-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.hardware')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-settings-3-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.options')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-history-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.history')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.backups')}
                      {backupsStats?.total > 0 && (
                        <Chip size="small" label={backupsStats.total} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-camera-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.snapshots')}
                      {snapshots.length > 0 && (
                        <Chip size="small" label={snapshots.length} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-sticky-note-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.notes')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-repeat-line" style={{ fontSize: 16 }} />
                      {t('replication.title')}
                      {replicationJobs.length > 0 && (
                        <Chip size="small" label={replicationJobs.length} sx={{ height: 18, fontSize: 11, ml: 0.5 }} />
                      )}
                    </Box>
                  }
                />
                {selectedVmIsCluster && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-shield-check-line" style={{ fontSize: 16 }} />
                        {t('inventory.tabs.ha')}
                      </Box>
                    }
                  />
                )}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabs.firewall')}
                    </Box>
                  }
                />
              </Tabs>

              {/* ==================== ONGLET 0 - RÉSUMÉ ==================== */}
              {detailTab === 0 && (
                <Box sx={{ py: 2 }}>
                  {/* Graphiques de performances (RRD) - dans le résumé */}
                  {canShowRrd && (
                    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
                      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                          <Typography fontWeight={700} fontSize={14}>
                            <i className="ri-line-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                            {t('inventory.performances')}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            {[
                              { label: '1h', value: 'hour' as RrdTimeframe },
                              { label: '24h', value: 'day' as RrdTimeframe },
                              { label: t('inventory.rrd7d'), value: 'week' as RrdTimeframe },
                              { label: t('inventory.rrd30d'), value: 'month' as RrdTimeframe },
                              { label: t('inventory.rrd1y'), value: 'year' as RrdTimeframe },
                            ].map(opt => (
                              <Chip
                                key={opt.value}
                                label={opt.label}
                                size="small"
                                onClick={() => setTf(opt.value)}
                                sx={{
                                  height: 24,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  bgcolor: tf === opt.value ? 'primary.main' : 'action.hover',
                                  color: tf === opt.value ? 'primary.contrastText' : 'text.secondary',
                                  '&:hover': { bgcolor: tf === opt.value ? 'primary.dark' : 'action.selected' },
                                  cursor: 'pointer',
                                }}
                              />
                            ))}
                          </Box>
                        </Box>

                        {rrdLoading ? <LinearProgress sx={{ mb: 2 }} /> : null}
                        {rrdError ? (
                          <Alert severity="warning" sx={{ mb: 2 }}>
                            RRD: {rrdError}
                          </Alert>
                        ) : null}

                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                          {/* CPU Usage */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              {t('inventory.cpuUsage')}
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'CPU']}
                                  />
                                  <Area type="monotone" dataKey="cpuPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>

                          {/* Memory Usage */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              {t('inventory.memoryUsage')}
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any) => [`${Number(v).toFixed(1)}%`, 'Memory']}
                                  />
                                  <Area type="monotone" dataKey="ramPct" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>

                          {/* Network Traffic */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              {t('inventoryPage.networkTraffic')}
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any, name: string) => [formatBps(Number(v)), name === 'netInBps' ? 'In' : 'Out']}
                                  />
                                  <Area type="monotone" dataKey="netInBps" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netInBps" connectNulls />
                                  <Area type="monotone" dataKey="netOutBps" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="netOutBps" connectNulls />
                                </AreaChart>
                              </ResponsiveContainer>
                            </Box>
                          </Box>

                          {/* Disk I/O (VMs) */}
                          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                              {t('inventory.diskIo')}
                            </Typography>
                            <Box sx={{ height: 160 }}>
                              <ResponsiveContainer width="100%" height="100%">
                                {(
                                  <AreaChart data={series}>
                                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                    <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={50} domain={[0, 'auto']} />
                                    <Tooltip
                                      labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                      formatter={(v: any, name: string) => [formatBps(Number(v)), name === 'diskReadBps' ? 'Read' : 'Write']}
                                    />
                                    <Area type="monotone" dataKey="diskReadBps" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="diskReadBps" connectNulls />
                                    <Area type="monotone" dataKey="diskWriteBps" stroke={primaryColorLight} fill={primaryColorLight} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} name="diskWriteBps" connectNulls />
                                  </AreaChart>
                                )}
                              </ResponsiveContainer>
                            </Box>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 1 - MATÉRIEL ==================== */}
              {detailTab === 1 && (
                <Box sx={{ py: 2 }}>
                  {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress />
                    </Box>
                  ) : (
                    <Stack spacing={2}>
                      {/* Ligne 1: CPU et RAM côte à côte */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
                        {/* CPU */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                              <i className="ri-cpu-line" style={{ fontSize: 20 }} />
                              {t('inventory.processor')}
                            </Typography>
                          
                          {/* Avertissement si config CPU en attente de reboot */}
                          {data?.cpuInfo?.pending && (
                            <Alert 
                              severity="warning" 
                              sx={{ mb: 2 }}
                              icon={<i className="ri-restart-line" style={{ fontSize: 20 }} />}
                            >
                              <Typography variant="body2" fontWeight={600}>
                                {t('inventory.pendingRestart')}
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
                                {data.cpuInfo.pending.sockets !== undefined && `Sockets: ${data.cpuInfo.sockets} → ${data.cpuInfo.pending.sockets}`}
                                {data.cpuInfo.pending.sockets !== undefined && data.cpuInfo.pending.cores !== undefined && ' • '}
                                {data.cpuInfo.pending.cores !== undefined && `Cores: ${data.cpuInfo.cores} → ${data.cpuInfo.pending.cores}`}
                                {(data.cpuInfo.pending.sockets !== undefined || data.cpuInfo.pending.cores !== undefined) && data.cpuInfo.pending.cpu !== undefined && ' • '}
                                {data.cpuInfo.pending.cpu !== undefined && `Type: ${data.cpuInfo.pending.cpu}`}
                              </Typography>
                            </Alert>
                          )}
                          
                          {/* Sockets Slider */}
                          <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2" fontWeight={600}>{t('inventory.sockets')}</Typography>
                              <TextField
                                size="small"
                                type="number"
                                value={cpuSockets}
                                onChange={(e) => setCpuSockets(Number(e.target.value))}
                                sx={{ width: 100 }}
                                inputProps={{ min: 1, max: 4 }}
                              />
                            </Box>
                            <Slider
                              value={cpuSockets}
                              onChange={(_, val) => setCpuSockets(val as number)}
                              min={1}
                              max={4}
                              step={1}
                              marks={[
                                { value: 1, label: '1' },
                                { value: 2, label: '2' },
                                { value: 3, label: '3' },
                                { value: 4, label: '4' },
                              ]}
                              valueLabelDisplay="auto"
                            />
                          </Box>

                          {/* Cores Slider */}
                          <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2" fontWeight={600}>{t('inventory.coresPerSocket')}</Typography>
                              <TextField
                                size="small"
                                type="number"
                                value={cpuCores}
                                onChange={(e) => setCpuCores(Math.max(1, Number(e.target.value)))}
                                sx={{ width: 100 }}
                                inputProps={{ min: 1 }}
                              />
                            </Box>
                            {(() => {
                              const hostCores = data.nodeCapacity?.maxCpu || 32
                              const sliderMax = Math.min(hostCores, 64) // Limiter à 64 pour le slider
                              const marks = [
                                { value: 1, label: '1' },
                                ...(sliderMax >= 8 ? [{ value: Math.floor(sliderMax / 4), label: String(Math.floor(sliderMax / 4)) }] : []),
                                ...(sliderMax >= 16 ? [{ value: Math.floor(sliderMax / 2), label: String(Math.floor(sliderMax / 2)) }] : []),
                                { value: sliderMax, label: String(sliderMax) },
                              ]
                              return (
                                <Slider
                                  value={Math.min(cpuCores, sliderMax)}
                                  onChange={(_, val) => setCpuCores(val as number)}
                                  min={1}
                                  max={sliderMax}
                                  step={1}
                                  marks={marks}
                                  valueLabelDisplay="auto"
                                />
                              )
                            })()}
                          </Box>

                          {/* CPU Type */}
                          <FormControl fullWidth sx={{ mb: 3 }}>
                            <InputLabel>{t('inventory.cpuType')}</InputLabel>
                            <Select
                              value={cpuType}
                              label={t('inventory.cpuType')}
                              onChange={(e) => setCpuType(e.target.value)}
                            >
                              <MenuItem value="host">host ({t('inventory.maxPerformance')})</MenuItem>
                              <MenuItem value="kvm64">kvm64 ({t('inventory.compatible')})</MenuItem>
                              <MenuItem value="qemu64">qemu64 ({t('inventory.emulation')})</MenuItem>
                              <MenuItem value="Broadwell">Intel Broadwell</MenuItem>
                              <MenuItem value="Haswell">Intel Haswell</MenuItem>
                              <MenuItem value="IvyBridge">Intel IvyBridge</MenuItem>
                              <MenuItem value="SandyBridge">Intel SandyBridge</MenuItem>
                              <MenuItem value="Skylake-Client">Intel Skylake</MenuItem>
                              <MenuItem value="EPYC">AMD EPYC</MenuItem>
                              <MenuItem value="Opteron_G5">AMD Opteron G5</MenuItem>
                            </Select>
                          </FormControl>

                          {/* CPU Limit (optionnel) */}
                          <Box sx={{ mb: 2 }}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={cpuLimitEnabled}
                                  onChange={(e) => setCpuLimitEnabled(e.target.checked)}
                                />
                              }
                              label={t('inventory.limitCpuUsage')}
                            />
                            {cpuLimitEnabled && (
                              <Box sx={{ mt: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="body2" fontWeight={600}>{t('inventory.cpuLimit')}</Typography>
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={cpuLimit}
                                    onChange={(e) => setCpuLimit(Number(e.target.value))}
                                    sx={{ width: 100 }}
                                    inputProps={{ min: 0, max: 128, step: 0.5 }}
                                  />
                                </Box>
                                <Slider
                                  value={cpuLimit}
                                  onChange={(_, val) => setCpuLimit(val as number)}
                                  min={0}
                                  max={128}
                                  step={0.5}
                                  valueLabelDisplay="auto"
                                />
                                <Typography variant="caption" color="text.secondary">
                                  {t('inventory.cpuLimitHint', { max: cpuSockets * cpuCores })}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          {/* Résumé */}
                          <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1, mb: 2 }}>
                            <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                              {t('inventory.totalVcpus', { count: cpuSockets * cpuCores })}
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.7 }}>
                              {t('inventory.socketsCoresBreakdown', { sockets: cpuSockets, cores: cpuCores })}
                            </Typography>
                          </Box>

                          {/* Bouton Sauvegarder */}
                          <Button
                            variant="contained"
                            fullWidth
                            disabled={savingCpu || !cpuModified}
                            onClick={saveCpuConfig}
                            startIcon={savingCpu ? <CircularProgress size={16} /> : <SaveIcon />}
                          >
                            {savingCpu ? t('common.saving') : t('inventory.saveCpuChanges')}
                          </Button>
                        </CardContent>
                      </Card>

                        {/* Mémoire */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                              <i className="ri-database-2-line" style={{ fontSize: 20 }} />
                              {t('inventory.memory')}
                            </Typography>
                          
                          {/* Avertissement si config RAM en attente de reboot */}
                          {data?.memoryInfo?.pending && (
                            <Alert 
                              severity="warning" 
                              sx={{ mb: 2 }}
                              icon={<i className="ri-restart-line" style={{ fontSize: 20 }} />}
                            >
                              <Typography variant="body2" fontWeight={600}>
                                {t('inventory.pendingRestart')}
                              </Typography>
                              <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
                                {data.memoryInfo.pending.memory !== undefined && `${t('inventoryPage.memoryLabel')} ${(data.memoryInfo.memory / 1024).toFixed(0)} GB → ${(data.memoryInfo.pending.memory / 1024).toFixed(0)} GB`}
                                {data.memoryInfo.pending.memory !== undefined && data.memoryInfo.pending.balloon !== undefined && ' • '}
                                {data.memoryInfo.pending.balloon !== undefined && `Balloon: ${((data.memoryInfo.balloon || 0) / 1024).toFixed(0)} GB → ${(data.memoryInfo.pending.balloon / 1024).toFixed(0)} GB`}
                              </Typography>
                            </Alert>
                          )}
                          
                          {/* RAM Slider */}
                          <Box sx={{ mb: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                              <Typography variant="body2" fontWeight={600}>{t('inventoryPage.memory')}</Typography>
                              <TextField
                                size="small"
                                type="number"
                                value={(memory / 1024).toFixed(0)}
                                onChange={(e) => setMemory(Math.max(512, Number(e.target.value) * 1024))}
                                InputProps={{
                                  endAdornment: <InputAdornment position="end">GB</InputAdornment>,
                                }}
                                sx={{ width: 120 }}
                                inputProps={{ min: 0.5 }}
                              />
                            </Box>
                            {(() => {
                              const hostMemGb = Math.floor((data.nodeCapacity?.maxMem || 64 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024))
                              const sliderMax = Math.min(hostMemGb, 128) // Limiter à 128 GB pour le slider
                              const step = sliderMax > 32 ? 2 : 1
                              const marks = [
                                { value: 1, label: '1 GB' },
                                ...(sliderMax >= 16 ? [{ value: Math.floor(sliderMax / 4), label: `${Math.floor(sliderMax / 4)} GB` }] : []),
                                ...(sliderMax >= 32 ? [{ value: Math.floor(sliderMax / 2), label: `${Math.floor(sliderMax / 2)} GB` }] : []),
                                { value: sliderMax, label: `${sliderMax} GB` },
                              ]
                              return (
                                <Slider
                                  value={Math.min(memory / 1024, sliderMax)}
                                  onChange={(_, val) => setMemory((val as number) * 1024)}
                                  min={1}
                                  max={sliderMax}
                                  step={step}
                                  marks={marks}
                                  valueLabelDisplay="auto"
                                  valueLabelFormat={(v) => `${v} GB`}
                                />
                              )
                            })()}
                          </Box>

                          {/* Ballooning */}
                          <Box sx={{ mb: 3 }}>
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={balloonEnabled}
                                  onChange={(e) => setBalloonEnabled(e.target.checked)}
                                />
                              }
                              label={t('inventory.enableBallooning')}
                            />
                            {balloonEnabled && (
                              <Box sx={{ mt: 2 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                  <Typography variant="body2" fontWeight={600}>{t('inventory.minMemoryBalloon')}</Typography>
                                  <TextField
                                    size="small"
                                    type="number"
                                    value={(balloon / 1024).toFixed(0)}
                                    onChange={(e) => setBalloon(Number(e.target.value) * 1024)}
                                    InputProps={{
                                      endAdornment: <InputAdornment position="end">GB</InputAdornment>,
                                    }}
                                    sx={{ width: 120 }}
                                    inputProps={{ min: 0, max: memory / 1024 }}
                                  />
                                </Box>
                                <Slider
                                  value={balloon / 1024}
                                  onChange={(_, val) => setBalloon((val as number) * 1024)}
                                  min={0}
                                  max={memory / 1024}
                                  step={1}
                                  valueLabelDisplay="auto"
                                  valueLabelFormat={(v) => `${v} GB`}
                                />
                                <Typography variant="caption" color="text.secondary">
                                  {t('inventory.balloonMinHint')}
                                </Typography>
                              </Box>
                            )}
                          </Box>

                          <Alert severity="info" sx={{ mb: 2 }}>
                            <Typography variant="caption">
                              {t('inventory.balloonInfo')}
                            </Typography>
                          </Alert>

                          {/* Bouton Sauvegarder */}
                          <Button
                            variant="contained"
                            fullWidth
                            disabled={savingMemory || !memoryModified}
                            onClick={saveMemoryConfig}
                            startIcon={savingMemory ? <CircularProgress size={16} /> : <SaveIcon />}
                          >
                            {savingMemory ? t('common.saving') : t('inventory.saveMemoryChanges')}
                          </Button>
                        </CardContent>
                      </Card>
                      </Box>

                      {/* Ligne 2: Disques et Réseau côte à côte */}
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2 }}>
                        {/* Disques */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-hard-drive-line" style={{ fontSize: 20 }} />
                                {t('inventory.disks')} ({data.disksInfo?.length || 0})
                              </Typography>
                              <Stack direction="row" spacing={1}>
                                {data.optionsInfo?.scsihw && (
                                  <MuiTooltip title={t('inventory.editScsiController')}>
                                    <Button
                                      size="small"
                                      variant="outlined"
                                    onClick={() => setEditScsiControllerDialogOpen(true)}
                                    startIcon={<i className="ri-settings-3-line" />}
                                  >
                                    {data.optionsInfo.scsihw}
                                  </Button>
                                </MuiTooltip>
                              )}
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => setAddDiskDialogOpen(true)}
                              >
                                {t('common.add')}
                              </Button>
                            </Stack>
                          </Box>
                          {data.disksInfo && data.disksInfo.length > 0 ? (
                            <List dense>
                              {data.disksInfo.map((disk: any, idx: number) => (
                                <ListItemButton
                                  key={idx}
                                  sx={{
                                    bgcolor: 'action.hover',
                                    borderRadius: 1,
                                    mb: 1,
                                    '&:last-child': { mb: 0 }
                                  }}
                                  onClick={() => {
                                    setSelectedDisk(disk)
                                    setEditDiskDialogOpen(true)
                                  }}
                                >
                                  <ListItemIcon sx={{ minWidth: 40 }}>
                                    <i className="ri-hard-drive-2-fill" style={{ fontSize: 24, opacity: 0.7 }} />
                                  </ListItemIcon>
                                  <ListItemText
                                    primary={
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" fontWeight={600}>
                                          {disk.id}
                                        </Typography>
                                        <Chip label={disk.size} size="small" sx={{ height: 20, fontSize: 11 }} />
                                      </Box>
                                    }
                                    secondary={
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                        {disk.storage} • {disk.format || 'raw'}
                                        {disk.cache && ` • Cache: ${disk.cache}`}
                                        {disk.iothread && ' • IOThread'}
                                      </Typography>
                                    }
                                  />
                                  <i className="ri-pencil-line" style={{ fontSize: 16, opacity: 0.5 }} />
                                </ListItemButton>
                              ))}
                            </List>
                          ) : (
                            <Alert severity="info">{t('common.noData')}</Alert>
                          )}
                        </CardContent>
                        </Card>

                        {/* Interfaces réseau */}
                        <Card variant="outlined" sx={{ borderRadius: 2 }}>
                          <CardContent>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-network-line" style={{ fontSize: 20 }} />
                                {t('inventory.tabs.network')} ({data.networkInfo?.length || 0})
                              </Typography>
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<AddIcon />}
                                onClick={() => setAddNetworkDialogOpen(true)}
                              >
                                {t('common.add')}
                              </Button>
                            </Box>
                            {data.networkInfo && data.networkInfo.length > 0 ? (
                              <List dense>
                                {data.networkInfo.map((net: any, idx: number) => (
                                  <ListItemButton
                                    key={idx}
                                    sx={{
                                      bgcolor: 'action.hover',
                                      borderRadius: 1,
                                      mb: 1,
                                      '&:last-child': { mb: 0 }
                                    }}
                                    onClick={() => {
                                      setSelectedNetwork({
                                        id: net.id,
                                        model: net.model,
                                        bridge: net.bridge,
                                        mac: net.macaddr,
                                        vlan: net.tag,
                                        firewall: net.firewall,
                                        linkDown: net.linkDown,
                                        rate: net.rate,
                                        mtu: net.mtu,
                                      queues: net.queues
                                    })
                                    setEditNetworkDialogOpen(true)
                                  }}
                                >
                                  <ListItemIcon sx={{ minWidth: 40 }}>
                                    <i className="ri-ethernet-fill" style={{ fontSize: 24, opacity: 0.7 }} />
                                  </ListItemIcon>
                                  <ListItemText
                                    primary={
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography variant="body2" fontWeight={600}>
                                          {net.id}
                                        </Typography>
                                        <Chip label={net.model} size="small" sx={{ height: 20, fontSize: 11 }} />
                                        {net.firewall && (
                                          <Chip
                                            icon={<i className="ri-shield-check-line" style={{ fontSize: 12 }} />}
                                            label="Firewall"
                                            size="small"
                                            color="success"
                                            sx={{ height: 20, fontSize: 11 }}
                                          />
                                        )}
                                      </Box>
                                    }
                                    secondary={
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                        Bridge: {net.bridge}
                                        {net.tag && ` • VLAN: ${net.tag}`}
                                        {net.rate && ` • Limit: ${net.rate} MB/s`}
                                        {net.macaddr && (
                                          <>
                                            <br />
                                            MAC: {net.macaddr}
                                          </>
                                        )}
                                      </Typography>
                                    }
                                  />
                                  <i className="ri-pencil-line" style={{ fontSize: 16, opacity: 0.5 }} />
                                </ListItemButton>
                              ))}
                            </List>
                          ) : (
                            <Alert severity="info">{t('common.noData')}</Alert>
                          )}
                        </CardContent>
                      </Card>
                      </Box>
                    </Stack>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 2 - OPTIONS ==================== */}
              {detailTab === 2 && (
                <Box sx={{ py: 2 }}>
                  {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress />
                    </Box>
                  ) : (
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent sx={{ p: 0 }}>
                        <Box sx={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', width: '30%' }}>{t('inventory.option')}</th>
                                <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)' }}>{t('inventory.value')}</th>
                                <th style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', width: '60px' }}>{t('inventory.actions')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-file-text-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('common.name')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>{data.name || data.title || 'N/A'}</td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'name', label: t('common.name'), value: data.name || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-sticky-note-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('common.description')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', opacity: data.description ? 1 : 0.5, fontStyle: data.description ? 'normal' : 'italic' }}>
                                  {data.description || t('common.noData')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'description', label: t('common.description'), value: data.description || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-price-tag-3-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Tags
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                    {localTags && localTags.length > 0 ? (
                                      localTags.map(tag => {
                                        const c = tagColor(tag)

                                        
return (
                                          <Chip
                                            key={tag}
                                            size="small"
                                            label={tag}
                                            sx={{
                                              height: 22,
                                              bgcolor: `${c}22`,
                                              color: c,
                                              border: '1px solid',
                                              borderColor: `${c}66`,
                                            }}
                                          />
                                        )
                                      })
                                    ) : (
                                      <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('common.none')}</Typography>
                                    )}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'tags', label: t('inventory.tags'), value: (localTags || []).join(','), type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-play-circle-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('common.enabled')} boot
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.onboot ? t('common.yes') : t('common.no')}
                                    color={data.optionsInfo?.onboot ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'onboot', label: t('common.enabled'), value: data.optionsInfo?.onboot ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-sort-asc" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.startupOrder')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                  {data.optionsInfo?.startupOrder || 'order=any'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'startup', label: t('inventory.startupOrder'), value: data.optionsInfo?.startupOrder || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-window-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.osType')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.ostype || t('common.notAvailable')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'ostype', label: t('inventory.osType'), value: data.optionsInfo?.ostype || 'other', type: 'select', options: [
                                      { value: 'other', label: t('inventory.other') },
                                      { value: 'wxp', label: 'Windows XP' },
                                      { value: 'w2k', label: 'Windows 2000' },
                                      { value: 'w2k3', label: 'Windows 2003' },
                                      { value: 'w2k8', label: 'Windows 2008' },
                                      { value: 'wvista', label: 'Windows Vista' },
                                      { value: 'win7', label: 'Windows 7' },
                                      { value: 'win8', label: 'Windows 8/2012' },
                                      { value: 'win10', label: 'Windows 10/2016/2019' },
                                      { value: 'win11', label: 'Windows 11/2022' },
                                      { value: 'l24', label: 'Linux 2.4 Kernel' },
                                      { value: 'l26', label: 'Linux 2.6+ Kernel' },
                                      { value: 'solaris', label: 'Solaris' },
                                    ] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-restart-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.bootOrder')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                  {data.optionsInfo?.bootOrder || t('common.noData')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'boot', label: t('inventory.bootOrder'), value: data.optionsInfo?.bootOrder || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-cursor-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.usbTablet')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.useTablet !== false ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.useTablet !== false ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'tablet', label: t('inventory.usbTablet'), value: data.optionsInfo?.useTablet !== false ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-plug-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Hotplug
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.hotplug || 'disk,network,usb'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'hotplug', label: 'Hotplug (disk,network,usb,memory,cpu)', value: data.optionsInfo?.hotplug || 'disk,network,usb', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-flashlight-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    ACPI
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.acpi !== false ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.acpi !== false ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'acpi', label: 'ACPI', value: data.optionsInfo?.acpi !== false ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-speed-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    KVM Hardware
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip
                                    size="small"
                                    label={data.optionsInfo?.kvmEnabled !== false ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.kvmEnabled !== false ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'kvm', label: 'KVM Hardware Virtualization', value: data.optionsInfo?.kvmEnabled !== false ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-snowflake-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.freezeCpuOnStartup')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip 
                                    size="small" 
                                    label={data.optionsInfo?.freezeCpu ? t('common.yes') : t('common.no')} 
                                    color={data.optionsInfo?.freezeCpu ? 'warning' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'freeze', label: t('inventory.freezeCpuOnStartup'), value: data.optionsInfo?.freezeCpu ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-time-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.rtcLocalTime')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.useLocalTime === 'yes' ? t('common.yes') : t('common.no')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'localtime', label: t('inventory.rtcLocalTime'), value: data.optionsInfo?.useLocalTime || '', type: 'select', options: [{ value: '', label: t('common.default') }, { value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-calendar-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    {t('inventory.rtcDate')}
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.rtcStartDate || 'now'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'startdate', label: t('inventory.rtcDate'), value: data.optionsInfo?.rtcStartDate || 'now', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-fingerprint-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    SMBIOS (type1)
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                  {data.optionsInfo?.smbiosUuid ? `uuid=${data.optionsInfo.smbiosUuid}` : t('inventory.autoGenerated')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('inventory.notEditable')}>
                                    <span>
                                      <IconButton size="small" disabled>
                                        <i className="ri-lock-line" style={{ fontSize: 16 }} />
                                      </IconButton>
                                    </span>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-robot-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    QEMU Guest Agent
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip 
                                    size="small" 
                                    label={data.optionsInfo?.agentEnabled ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.agentEnabled ? 'success' : 'warning'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'agent', label: 'QEMU Guest Agent', value: data.optionsInfo?.agentEnabled ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.enabled') }, { value: '0', label: t('common.disabled') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-shield-check-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Protection
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  <Chip 
                                    size="small" 
                                    label={data.optionsInfo?.protection ? t('common.enabled') : t('common.disabled')}
                                    color={data.optionsInfo?.protection ? 'success' : 'default'}
                                    variant="outlined"
                                  />
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'protection', label: t('inventory.protection'), value: data.optionsInfo?.protection ? '1' : '0', type: 'select', options: [{ value: '1', label: t('common.yes') }, { value: '0', label: t('common.no') }] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-tv-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    Spice Enhancements
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.spiceEnhancements || 'none'}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'spice_enhancements', label: t('inventory.spiceEnhancements'), value: data.optionsInfo?.spiceEnhancements || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-save-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    VM State Storage
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)' }}>
                                  {data.optionsInfo?.vmStateStorage || t('inventoryPage.automatic')}
                                </td>
                                <td style={{ padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.15)', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'vmstatestorage', label: t('inventory.vmStateStorage'), value: data.optionsInfo?.vmStateStorage || '', type: 'text' })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                              <tr>
                                <td style={{ padding: '10px 16px', fontWeight: 500 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <i className="ri-lock-password-line" style={{ fontSize: 16, opacity: 0.6 }} />
                                    AMD SEV
                                  </Box>
                                </td>
                                <td style={{ padding: '10px 16px' }}>
                                  {data.optionsInfo?.amdSEV === 'enabled' ? t('common.enabled') : t('common.disabled')}
                                </td>
                                <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                  <MuiTooltip title={t('common.edit')}>
                                    <IconButton size="small" onClick={() => setEditOptionDialog({ key: 'amd_sev', label: 'AMD SEV', value: data.optionsInfo?.amdSEV || '', type: 'select', options: [
                                      { value: '', label: t('common.default') },
                                      { value: 'sev', label: 'AMD SEV' },
                                      { value: 'sev-es', label: 'AMD SEV-ES (highly experimental)' },
                                      { value: 'sev-snp', label: 'AMD SEV-SNP (highly experimental)' },
                                    ] })}>
                                      <i className="ri-pencil-line" style={{ fontSize: 16 }} />
                                    </IconButton>
                                  </MuiTooltip>
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </Box>
                      </CardContent>
                    </Card>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 3 - HISTORIQUE DES TÂCHES ==================== */}
              {detailTab === 3 && (
                <Box sx={{ py: 2 }}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent sx={{ p: 0 }}>
                      <Box sx={{ p: 2, borderBottom: '1px solid rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-history-line" style={{ fontSize: 20 }} />
                          {t('inventory.tabs.history')}
                          {tasks.length > 0 && (
                            <Chip size="small" label={tasks.length} sx={{ height: 20, fontSize: 11, ml: 1 }} />
                          )}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={tasksLoading ? <CircularProgress size={14} /> : <i className="ri-refresh-line" />}
                          onClick={() => { setTasksLoaded(false); loadTasks(); }}
                          disabled={tasksLoading}
                        >
                          {t('common.refresh')}
                        </Button>
                      </Box>
                      
                      {/* Loading */}
                      {tasksLoading && tasks.length === 0 && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={32} />
                        </Box>
                      )}

                      {/* Error */}
                      {tasksError && (
                        <Alert severity="warning" sx={{ m: 2 }}>{tasksError}</Alert>
                      )}

                      {/* Tableau des tâches - Format Proxmox */}
                      {!tasksLoading && !tasksError && (
                        <Box sx={{ overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ backgroundColor: 'rgba(0,0,0,0.04)' }}>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>{t('inventory.startTime')}</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>{t('inventory.endTime')}</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>{t('inventory.userName')}</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem' }}>{t('common.description')}</th>
                                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)', fontSize: '0.8rem', width: '180px' }}>{t('updates.status')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tasks.length === 0 ? (
                                <tr>
                                  <td colSpan={5} style={{ padding: '40px 16px', textAlign: 'center' }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: 0.6 }}>
                                      <i className="ri-task-line" style={{ fontSize: 48, opacity: 0.3 }} />
                                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                        {t('common.noData')}
                                      </Typography>
                                      <Typography variant="caption" sx={{ maxWidth: 400 }}>
                                        {t('inventory.tabs.historyEmpty')}
                                      </Typography>
                                    </Box>
                                  </td>
                                </tr>
                              ) : (
                                tasks.map((task, idx) => {
                                  const isError = task.status === 'error'
                                  const rowBgColor = isError ? 'rgba(211, 47, 47, 0.15)' : 'transparent'
                                  
                                  return (
                                    <tr key={task.upid || idx} style={{ backgroundColor: rowBgColor }}>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                          {task.starttime ? formatDateTime(task.starttime * 1000, locale) : '-'}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                          {task.endtime ? formatDateTime(task.endtime * 1000, locale) : '-'}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                          {task.user}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                                          {data?.kindLabel}/{data?.vmType?.toUpperCase()} {selection?.id?.split(':').pop()} - {t(`tasks.types.${task.type}`, { defaultValue: task.type })}
                                        </Typography>
                                      </td>
                                      <td style={{ padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,0.1)' }}>
                                        <Typography
                                          variant="body2"
                                          sx={{
                                            fontSize: '0.8rem',
                                            color: isError ? 'error.main' : 'inherit',
                                            fontWeight: isError ? 500 : 400
                                          }}
                                        >
                                          {task.statusText || t('tasks.status.running')}
                                        </Typography>
                                      </td>
                                    </tr>
                                  )
                                })
                              )}
                            </tbody>
                          </table>
                        </Box>
                      )}
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ==================== ONGLET 4 - SAUVEGARDES ==================== */}
              {detailTab === 4 && (
                <Box>
                  {/* Header avec bouton de création */}
                  {!selectedBackup && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 20 }} />
                        {t('inventory.tabs.backups')}
                      </Typography>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => {
                          // Charger les storages de backup disponibles
                          if (selection?.type === 'vm') {
                            const { connId, node } = parseVmId(selection.id)

                            fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storages?content=backup`)
                              .then(res => res.json())
                              .then(json => setBackupStorages(json.data || []))
                              .catch(() => setBackupStorages([]))
                          }

                          setBackupStorage('')
                          setBackupMode('snapshot')
                          setBackupCompress('zstd')
                          setBackupNote('')
                          setCreateBackupDialogOpen(true)
                        }}
                      >
                        {t('inventory.newBackup')}
                      </Button>
                    </Box>
                  )}
                  
                  {/* Loading */}
                  {backupsLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress size={32} />
                    </Box>
                  )}

                  {/* Error */}
                  {backupsError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>{backupsError}</Alert>
                  )}

                  {backupsWarnings?.length > 0 && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      {backupsWarnings.map((w: string, i: number) => (
                        <div key={i}>{w}</div>
                      ))}
                    </Alert>
                  )}

                  {/* Stats */}
                  {!backupsLoading && backupsStats && backupsStats.total > 0 && !selectedBackup && (
                    <Card variant="outlined" sx={{ mb: 2 }}>
                      <CardContent sx={{ pb: '16px !important' }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
                          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: primaryColor }}>{backupsStats.total}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Total</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main' }}>{backupsStats.verifiedCount || 0}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('backups.verified')}</Typography>
                          </Box>
                          <Box sx={{ textAlign: 'center', p: 1, bgcolor: 'action.hover', borderRadius: 2 }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>{backupsStats.totalSizeFormatted}</Typography>
                            <Typography variant="caption" sx={{ opacity: 0.6 }}>Total</Typography>
                          </Box>
                        </Box>
                      </CardContent>
                    </Card>
                  )}

                  {/* Liste des backups */}
                  {!backupsLoading && !selectedBackup && (
                    <>
                      {backups.length === 0 ? (
                        <Alert severity="info" sx={{ mt: 2 }}>
                          {t('common.noData')}
                        </Alert>
                      ) : (
                        <List dense sx={{ mx: -1 }}>
                          {backups.map((backup, idx) => (
                            <ListItem key={idx} disablePadding>
                              <ListItemButton
                                onClick={() => {
                                  setSelectedBackup(backup)
                                  loadBackupContent(backup)
                                }}
                                sx={{ borderRadius: 1, py: 1.5 }}
                              >
                                <ListItemIcon sx={{ minWidth: 40 }}>
                                  <i
                                    className="ri-hard-drive-2-fill"
                                    style={{
                                      fontSize: 24,
                                      color: backup.verified ? '#66BB6A' : '#90A4AE'
                                    }}
                                  />
                                </ListItemIcon>
                                <ListItemText
                                  primary={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {backup.backupTimeFormatted}
                                      </Typography>
                                      {backup.protected && (
                                        <i className="ri-lock-fill" style={{ fontSize: 14, color: '#FFB74D' }} />
                                      )}
                                    </Box>
                                  }
                                  secondary={
                                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                      {backup.pbsName} • {backup.datastore} • {backup.sizeFormatted}
                                    </Typography>
                                  }
                                />
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  {backup.verified && (
                                    <Chip size="small" color="success" label="✓" sx={{ height: 20, minWidth: 24 }} />
                                  )}
                                  <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                </Box>
                              </ListItemButton>
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </>
                  )}

                  {/* Détails d'un backup sélectionné */}
                  {selectedBackup && (
                    <>
                      {/* Header avec bouton retour */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        <IconButton size="small" onClick={backToBackupsList}>
                          <i className="ri-arrow-left-line" />
                        </IconButton>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {selectedBackup.backupTimeFormatted}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>
                            {selectedBackup.pbsName} • {selectedBackup.datastore}
                          </Typography>
                        </Box>
                        <Chip size="small" label={selectedBackup.sizeFormatted} variant="outlined" />
                      </Box>

                      {/* Explorateur de fichiers */}
                      <Card variant="outlined">
                        <CardContent sx={{ pb: '16px !important' }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                              <i className="ri-folder-open-line" style={{ marginRight: 8 }} />
                              {t('inventory.backupContent')}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                              {selectedPveStorage && (
                                <Chip
                                  size="small"
                                  label={selectedPveStorage.storage}
                                  color="primary"
                                  variant="outlined"
                                  onDelete={() => {
                                    setSelectedPveStorage(null)
                                    setExplorerArchives([])
                                    setExplorerFiles([])
                                    setExplorerArchive(null)
                                  }}
                                  sx={{ height: 20, fontSize: 10 }}
                                />
                              )}
                              <Chip
                                size="small"
                                label={explorerMode === 'pve' ? 'via PVE' : 'via PBS'}
                                color={explorerMode === 'pve' ? 'success' : 'default'}
                                variant="outlined"
                                sx={{ height: 20, fontSize: 10 }}
                              />
                            </Stack>
                          </Box>

                          {explorerLoading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                              <CircularProgress size={24} />
                            </Box>
                          )}

                          {explorerError && (
                            <Alert severity="warning" sx={{ mb: 2 }}>{explorerError}</Alert>
                          )}

                          {/* Sélecteur de storage PVE */}
                          {!explorerLoading && !explorerArchive && compatibleStorages.length > 0 && !selectedPveStorage && (
                            <Box sx={{ mb: 2 }}>
                              <Alert 
                                severity={compatibleStorages[0]?.matchType === 'exact' ? 'success' : 'info'} 
                                sx={{ mb: 2 }}
                              >
                                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                                  {compatibleStorages.length === 1 ? 'PBS Storage' : 'PBS Storages'}
                                </Typography>
                                <Typography variant="caption">
                                  {t('common.select')}:
                                </Typography>
                              </Alert>
                              <List dense sx={{ mx: -1 }}>
                                {compatibleStorages.map((storage: any, idx: number) => (
                                  <ListItem key={idx} disablePadding>
                                    <ListItemButton
                                      onClick={() => exploreWithPveStorage(selectedBackup, storage)}
                                      sx={{ borderRadius: 1 }}
                                    >
                                      <ListItemIcon sx={{ minWidth: 36 }}>
                                        <i className="ri-database-2-line" style={{ 
                                          color: storage.matchType === 'exact' ? '#66BB6A' : '#42A5F5', 
                                          fontSize: 20 
                                        }} />
                                      </ListItemIcon>
                                      <ListItemText
                                        primary={
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            {storage.storage}
                                            {storage.matchType === 'exact' && (
                                              <Chip label={t('inventory.recommended')} size="small" color="success" sx={{ height: 18, fontSize: 10 }} />
                                            )}
                                          </Box>
                                        }
                                        secondary={`${storage.server || '?'} → ${storage.datastore || '?'}`}
                                      />
                                      <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                    </ListItemButton>
                                  </ListItem>
                                ))}
                              </List>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => loadBackupContentViaPbs(selectedBackup)}
                                sx={{ mt: 1 }}
                              >
                                {t('inventory.usePbsDirectly')}
                              </Button>
                            </Box>
                          )}

                          {/* Liste des archives (niveau racine) */}
                          {!explorerArchive && !explorerLoading && (explorerArchives.length > 0 || explorerMode === 'pbs' || selectedPveStorage) && (
                            <>
                              <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 1 }}>
                                {explorerMode === 'pve' ? t('inventory.drivesAndArchives') : t('inventory.backupArchives')}
                              </Typography>
                              <List dense sx={{ mx: -1 }}>
                                {explorerArchives.map((file: any, idx: number) => (
                                  <ListItem key={idx} disablePadding>
                                    <ListItemButton
                                      onClick={() => file.browsable && browseArchive(file.name, '/')}
                                      disabled={!file.browsable}
                                      sx={{ borderRadius: 1 }}
                                    >
                                      <ListItemIcon sx={{ minWidth: 36 }}>
                                        {file.type === 'virtual' ? (
                                          <i className="ri-hard-drive-2-fill" style={{ color: '#42A5F5', fontSize: 20 }} />
                                        ) : file.type === 'directory' ? (
                                          <i className="ri-folder-fill" style={{ color: '#FFB74D', fontSize: 20 }} />
                                        ) : (
                                          <i className="ri-file-fill" style={{ color: '#90A4AE', fontSize: 20 }} />
                                        )}
                                      </ListItemIcon>
                                      <ListItemText
                                        primary={file.name}
                                        secondary={
                                          file.type === 'virtual' ? t('inventory.drivePartition') :
                                          file.isRawDiskImage ? t('inventory.diskImageNotBrowsable') :
                                          file.browsable ? t('inventory.clickToExplore') :
                                          file.sizeFormatted || t('inventory.notBrowsable')
                                        }
                                      />
                                      {file.browsable && (
                                        <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                      )}
                                    </ListItemButton>
                                  </ListItem>
                                ))}
                                {explorerArchives.length === 0 && !explorerLoading && (
                                  <Typography variant="body2" sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                                    {t('common.noData')}
                                  </Typography>
                                )}
                              </List>
                            </>
                          )}

                          {/* Navigation dans une archive */}
                          {explorerArchive && !explorerLoading && (
                            <>
                              {/* Breadcrumb */}
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                                <IconButton size="small" onClick={backToArchives}>
                                  <i className="ri-arrow-left-line" />
                                </IconButton>
                                <Breadcrumbs separator="›" sx={{ flex: 1, fontSize: 12 }}>
                                  <Typography
                                    variant="body2"
                                    sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                    onClick={backToArchives}
                                  >
                                    {explorerArchive.replace('.pxar.didx', '')}
                                  </Typography>
                                  {explorerPath !== '/' && explorerPath.split('/').filter(Boolean).map((part, idx) => (
                                    <Typography
                                      key={idx}
                                      variant="body2"
                                      sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                                      onClick={() => navigateToBreadcrumb(idx)}
                                    >
                                      {part}
                                    </Typography>
                                  ))}
                                </Breadcrumbs>
                              </Box>

                              {/* Bouton remonter */}
                              {explorerPath !== '/' && (
                                <ListItemButton onClick={navigateUp} sx={{ mb: 1, borderRadius: 1, mx: -1 }}>
                                  <ListItemIcon sx={{ minWidth: 36 }}>
                                    <i className="ri-arrow-up-line" style={{ fontSize: 20 }} />
                                  </ListItemIcon>
                                  <ListItemText primary=".." />
                                </ListItemButton>
                              )}

                              {/* Champ de recherche */}
                              {explorerFiles.length > 5 && (
                                <TextField
                                  size="small"
                                  placeholder={t('inventory.searchFile')}
                                  value={explorerSearch}
                                  onChange={(e) => setExplorerSearch(e.target.value)}
                                  InputProps={{
                                    startAdornment: (
                                      <i className="ri-search-line" style={{ marginRight: 8, opacity: 0.5 }} />
                                    ),
                                    endAdornment: explorerSearch && (
                                      <IconButton size="small" onClick={() => setExplorerSearch('')}>
                                        <CloseIcon sx={{ fontSize: 16 }} />
                                      </IconButton>
                                    )
                                  }}
                                  sx={{ mb: 1, width: '100%' }}
                                />
                              )}

                              {/* Compteur de résultats */}
                              {explorerSearch && (
                                <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mb: 1 }}>
                                  {filteredExplorerFiles.length} / {explorerFiles.length}
                                </Typography>
                              )}

                              {/* Liste des fichiers */}
                              <List dense sx={{ maxHeight: 300, overflow: 'auto', mx: -1 }}>
                                {filteredExplorerFiles.map((file: any, idx: number) => {
                                  const isNavigable = file.type === 'directory' || file.type === 'virtual' || file.leaf === false || file.leaf === 0
                                  const canDownload = explorerMode === 'pve' && selectedPveStorage
                                  const canPreviewFile = canDownload && !isNavigable && canPreview(file.name)

                                  
return (
                                    <ListItem 
                                      key={idx} 
                                      disablePadding
                                      secondaryAction={
                                        canDownload && (
                                          <Stack direction="row" spacing={0}>
                                            {canPreviewFile && (
                                              <MuiTooltip title={t('common.view')}>
                                                <IconButton 
                                                  size="small"
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    previewFile(file.name)
                                                  }}
                                                >
                                                  <i className="ri-eye-line" style={{ fontSize: 18 }} />
                                                </IconButton>
                                              </MuiTooltip>
                                            )}
                                            <MuiTooltip title={t('common.download')}>
                                              <IconButton 
                                                edge="end" 
                                                size="small"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  downloadFile(file.name, isNavigable)
                                                }}
                                              >
                                                <i className="ri-download-2-line" style={{ fontSize: 18 }} />
                                              </IconButton>
                                            </MuiTooltip>
                                          </Stack>
                                        )
                                      }
                                    >
                                      <ListItemButton
                                        onClick={() => isNavigable && navigateToFolder(file.name)}
                                        disabled={!isNavigable && file.type !== 'file'}
                                        sx={{ borderRadius: 1, pr: canDownload ? (canPreviewFile ? 10 : 6) : 2 }}
                                      >
                                        <ListItemIcon sx={{ minWidth: 36 }}>
                                          {file.type === 'directory' || file.type === 'virtual' ? (
                                            <i className="ri-folder-fill" style={{ color: '#FFB74D', fontSize: 20 }} />
                                          ) : (
                                            <i className="ri-file-fill" style={{ color: '#90A4AE', fontSize: 20 }} />
                                          )}
                                        </ListItemIcon>
                                        <ListItemText
                                          primary={file.name}
                                          secondary={
                                            file.sizeFormatted && file.sizeFormatted !== '0 B' 
                                              ? file.sizeFormatted
                                              : isNavigable ? t('inventory.folder') : '-'
                                          }
                                        />
                                        {isNavigable && (
                                          <i className="ri-arrow-right-s-line" style={{ opacity: 0.5 }} />
                                        )}
                                      </ListItemButton>
                                    </ListItem>
                                  )
                                })}
                                {filteredExplorerFiles.length === 0 && explorerFiles.length > 0 && (
                                  <Typography variant="body2" sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                                    {t('common.noResults')}
                                  </Typography>
                                )}
                                {explorerFiles.length === 0 && (
                                  <Typography variant="body2" sx={{ opacity: 0.5, py: 2, textAlign: 'center' }}>
                                    {t('inventory.emptyFolder')}
                                  </Typography>
                                )}
                              </List>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 5 - SNAPSHOTS ==================== */}
              {detailTab === 5 && (
                <Box>
                  {/* Loading */}
                  {snapshotsLoading && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                      <CircularProgress size={32} />
                    </Box>
                  )}

                  {/* Error */}
                  {snapshotsError && (
                    <Alert severity="warning" sx={{ mb: 2 }}>{snapshotsError}</Alert>
                  )}

                  {/* Header avec bouton créer */}
                  {!snapshotsLoading && (
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-camera-line" style={{ fontSize: 20, opacity: 0.7 }} />
                        <Typography variant="subtitle1" fontWeight={600}>
                          {t('inventory.tabs.snapshots')}
                        </Typography>
                        {snapshots.length > 0 && (
                          <Chip 
                            size="small" 
                            label={`${snapshots.filter(s => s.name !== 'current').length} snapshot${snapshots.filter(s => s.name !== 'current').length > 1 ? 's' : ''}`}
                            sx={{ height: 20, fontSize: '0.7rem' }}
                          />
                        )}
                      </Box>
                      {!showCreateSnapshot && (
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<i className="ri-add-line" />}
                          onClick={() => setShowCreateSnapshot(true)}
                          disabled={snapshotActionBusy}
                        >
                          {t('common.create')}
                        </Button>
                      )}
                    </Box>
                  )}

                  {/* Formulaire de création */}
                  {!snapshotsLoading && showCreateSnapshot && (
                    <Card variant="outlined" sx={{ mb: 2, bgcolor: 'action.hover' }}>
                      <CardContent sx={{ pb: '16px !important' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-camera-lens-line" style={{ fontSize: 18 }} />
                          {t('audit.actions.snapshot')}
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                          <TextField
                            size="small"
                            label={t('common.name')}
                            value={newSnapshotName}
                            onChange={(e) => setNewSnapshotName(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                            placeholder="my-snapshot"
                            helperText={t('inventory.snapshotNameHelp')}
                            fullWidth
                          />
                          <TextField
                            size="small"
                            label={`${t('common.description')} (${t('common.optional')})`}
                            value={newSnapshotDesc}
                            onChange={(e) => setNewSnapshotDesc(e.target.value)}
                            fullWidth
                          />
                        </Box>
                        <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={newSnapshotRam}
                                onChange={(e) => setNewSnapshotRam(e.target.checked)}
                                size="small"
                              />
                            }
                            label={
                              <Typography variant="body2">
                                {t('inventory.includeRam')}
                                <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.6 }}>
                                  ({t('inventory.vmMustBeRunning')})
                                </Typography>
                              </Typography>
                            }
                          />
                          <Stack direction="row" spacing={1}>
                            <Button
                              variant="outlined"
                              size="small"
                              onClick={() => {
                                setShowCreateSnapshot(false)
                                setNewSnapshotName('')
                                setNewSnapshotDesc('')
                                setNewSnapshotRam(false)
                              }}
                            >
                              {t('common.cancel')}
                            </Button>
                            <Button
                              variant="contained"
                              size="small"
                              onClick={createSnapshot}
                              disabled={!newSnapshotName.trim() || snapshotActionBusy}
                              startIcon={snapshotActionBusy ? <CircularProgress size={14} /> : <i className="ri-camera-line" />}
                            >
                              {t('common.create')}
                            </Button>
                          </Stack>
                        </Box>
                      </CardContent>
                    </Card>
                  )}

                  {/* Timeline des snapshots */}
                  {!snapshotsLoading && (
                    <>
                      {snapshots.filter(s => s.name !== 'current').length === 0 ? (
                        <Card variant="outlined" sx={{ textAlign: 'center', py: 4, bgcolor: 'transparent' }}>
                          <i className="ri-camera-off-line" style={{ fontSize: 48, opacity: 0.2 }} />
                          <Typography variant="body2" sx={{ mt: 1, opacity: 0.6 }}>
                            {t('common.noData')}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.4, display: 'block', mt: 0.5 }}>
                            {t('inventory.deleteSnapshotDesc')}
                          </Typography>
                        </Card>
                      ) : (
                        <Box sx={{ position: 'relative' }}>
                          {/* Ligne de timeline */}
                          <Box sx={{ 
                            position: 'absolute', 
                            left: 19, 
                            top: 24, 
                            bottom: 24, 
                            width: 2, 
                            bgcolor: 'divider',
                            borderRadius: 1
                          }} />
                          
                          {/* État actuel (current) */}
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 1, position: 'relative' }}>
                            <Box sx={{ 
                              width: 40, 
                              height: 40, 
                              borderRadius: '50%', 
                              bgcolor: 'success.main',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'success.contrastText',
                              zIndex: 1,
                              boxShadow: 2
                            }}>
                              <i className="ri-play-circle-fill" style={{ fontSize: 20 }} />
                            </Box>
                            <Box sx={{ flex: 1, pt: 0.5 }}>
                              <Typography variant="body2" fontWeight={600}>
                                {t('common.active')}
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                                {t('common.configuration')}
                              </Typography>
                            </Box>
                          </Box>

                          {/* Liste des snapshots */}
                          {snapshots
                            .filter(s => s.name !== 'current')
                            .sort((a, b) => (b.snaptime || 0) - (a.snaptime || 0))
                            .map((snap, idx, arr) => {
                              const isOldest = idx === arr.length - 1

                              
return (
                                <Box 
                                  key={snap.name}
                                  sx={{ 
                                    display: 'flex', 
                                    alignItems: 'flex-start', 
                                    gap: 2, 
                                    mb: 1,
                                    position: 'relative',
                                    '&:hover .snapshot-actions': { opacity: 1 }
                                  }}
                                >
                                  {/* Point de timeline */}
                                  <Box sx={{ 
                                    width: 40, 
                                    height: 40, 
                                    borderRadius: '50%', 
                                    bgcolor: snap.vmstate ? 'info.main' : 'background.paper',
                                    border: '2px solid',
                                    borderColor: snap.vmstate ? 'info.main' : 'divider',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: snap.vmstate ? 'info.contrastText' : 'text.secondary',
                                    zIndex: 1
                                  }}>
                                    <i className={snap.vmstate ? "ri-save-3-fill" : "ri-camera-fill"} style={{ fontSize: 18 }} />
                                  </Box>
                                  
                                  {/* Contenu */}
                                  <Card 
                                    variant="outlined" 
                                    sx={{ 
                                      flex: 1, 
                                      bgcolor: 'transparent',
                                      '&:hover': { bgcolor: 'action.hover' }
                                    }}
                                  >
                                    <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                                      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                                        <Box sx={{ flex: 1 }}>
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                            <Typography variant="body2" fontWeight={600}>
                                              {snap.name}
                                            </Typography>
                                            {snap.vmstate && (
                                              <Chip 
                                                size="small" 
                                                label="RAM" 
                                                color="info"
                                                icon={<i className="ri-ram-line" style={{ fontSize: 12 }} />}
                                                sx={{ height: 20, fontSize: '0.65rem' }} 
                                              />
                                            )}
                                            {isOldest && (
                                              <Chip 
                                                size="small" 
                                                label={t('inventory.oldest')}
                                                variant="outlined"
                                                sx={{ height: 20, fontSize: '0.65rem' }} 
                                              />
                                            )}
                                          </Box>
                                          
                                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
                                            <Typography variant="caption" sx={{ opacity: 0.6, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <i className="ri-time-line" style={{ fontSize: 12 }} />
                                              {snap.snaptimeFormatted || new Date(snap.snaptime * 1000).toLocaleString()}
                                            </Typography>
                                            {snap.description && (
                                              <>
                                                <Typography variant="caption" sx={{ opacity: 0.3 }}>•</Typography>
                                                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                                  {snap.description}
                                                </Typography>
                                              </>
                                            )}
                                          </Box>
                                        </Box>
                                        
                                        {/* Actions */}
                                        <Stack 
                                          direction="row" 
                                          spacing={0.5} 
                                          className="snapshot-actions"
                                          sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 0.2s' }}
                                        >
                                          <MuiTooltip title={t('audit.actions.restore')}>
                                            <IconButton
                                              size="small"
                                              onClick={() => rollbackSnapshot(snap.name, snap.vmstate)}
                                              disabled={snapshotActionBusy}
                                              sx={{
                                                color: 'warning.main',
                                                '&:hover': { bgcolor: 'warning.main', color: 'warning.contrastText' }
                                              }}
                                            >
                                              <i className="ri-history-line" style={{ fontSize: 18 }} />
                                            </IconButton>
                                          </MuiTooltip>
                                          <MuiTooltip title={t('inventory.deleteSnapshot')}>
                                            <IconButton
                                              size="small"
                                              onClick={() => deleteSnapshot(snap.name)}
                                              disabled={snapshotActionBusy}
                                              sx={{
                                                color: 'error.main',
                                                '&:hover': { bgcolor: 'error.main', color: 'error.contrastText' }
                                              }}
                                            >
                                              <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
                                            </IconButton>
                                          </MuiTooltip>
                                        </Stack>
                                      </Box>
                                    </CardContent>
                                  </Card>
                                </Box>
                              )
                            })}
                        </Box>
                      )}
                    </>
                  )}

                  {/* Info */}
                  {!snapshotsLoading && snapshots.filter(s => s.name !== 'current').length > 0 && (
                    <Alert severity="info" sx={{ mt: 2 }} icon={<i className="ri-information-line" />}>
                      <Typography variant="caption">
                        <strong>{t('audit.actions.restore')}</strong>: {t('inventory.deleteSnapshotDesc')}<br/>
                        <strong>{t('common.delete')}</strong>: {t('inventory.deleteSnapshotDesc')}
                      </Typography>
                    </Alert>
                  )}
                </Box>
              )}

              {/* ==================== ONGLET 6 - NOTES ==================== */}
              {detailTab === 6 && (
                <Box sx={{ py: 2 }}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-sticky-note-line" style={{ fontSize: 20 }} />
                          {t('inventory.tabs.notes')}
                        </Typography>
                        {!notesEditing && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<i className="ri-edit-line" />}
                            onClick={() => setNotesEditing(true)}
                          >
                            {t('common.edit')}
                          </Button>
                        )}
                      </Box>

                      {/* Loading */}
                      {notesLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={32} />
                        </Box>
                      )}

                      {/* Error */}
                      {notesError && (
                        <Alert severity="warning" sx={{ mb: 2 }}>{notesError}</Alert>
                      )}

                      {/* Contenu des notes */}
                      {!notesLoading && !notesError && (
                        <>
                          {notesEditing ? (
                            <Box>
                              <TextField
                                fullWidth
                                multiline
                                minRows={8}
                                maxRows={20}
                                value={vmNotes}
                                onChange={(e) => setVmNotes(e.target.value)}
                                placeholder={t('inventory.notesPlaceholder')}
                                sx={{ mb: 2 }}
                              />
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  variant="outlined"
                                  onClick={() => {
                                    setNotesEditing(false)
                                    loadNotes() // Recharger les notes originales
                                  }}
                                  disabled={notesSaving}
                                >
                                  {t('common.cancel')}
                                </Button>
                                <Button
                                  variant="contained"
                                  onClick={saveNotes}
                                  disabled={notesSaving}
                                  startIcon={notesSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                                >
                                  {notesSaving ? t('common.saving') : t('common.save')}
                                </Button>
                              </Stack>
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                p: 2,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                minHeight: 150,
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'inherit',
                              }}
                            >
                              {vmNotes ? (
                                <Typography variant="body2" sx={{ lineHeight: 1.8 }}>
                                  {vmNotes}
                                </Typography>
                              ) : (
                                <Typography variant="body2" sx={{ opacity: 0.5, fontStyle: 'italic' }}>
                                  {t('inventory.noNotes')}
                                </Typography>
                              )}
                            </Box>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ==================== ONGLET 7 - RÉPLICATION ==================== */}
              {detailTab === 7 && (
                <Box sx={{ py: 2 }}>
                  <Stack spacing={2}>
                    {/* ZFS Replication (Native Proxmox) */}
                    <Card variant="outlined" sx={{ borderRadius: 2 }}>
                      <CardContent>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                          <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-database-2-line" style={{ fontSize: 20 }} />
                            {t('replication.zfsReplication')}
                          </Typography>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<AddIcon />}
                            onClick={() => {
                              setReplicationTargetNode('')
                              setReplicationSchedule('*/15')
                              setReplicationRateLimit('')
                              setReplicationComment('')
                              setAddReplicationDialogOpen(true)
                            }}
                            disabled={availableTargetNodes.length === 0}
                          >
                            {t('replication.addJob')}
                          </Button>
                        </Box>

                        {replicationLoading ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress size={24} />
                          </Box>
                        ) : replicationJobs.length > 0 ? (
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>{t('replication.target')}</TableCell>
                                  <TableCell>{t('replication.schedule')}</TableCell>
                                  <TableCell>{t('replication.lastSync')}</TableCell>
                                  <TableCell>{t('replication.nextSync')}</TableCell>
                                  <TableCell align="center">{t('updates.status')}</TableCell>
                                  <TableCell align="center">{t('inventory.actions')}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {replicationJobs.map((job: any) => (
                                  <TableRow key={job.id}>
                                    <TableCell>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <i className="ri-server-line" style={{ fontSize: 16, opacity: 0.7 }} />
                                        <Typography variant="body2" fontWeight={600}>{job.target}</Typography>
                                      </Box>
                                    </TableCell>
                                    <TableCell>
                                      <Chip 
                                        size="small" 
                                        label={job.schedule || '*/15'} 
                                        sx={{ height: 22, fontSize: 11 }}
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                                        {job.last_sync ? new Date(job.last_sync * 1000).toLocaleString() : '—'}
                                      </Typography>
                                    </TableCell>
                                    <TableCell>
                                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                                        {job.next_sync ? new Date(job.next_sync * 1000).toLocaleString() : '—'}
                                      </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                      {job.error ? (
                                        <MuiTooltip title={typeof job.error === 'string' ? job.error : JSON.stringify(job.error)}>
                                          <Chip 
                                            size="small" 
                                            label={t('replication.error')} 
                                            color="error"
                                            icon={<i className="ri-error-warning-fill" style={{ fontSize: 14 }} />}
                                            sx={{ height: 22 }}
                                          />
                                        </MuiTooltip>
                                      ) : job.disable ? (
                                        <Chip 
                                          size="small" 
                                          label={t('common.disabled')} 
                                          color="default"
                                          sx={{ height: 22 }}
                                        />
                                      ) : (
                                        <Chip 
                                          size="small" 
                                          label={t('replication.active')} 
                                          color="success"
                                          icon={<i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                          sx={{ height: 22 }}
                                        />
                                      )}
                                    </TableCell>
                                    <TableCell align="center">
                                      <Stack direction="row" spacing={0.5} justifyContent="center">
                                        <MuiTooltip title={t('replication.runNow')}>
                                          <IconButton 
                                            size="small"
                                            onClick={async () => {
                                              const { connId, node } = parseVmId(selection?.id || '')
                                              try {
                                                await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(job.id)}/schedule_now`, {
                                                  method: 'POST'
                                                })
                                                setReplicationLoaded(false)
                                              } catch {}
                                            }}
                                          >
                                            <i className="ri-play-fill" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                        <MuiTooltip title={t('common.delete')}>
                                          <IconButton 
                                            size="small" 
                                            color="error"
                                            onClick={() => setDeleteReplicationId(job.id)}
                                          >
                                            <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                          </IconButton>
                                        </MuiTooltip>
                                      </Stack>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        ) : (
                          <Alert severity="info" icon={<i className="ri-information-line" />}>
                            <Typography variant="body2">
                              {t('replication.noJobs')}
                            </Typography>
                            {availableTargetNodes.length === 0 && (
                              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.8 }}>
                                {t('replication.noTargetNodes')}
                              </Typography>
                            )}
                          </Alert>
                        )}
                      </CardContent>
                    </Card>

                    {/* Ceph RBD Replication (Crossover) - Affiché uniquement si Ceph est disponible */}
                    {sourceCephAvailable && (
                      <Card variant="outlined" sx={{ borderRadius: 2 }}>
                        <CardContent>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                            <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-cloud-line" style={{ fontSize: 20 }} />
                              {t('replication.cephReplication')}
                              <Chip size="small" label="Crossover" color="primary" sx={{ height: 20, fontSize: 10 }} />
                            </Typography>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<AddIcon />}
                              onClick={() => {
                                setSelectedCephCluster('')
                                setCephReplicationSchedule('*/15')
                                setCephClusters([])
                                setAddCephReplicationDialogOpen(true)
                              }}
                            >
                              {t('replication.addJob')}
                            </Button>
                          </Box>

                          {cephReplicationJobs.length > 0 ? (
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>{t('replication.targetCluster')}</TableCell>
                                    <TableCell>{t('replication.schedule')}</TableCell>
                                    <TableCell>{t('replication.lastSync')}</TableCell>
                                    <TableCell align="center">{t('updates.status')}</TableCell>
                                    <TableCell align="center">{t('inventory.actions')}</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {cephReplicationJobs.map((job: any, idx: number) => (
                                    <TableRow key={idx}>
                                      <TableCell>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <i className="ri-cloud-line" style={{ fontSize: 16, opacity: 0.7 }} />
                                          <Typography variant="body2" fontWeight={600}>{job.targetCluster}</Typography>
                                        </Box>
                                      </TableCell>
                                      <TableCell>
                                        <Chip size="small" label={job.schedule} sx={{ height: 22, fontSize: 11 }} />
                                      </TableCell>
                                      <TableCell>
                                        <Typography variant="body2" sx={{ fontSize: 12 }}>
                                          {job.lastSync ? new Date(job.lastSync).toLocaleString() : '—'}
                                        </Typography>
                                      </TableCell>
                                      <TableCell align="center">
                                        <Chip 
                                          size="small" 
                                          label={job.status} 
                                          color={job.status === 'active' ? 'success' : 'default'}
                                          sx={{ height: 22 }}
                                        />
                                      </TableCell>
                                      <TableCell align="center">
                                        <IconButton size="small" color="error">
                                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                                        </IconButton>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </TableContainer>
                          ) : (
                            <>
                              <Alert severity="info" icon={<i className="ri-information-line" />}>
                                <Typography variant="body2">
                                  {t('replication.noCephJobs')}
                                </Typography>
                              </Alert>

                              <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                                <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                                  {t('replication.cephFeatures')}
                                </Typography>
                                <Box component="ul" sx={{ m: 0, pl: 2, '& li': { mb: 0.5 } }}>
                                  <li><Typography variant="caption">{t('replication.featureCrossCluster')}</Typography></li>
                                  <li><Typography variant="caption">{t('replication.featureRbdMirroring')}</Typography></li>
                                  <li><Typography variant="caption">{t('replication.featureAsyncReplication')}</Typography></li>
                                  <li><Typography variant="caption">{t('replication.featureFailover')}</Typography></li>
                                </Box>
                              </Box>
                            </>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </Stack>

                  {/* Dialog Ajouter Réplication Ceph */}
                  <Dialog 
                    open={addCephReplicationDialogOpen} 
                    onClose={() => setAddCephReplicationDialogOpen(false)}
                    maxWidth="sm"
                    fullWidth
                  >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-cloud-line" style={{ fontSize: 24, color: '#2196f3' }} />
                      {t('replication.createCephJob')}
                    </DialogTitle>
                    <DialogContent>
                      <Stack spacing={2} sx={{ mt: 1 }}>
                        <Alert severity="info" icon={<i className="ri-information-line" />}>
                          <Typography variant="caption">
                            {t('replication.cephJobDescription')}
                          </Typography>
                        </Alert>

                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                            {t('replication.sourceVm')}
                          </Typography>
                          <TextField
                            fullWidth
                            size="small"
                            value={`VM ${selection?.id ? parseVmId(selection.id).vmid : ''} - ${data?.name || ''}`}
                            disabled
                          />
                        </Box>

                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                            {t('replication.selectTargetCluster')}
                          </Typography>
                          {cephClustersLoading ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                              <CircularProgress size={20} />
                              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                {t('replication.loadingClusters')}
                              </Typography>
                            </Box>
                          ) : cephClusters.length > 0 ? (
                            <Stack spacing={1}>
                              {cephClusters.map((cluster: any) => (
                                <Card 
                                  key={cluster.id}
                                  variant="outlined"
                                  sx={{ 
                                    cursor: 'pointer',
                                    border: selectedCephCluster === cluster.id ? '2px solid' : '1px solid',
                                    borderColor: selectedCephCluster === cluster.id ? 'primary.main' : 'divider',
                                    bgcolor: selectedCephCluster === cluster.id ? 'primary.main' + '10' : 'transparent',
                                    '&:hover': { bgcolor: 'action.hover' }
                                  }}
                                  onClick={() => setSelectedCephCluster(cluster.id)}
                                >
                                  <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <i className="ri-cloud-line" style={{ fontSize: 24, opacity: 0.7 }} />
                                        <Box>
                                          <Typography variant="body2" fontWeight={600}>
                                            {cluster.name}
                                          </Typography>
                                          <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                            {cluster.host}
                                          </Typography>
                                        </Box>
                                      </Box>
                                      <Chip 
                                        size="small" 
                                        label={cluster.cephHealth === 'HEALTH_OK' ? 'Healthy' : cluster.cephHealth}
                                        color={cluster.cephHealth === 'HEALTH_OK' ? 'success' : 'warning'}
                                        sx={{ height: 22, fontSize: 10 }}
                                      />
                                    </Box>
                                  </CardContent>
                                </Card>
                              ))}
                            </Stack>
                          ) : (
                            <Alert severity="warning" icon={<i className="ri-error-warning-line" />}>
                              <Typography variant="body2">
                                {t('replication.noCephClusters')}
                              </Typography>
                            </Alert>
                          )}
                        </Box>

                        {cephClusters.length > 0 && (
                          <FormControl fullWidth size="small">
                            <InputLabel>{t('replication.schedule')}</InputLabel>
                            <Select
                              value={cephReplicationSchedule}
                              label={t('replication.schedule')}
                              onChange={(e) => setCephReplicationSchedule(e.target.value)}
                            >
                              <MenuItem value="*/5">*/5 - {t('replication.every5min')}</MenuItem>
                              <MenuItem value="*/15">*/15 - {t('replication.every15min')}</MenuItem>
                              <MenuItem value="*/30">*/30 - {t('replication.every30min')}</MenuItem>
                              <MenuItem value="0">0 - {t('replication.everyHour')}</MenuItem>
                              <MenuItem value="0 */2">0 */2 - {t('replication.every2hours')}</MenuItem>
                              <MenuItem value="0 */6">0 */6 - {t('replication.every6hours')}</MenuItem>
                              <MenuItem value="0 0">0 0 - {t('replication.daily')}</MenuItem>
                            </Select>
                          </FormControl>
                        )}
                      </Stack>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setAddCephReplicationDialogOpen(false)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="contained"
                        disabled={!selectedCephCluster || cephClusters.length === 0}
                        startIcon={<AddIcon />}
                        onClick={() => {
                          // TODO: Implémenter la création du job Ceph via Crossover
                          console.log('Create Ceph replication job:', {
                            vmId: selection?.id ? parseVmId(selection.id).vmid : '',
                            targetCluster: selectedCephCluster,
                            schedule: cephReplicationSchedule,
                          })
                          setAddCephReplicationDialogOpen(false)
                        }}
                      >
                        {t('replication.create')}
                      </Button>
                    </DialogActions>
                  </Dialog>

                  {/* Dialog Ajouter Réplication ZFS */}
                  <Dialog 
                    open={addReplicationDialogOpen} 
                    onClose={() => setAddReplicationDialogOpen(false)}
                    maxWidth="sm"
                    fullWidth
                  >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-repeat-line" style={{ fontSize: 24 }} />
                      {t('replication.createJob')}
                    </DialogTitle>
                    <DialogContent>
                      <Stack spacing={2} sx={{ mt: 1 }}>
                        <Box>
                          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                            CT/VM ID
                          </Typography>
                          <TextField
                            fullWidth
                            size="small"
                            value={selection?.id ? parseVmId(selection.id).vmid : ''}
                            disabled
                          />
                        </Box>

                        <FormControl fullWidth size="small">
                          <InputLabel>{t('replication.target')}</InputLabel>
                          <Select
                            value={replicationTargetNode}
                            label={t('replication.target')}
                            onChange={(e) => setReplicationTargetNode(e.target.value)}
                          >
                            {availableTargetNodes.map((node) => (
                              <MenuItem key={node} value={node}>{node}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>

                        <FormControl fullWidth size="small">
                          <InputLabel>{t('replication.schedule')}</InputLabel>
                          <Select
                            value={replicationSchedule}
                            label={t('replication.schedule')}
                            onChange={(e) => setReplicationSchedule(e.target.value)}
                          >
                            <MenuItem value="*/5">*/5 - {t('replication.every5min')}</MenuItem>
                            <MenuItem value="*/15">*/15 - {t('replication.every15min')}</MenuItem>
                            <MenuItem value="*/30">*/30 - {t('replication.every30min')}</MenuItem>
                            <MenuItem value="0">0 - {t('replication.everyHour')}</MenuItem>
                            <MenuItem value="0 */2">0 */2 - {t('replication.every2hours')}</MenuItem>
                            <MenuItem value="0 */6">0 */6 - {t('replication.every6hours')}</MenuItem>
                            <MenuItem value="0 0">0 0 - {t('replication.daily')}</MenuItem>
                          </Select>
                        </FormControl>

                        <TextField
                          fullWidth
                          size="small"
                          label={t('replication.rateLimit')}
                          value={replicationRateLimit}
                          onChange={(e) => setReplicationRateLimit(e.target.value)}
                          placeholder="unlimited"
                          InputProps={{
                            endAdornment: <InputAdornment position="end">MB/s</InputAdornment>,
                          }}
                        />

                        <TextField
                          fullWidth
                          size="small"
                          label={t('replication.comment')}
                          value={replicationComment}
                          onChange={(e) => setReplicationComment(e.target.value)}
                          multiline
                          rows={2}
                        />
                      </Stack>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setAddReplicationDialogOpen(false)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="contained"
                        disabled={!replicationTargetNode || savingReplication}
                        startIcon={savingReplication ? <CircularProgress size={16} /> : <AddIcon />}
                        onClick={async () => {
                          if (!selection?.id || !replicationTargetNode) return
                          setSavingReplication(true)
                          const { connId, node, vmid } = parseVmId(selection.id)
                          try {
                            const body: any = {
                              target: replicationTargetNode,
                              schedule: replicationSchedule,
                            }
                            if (replicationRateLimit) body.rate = replicationRateLimit
                            if (replicationComment) body.comment = replicationComment

                            const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ ...body, guest: vmid }),
                            })
                            
                            if (res.ok) {
                              setAddReplicationDialogOpen(false)
                              setReplicationLoaded(false)
                            }
                          } catch (e) {
                            console.error('Error creating replication job:', e)
                          } finally {
                            setSavingReplication(false)
                          }
                        }}
                      >
                        {t('replication.create')}
                      </Button>
                    </DialogActions>
                  </Dialog>

                  {/* Dialog Confirmer suppression */}
                  <Dialog 
                    open={!!deleteReplicationId} 
                    onClose={() => setDeleteReplicationId(null)}
                    maxWidth="xs"
                    fullWidth
                  >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <i className="ri-error-warning-line" style={{ fontSize: 24, color: '#f44336' }} />
                      {t('replication.deleteJob')}
                    </DialogTitle>
                    <DialogContent>
                      <Typography variant="body2">
                        {t('replication.confirmDelete')}
                      </Typography>
                    </DialogContent>
                    <DialogActions>
                      <Button onClick={() => setDeleteReplicationId(null)}>
                        {t('common.cancel')}
                      </Button>
                      <Button
                        variant="contained"
                        color="error"
                        onClick={async () => {
                          if (!selection?.id || !deleteReplicationId) return
                          const { connId, node } = parseVmId(selection.id)
                          try {
                            await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(deleteReplicationId)}`, {
                              method: 'DELETE',
                            })
                            setDeleteReplicationId(null)
                            setReplicationLoaded(false)
                          } catch (e) {
                            console.error('Error deleting replication job:', e)
                          }
                        }}
                      >
                        {t('common.delete')}
                      </Button>
                    </DialogActions>
                  </Dialog>
                </Box>
              )}

              {/* ==================== ONGLET 8 - HA (seulement pour les clusters) ==================== */}
              {detailTab === 8 && selectedVmIsCluster && (
                <Box sx={{ py: 2 }}>
                  <Card variant="outlined" sx={{ borderRadius: 2 }}>
                    <CardContent>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-shield-check-line" style={{ fontSize: 20 }} />
                          High Availability (HA)
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          {haConfig && !haEditing && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              startIcon={<i className="ri-delete-bin-line" />}
                              onClick={removeHaConfig}
                              disabled={haSaving}
                            >
                              {t('audit.actions.disable')}
                            </Button>
                          )}
                          {!haEditing && (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<i className="ri-edit-line" />}
                              onClick={() => setHaEditing(true)}
                            >
                              {haConfig ? t('common.edit') : t('common.enabled')}
                            </Button>
                          )}
                        </Box>
                      </Box>

                      {/* Loading */}
                      {haLoading && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                          <CircularProgress size={32} />
                        </Box>
                      )}

                      {/* Error */}
                      {haError && (
                        <Alert severity="error" sx={{ mb: 2 }}>{haError}</Alert>
                      )}

                      {/* Avertissement cluster */}
                      {!haLoading && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                          <Typography variant="body2">
                            {t('inventory.haQuorumRecommendation')}
                          </Typography>
                        </Alert>
                      )}

                      {/* Contenu HA */}
                      {!haLoading && !haError && (
                        <>
                          {haEditing ? (
                            <Box>
                              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                                <Box>
                                  <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
                                    VM:
                                  </Typography>
                                  <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                    {selection?.type === 'vm' ? parseVmId(selection.id).vmid : ''}
                                  </Typography>
                                </Box>
                                <FormControl fullWidth size="small">
                                  <InputLabel>Group</InputLabel>
                                  <Select
                                    value={haGroup}
                                    onChange={(e) => setHaGroup(e.target.value)}
                                    label="Group"
                                  >
                                    <MenuItem value="">
                                      <em>{t('common.none')}</em>
                                    </MenuItem>
                                    {haGroups.map((g: any) => (
                                      <MenuItem key={g.group} value={g.group}>
                                        {g.group}
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                                
                                <TextField
                                  label="Max. Restart"
                                  type="number"
                                  size="small"
                                  value={haMaxRestart}
                                  onChange={(e) => setHaMaxRestart(parseInt(e.target.value) || 0)}
                                  inputProps={{ min: 0, max: 10 }}
                                />
                                <FormControl fullWidth size="small">
                                  <InputLabel>Request State</InputLabel>
                                  <Select
                                    value={haState}
                                    onChange={(e) => setHaState(e.target.value)}
                                    label="Request State"
                                  >
                                    <MenuItem value="started">started</MenuItem>
                                    <MenuItem value="stopped">stopped</MenuItem>
                                    <MenuItem value="enabled">enabled</MenuItem>
                                    <MenuItem value="disabled">disabled</MenuItem>
                                    <MenuItem value="ignored">ignored</MenuItem>
                                  </Select>
                                </FormControl>
                                
                                <TextField
                                  label="Max. Relocate"
                                  type="number"
                                  size="small"
                                  value={haMaxRelocate}
                                  onChange={(e) => setHaMaxRelocate(parseInt(e.target.value) || 0)}
                                  inputProps={{ min: 0, max: 10 }}
                                />
                                <Box />
                                
                                <TextField
                                  label="Comment"
                                  size="small"
                                  value={haComment}
                                  onChange={(e) => setHaComment(e.target.value)}
                                  sx={{ gridColumn: '1 / -1' }}
                                />
                              </Box>
                              
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  variant="outlined"
                                  onClick={() => {
                                    setHaEditing(false)
                                    loadHaConfig() // Recharger la config originale
                                  }}
                                  disabled={haSaving}
                                >
                                  {t('common.cancel')}
                                </Button>
                                <Button
                                  variant="contained"
                                  onClick={saveHaConfig}
                                  disabled={haSaving}
                                  startIcon={haSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                                >
                                  {haSaving ? t('common.saving') : (haConfig ? t('common.save') : t('common.enabled'))}
                                </Button>
                              </Stack>
                            </Box>
                          ) : haConfig ? (
                            <Box
                              sx={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, 1fr)',
                                gap: 2,
                                p: 2,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                              }}
                            >
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.state')}</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  <Chip 
                                    label={haConfig.state || 'started'} 
                                    size="small" 
                                    color={haConfig.state === 'started' || haConfig.state === 'enabled' ? 'success' : 'default'}
                                  />
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventory.group')}</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  {haConfig.group || <span style={{ opacity: 0.5 }}>{t('common.none')}</span>}
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Max Restart</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  {haConfig.max_restart ?? 1}
                                </Typography>
                              </Box>
                              <Box>
                                <Typography variant="caption" sx={{ opacity: 0.7 }}>Max Relocate</Typography>
                                <Typography variant="body2" fontWeight={600}>
                                  {haConfig.max_relocate ?? 1}
                                </Typography>
                              </Box>
                              {haConfig.comment && (
                                <Box sx={{ gridColumn: '1 / -1' }}>
                                  <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('inventoryPage.comment')}</Typography>
                                  <Typography variant="body2">
                                    {haConfig.comment}
                                  </Typography>
                                </Box>
                              )}
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                p: 3,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                textAlign: 'center',
                              }}
                            >
                              <i className="ri-shield-cross-line" style={{ fontSize: 48, opacity: 0.3 }} />
                              <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
                                {t('inventory.haNotEnabled')}
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.4 }}>
                                {t('common.noData')}
                              </Typography>
                            </Box>
                          )}
                        </>
                      )}
                    </CardContent>
                  </Card>
                </Box>
              )}

              {/* ==================== ONGLET FIREWALL (9 si cluster, 8 sinon) ==================== */}
              {((selectedVmIsCluster && detailTab === 9) || (!selectedVmIsCluster && detailTab === 8)) && selection?.type === 'vm' && (
                <VmFirewallTab
                  connectionId={parseVmId(selection.id).connId}
                  node={parseVmId(selection.id).node}
                  vmType={data.vmType as 'qemu' | 'lxc'}
                  vmid={parseInt(parseVmId(selection.id).vmid)}
                  vmName={data.name}
                />
              )}

            </>
          )}
    </>
  )
}
