'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
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
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import { formatBytes } from '@/utils/format'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import BackupJobsPanel from '../BackupJobsPanel'
import CveTab from '@/components/CveTab'
import SnapshotsTab from '@/components/SnapshotsTab'
import RollingUpdateWizard from '@/components/RollingUpdateWizard'
import NodeUpdateDialog from '@/components/NodeUpdateDialog'
import NodeFirewallTab from '@/components/NodeFirewallTab'

import type { InventorySelection, DetailsPayload, RrdTimeframe, SeriesPoint, Status } from '../types'
import { formatBps, formatTime, formatUptime, parseMarkdown, parseNodeId, parseVmId, cpuPct, pct, buildSeriesFromRrd, fetchRrd, tagColor } from '../helpers'
import { AreaPctChart, AreaBpsChart2 } from '../components/RrdCharts'
import VCenterSummary from '../components/VCenterSummary'

export default function NodeTabs(props: any) {
  const t = useTranslations()

  const {
    clusterConfigLoaded,
    canShowRrd,
    clusterConfigLoading,
    cveAvailable,
    data,
    deleteReplicationDialogOpen,
    deletingReplicationJob,
    dnsFormData,
    editDnsDialogOpen,
    editHostsDialogOpen,
    editTimeDialogOpen,
    editingReplicationJob,
    error,
    expandedVmsTable,
    favorites,
    handleTableMigrate,
    handleTableVmAction,
    hosts,
    hostsFormData,
    loadClusterConfig,
    loadVmTrendsBatch,
    loading,
    migratingVmIds,
    nodeCephData,
    nodeCephLoading,
    nodeCephLogLive,
    nodeCephSubTab,
    nodeDisksData,
    nodeDisksLoading,
    nodeDisksSubTab,
    nodeNotesData,
    nodeNotesEditValue,
    nodeNotesEditing,
    nodeNotesLoading,
    nodeNotesSaving,
    nodeReplicationData,
    nodeReplicationLoading,
    nodeShellData,
    nodeShellLoading,
    nodeSubscriptionData,
    nodeSubscriptionLoading,
    nodeSyslogData,
    nodeSyslogLive,
    nodeSyslogLoading,
    nodeSystemData,
    nodeSystemLoading,
    nodeSystemSubTab,
    nodeTab,
    onSelect,
    pools,
    primaryColor,
    primaryColorLight,
    removeSubscriptionDialogOpen,
    removeSubscriptionLoading,
    replicationDeleting,
    replicationDialogMode,
    replicationDialogOpen,
    replicationFormData,
    replicationLogData,
    replicationLogDialogOpen,
    replicationLogJob,
    replicationLogLoading,
    replicationSaving,
    rrdError,
    rrdLoading,
    selection,
    series,
    setCreateClusterDialogOpen,
    setDeleteReplicationDialogOpen,
    setDeletingReplicationJob,
    setDnsFormData,
    setEditDnsDialogOpen,
    setEditHostsDialogOpen,
    setEditTimeDialogOpen,
    setEditingReplicationJob,
    setExpandedVmsTable,
    setHostsFormData,
    setJoinClusterDialogOpen,
    setNodeCephData,
    setNodeCephLogLive,
    setNodeCephSubTab,
    setNodeDisksData,
    setNodeDisksLoading,
    setNodeDisksSubTab,
    setNodeNotesData,
    setNodeNotesEditValue,
    setNodeNotesEditing,
    setNodeNotesSaving,
    setNodeReplicationLoaded,
    setNodeShellConnected,
    setNodeShellData,
    setNodeShellLoading,
    setNodeSubscriptionData,
    setNodeSubscriptionLoading,
    setNodeSyslogData,
    setNodeSyslogLive,
    setNodeSyslogLoading,
    setNodeSystemLoaded,
    setNodeSystemSubTab,
    setNodeTab,
    setRemoveSubscriptionDialogOpen,
    setRemoveSubscriptionLoading,
    setReplicationDeleting,
    setReplicationDialogMode,
    setReplicationDialogOpen,
    setReplicationFormData,
    setReplicationLogData,
    setReplicationLogDialogOpen,
    setReplicationLogJob,
    setReplicationLogLoading,
    setReplicationSaving,
    setSubscriptionKeyDialogOpen,
    setSubscriptionKeyInput,
    setSubscriptionKeySaving,
    setSystemReportData,
    setSystemReportDialogOpen,
    setSystemReportLoading,
    setSystemSaving,
    setTf,
    setTimeFormData,
    setTimezonesList,
    subscriptionKeyDialogOpen,
    subscriptionKeyInput,
    subscriptionKeySaving,
    systemReportData,
    systemReportDialogOpen,
    systemReportLoading,
    systemSaving,
    tf,
    timeFormData,
    timezonesList,
    toggleFavorite,
    nodeUpdates,
    setNodeUpdates,
    nodeLocalVms,
    setNodeLocalVms,
    rollingUpdateAvailable,
    rollingUpdateWizardOpen,
    setRollingUpdateWizardOpen,
    updatesDialogOpen,
    setUpdatesDialogOpen,
    updatesDialogNode,
    setUpdatesDialogNode,
  } = props

  const [nodeUpdateDialogOpen, setNodeUpdateDialogOpen] = React.useState(false)

  return (
    <>
          {/* Onglets pour Node: Summary / Notes / Shell / VMs / Disks / System / Ceph (si cluster) / Backups / Cluster (si standalone) / Replication / Subscription */}
          {selection?.type === 'node' && data.vmsData ? (
            <Card variant="outlined" sx={{ width: '100%', borderRadius: 2, flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Tabs
                value={nodeTab}
                onChange={(_e, v) => setNodeTab(v)}
                sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
                variant="scrollable"
                scrollButtons="auto"
              >
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-line-chart-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabSummary')}
                    </Box>
                  }
                />
                {/* Onglet Notes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-file-text-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabNotes')}
                    </Box>
                  }
                />
                {/* Onglet Shell */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-terminal-box-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabShell')}
                    </Box>
                  }
                />
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-computer-line" style={{ fontSize: 16 }} />
                      {t('inventory.vms')}
                      <Chip size="small" label={data.vmsData.length} sx={{ height: 18, fontSize: 11 }} />
                    </Box>
                  }
                />
                {/* Onglet Snapshots */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-camera-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabSnapshots')}
                    </Box>
                  }
                />
                {/* Onglet Disks pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabDisks')}
                    </Box>
                  }
                />
                {/* Onglet System pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-settings-3-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabSystem')}
                    </Box>
                  }
                />
                {/* Onglet Firewall pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-shield-keyhole-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabFirewall')}
                    </Box>
                  }
                />
                {/* Onglet Ceph seulement pour les nodes dans un cluster */}
                {data.clusterName && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-database-2-line" style={{ fontSize: 16 }} />
                        {t('inventory.tabCeph')}
                      </Box>
                    }
                  />
                )}
                {/* Onglet Backups seulement pour les hosts standalone (pas dans un cluster) */}
                {!data.clusterName && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-calendar-schedule-line" style={{ fontSize: 16 }} />
                        {t('inventory.tabBackups')}
                      </Box>
                    }
                  />
                )}
                {/* Onglet Cluster seulement pour les hosts standalone */}
                {!data.clusterName && (
                  <Tab
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-git-branch-line" style={{ fontSize: 16 }} />
                        {t('inventory.tabCluster')}
                      </Box>
                    }
                  />
                )}
                {/* Onglet Replication pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-refresh-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabReplication')}
                    </Box>
                  }
                />
                {/* Onglet Updates */}
                <Tab
                  disabled={!rollingUpdateAvailable}
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: rollingUpdateAvailable ? 1 : 0.4 }}>
                      <i className="ri-download-cloud-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabUpdates')}
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
                {/* Onglet CVE Scanner */}
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
                {/* Onglet Subscription pour tous les nodes */}
                <Tab
                  label={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-vip-crown-line" style={{ fontSize: 16 }} />
                      {t('inventory.tabSubscription')}
                    </Box>
                  }
                />
              </Tabs>

              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                {/* Onglet Summary - Graphiques RRD */}
                {nodeTab === 0 && canShowRrd && (
                  <Box sx={{ p: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
                      <Typography fontWeight={700} fontSize={14}>{t('inventory.performances')}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {[
                          { label: '1h', value: 'hour' as RrdTimeframe },
                          { label: '24h', value: 'day' as RrdTimeframe },
                          { label: '7j', value: 'week' as RrdTimeframe },
                          { label: '30j', value: 'month' as RrdTimeframe },
                          { label: '1an', value: 'year' as RrdTimeframe },
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

                    {rrdLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={32} />
                      </Box>
                    ) : rrdError ? (
                      <Alert severity="error" sx={{ mb: 2 }}>{rrdError}</Alert>
                    ) : (
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
                            {t('inventory.networkTrafficChart')}
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

                        {/* Server Load (nodes) ou Disk I/O (VMs) */}
                        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                          <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                            {selection?.type === 'node' ? t('inventory.serverLoad') : t('inventory.diskIo')}
                          </Typography>
                          <Box sx={{ height: 160 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              {selection?.type === 'node' ? (
                                <AreaChart data={series}>
                                  <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                                  <YAxis tick={{ fontSize: 9 }} width={30} domain={[0, 'auto']} />
                                  <Tooltip
                                    labelFormatter={v => new Date(Number(v)).toLocaleString()}
                                    formatter={(v: any) => [Number(v).toFixed(2), 'Load']}
                                  />
                                  <Area type="monotone" dataKey="loadAvg" stroke={primaryColor} fill={primaryColor} fillOpacity={0.4} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                                </AreaChart>
                              ) : (
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
                    )}
                  </Box>
                )}

                {nodeTab === 0 && !canShowRrd && (
                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                    <i className="ri-line-chart-line" style={{ fontSize: 48, marginBottom: 8 }} />
                    <Typography>{t('common.noData')}</Typography>
                  </Box>
                )}

                {/* Onglet Notes - Index 1 */}
                {nodeTab === 1 && (
                  <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                      <Typography variant="subtitle2" fontWeight={700}>{t('inventory.nodeNotes')}</Typography>
                      {!nodeNotesEditing ? (
                        <Button 
                          size="small" 
                          variant="outlined"
                          startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                          onClick={() => {
                            setNodeNotesEditValue(nodeNotesData)
                            setNodeNotesEditing(true)
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                      ) : (
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined"
                            onClick={() => setNodeNotesEditing(false)}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button 
                            size="small" 
                            variant="contained"
                            disabled={nodeNotesSaving}
                            onClick={async () => {
                              setNodeNotesSaving(true)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/notes`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ notes: nodeNotesEditValue })
                                })
                                if (res.ok) {
                                  setNodeNotesData(nodeNotesEditValue)
                                  setNodeNotesEditing(false)
                                } else {
                                  const err = await res.json()
                                  alert(err.error || t('inventory.failedToSaveNotes'))
                                }
                              } finally {
                                setNodeNotesSaving(false)
                              }
                            }}
                          >
                            {nodeNotesSaving ? <CircularProgress size={20} /> : t('inventory.save')}
                          </Button>
                        </Box>
                      )}
                    </Box>
                    {nodeNotesLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeNotesEditing ? (
                      <TextField
                        fullWidth
                        multiline
                        rows={15}
                        value={nodeNotesEditValue}
                        onChange={(e) => setNodeNotesEditValue(e.target.value)}
                        placeholder={t('inventory.enterNotesPlaceholder')}
                        sx={{ flex: 1, '& textarea': { fontFamily: 'inherit' } }}
                      />
                    ) : (
                      <Card variant="outlined" sx={{ flex: 1 }}>
                        <CardContent sx={{ height: '100%' }}>
                          {nodeNotesData ? (
                            <Box 
                              sx={{ 
                                whiteSpace: 'pre-wrap', 
                                wordBreak: 'break-word',
                                fontFamily: 'inherit',
                                fontSize: 14
                              }}
                            >
                              {nodeNotesData}
                            </Box>
                          ) : (
                            <Box sx={{ textAlign: 'center', opacity: 0.5, py: 4 }}>
                              <i className="ri-file-text-line" style={{ fontSize: 48 }} />
                              <Typography sx={{ mt: 1 }}>{t('inventory.noNotesForNode')}</Typography>
                              <Typography variant="caption">{t('inventory.clickEditToAddNotes')}</Typography>
                            </Box>
                          )}
                        </CardContent>
                      </Card>
                    )}
                  </Box>
                )}

                {/* Onglet Shell - Index 2 */}
                {nodeTab === 2 && (
                  <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {!nodeShellData ? (
                      // Pas encore de session - afficher le bouton de connexion
                      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#1e1e1e' }}>
                        <Box sx={{ textAlign: 'center' }}>
                          <i className="ri-terminal-box-line" style={{ fontSize: 64, color: '#444' }} />
                          <Typography sx={{ mt: 2, color: '#888' }}>{t('inventory.nodeShell')}</Typography>
                          <Typography variant="caption" sx={{ color: '#666', display: 'block', mt: 1, mb: 3 }}>
                            {t('inventory.connectToNodeCli')}
                          </Typography>
                          <Button 
                            variant="contained"
                            disabled={nodeShellLoading}
                            startIcon={nodeShellLoading ? <CircularProgress size={16} /> : <i className="ri-terminal-box-line" />}
                            onClick={async () => {
                              setNodeShellLoading(true)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/terminal`, {
                                  method: 'POST'
                                })
                                if (res.ok) {
                                  const json = await res.json()
                                  setNodeShellData({ ...json.data, node })
                                  setNodeShellConnected(true)
                                } else {
                                  const err = await res.json()
                                  alert(err.error || t('inventory.failedToCreateTerminal'))
                                }
                              } catch (e: any) {
                                alert(e.message || t('inventory.failedToCreateTerminal'))
                              } finally {
                                setNodeShellLoading(false)
                              }
                            }}
                          >
                            {nodeShellLoading ? t('inventory.connecting') : t('inventory.connectToShell')}
                          </Button>
                        </Box>
                      </Box>
                    ) : (
                      // Session active - afficher le terminal xterm.js
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                        {/* Lazy load du composant XTermShell */}
                        {(() => {
                          const XTermShell = require('@/components/xterm/XTermShell').default
                          return (
                            <XTermShell
                              wsUrl={nodeShellData.wsUrl}
                              host={nodeShellData.host}
                              port={nodeShellData.port}
                              ticket={nodeShellData.ticket}
                              node={nodeShellData.node}
                              user={nodeShellData.user}
                              pvePort={nodeShellData.nodePort}
                              apiToken={nodeShellData.apiToken}
                              onDisconnect={() => {
                                setNodeShellData(null)
                                setNodeShellConnected(false)
                              }}
                            />
                          )
                        })()}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet VMs - Index 3 */}
                {nodeTab === 3 && (
                  <>
                    <Box sx={{ 
                      px: 2, 
                      py: 1.5, 
                      borderBottom: '1px solid', 
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end'
                    }}>
                      <Button
                        size="small"
                        variant={expandedVmsTable ? 'contained' : 'outlined'}
                        onClick={() => setExpandedVmsTable(!expandedVmsTable)}
                        startIcon={<i className={expandedVmsTable ? 'ri-collapse-diagonal-line' : 'ri-expand-diagonal-line'} />}
                        sx={{ 
                          textTransform: 'none',
                          fontSize: '0.75rem',
                        }}
                      >
                        {expandedVmsTable ? t('inventory.compactView') : t('inventory.fullView')}
                      </Button>
                    </Box>
                    {data.vmsData.length > 0 ? (
                      <VmsTable
                        vms={data.vmsData as VmRow[]}
                        compact={!expandedVmsTable}
                        expanded={expandedVmsTable}
                        maxHeight={expandedVmsTable ? 500 : 400}
                        showTrends={expandedVmsTable}
                        showActions={true}
                        onLoadTrendsBatch={loadVmTrendsBatch}
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
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-computer-line" style={{ fontSize: 48, marginBottom: 8 }} />
                        <Typography>{t('inventory.noVmsOnNode')}</Typography>
                      </Box>
                    )}
                  </>
                )}

                {/* Onglet Snapshots - Index 4 */}
                {nodeTab === 4 && (
                  <Box sx={{ overflow: 'auto' }}>
                    <SnapshotsTab
                      connectionId={selection?.id?.split(':')[0] || ''}
                      node={data.nodeName || selection?.id?.split(':').pop() || ''}
                    />
                  </Box>
                )}

                {/* Onglet Disks - Index 5 */}
                {nodeTab === 5 && (
                  <Box sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {nodeDisksLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeDisksData ? (
                      <>
                        {/* Sous-onglets Disks */}
                        <Tabs
                          value={nodeDisksSubTab}
                          onChange={(_e, v) => setNodeDisksSubTab(v)}
                          sx={{ borderBottom: 1, borderColor: 'divider', px: 2, minHeight: 40 }}
                        >
                          <Tab label={t('inventory.tabDisks')} sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="LVM" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="LVM-Thin" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label={t('inventory.tabDirectory')} sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="ZFS" sx={{ minHeight: 40, py: 0 }} />
                        </Tabs>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                          {/* Disks - Liste des disques physiques */}
                          {nodeDisksSubTab === 0 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>{t('inventory.physicalDisks')}</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                                      onClick={async () => {
                                        setNodeDisksLoading(true)
                                        const { connId, node } = parseNodeId(selection?.id || '')
                                        try {
                                          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/disks?section=disks`, { cache: 'no-store' })
                                          if (res.ok) {
                                            const json = await res.json()
                                            setNodeDisksData((prev: any) => ({ ...prev, disks: json.data?.disks || [] }))
                                          }
                                        } finally {
                                          setNodeDisksLoading(false)
                                        }
                                      }}
                                    >
                                      {t('inventory.reload')}
                                    </Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.disks) ? nodeDisksData.disks : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.device')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.type')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.usage')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>{t('inventory.size')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.model')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.serial')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.health.label')}</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>{t('inventory.wearout')}</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.disks.map((disk: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{disk.devpath}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={disk.type?.toUpperCase() || 'HDD'} 
                                                color={disk.type === 'nvme' || disk.type === 'ssd' ? 'info' : 'default'}
                                                sx={{ height: 20, fontSize: 10 }}
                                              />
                                            </TableCell>
                                            <TableCell>
                                              {disk.used ? (
                                                <Chip 
                                                  size="small" 
                                                  label={disk.used} 
                                                  color={disk.used === 'unused' ? 'default' : 'primary'}
                                                  variant="outlined"
                                                  sx={{ height: 20, fontSize: 10 }}
                                                />
                                              ) : (
                                                <Typography variant="caption" sx={{ opacity: 0.5 }}>-</Typography>
                                              )}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {disk.size ? `${(disk.size / 1024 / 1024 / 1024).toFixed(1)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                              {disk.model || '-'}
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                              {disk.serial || '-'}
                                            </TableCell>
                                            <TableCell>
                                              {disk.health ? (
                                                <Chip 
                                                  size="small" 
                                                  label={disk.health} 
                                                  color={disk.health === 'PASSED' ? 'success' : disk.health === 'FAILED' ? 'error' : 'warning'}
                                                  sx={{ height: 20, fontSize: 10 }}
                                                />
                                              ) : (
                                                <Typography variant="caption" sx={{ opacity: 0.5 }}>-</Typography>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              {disk.wearout !== undefined && disk.wearout !== null ? (
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                  <LinearProgress
                                                    variant="determinate"
                                                    value={100 - (disk.wearout || 0)}
                                                    sx={{
                                                      width: 50,
                                                      height: 14,
                                                      borderRadius: 0,
                                                      bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                                                      '& .MuiLinearProgress-bar': {
                                                        borderRadius: 0,
                                                        background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)',
                                                        backgroundSize: (100 - (disk.wearout || 0)) > 0 ? `${(100 / (100 - (disk.wearout || 0))) * 100}% 100%` : '100% 100%',
                                                      }
                                                    }}
                                                  />
                                                  <Typography variant="caption">{disk.wearout}%</Typography>
                                                </Box>
                                              ) : (
                                                <Typography variant="caption" sx={{ opacity: 0.5 }}>N/A</Typography>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-hard-drive-2-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No disks found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* LVM */}
                          {nodeDisksSubTab === 1 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>LVM Volume Groups</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: Volume Group</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.lvm) ? nodeDisksData.lvm : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Free</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}># LVs</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}># PVs</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.lvm.map((vg: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{vg.name}</TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {vg.size ? `${(vg.size / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {vg.free ? `${(vg.free / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{vg.lvcount ?? '-'}</TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{vg.pvcount ?? '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-stack-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No LVM Volume Groups found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* LVM-Thin */}
                          {nodeDisksSubTab === 2 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>LVM Thin Pools</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: Thinpool</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.lvmthin) ? nodeDisksData.lvmthin : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Volume Group</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Used</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Metadata Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Metadata Used</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.lvmthin.map((tp: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{tp.lv}</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{tp.vg}</TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {tp.lv_size ? `${(tp.lv_size / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right' }}>
                                              {tp.used !== undefined ? `${tp.used.toFixed(1)}%` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {tp.metadata_size ? `${(tp.metadata_size / 1024 / 1024).toFixed(2)} MiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right' }}>
                                              {tp.metadata_used !== undefined ? `${tp.metadata_used.toFixed(1)}%` : '-'}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-stack-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No Thin-Pool found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* Directory */}
                          {nodeDisksSubTab === 3 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Directory Storage</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: Directory</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.directory) ? nodeDisksData.directory : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Path</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Device</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Filesystem</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Options</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.directory.map((dir: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{dir.path}</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{dir.device || '-'}</TableCell>
                                            <TableCell>{dir.type || '-'}</TableCell>
                                            <TableCell sx={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{dir.options || '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-folder-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No Directory storage found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* ZFS */}
                          {nodeDisksSubTab === 4 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>ZFS Pools</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-eye-line" style={{ fontSize: 14 }} />}>Detail</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create: ZFS</Button>
                                  </Box>
                                </Box>
                                {(Array.isArray(nodeDisksData.zfs) ? nodeDisksData.zfs : []).length > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Size</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Allocated</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'right' }}>Free</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}>Frag</TableCell>
                                          <TableCell sx={{ fontWeight: 700, textAlign: 'center' }}>Dedup</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Health</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeDisksData.zfs.map((pool: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{pool.name}</TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {pool.size ? `${(pool.size / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {pool.alloc ? `${(pool.alloc / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                                              {pool.free ? `${(pool.free / 1024 / 1024 / 1024).toFixed(2)} GiB` : '-'}
                                            </TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{pool.frag ?? '-'}</TableCell>
                                            <TableCell sx={{ textAlign: 'center' }}>{pool.dedup ?? '-'}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={pool.health || 'UNKNOWN'} 
                                                color={pool.health === 'ONLINE' ? 'success' : pool.health === 'DEGRADED' ? 'warning' : pool.health === 'FAULTED' ? 'error' : 'default'}
                                                sx={{ height: 20, fontSize: 10 }}
                                              />
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <i className="ri-database-line" style={{ fontSize: 32 }} />
                                    <Typography variant="body2" sx={{ mt: 1 }}>No ZFS pools found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-hard-drive-2-line" style={{ fontSize: 48 }} />
                        <Typography sx={{ mt: 1 }}>Unable to load disk data</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet System - Index 6 pour tous les nodes */}
                {nodeTab === 6 && (
                  <Box sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {nodeSystemLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeSystemData ? (
                      <>
                        {/* Sous-onglets System */}
                        <Tabs
                          value={nodeSystemSubTab}
                          onChange={(_e, v) => setNodeSystemSubTab(v)}
                          sx={{ borderBottom: 1, borderColor: 'divider', px: 2, minHeight: 40 }}
                        >
                          <Tab label="Network" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Certificates" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="DNS" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Hosts" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Options" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Time" sx={{ minHeight: 40, py: 0 }} />
                          <Tab label="Syslog" sx={{ minHeight: 40, py: 0 }} />
                        </Tabs>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                          {/* Network */}
                          {nodeSystemSubTab === 0 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Network Interfaces</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}>Create</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Revert</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-check-line" style={{ fontSize: 14 }} />}>Apply</Button>
                                  </Box>
                                </Box>
                                {(nodeSystemData.network?.length || 0) > 0 ? (
                                  <TableContainer sx={{ maxHeight: 400 }}>
                                    <Table size="small" stickyHeader>
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Type</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Active</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Autostart</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>CIDR</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Gateway</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Ports/Slaves</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Comment</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeSystemData.network.map((iface: any, idx: number) => (
                                          <TableRow key={idx} hover>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{iface.iface}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={iface.type} 
                                                color={iface.type === 'bridge' ? 'primary' : iface.type === 'bond' ? 'secondary' : 'default'}
                                                sx={{ height: 20, fontSize: 10 }}
                                              />
                                            </TableCell>
                                            <TableCell>
                                              <Chip size="small" label={iface.active ? 'Yes' : 'No'} color={iface.active ? 'success' : 'default'} sx={{ height: 20, fontSize: 10 }} />
                                            </TableCell>
                                            <TableCell>
                                              <Chip size="small" label={iface.autostart ? 'Yes' : 'No'} color={iface.autostart ? 'success' : 'default'} sx={{ height: 20, fontSize: 10 }} />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{iface.cidr || iface.address || '-'}</TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{iface.gateway || '-'}</TableCell>
                                            <TableCell sx={{ fontSize: 11 }}>{iface.bridge_ports || iface.slaves || '-'}</TableCell>
                                            <TableCell sx={{ fontSize: 11, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{iface.comments || '-'}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <Typography variant="body2">No network interfaces found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* Certificates */}
                          {nodeSystemSubTab === 1 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>SSL Certificates</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-upload-line" style={{ fontSize: 14 }} />}>Upload Custom</Button>
                                    <Button size="small" variant="outlined" disabled startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Renew</Button>
                                  </Box>
                                </Box>
                                {(nodeSystemData.certificates?.length || 0) > 0 ? (
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow>
                                          <TableCell sx={{ fontWeight: 700 }}>File</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Issuer</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Subject</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Valid From</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Valid Until</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Fingerprint</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeSystemData.certificates.map((cert: any, idx: number) => {
                                          const now = Date.now() / 1000
                                          const isExpired = cert.notAfter && cert.notAfter < now
                                          const isExpiringSoon = cert.notAfter && cert.notAfter < now + 30 * 24 * 3600 && !isExpired
                                          return (
                                            <TableRow key={idx} hover>
                                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{cert.filename}</TableCell>
                                              <TableCell sx={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cert.issuer}</TableCell>
                                              <TableCell sx={{ fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cert.subject}</TableCell>
                                              <TableCell sx={{ fontSize: 11 }}>{cert.notBefore ? new Date(cert.notBefore * 1000).toLocaleDateString() : '-'}</TableCell>
                                              <TableCell>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                  <Typography sx={{ fontSize: 11, color: isExpired ? 'error.main' : isExpiringSoon ? 'warning.main' : 'inherit' }}>
                                                    {cert.notAfter ? new Date(cert.notAfter * 1000).toLocaleDateString() : '-'}
                                                  </Typography>
                                                  {isExpired && <Chip size="small" label="EXPIRED" color="error" sx={{ height: 16, fontSize: 9 }} />}
                                                  {isExpiringSoon && <Chip size="small" label="EXPIRING" color="warning" sx={{ height: 16, fontSize: 9 }} />}
                                                </Box>
                                              </TableCell>
                                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 10, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cert.fingerprint}</TableCell>
                                            </TableRow>
                                          )
                                        })}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <Typography variant="body2">No certificates found</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}

                          {/* DNS */}
                          {nodeSystemSubTab === 2 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>DNS Configuration</Typography>
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                                    onClick={() => {
                                      setDnsFormData({
                                        search: nodeSystemData.dns?.search || '',
                                        dns1: nodeSystemData.dns?.dns1 || '',
                                        dns2: nodeSystemData.dns?.dns2 || '',
                                        dns3: nodeSystemData.dns?.dns3 || '',
                                      })
                                      setEditDnsDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </Box>
                                <TableContainer>
                                  <Table size="small">
                                    <TableBody>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600, width: 200 }}>Search Domain</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.search || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>DNS Server 1</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.dns1 || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>DNS Server 2</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.dns2 || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>DNS Server 3</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.dns?.dns3 || '-'}</TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Hosts */}
                          {nodeSystemSubTab === 3 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>/etc/hosts</Typography>
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                                    onClick={() => {
                                      setHostsFormData({
                                        data: nodeSystemData.hosts?.data || '',
                                        digest: nodeSystemData.hosts?.digest || '',
                                      })
                                      setEditHostsDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </Box>
                                <Box 
                                  component="pre" 
                                  sx={{ 
                                    fontFamily: 'monospace', 
                                    fontSize: 12, 
                                    m: 0, 
                                    p: 2, 
                                    whiteSpace: 'pre-wrap',
                                    bgcolor: 'background.default',
                                    maxHeight: 300,
                                    overflow: 'auto'
                                  }}
                                >
                                  {nodeSystemData.hosts?.data || 'No hosts file content'}
                                </Box>
                              </CardContent>
                            </Card>
                          )}

                          {/* Options */}
                          {nodeSystemSubTab === 4 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Node Options</Typography>
                                </Box>
                                <TableContainer>
                                  <Table size="small">
                                    <TableBody>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600, width: 250 }}>Description</TableCell>
                                        <TableCell>{nodeSystemData.options?.description || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Wake on LAN</TableCell>
                                        <TableCell>{nodeSystemData.options?.wakeonlan || 'No'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Start all VMs on boot delay</TableCell>
                                        <TableCell>{nodeSystemData.options?.startall_onboot_delay || '0'} seconds</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>ACME Account</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{nodeSystemData.options?.acme || '-'}</TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Time */}
                          {nodeSystemSubTab === 5 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Time Configuration</Typography>
                                  <Button 
                                    size="small" 
                                    variant="outlined" 
                                    startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                                    onClick={async () => {
                                      setTimeFormData({ timezone: nodeSystemData.time?.timezone || '' })
                                      // Charger les timezones si pas encore fait
                                      if (timezonesList.length === 0) {
                                        const { connId, node } = parseNodeId(selection?.id || '')
                                        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system?section=time`, { cache: 'no-store' })
                                        if (res.ok) {
                                          const json = await res.json()
                                          setTimezonesList(json.data?.timezones || [])
                                        }
                                      }
                                      setEditTimeDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                </Box>
                                <TableContainer>
                                  <Table size="small">
                                    <TableBody>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600, width: 200 }}>Timezone</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeSystemData.time?.timezone || '-'}</TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>Local Time</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                          {nodeSystemData.time?.localtime ? new Date(nodeSystemData.time.localtime * 1000).toLocaleString() : '-'}
                                        </TableCell>
                                      </TableRow>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 600 }}>UTC Time</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                          {nodeSystemData.time?.time ? new Date(nodeSystemData.time.time * 1000).toISOString() : '-'}
                                        </TableCell>
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Syslog */}
                          {nodeSystemSubTab === 6 && (
                            <Card variant="outlined">
                              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Typography variant="subtitle2" fontWeight={700}>System Log</Typography>
                                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    {nodeSyslogLive && (
                                      <Chip 
                                        size="small" 
                                        label="LIVE" 
                                        color="success"
                                        sx={{ height: 20, fontSize: 10, animation: 'pulse 1.5s infinite' }}
                                      />
                                    )}
                                    <Button 
                                      size="small" 
                                      variant={nodeSyslogLive ? 'contained' : 'outlined'}
                                      color={nodeSyslogLive ? 'error' : 'primary'}
                                      startIcon={<i className={nodeSyslogLive ? 'ri-stop-line' : 'ri-play-line'} style={{ fontSize: 14 }} />}
                                      onClick={() => setNodeSyslogLive(!nodeSyslogLive)}
                                    >
                                      {nodeSyslogLive ? 'Stop' : 'Live'}
                                    </Button>
                                    <Button 
                                      size="small" 
                                      variant="outlined"
                                      disabled={nodeSyslogLoading}
                                      startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                                      onClick={async () => {
                                        setNodeSyslogLoading(true)
                                        const { connId, node } = parseNodeId(selection?.id || '')
                                        try {
                                          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/syslog?limit=200&_t=${Date.now()}`, { cache: 'no-store' })
                                          if (res.ok) {
                                            const json = await res.json()
                                            setNodeSyslogData(json.data || [])
                                          }
                                        } finally {
                                          setNodeSyslogLoading(false)
                                        }
                                      }}
                                    >
                                      Refresh
                                    </Button>
                                  </Box>
                                </Box>
                                {nodeSyslogLoading ? (
                                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                    <CircularProgress size={24} />
                                  </Box>
                                ) : nodeSyslogData.length > 0 ? (
                                  <Box 
                                    component="pre" 
                                    sx={{ 
                                      fontFamily: 'monospace', 
                                      fontSize: 11, 
                                      m: 0, 
                                      p: 2, 
                                      whiteSpace: 'pre-wrap',
                                      bgcolor: 'background.default',
                                      maxHeight: 400,
                                      overflow: 'auto'
                                    }}
                                  >
                                    {nodeSyslogData.map((line, i) => {
                                      // Coloration syntaxique basique
                                      const isError = /error|fail|crit/i.test(line)
                                      const isWarning = /warn/i.test(line)
                                      return (
                                        <Box 
                                          key={i} 
                                          component="div"
                                          sx={{ 
                                            color: isError ? 'error.main' : isWarning ? 'warning.main' : 'inherit',
                                            '&:hover': { bgcolor: 'action.hover' }
                                          }}
                                        >
                                          {line}
                                        </Box>
                                      )
                                    })}
                                  </Box>
                                ) : (
                                  <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                    <Typography variant="body2">No log entries</Typography>
                                  </Box>
                                )}
                              </CardContent>
                            </Card>
                          )}
                        </Box>

                        {/* Dialog Edit DNS */}
                        <Dialog open={editDnsDialogOpen} onClose={() => setEditDnsDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle>Edit DNS Configuration</DialogTitle>
                          <DialogContent>
                            <Stack spacing={2} sx={{ mt: 1 }}>
                              <TextField
                                fullWidth
                                size="small"
                                label="Search Domain"
                                value={dnsFormData.search}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, search: e.target.value }))}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="DNS Server 1"
                                value={dnsFormData.dns1}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, dns1: e.target.value }))}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="DNS Server 2"
                                value={dnsFormData.dns2}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, dns2: e.target.value }))}
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="DNS Server 3"
                                value={dnsFormData.dns3}
                                onChange={(e) => setDnsFormData(prev => ({ ...prev, dns3: e.target.value }))}
                              />
                            </Stack>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setEditDnsDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={systemSaving}
                              onClick={async () => {
                                setSystemSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ section: 'dns', data: dnsFormData })
                                  })
                                  if (res.ok) {
                                    setEditDnsDialogOpen(false)
                                    setNodeSystemLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to update DNS')
                                  }
                                } finally {
                                  setSystemSaving(false)
                                }
                              }}
                            >
                              {systemSaving ? <CircularProgress size={20} /> : 'Save'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Edit Hosts */}
                        <Dialog open={editHostsDialogOpen} onClose={() => setEditHostsDialogOpen(false)} maxWidth="md" fullWidth>
                          <DialogTitle>Edit /etc/hosts</DialogTitle>
                          <DialogContent>
                            <TextField
                              fullWidth
                              multiline
                              rows={15}
                              value={hostsFormData.data}
                              onChange={(e) => setHostsFormData(prev => ({ ...prev, data: e.target.value }))}
                              sx={{ mt: 1, '& textarea': { fontFamily: 'monospace', fontSize: 12 } }}
                            />
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setEditHostsDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={systemSaving}
                              onClick={async () => {
                                setSystemSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ section: 'hosts', data: hostsFormData })
                                  })
                                  if (res.ok) {
                                    setEditHostsDialogOpen(false)
                                    setNodeSystemLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to update hosts')
                                  }
                                } finally {
                                  setSystemSaving(false)
                                }
                              }}
                            >
                              {systemSaving ? <CircularProgress size={20} /> : 'Save'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Edit Time */}
                        <Dialog open={editTimeDialogOpen} onClose={() => setEditTimeDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle>Edit Time Configuration</DialogTitle>
                          <DialogContent>
                            <Autocomplete
                              fullWidth
                              size="small"
                              options={timezonesList}
                              value={timeFormData.timezone}
                              onChange={(_, v) => setTimeFormData({ timezone: v || '' })}
                              renderInput={(params) => <TextField {...params} label="Timezone" sx={{ mt: 2 }} />}
                              loading={timezonesList.length === 0}
                            />
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setEditTimeDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={systemSaving || !timeFormData.timezone}
                              onClick={async () => {
                                setSystemSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/system`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ section: 'time', data: timeFormData })
                                  })
                                  if (res.ok) {
                                    setEditTimeDialogOpen(false)
                                    setNodeSystemLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to update time')
                                  }
                                } finally {
                                  setSystemSaving(false)
                                }
                              }}
                            >
                              {systemSaving ? <CircularProgress size={20} /> : 'Save'}
                            </Button>
                          </DialogActions>
                        </Dialog>
                      </>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-settings-3-line" style={{ fontSize: 48 }} />
                        <Typography sx={{ mt: 1 }}>Unable to load system data</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Firewall - Index 7 */}
                {nodeTab === 7 && (
                  <Box sx={{ p: 2 }}>
                    <NodeFirewallTab connectionId={parseNodeId(selection?.id || '').connId} node={parseNodeId(selection?.id || '').node} />
                  </Box>
                )}

                {/* Onglet Ceph (cluster nodes only) - Index 8 */}
                {nodeTab === 8 && data.clusterName && (
                  <Box sx={{ p: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
                    {nodeCephLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : nodeCephData?.hasCeph === false ? (
                      /* Ceph non installé */
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
                          Ceph not installed
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.7, mb: 3, maxWidth: 400, mx: 'auto' }}>
                          Ceph is a distributed storage system that provides high availability and scalability.
                          Install Ceph to enable distributed storage on this cluster.
                        </Typography>
                        <Button
                          variant="contained"
                          startIcon={<i className="ri-download-cloud-line" />}
                          disabled
                        >
                          Install Ceph
                        </Button>
                        <Typography variant="caption" sx={{ display: 'block', mt: 1, opacity: 0.5 }}>
                          Coming soon - Use Proxmox VE directly for now
                        </Typography>
                      </Box>
                    ) : nodeCephData ? (
                      /* Ceph installé - Sous-onglets */
                      <>
                        <Tabs
                          value={nodeCephSubTab}
                          onChange={(_e, v) => setNodeCephSubTab(v)}
                          sx={{ 
                            borderBottom: 1, 
                            borderColor: 'divider', 
                            minHeight: 36,
                            '& .MuiTab-root': { minHeight: 36, py: 0.5, fontSize: 13 }
                          }}
                        >
                          <Tab label="Configuration" />
                          <Tab label="Monitor" />
                          <Tab label="OSD" />
                          <Tab label="CephFS" />
                          <Tab label="Pools" />
                          <Tab label="Log" />
                        </Tabs>

                        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                          {/* Configuration */}
                          {nodeCephSubTab === 0 && (
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 300px' }, gap: 2 }}>
                              <Stack spacing={2}>
                                {/* Configuration globale */}
                                <Card variant="outlined">
                                  <CardContent>
                                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Configuration</Typography>
                                    <Box sx={{ 
                                      bgcolor: 'grey.900', 
                                      borderRadius: 1, 
                                      p: 2, 
                                      fontFamily: 'monospace', 
                                      fontSize: 12,
                                      maxHeight: 300,
                                      overflow: 'auto',
                                      whiteSpace: 'pre-wrap',
                                      color: '#e0e0e0'
                                    }}>
                                      {nodeCephData.config?.global ? (
                                        Object.entries(nodeCephData.config.global).map(([section, values]: [string, any]) => (
                                          <Box key={section}>
                                            <Box sx={{ color: '#4fc3f7', fontWeight: 700 }}>[{section}]</Box>
                                            {typeof values === 'object' && values !== null ? (
                                              Object.entries(values).map(([k, v]) => (
                                                <Box key={k} sx={{ pl: 2 }}>
                                                  <span style={{ color: '#81c784' }}>{k}</span> = {String(v)}
                                                </Box>
                                              ))
                                            ) : (
                                              <Box sx={{ pl: 2 }}>{String(values)}</Box>
                                            )}
                                          </Box>
                                        ))
                                      ) : (
                                        <Typography variant="caption" sx={{ opacity: 0.5 }}>No configuration available</Typography>
                                      )}
                                    </Box>
                                  </CardContent>
                                </Card>

                                {/* Configuration Database */}
                                <Card variant="outlined">
                                  <CardContent>
                                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Configuration Database</Typography>
                                    {nodeCephData.config?.database?.length > 0 ? (
                                      <TableContainer sx={{ maxHeight: 250 }}>
                                        <Table size="small" stickyHeader>
                                          <TableHead>
                                            <TableRow>
                                              <TableCell sx={{ fontWeight: 700, width: 120 }}>WHO</TableCell>
                                              <TableCell sx={{ fontWeight: 700 }}>OPTION</TableCell>
                                              <TableCell sx={{ fontWeight: 700, width: 150 }}>VALUE</TableCell>
                                            </TableRow>
                                          </TableHead>
                                          <TableBody>
                                            {nodeCephData.config.database.map((item: any, idx: number) => (
                                              <TableRow key={idx}>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.section || item.who || 'global'}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.name || item.option}</TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{item.value}</TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </TableContainer>
                                    ) : (
                                      <Typography variant="body2" sx={{ opacity: 0.5 }}>No custom configuration</Typography>
                                    )}
                                  </CardContent>
                                </Card>
                              </Stack>

                              {/* Crush Map */}
                              <Card variant="outlined">
                                <CardContent>
                                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Crush Map</Typography>
                                  <Box sx={{ 
                                    bgcolor: 'grey.900', 
                                    borderRadius: 1, 
                                    p: 2, 
                                    fontFamily: 'monospace', 
                                    fontSize: 11,
                                    maxHeight: 500,
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    color: '#e0e0e0'
                                  }}>
                                    {nodeCephData.config?.crushMap || 'Crush map not available'}
                                  </Box>
                                </CardContent>
                              </Card>
                            </Box>
                          )}

                          {/* Monitor */}
                          {nodeCephSubTab === 1 && (
                            <Stack spacing={2}>
                              {/* Monitors */}
                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Monitor</Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />} disabled>Start</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-stop-line" style={{ fontSize: 14 }} />} disabled>Stop</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} disabled>Restart</Button>
                                      <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                    </Box>
                                  </Box>
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Host</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Address</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Quorum</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {(Array.isArray(nodeCephData.monitors) ? nodeCephData.monitors : []).map((mon: any) => (
                                          <TableRow key={mon.name}>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>{mon.name}</TableCell>
                                            <TableCell>{mon.host}</TableCell>
                                            <TableCell>
                                              <Chip 
                                                size="small" 
                                                label={mon.quorum ? 'running' : 'stopped'} 
                                                color={mon.quorum ? 'success' : 'default'}
                                                sx={{ height: 20, fontSize: 11 }}
                                              />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{mon.addr}</TableCell>
                                            <TableCell>{mon.ceph_version_short || mon.ceph_version?.split(' ')[2]}</TableCell>
                                            <TableCell>
                                              {mon.quorum ? (
                                                <Chip size="small" label="Yes" color="success" sx={{ height: 20, fontSize: 11 }} />
                                              ) : (
                                                <Chip size="small" label="No" color="error" sx={{ height: 20, fontSize: 11 }} />
                                              )}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </CardContent>
                              </Card>

                              {/* Managers */}
                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Manager</Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />} disabled>Start</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-stop-line" style={{ fontSize: 14 }} />} disabled>Stop</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} disabled>Restart</Button>
                                      <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                    </Box>
                                  </Box>
                                  <TableContainer>
                                    <Table size="small">
                                      <TableHead>
                                        <TableRow sx={{ bgcolor: 'action.hover' }}>
                                          <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Host</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Address</TableCell>
                                          <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                        </TableRow>
                                      </TableHead>
                                      <TableBody>
                                        {nodeCephData.managers?.active && (
                                          <TableRow>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>mgr.{nodeCephData.managers.active}</TableCell>
                                            <TableCell>{nodeCephData.managers.active?.split('.')[0] || nodeCephData.managers.active}</TableCell>
                                            <TableCell>
                                              <Chip size="small" label="active" color="success" sx={{ height: 20, fontSize: 11 }} />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>—</TableCell>
                                            <TableCell>—</TableCell>
                                          </TableRow>
                                        )}
                                        {(nodeCephData.managers?.standbys || []).map((mgr: any) => (
                                          <TableRow key={mgr.name || mgr}>
                                            <TableCell sx={{ fontFamily: 'monospace' }}>mgr.{mgr.name || mgr}</TableCell>
                                            <TableCell>{(mgr.name || mgr)?.split('.')[0] || mgr.name || mgr}</TableCell>
                                            <TableCell>
                                              <Chip size="small" label="standby" color="default" sx={{ height: 20, fontSize: 11 }} />
                                            </TableCell>
                                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>—</TableCell>
                                            <TableCell>—</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </TableContainer>
                                </CardContent>
                              </Card>
                            </Stack>
                          )}

                          {/* OSD */}
                          {nodeCephSubTab === 2 && (
                            <Card variant="outlined">
                              <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                  <Typography variant="subtitle2" fontWeight={700}>OSD (Object Storage Daemon)</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined" startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}>Reload</Button>
                                    <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create OSD</Button>
                                  </Box>
                                </Box>
                                <TableContainer sx={{ maxHeight: 400 }}>
                                  <Table size="small" stickyHeader>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Class</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>OSD Type</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Weight</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Reweight</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Used (%)</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Total</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">PGs</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(Array.isArray(nodeCephData.osds) ? nodeCephData.osds : []).map((osd: any) => (
                                        <TableRow key={osd.id}>
                                          <TableCell sx={{ fontFamily: 'monospace' }}>osd.{osd.id}</TableCell>
                                          <TableCell>{osd.device_class || osd.class || 'nvme'}</TableCell>
                                          <TableCell>{osd.osdtype || 'bluestore'}</TableCell>
                                          <TableCell>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                              <Chip 
                                                size="small" 
                                                label={osd.status === 'up' || osd.in === 1 ? 'up' : 'down'}
                                                color={osd.status === 'up' || osd.in === 1 ? 'success' : 'error'}
                                                sx={{ height: 18, fontSize: 10 }}
                                              />
                                              <span style={{ opacity: 0.5 }}>/</span>
                                              <Chip 
                                                size="small" 
                                                label={osd.in === 1 ? 'in' : 'out'}
                                                color={osd.in === 1 ? 'success' : 'warning'}
                                                sx={{ height: 18, fontSize: 10 }}
                                              />
                                            </Box>
                                          </TableCell>
                                          <TableCell>{osd.ceph_version_short || osd.version}</TableCell>
                                          <TableCell align="right">{osd.crush_weight?.toFixed(2) || '1.00'}</TableCell>
                                          <TableCell align="right">{osd.reweight?.toFixed(2) || '1.00'}</TableCell>
                                          <TableCell align="right">
                                            {osd.percent_used?.toFixed(2) || ((osd.kb_used / osd.kb) * 100).toFixed(2) || '0'}%
                                          </TableCell>
                                          <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                            {osd.kb ? `${(osd.kb / 1024 / 1024 / 1024).toFixed(2)} TiB` : osd.total_space || '—'}
                                          </TableCell>
                                          <TableCell align="right">{osd.num_pgs || osd.pgs || '—'}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* CephFS */}
                          {nodeCephSubTab === 3 && (
                            <Stack spacing={2}>
                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>CephFS</Typography>
                                    <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create CephFS</Button>
                                  </Box>
                                  {(Array.isArray(nodeCephData.cephfs) ? nodeCephData.cephfs : []).length > 0 ? (
                                    <TableContainer>
                                      <Table size="small">
                                        <TableHead>
                                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                                            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Data Pool</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Metadata Pool</TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {(Array.isArray(nodeCephData.cephfs) ? nodeCephData.cephfs : []).map((fs: any) => (
                                            <TableRow key={fs.name}>
                                              <TableCell sx={{ fontFamily: 'monospace' }}>{fs.name}</TableCell>
                                              <TableCell>{fs.data_pool}</TableCell>
                                              <TableCell>{fs.metadata_pool}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </TableContainer>
                                  ) : (
                                    <Typography variant="body2" sx={{ opacity: 0.5 }}>No CephFS configured</Typography>
                                  )}
                                </CardContent>
                              </Card>

                              <Card variant="outlined">
                                <CardContent>
                                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Metadata Servers</Typography>
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />} disabled>Start</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-stop-line" style={{ fontSize: 14 }} />} disabled>Stop</Button>
                                      <Button size="small" variant="outlined" startIcon={<i className="ri-restart-line" style={{ fontSize: 14 }} />} disabled>Restart</Button>
                                      <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                    </Box>
                                  </Box>
                                  {(Array.isArray(nodeCephData.mds) ? nodeCephData.mds : []).length > 0 ? (
                                    <TableContainer>
                                      <Table size="small">
                                        <TableHead>
                                          <TableRow sx={{ bgcolor: 'action.hover' }}>
                                            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Host</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Address</TableCell>
                                            <TableCell sx={{ fontWeight: 700 }}>Version</TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {(Array.isArray(nodeCephData.mds) ? nodeCephData.mds : []).map((mds: any) => (
                                            <TableRow key={mds.name}>
                                              <TableCell sx={{ fontFamily: 'monospace' }}>{mds.name}</TableCell>
                                              <TableCell>{mds.host}</TableCell>
                                              <TableCell>
                                                <Chip 
                                                  size="small" 
                                                  label={mds.state || mds.status || 'unknown'}
                                                  color={mds.state?.includes('active') ? 'success' : 'default'}
                                                  sx={{ height: 20, fontSize: 11 }}
                                                />
                                              </TableCell>
                                              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{mds.addr}</TableCell>
                                              <TableCell>{mds.ceph_version_short}</TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </TableContainer>
                                  ) : (
                                    <Typography variant="body2" sx={{ opacity: 0.5 }}>No MDS configured</Typography>
                                  )}
                                </CardContent>
                              </Card>
                            </Stack>
                          )}

                          {/* Pools */}
                          {nodeCephSubTab === 4 && (
                            <Card variant="outlined">
                              <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                  <Typography variant="subtitle2" fontWeight={700}>Pools</Typography>
                                  <Box sx={{ display: 'flex', gap: 1 }}>
                                    <Button size="small" variant="outlined">Edit</Button>
                                    <Button size="small" variant="outlined" color="error">Destroy</Button>
                                    <Button size="small" variant="contained" startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />} disabled>Create</Button>
                                  </Box>
                                </Box>
                                <TableContainer sx={{ maxHeight: 400 }}>
                                  <Table size="small" stickyHeader>
                                    <TableHead>
                                      <TableRow>
                                        <TableCell sx={{ fontWeight: 700, width: 60 }}>Pool #</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="center">Size/min</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right"># of PGs</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Optimal # PGs</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>Autoscaler</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>CRUSH Rule</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }} align="right">Used (%)</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {(Array.isArray(nodeCephData.pools) ? nodeCephData.pools : []).map((pool: any) => (
                                        <TableRow key={pool.pool || pool.pool_name}>
                                          <TableCell>{pool.pool}</TableCell>
                                          <TableCell sx={{ fontFamily: 'monospace' }}>{pool.pool_name}</TableCell>
                                          <TableCell align="center">{pool.size}/{pool.min_size}</TableCell>
                                          <TableCell align="right">{pool.pg_num}</TableCell>
                                          <TableCell align="right">{pool.pg_num_target || pool.pg_num}</TableCell>
                                          <TableCell>
                                            <Chip 
                                              size="small" 
                                              label={pool.pg_autoscale_mode || 'on'}
                                              color={pool.pg_autoscale_mode === 'on' ? 'success' : 'default'}
                                              sx={{ height: 18, fontSize: 10 }}
                                            />
                                          </TableCell>
                                          <TableCell>{pool.crush_rule_name || `rule ${pool.crush_rule}`}</TableCell>
                                          <TableCell align="right">
                                            {pool.percent_used?.toFixed(2) || '0.00'}%
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </CardContent>
                            </Card>
                          )}

                          {/* Log */}
                          {nodeCephSubTab === 5 && (
                            <Card variant="outlined">
                              <CardContent>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2" fontWeight={700}>Ceph Log</Typography>
                                    {nodeCephLogLive && (
                                      <Chip 
                                        size="small" 
                                        label="LIVE" 
                                        color="success" 
                                        sx={{ height: 20, fontSize: 10, animation: 'pulse 2s infinite' }}
                                      />
                                    )}
                                  </Box>
                                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                    <Button 
                                      size="small" 
                                      variant={nodeCephLogLive ? 'contained' : 'outlined'}
                                      color={nodeCephLogLive ? 'error' : 'success'}
                                      startIcon={<i className={nodeCephLogLive ? 'ri-stop-circle-line' : 'ri-play-circle-line'} style={{ fontSize: 14 }} />}
                                      onClick={() => setNodeCephLogLive(!nodeCephLogLive)}
                                    >
                                      {nodeCephLogLive ? 'Stop' : 'Live'}
                                    </Button>
                                    <Button 
                                      size="small" 
                                      variant="outlined" 
                                      startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                                      onClick={async () => {
                                        if (!selection?.id) return
                                        const { connId, node: nodeName } = parseNodeId(selection.id)
                                        try {
                                          const timestamp = Date.now()
                                          const res = await fetch(
                                            `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/ceph?section=log&logLines=100&_t=${timestamp}`, 
                                            { 
                                              cache: 'no-store',
                                              headers: {
                                                'Cache-Control': 'no-cache, no-store, must-revalidate',
                                                'Pragma': 'no-cache'
                                              }
                                            }
                                          )
                                          if (res.ok) {
                                            const json = await res.json()
                                            if (json.data?.log) {
                                              setNodeCephData((prev: any) => ({ ...prev, log: json.data.log }))
                                            }
                                          }
                                        } catch (e) {
                                          console.error('Failed to refresh logs:', e)
                                        }
                                      }}
                                    >
                                      Refresh
                                    </Button>
                                  </Box>
                                </Box>
                                <Box 
                                  sx={{ 
                                    bgcolor: 'grey.900', 
                                    borderRadius: 1, 
                                    p: 2, 
                                    fontFamily: 'monospace', 
                                    fontSize: 11,
                                    height: 400,
                                    overflow: 'auto',
                                    color: '#e0e0e0',
                                    '& .log-line': {
                                      whiteSpace: 'pre-wrap',
                                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                                      py: 0.25,
                                      '&:hover': { bgcolor: 'rgba(255,255,255,0.05)' }
                                    },
                                    '& .log-dbg': { color: '#9e9e9e' },
                                    '& .log-info': { color: '#4fc3f7' },
                                    '& .log-warn': { color: '#ffb74d' },
                                    '& .log-err': { color: '#ef5350' },
                                  }}
                                >
                                  {(Array.isArray(nodeCephData.log) ? nodeCephData.log : []).length > 0 ? (
                                    (Array.isArray(nodeCephData.log) ? nodeCephData.log : []).map((line: string, idx: number) => {
                                      // Déterminer le niveau de log pour la couleur
                                      const logClass = line.includes('[DBG]') ? 'log-dbg' : 
                                                       line.includes('[INF]') || line.includes('[INFO]') ? 'log-info' :
                                                       line.includes('[WRN]') || line.includes('[WARN]') ? 'log-warn' :
                                                       line.includes('[ERR]') || line.includes('[ERROR]') ? 'log-err' : ''
                                      return (
                                        <Box key={idx} className={`log-line ${logClass}`}>
                                          {line}
                                        </Box>
                                      )
                                    })
                                  ) : (
                                    <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                                      <i className="ri-file-list-3-line" style={{ fontSize: 32 }} />
                                      <Typography variant="body2" sx={{ mt: 1 }}>No log entries available</Typography>
                                      <Typography variant="caption">Logs require Sys.Syslog permission</Typography>
                                    </Box>
                                  )}
                                </Box>
                              </CardContent>
                            </Card>
                          )}
                        </Box>
                      </>
                    ) : (
                      <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                        <i className="ri-database-2-line" style={{ fontSize: 48 }} />
                        <Typography sx={{ mt: 1 }}>Unable to load Ceph data</Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {/* Onglet Backups (standalone only) - Index 8 */}
                {nodeTab === 8 && !data.clusterName && (
                  <BackupJobsPanel connectionId={parseNodeId(selection.id).connId} />
                )}

                {/* Onglet Cluster (standalone only) - Index 9 */}
                {nodeTab === 9 && !data.clusterName && (
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
                        </Box>

                        {/* Standalone message avec boutons */}
                        <Card variant="outlined">
                          <CardContent>
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
                                  onClick={() => {
                                    // Charger la config pour avoir les networks
                                    if (!clusterConfigLoaded) {
                                      loadClusterConfig(parseNodeId(selection.id).connId)
                                    }
                                    setCreateClusterDialogOpen(true)
                                  }}
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
                          </CardContent>
                        </Card>

                        {/* Liste des Cluster Nodes (vide pour standalone) */}
                        <Card variant="outlined">
                          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                              <Typography fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <i className="ri-server-line" style={{ fontSize: 18 }} />
                                Cluster Nodes
                              </Typography>
                            </Box>
                            <Box sx={{ p: 3, textAlign: 'center', opacity: 0.5 }}>
                              <Typography variant="body2">No cluster configured</Typography>
                            </Box>
                          </CardContent>
                        </Card>
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Replication - Index 9 pour cluster, Index 10 pour standalone */}
                {((nodeTab === 9 && data.clusterName) || (nodeTab === 10 && !data.clusterName)) && (
                  <Box sx={{ p: 2 }}>
                    {nodeReplicationLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={2}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-add-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              setReplicationDialogMode('create')
                              setEditingReplicationJob(null)
                              setReplicationFormData({
                                guest: '',
                                target: '',
                                schedule: '*/15',
                                rate: '',
                                comment: '',
                                enabled: true
                              })
                              setReplicationDialogOpen(true)
                            }}
                          >
                            Add
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-edit-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              if (editingReplicationJob) {
                                setReplicationDialogMode('edit')
                                setReplicationFormData({
                                  guest: String(editingReplicationJob.guest),
                                  target: editingReplicationJob.target,
                                  schedule: editingReplicationJob.schedule || '*/15',
                                  rate: editingReplicationJob.rate || '',
                                  comment: editingReplicationJob.comment || '',
                                  enabled: editingReplicationJob.enabled !== false
                                })
                                setReplicationDialogOpen(true)
                              }
                            }}
                          >
                            Edit
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            color="error"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-delete-bin-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              if (editingReplicationJob) {
                                setDeletingReplicationJob(editingReplicationJob)
                                setDeleteReplicationDialogOpen(true)
                              }
                            }}
                          >
                            Remove
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-file-list-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              if (editingReplicationJob) {
                                setReplicationLogJob(editingReplicationJob)
                                setReplicationLogDialogOpen(true)
                                setReplicationLogLoading(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(editingReplicationJob.id)}?limit=100`, { cache: 'no-store' })
                                  if (res.ok) {
                                    const json = await res.json()
                                    setReplicationLogData(json.data || [])
                                  }
                                } finally {
                                  setReplicationLogLoading(false)
                                }
                              }
                            }}
                          >
                            Log
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            disabled={!editingReplicationJob}
                            startIcon={<i className="ri-play-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              if (editingReplicationJob) {
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication/${encodeURIComponent(editingReplicationJob.id)}`, { 
                                    method: 'POST',
                                    cache: 'no-store' 
                                  })
                                  if (res.ok) {
                                    // Recharger les données
                                    setNodeReplicationLoaded(false)
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to schedule replication')
                                  }
                                } catch (e) {
                                  alert('Error scheduling replication')
                                }
                              }
                            }}
                          >
                            Schedule now
                          </Button>
                        </Box>

                        {/* Tableau des jobs de réplication */}
                        <Card variant="outlined">
                          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                            {(nodeReplicationData?.jobs?.length || 0) > 0 ? (
                              <TableContainer sx={{ maxHeight: 400 }}>
                                <Table size="small" stickyHeader>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell padding="checkbox" sx={{ fontWeight: 700 }}></TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Enabled</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Guest</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Job</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Target</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Schedule</TableCell>
                                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {nodeReplicationData.jobs.map((job: any) => (
                                      <TableRow 
                                        key={job.id} 
                                        hover 
                                        selected={editingReplicationJob?.id === job.id}
                                        onClick={() => setEditingReplicationJob(job)}
                                        sx={{ cursor: 'pointer' }}
                                      >
                                        <TableCell padding="checkbox">
                                          <input 
                                            type="radio" 
                                            checked={editingReplicationJob?.id === job.id}
                                            onChange={() => setEditingReplicationJob(job)}
                                          />
                                        </TableCell>
                                        <TableCell>
                                          <Chip 
                                            size="small" 
                                            label={job.enabled ? 'Yes' : 'No'} 
                                            color={job.enabled ? 'success' : 'default'}
                                            sx={{ height: 20, fontSize: 10 }}
                                          />
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                                          {job.guest}
                                          {nodeReplicationData.guests?.find((g: any) => g.vmid === job.guest)?.name && (
                                            <Typography component="span" variant="caption" sx={{ ml: 1, opacity: 0.6 }}>
                                              ({nodeReplicationData.guests.find((g: any) => g.vmid === job.guest)?.name})
                                            </Typography>
                                          )}
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{job.id}</TableCell>
                                        <TableCell>{job.target}</TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: 11 }}>{job.schedule || '*/15'}</TableCell>
                                        <TableCell>
                                          <Chip 
                                            size="small" 
                                            label={job.state || 'unknown'} 
                                            color={job.state === 'ok' ? 'success' : job.state === 'error' ? 'error' : 'default'}
                                            sx={{ height: 20, fontSize: 10 }}
                                          />
                                          {job.error && (
                                            <Typography variant="caption" sx={{ ml: 1, color: 'error.main' }}>
                                              {job.error}
                                            </Typography>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </TableContainer>
                            ) : (
                              <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                <i className="ri-refresh-line" style={{ fontSize: 32 }} />
                                <Typography variant="body2" sx={{ mt: 1 }}>No replication jobs configured</Typography>
                              </Box>
                            )}
                          </CardContent>
                        </Card>

                        {/* Dialog Create/Edit Replication Job */}
                        <Dialog open={replicationDialogOpen} onClose={() => setReplicationDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-refresh-line" style={{ fontSize: 20 }} />
                            {replicationDialogMode === 'create' ? 'Create: Replication Job' : 'Edit: Replication Job'}
                          </DialogTitle>
                          <DialogContent>
                            <Stack spacing={2} sx={{ mt: 1 }}>
                              {replicationDialogMode === 'create' && (
                                <FormControl fullWidth size="small">
                                  <InputLabel>CT/VM ID</InputLabel>
                                  <Select
                                    value={replicationFormData.guest}
                                    label="CT/VM ID"
                                    onChange={(e) => setReplicationFormData(prev => ({ ...prev, guest: e.target.value }))}
                                  >
                                    {(nodeReplicationData?.guests || []).map((g: any) => (
                                      <MenuItem key={g.vmid} value={String(g.vmid)}>
                                        {g.vmid} - {g.name || 'unnamed'} ({g.type})
                                      </MenuItem>
                                    ))}
                                  </Select>
                                </FormControl>
                              )}
                              {replicationDialogMode === 'edit' && (
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="CT/VM ID"
                                  value={replicationFormData.guest}
                                  disabled
                                />
                              )}
                              <FormControl fullWidth size="small">
                                <InputLabel>Target</InputLabel>
                                <Select
                                  value={replicationFormData.target}
                                  label="Target"
                                  onChange={(e) => setReplicationFormData(prev => ({ ...prev, target: e.target.value }))}
                                >
                                  {(nodeReplicationData?.nodes || []).map((n: any) => (
                                    <MenuItem key={n.node} value={n.node} disabled={!n.online}>
                                      {n.node} {!n.online && '(offline)'}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </FormControl>
                              <FormControl fullWidth size="small">
                                <InputLabel>Schedule</InputLabel>
                                <Select
                                  value={replicationFormData.schedule}
                                  label="Schedule"
                                  onChange={(e) => setReplicationFormData(prev => ({ ...prev, schedule: e.target.value }))}
                                >
                                  <MenuItem value="*/1">*/1 - Every minute</MenuItem>
                                  <MenuItem value="*/5">*/5 - Every 5 minutes</MenuItem>
                                  <MenuItem value="*/15">*/15 - Every 15 minutes</MenuItem>
                                  <MenuItem value="*/30">*/30 - Every 30 minutes</MenuItem>
                                  <MenuItem value="0 *">0 * - Every hour</MenuItem>
                                  <MenuItem value="0 */2">0 */2 - Every 2 hours</MenuItem>
                                  <MenuItem value="0 */6">0 */6 - Every 6 hours</MenuItem>
                                  <MenuItem value="0 */12">0 */12 - Every 12 hours</MenuItem>
                                  <MenuItem value="0 0">0 0 - Daily at midnight</MenuItem>
                                </Select>
                              </FormControl>
                              <TextField
                                fullWidth
                                size="small"
                                label="Rate limit (MB/s)"
                                placeholder="unlimited"
                                value={replicationFormData.rate}
                                onChange={(e) => setReplicationFormData(prev => ({ ...prev, rate: e.target.value }))}
                                helperText="Leave empty for unlimited"
                              />
                              <TextField
                                fullWidth
                                size="small"
                                label="Comment"
                                value={replicationFormData.comment}
                                onChange={(e) => setReplicationFormData(prev => ({ ...prev, comment: e.target.value }))}
                              />
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={replicationFormData.enabled}
                                    onChange={(e) => setReplicationFormData(prev => ({ ...prev, enabled: e.target.checked }))}
                                  />
                                }
                                label="Enabled"
                              />
                            </Stack>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setReplicationDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={replicationSaving || (replicationDialogMode === 'create' && (!replicationFormData.guest || !replicationFormData.target))}
                              onClick={async () => {
                                setReplicationSaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const method = replicationDialogMode === 'create' ? 'POST' : 'PUT'
                                  const body = replicationDialogMode === 'create' 
                                    ? {
                                        guest: replicationFormData.guest,
                                        target: replicationFormData.target,
                                        schedule: replicationFormData.schedule,
                                        rate: replicationFormData.rate || undefined,
                                        comment: replicationFormData.comment || undefined,
                                        enabled: replicationFormData.enabled
                                      }
                                    : {
                                        jobId: editingReplicationJob?.id,
                                        schedule: replicationFormData.schedule,
                                        rate: replicationFormData.rate || undefined,
                                        comment: replicationFormData.comment || undefined,
                                        enabled: replicationFormData.enabled
                                      }
                                  
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication`, {
                                    method,
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(body)
                                  })
                                  
                                  if (res.ok) {
                                    setReplicationDialogOpen(false)
                                    setNodeReplicationLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to save replication job')
                                  }
                                } catch (e) {
                                  alert('Error saving replication job')
                                } finally {
                                  setReplicationSaving(false)
                                }
                              }}
                            >
                              {replicationSaving ? <CircularProgress size={20} /> : (replicationDialogMode === 'create' ? 'Create' : 'Save')}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Delete Replication Job */}
                        <Dialog open={deleteReplicationDialogOpen} onClose={() => setDeleteReplicationDialogOpen(false)} maxWidth="xs" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                            <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
                            Remove Replication Job
                          </DialogTitle>
                          <DialogContent>
                            <Typography variant="body2">
                              Are you sure you want to remove the replication job <strong>{deletingReplicationJob?.id}</strong>?
                            </Typography>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setDeleteReplicationDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              color="error"
                              disabled={replicationDeleting}
                              onClick={async () => {
                                setReplicationDeleting(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/replication?jobId=${encodeURIComponent(deletingReplicationJob?.id)}`, {
                                    method: 'DELETE'
                                  })
                                  if (res.ok) {
                                    setDeleteReplicationDialogOpen(false)
                                    setEditingReplicationJob(null)
                                    setNodeReplicationLoaded(false) // Recharger
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to delete replication job')
                                  }
                                } catch (e) {
                                  alert('Error deleting replication job')
                                } finally {
                                  setReplicationDeleting(false)
                                }
                              }}
                            >
                              {replicationDeleting ? <CircularProgress size={20} /> : 'Remove'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Replication Log */}
                        <Dialog open={replicationLogDialogOpen} onClose={() => setReplicationLogDialogOpen(false)} maxWidth="md" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-file-list-line" style={{ fontSize: 20 }} />
                            Replication Log - {replicationLogJob?.id}
                          </DialogTitle>
                          <DialogContent dividers>
                            {replicationLogLoading ? (
                              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={24} />
                              </Box>
                            ) : replicationLogData.length > 0 ? (
                              <Box 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: 11, 
                                  whiteSpace: 'pre-wrap', 
                                  wordBreak: 'break-all',
                                  m: 0,
                                  p: 2,
                                  bgcolor: 'background.default',
                                  borderRadius: 1,
                                  maxHeight: '50vh',
                                  overflow: 'auto'
                                }}
                              >
                                {replicationLogData.join('\n')}
                              </Box>
                            ) : (
                              <Box sx={{ p: 4, textAlign: 'center', opacity: 0.5 }}>
                                <Typography variant="body2">No log entries</Typography>
                              </Box>
                            )}
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setReplicationLogDialogOpen(false)}>Close</Button>
                          </DialogActions>
                        </Dialog>
                      </Stack>
                    )}
                  </Box>
                )}

                {/* Onglet Updates - Index 10 pour cluster, Index 11 pour standalone */}
                {((nodeTab === 10 && data.clusterName) || (nodeTab === 11 && !data.clusterName)) && (() => {
                  const nodeName = data.nodeName || selection?.id?.split(':').pop() || ''
                  const nodeUpdate = nodeUpdates?.[nodeName]
                  const pkgCount = nodeUpdate?.count || 0
                  const hasKernel = nodeUpdate?.updates?.some((u: any) =>
                    (u.Package || u.package || '').toLowerCase().includes('kernel') ||
                    (u.Package || u.package || '').toLowerCase().includes('linux-image') ||
                    (u.Package || u.package || '').toLowerCase().includes('pve-kernel')
                  )
                  // Estimation: download 2min + install 5min + 3s/pkg + reboot 5min if kernel + buffer 2min
                  const estimatedMinutes = pkgCount > 0
                    ? Math.ceil(2 + 5 + Math.ceil(pkgCount * 3 / 60) + (hasKernel ? 5 : 0) + 2)
                    : 0

                  return (
                    <Box sx={{ p: 2 }}>
                      <Stack spacing={3}>
                        {/* Header */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Typography variant="subtitle1" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-download-cloud-line" style={{ fontSize: 20 }} />
                            {t('updates.availableUpdates')}
                          </Typography>
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<i className="ri-refresh-line" />}
                            onClick={() => {
                              setNodeUpdates((prev: any) => { const next = {...prev}; delete next[nodeName]; return next })
                            }}
                          >
                            {t('updates.refresh')}
                          </Button>
                        </Box>

                        {/* Loading state */}
                        {nodeUpdate?.loading ? (
                          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                            <CircularProgress size={32} />
                          </Box>
                        ) : !nodeUpdate ? (
                          <Alert severity="info" icon={<i className="ri-information-line" />}>
                            <Typography variant="body2">
                              {t('updates.checkUpdates')}
                            </Typography>
                          </Alert>
                        ) : (
                          <>
                            {/* Version card */}
                            <Card variant="outlined">
                              <CardContent>
                                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <i className="ri-server-line" style={{ fontSize: 18 }} />
                                  {nodeName}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                                  {nodeUpdate?.version && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('updates.version')}:</Typography>
                                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12 }}>{nodeUpdate.version}</Typography>
                                    </Box>
                                  )}
                                  <Chip
                                    size="small"
                                    label={`${pkgCount} ${t('updates.packages').toLowerCase()}`}
                                    color={pkgCount > 0 ? 'warning' : 'success'}
                                    icon={pkgCount > 0 ? <i className="ri-arrow-up-circle-fill" style={{ fontSize: 14 }} /> : <i className="ri-checkbox-circle-fill" style={{ fontSize: 14 }} />}
                                    sx={{ height: 24, fontSize: 11, fontWeight: 600 }}
                                  />
                                  {pkgCount > 0 && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <i className="ri-time-line" style={{ fontSize: 14, opacity: 0.7 }} />
                                      <Typography variant="caption">~{estimatedMinutes} min</Typography>
                                    </Box>
                                  )}
                                  {hasKernel && (
                                    <MuiTooltip title={t('updates.rebootRequired')}>
                                      <Chip
                                        size="small"
                                        label={t('updates.rebootRequired')}
                                        color="warning"
                                        icon={<i className="ri-restart-line" style={{ fontSize: 14 }} />}
                                        sx={{ height: 24, fontSize: 11 }}
                                      />
                                    </MuiTooltip>
                                  )}
                                </Box>
                              </CardContent>
                            </Card>

                            {/* Package list table */}
                            {pkgCount > 0 && (
                              <Card variant="outlined">
                                <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                                  <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
                                    {/* Header */}
                                    <Box sx={{
                                      display: 'grid',
                                      gridTemplateColumns: '1fr 160px 160px',
                                      gap: 1,
                                      px: 1.5,
                                      py: 0.75,
                                      bgcolor: 'background.paper',
                                      borderBottom: '1px solid',
                                      borderColor: 'divider',
                                      position: 'sticky',
                                      top: 0,
                                      zIndex: 2
                                    }}>
                                      <Typography variant="caption" fontWeight={600}>{t('updates.package')}</Typography>
                                      <Typography variant="caption" fontWeight={600}>{t('updates.currentVersion')}</Typography>
                                      <Typography variant="caption" fontWeight={600}>{t('updates.newVersion')}</Typography>
                                    </Box>
                                    {/* Rows */}
                                    {nodeUpdate.updates.map((upd: any, idx: number) => {
                                      const pkgName = upd.Package || upd.package || ''
                                      const isKernel = pkgName.toLowerCase().includes('kernel') || pkgName.toLowerCase().includes('linux-image')
                                      return (
                                        <Box
                                          key={idx}
                                          sx={{
                                            display: 'grid',
                                            gridTemplateColumns: '1fr 160px 160px',
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
                                </CardContent>
                              </Card>
                            )}

                            {/* Summary alert */}
                            {pkgCount === 0 ? (
                              <Alert severity="success" icon={<i className="ri-checkbox-circle-line" />}>
                                <Typography variant="body2" fontWeight={600}>
                                  {t('updates.upToDate')}
                                </Typography>
                              </Alert>
                            ) : (
                              <Alert
                                severity="warning"
                                icon={<i className="ri-error-warning-line" />}
                              >
                                <Box>
                                  <Typography variant="body2" fontWeight={600}>
                                    {t('updates.summaryUpdates', { count: pkgCount, nodes: 1 })}
                                  </Typography>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      <i className="ri-time-line" style={{ fontSize: 14 }} />
                                      <Typography variant="caption">
                                        {t('updates.totalEstimatedTime')}: ~{estimatedMinutes} min
                                      </Typography>
                                    </Box>
                                    {hasKernel && (
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <i className="ri-restart-line" style={{ fontSize: 14, color: '#ff9800' }} />
                                        <Typography variant="caption">
                                          {t('updates.rebootsRequired', { count: 1 })}
                                        </Typography>
                                      </Box>
                                    )}
                                  </Box>
                                </Box>
                              </Alert>
                            )}

                            {/* Pre-flight checks (cluster nodes with updates) */}
                            {pkgCount > 0 && data.clusterName && (() => {
                              const cephHealth = nodeCephData?.health?.status || nodeCephData?.health?.overall_status
                              const hasCeph = nodeCephData && nodeCephData.hasCeph !== false
                              const localVmData = nodeLocalVms?.[nodeName]
                              const cephHealthy = !hasCeph || cephHealth === 'HEALTH_OK'

                              return (
                                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                      <i className="ri-shield-check-line" style={{ fontSize: 18 }} />
                                      {t('updates.preflightChecks')}
                                    </Typography>
                                    <Stack spacing={1.5}>
                                      {/* Ceph Health */}
                                      {hasCeph && (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                          <Chip
                                            size="small"
                                            label={cephHealth || 'LOADING'}
                                            color={cephHealth === 'HEALTH_OK' ? 'success' : cephHealth === 'HEALTH_WARN' ? 'warning' : 'error'}
                                            icon={<i className={cephHealth === 'HEALTH_OK' ? 'ri-checkbox-circle-line' : 'ri-alert-line'} style={{ fontSize: 14 }} />}
                                            sx={{ height: 24, fontSize: 11, fontWeight: 600 }}
                                          />
                                          <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                            {t('updates.cephHealth')}
                                          </Typography>
                                          {!cephHealthy && (
                                            <Typography variant="caption" color="error">
                                              {t('updates.cephMustBeHealthy')}
                                            </Typography>
                                          )}
                                        </Box>
                                      )}

                                      {/* VM Migration Readiness */}
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        {localVmData?.loading ? (
                                          <CircularProgress size={16} />
                                        ) : localVmData && localVmData.total > 0 ? (
                                          <Chip
                                            size="small"
                                            label={`${localVmData.total} VM${localVmData.total > 1 ? 's' : ''}`}
                                            color={localVmData.blockingMigration > 0 ? 'error' : 'warning'}
                                            icon={<i className={localVmData.blockingMigration > 0 ? 'ri-error-warning-line' : 'ri-information-line'} style={{ fontSize: 14 }} />}
                                            sx={{ height: 24, fontSize: 11, fontWeight: 600 }}
                                          />
                                        ) : (
                                          <Chip
                                            size="small"
                                            label="OK"
                                            color="success"
                                            icon={<i className="ri-checkbox-circle-line" style={{ fontSize: 14 }} />}
                                            sx={{ height: 24, fontSize: 11, fontWeight: 600 }}
                                          />
                                        )}
                                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                          {t('updates.vmMigration')}
                                          {localVmData && !localVmData.loading && localVmData.total === 0 && (
                                            <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.6 }}>
                                              — {t('updates.allOnSharedStorage')}
                                            </Typography>
                                          )}
                                        </Typography>
                                      </Box>

                                      {/* Maintenance Mode Notice */}
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <Chip
                                          size="small"
                                          label="Auto"
                                          color="info"
                                          icon={<i className="ri-tools-line" style={{ fontSize: 14 }} />}
                                          sx={{ height: 24, fontSize: 11, fontWeight: 600 }}
                                        />
                                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                                          {t('updates.maintenanceNotice')}
                                          <Typography component="span" variant="caption" sx={{ ml: 0.5, opacity: 0.6 }}>
                                            — {t('updates.willBeActivated')}
                                          </Typography>
                                        </Typography>
                                      </Box>
                                    </Stack>
                                  </CardContent>
                                </Card>
                              )
                            })()}

                            {/* Action buttons */}
                            {pkgCount > 0 && (
                              <Button
                                variant="contained"
                                color="warning"
                                size="large"
                                startIcon={<i className="ri-play-circle-line" style={{ fontSize: 20 }} />}
                                onClick={() => data.clusterName ? setRollingUpdateWizardOpen(true) : setNodeUpdateDialogOpen(true)}
                                sx={{ alignSelf: 'flex-start' }}
                                disabled={
                                  !!(data.clusterName && nodeCephData && nodeCephData.hasCeph !== false &&
                                  (nodeCephData?.health?.status || nodeCephData?.health?.overall_status) !== 'HEALTH_OK')
                                }
                              >
                                {t('updates.update')}
                              </Button>
                            )}
                          </>
                        )}
                      </Stack>

                      {/* Rolling Update Wizard (cluster nodes) */}
                      {data.clusterName && (
                        <RollingUpdateWizard
                          open={rollingUpdateWizardOpen}
                          onClose={() => setRollingUpdateWizardOpen(false)}
                          connectionId={selection?.id?.split(':')[0] || ''}
                          nodes={[{
                            node: nodeName,
                            version: nodeUpdate?.version || '',
                            vms: data.vmsData?.length || 0,
                            status: 'online',
                          }]}
                          nodeUpdates={nodeUpdates}
                        />
                      )}

                      {/* Node Update Dialog (standalone nodes) */}
                      {!data.clusterName && (
                        <NodeUpdateDialog
                          open={nodeUpdateDialogOpen}
                          onClose={() => setNodeUpdateDialogOpen(false)}
                          connectionId={selection?.id?.split(':')[0] || ''}
                          nodeName={nodeName}
                          vmCount={data.vmsData?.filter((vm: any) => vm.status === 'running').length || 0}
                          nodeUpdates={nodeUpdates}
                        />
                      )}
                    </Box>
                  )
                })()}

                {/* Onglet CVE - Index 11 pour cluster, Index 12 pour standalone */}
                {((nodeTab === 11 && data.clusterName) || (nodeTab === 12 && !data.clusterName)) && (
                  <Box sx={{ p: 2, overflow: 'auto' }}>
                    <CveTab connectionId={selection?.id?.split(':')[0] || ''} node={data.nodeName || selection?.id?.split(':').pop() || ''} available={cveAvailable} />
                  </Box>
                )}

                {/* Onglet Subscription - Index 12 pour cluster, Index 13 pour standalone */}
                {((nodeTab === 12 && data.clusterName) || (nodeTab === 13 && !data.clusterName)) && (
                  <Box sx={{ p: 2 }}>
                    {nodeSubscriptionLoading ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                      </Box>
                    ) : (
                      <Stack spacing={2}>
                        {/* Header avec boutons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-upload-2-line" style={{ fontSize: 14 }} />}
                            onClick={() => {
                              setSubscriptionKeyInput(nodeSubscriptionData?.key || '')
                              setSubscriptionKeyDialogOpen(true)
                            }}
                          >
                            Upload Subscription Key
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              setNodeSubscriptionLoading(true)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, { 
                                  method: 'POST',
                                  cache: 'no-store' 
                                })
                                if (res.ok) {
                                  const json = await res.json()
                                  setNodeSubscriptionData(json.data || json)
                                }
                              } finally {
                                setNodeSubscriptionLoading(false)
                              }
                            }}
                          >
                            Check
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            color="error"
                            disabled={!nodeSubscriptionData?.key}
                            startIcon={<i className="ri-delete-bin-line" style={{ fontSize: 14 }} />}
                            onClick={() => setRemoveSubscriptionDialogOpen(true)}
                          >
                            Remove Subscription
                          </Button>
                          <Button 
                            size="small" 
                            variant="outlined"
                            startIcon={<i className="ri-file-text-line" style={{ fontSize: 14 }} />}
                            onClick={async () => {
                              setSystemReportDialogOpen(true)
                              setSystemReportLoading(true)
                              setSystemReportData(null)
                              const { connId, node } = parseNodeId(selection?.id || '')
                              try {
                                const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/report`, { cache: 'no-store' })
                                if (res.ok) {
                                  const json = await res.json()
                                  setSystemReportData(json.data || 'No report available')
                                } else {
                                  setSystemReportData('Failed to load system report')
                                }
                              } catch (e) {
                                setSystemReportData('Error loading system report')
                              } finally {
                                setSystemReportLoading(false)
                              }
                            }}
                          >
                            System Report
                          </Button>
                        </Box>

                        {/* Informations de subscription */}
                        <Card variant="outlined">
                          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                            <TableContainer>
                              <Table size="small">
                                <TableBody>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, width: 200, borderBottom: '1px solid', borderColor: 'divider' }}>Type</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.type || nodeSubscriptionData?.productname || 'No valid subscription'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Subscription Key</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.key ? (
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                          <span>{nodeSubscriptionData.key.substring(0, 8)}{'*'.repeat(Math.max(0, nodeSubscriptionData.key.length - 16))}{nodeSubscriptionData.key.substring(nodeSubscriptionData.key.length - 8)}</span>
                                        </Box>
                                      ) : (
                                        <Typography variant="caption" sx={{ opacity: 0.5 }}>-</Typography>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Status</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      <Chip 
                                        size="small" 
                                        label={nodeSubscriptionData?.status || 'unknown'}
                                        color={nodeSubscriptionData?.status === 'active' || nodeSubscriptionData?.status === 'Active' ? 'success' : 
                                               nodeSubscriptionData?.status === 'notfound' ? 'warning' : 'default'}
                                        sx={{ height: 22, fontSize: 11 }}
                                      />
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Server ID</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 11, borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.serverId || nodeSubscriptionData?.serverid || '-'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Sockets</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.sockets || '-'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>Last checked</TableCell>
                                    <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                                      {nodeSubscriptionData?.lastChecked ? 
                                        new Date(nodeSubscriptionData.lastChecked).toLocaleString() : '-'}
                                    </TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell sx={{ fontWeight: 600 }}>Next due date</TableCell>
                                    <TableCell>
                                      {nodeSubscriptionData?.nextDueDate || nodeSubscriptionData?.nextduedate || '-'}
                                    </TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </CardContent>
                        </Card>

                        {/* Message si pas de subscription */}
                        {(!nodeSubscriptionData || nodeSubscriptionData.status === 'notfound' || nodeSubscriptionData.status === 'new') && (
                          <Card variant="outlined" sx={{ bgcolor: 'warning.main', color: 'warning.contrastText' }}>
                            <CardContent sx={{ py: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <i className="ri-error-warning-line" style={{ fontSize: 24 }} />
                                <Box>
                                  <Typography variant="body2" fontWeight={600}>No valid subscription</Typography>
                                  <Typography variant="caption">
                                    You do not have a valid subscription for this server. Please visit{' '}
                                    <a href="https://www.proxmox.com/proxmox-ve/pricing" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
                                      www.proxmox.com
                                    </a>
                                    {' '}to get a list of available options.
                                  </Typography>
                                </Box>
                              </Box>
                            </CardContent>
                          </Card>
                        )}

                        {/* Dialog Upload Subscription Key */}
                        <Dialog open={subscriptionKeyDialogOpen} onClose={() => setSubscriptionKeyDialogOpen(false)} maxWidth="sm" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <i className="ri-key-line" style={{ fontSize: 20 }} />
                            Upload Subscription Key
                          </DialogTitle>
                          <DialogContent>
                            <Typography variant="body2" sx={{ mb: 2, opacity: 0.7 }}>
                              Enter your Proxmox subscription key. The key will be validated with the Proxmox servers.
                            </Typography>
                            <TextField
                              fullWidth
                              label="Subscription Key"
                              placeholder="pve2c-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                              value={subscriptionKeyInput}
                              onChange={(e) => setSubscriptionKeyInput(e.target.value)}
                              variant="outlined"
                              size="small"
                              InputProps={{
                                sx: { fontFamily: 'monospace' }
                              }}
                            />
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setSubscriptionKeyDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              disabled={!subscriptionKeyInput.trim() || subscriptionKeySaving}
                              onClick={async () => {
                                setSubscriptionKeySaving(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ key: subscriptionKeyInput.trim() })
                                  })
                                  if (res.ok) {
                                    const json = await res.json()
                                    setNodeSubscriptionData(json.data || json)
                                    setSubscriptionKeyDialogOpen(false)
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to upload subscription key')
                                  }
                                } catch (e) {
                                  alert('Error uploading subscription key')
                                } finally {
                                  setSubscriptionKeySaving(false)
                                }
                              }}
                            >
                              {subscriptionKeySaving ? <CircularProgress size={20} /> : 'Upload'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog Remove Subscription */}
                        <Dialog open={removeSubscriptionDialogOpen} onClose={() => setRemoveSubscriptionDialogOpen(false)} maxWidth="xs" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
                            <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
                            Remove Subscription
                          </DialogTitle>
                          <DialogContent>
                            <Typography variant="body2">
                              Are you sure you want to remove the subscription key from this node?
                            </Typography>
                            <Typography variant="caption" sx={{ mt: 1, display: 'block', opacity: 0.7 }}>
                              This will not cancel your subscription with Proxmox, only remove the key from this server.
                            </Typography>
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setRemoveSubscriptionDialogOpen(false)}>Cancel</Button>
                            <Button 
                              variant="contained"
                              color="error"
                              disabled={removeSubscriptionLoading}
                              onClick={async () => {
                                setRemoveSubscriptionLoading(true)
                                const { connId, node } = parseNodeId(selection?.id || '')
                                try {
                                  const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/subscription`, {
                                    method: 'DELETE'
                                  })
                                  if (res.ok) {
                                    const json = await res.json()
                                    setNodeSubscriptionData(json.data || json)
                                    setRemoveSubscriptionDialogOpen(false)
                                  } else {
                                    const err = await res.json()
                                    alert(err.error || 'Failed to remove subscription')
                                  }
                                } catch (e) {
                                  alert('Error removing subscription')
                                } finally {
                                  setRemoveSubscriptionLoading(false)
                                }
                              }}
                            >
                              {removeSubscriptionLoading ? <CircularProgress size={20} /> : 'Remove'}
                            </Button>
                          </DialogActions>
                        </Dialog>

                        {/* Dialog System Report */}
                        <Dialog open={systemReportDialogOpen} onClose={() => setSystemReportDialogOpen(false)} maxWidth="lg" fullWidth>
                          <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <i className="ri-file-text-line" style={{ fontSize: 20 }} />
                              System Report - {selection?.id ? parseNodeId(selection.id).node : ''}
                            </Box>
                            <IconButton 
                              size="small" 
                              onClick={() => {
                                if (systemReportData) {
                                  navigator.clipboard.writeText(systemReportData)
                                }
                              }}
                              title="Copy to clipboard"
                            >
                              <i className="ri-file-copy-line" style={{ fontSize: 18 }} />
                            </IconButton>
                          </DialogTitle>
                          <DialogContent dividers>
                            {systemReportLoading ? (
                              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress size={24} />
                              </Box>
                            ) : (
                              <Box 
                                component="pre" 
                                sx={{ 
                                  fontFamily: 'monospace', 
                                  fontSize: 11, 
                                  whiteSpace: 'pre-wrap', 
                                  wordBreak: 'break-all',
                                  m: 0,
                                  p: 2,
                                  bgcolor: 'background.default',
                                  borderRadius: 1,
                                  maxHeight: '60vh',
                                  overflow: 'auto'
                                }}
                              >
                                {systemReportData || 'No report data'}
                              </Box>
                            )}
                          </DialogContent>
                          <DialogActions>
                            <Button onClick={() => setSystemReportDialogOpen(false)}>Close</Button>
                          </DialogActions>
                        </Dialog>
                      </Stack>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          ) : null}
    </>
  )
}
