'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  Divider,
  IconButton,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { lighten } from '@mui/material/styles'

import { formatBytes } from '@/utils/format'

import type { Status, Kpi, DetailsPayload } from '../types'
import { formatUptime } from '../helpers'
import UsageBar from './UsageBar'
import ConsolePreview from './ConsolePreview'
import StatusChip from './StatusChip'
import NodeHeatmap from './NodeHeatmap'

function VCenterSummary({
  kindLabel,
  status,
  subtitle,
  metrics,
  vmState,
  showConsole,
  hostInfo,
  kpis,
  vmInfo,
  guestInfo,
  guestInfoLoading,
  clusterPveVersion,
  connId,
  nodeName,
  onRefreshSubscription,
  cephHealth,
  nodesOnline,
  nodesTotal,
}: {
  kindLabel: string
  status: Status
  subtitle?: string
  metrics?: DetailsPayload['metrics']
  vmState?: string | null
  showConsole?: boolean
  hostInfo?: DetailsPayload['hostInfo']
  kpis?: Kpi[]
  vmInfo?: { connId: string; node: string; type: string; vmid: string } | null
  guestInfo?: { ip?: string; uptime?: number; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null } | null
  guestInfoLoading?: boolean
  clusterPveVersion?: string
  connId?: string
  nodeName?: string
  onRefreshSubscription?: () => void
  cephHealth?: string
  nodesOnline?: number
  nodesTotal?: number
}) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main
  const primaryColorLight = lighten(primaryColor, 0.3)
  
  const state = (vmState || '').toLowerCase()

  const stateColor =
    state.includes('running') ? '#2e7d32' : state.includes('stopped') || state.includes('shutdown') ? '#6b7280' : undefined

  const cpuNowPct = metrics?.cpu?.pct ?? 0
  const memUsed = metrics?.ram?.used ?? 0
  const memCap = metrics?.ram?.max ?? 0
  const diskUsed = metrics?.storage?.used ?? 0
  const diskCap = metrics?.storage?.max ?? 0
  const swapUsed = metrics?.swap?.used ?? 0
  const swapCap = metrics?.swap?.max ?? 0

  const consoleWidth = { xs: '100%', md: 360 }
  
  // État pour les blocs collapsibles dans la vue host
  const [hostBlocksCollapsed, setHostBlocksCollapsed] = useState<{
    updates: boolean
    subscription: boolean
  }>({
    updates: true,
    subscription: true,
  })

  // États pour les modales
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false)
  const [changelogDialogOpen, setChangelogDialogOpen] = useState(false)
  const [upgradeConsoleOpen, setUpgradeConsoleOpen] = useState(false)
  const [upgradeTaskId, setUpgradeTaskId] = useState<string | null>(null)
  const [checkingSubscription, setCheckingSubscription] = useState(false)

  // Vérifier si un reboot est nécessaire (présence de kernel dans les updates)
  const hasKernelUpdate = hostInfo?.updates?.some((u: any) => 
    u.package?.toLowerCase().includes('kernel') || 
    u.package?.toLowerCase().includes('linux-image') ||
    u.package?.toLowerCase().includes('proxmox-kernel')
  ) || false

  // Handler pour lancer la mise à jour
  const handleStartUpgrade = async (consoleType: 'novnc' | 'xterm') => {
    if (!connId || !nodeName) return
    
    try {
      // Appel API pour lancer apt upgrade
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/apt/upgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: consoleType })
      })
      
      if (res.ok) {
        const data = await res.json()
        setUpgradeTaskId(data.data || data.upid)
        setUpgradeDialogOpen(false)
        setUpgradeConsoleOpen(true)
      }
    } catch (err) {
      console.error('Failed to start upgrade:', err)
    }
  }

  // Handler pour vérifier la subscription
  const handleCheckSubscription = async () => {
    if (!connId || !nodeName) return
    setCheckingSubscription(true)
    
    try {
      // Appel API pour rafraîchir la subscription
      await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/subscription`, {
        method: 'POST'
      })
      // Callback pour rafraîchir les données
      onRefreshSubscription?.()
    } catch (err) {
      console.error('Failed to check subscription:', err)
    } finally {
      setCheckingSubscription(false)
    }
  }
  
  // Formater l'uptime
  const formatUptime = (secs?: number) => {
    if (!secs) return null
    const days = Math.floor(secs / 86400)
    const hours = Math.floor((secs % 86400) / 3600)
    const mins = Math.floor((secs % 3600) / 60)

    if (days > 0) return `${days}j ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`
    
return `${mins}m`
  }

  // Composant pour une ligne d'info host
  const InfoRow = ({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
      <i className={icon} style={{ opacity: 0.6, fontSize: 14, width: 16 }} />
      <Typography variant="body2" sx={{ opacity: 0.7, minWidth: 120 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right', flex: 1 }}>{value}</Typography>
    </Box>
  )

  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5 }}>
        {/* Header seulement pour les Clusters (pas pour les VMs ni les hosts) */}
        {!showConsole && !hostInfo ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, gap: 1, flexWrap: 'wrap' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Typography fontWeight={900}>Summary</Typography>
              <Chip size="small" label={kindLabel} variant="outlined" />
              {vmState ? (
                <Chip
                  size="small"
                  label={vmState}
                  variant="outlined"
                  sx={{
                    borderColor: stateColor ? stateColor : 'divider',
                    color: stateColor ? stateColor : 'text.secondary',
                    bgcolor: stateColor ? `${stateColor}14` : 'transparent',
                    fontWeight: 800,
                  }}
                />
              ) : (
                <StatusChip status={status} />
              )}
              {/* KPIs pour les clusters */}
              {kpis && kpis.length > 0 ? (
                kpis.map((kpi, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={`${kpi.label}: ${kpi.value}`}
                    variant="outlined"
                    sx={{ fontWeight: 600 }}
                  />
                ))
              ) : null}
              {/* Version PVE pour les clusters */}
              {clusterPveVersion && (
                <Chip
                  size="small"
                  icon={<i className="ri-server-line" style={{ fontSize: 12 }} />}
                  label={`PVE ${clusterPveVersion.split('.')[0]}.x`}
                  variant="outlined"
                  color="primary"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Stack>
          </Stack>
        ) : null}

        {showConsole ? (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              gap: 2,
              alignItems: 'stretch',
              flexDirection: { xs: 'column', md: 'row' },
            }}
          >
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                pb: 1,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'grey.50' : undefined,
              }}
            >
              <UsageBar themeColor={primaryColor} label="CPU" used={cpuNowPct} capacity={100} mode="pct" />
              <UsageBar themeColor={primaryColor} label="Memory" used={memUsed} capacity={memCap} mode="bytes" />
              <UsageBar themeColor={primaryColor} label="Storage" used={diskUsed} capacity={diskCap} mode="bytes" />
              
              {/* IP et Uptime */}
              <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-global-line" style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>IP:</Typography>
                  {guestInfoLoading ? (
                    <CircularProgress size={12} />
                  ) : guestInfo?.ip ? (
                    <Chip 
                      size="small" 
                      label={guestInfo.ip} 
                      sx={{ 
                        height: 20, 
                        fontSize: '0.75rem', 
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                      onClick={() => navigator.clipboard.writeText(guestInfo.ip!)}
                      title={t('inventoryPage.clickToCopy')}
                    />
                  ) : (
                    <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-time-line" style={{ fontSize: 14, opacity: 0.6 }} />
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>Uptime:</Typography>
                  {guestInfoLoading ? (
                    <CircularProgress size={12} />
                  ) : formatUptime(guestInfo?.uptime) ? (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {formatUptime(guestInfo?.uptime)}
                    </Typography>
                  ) : (
                    <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
                  )}
                </Box>
              </Box>
            </Box>

            <Box sx={{ width: consoleWidth, flex: '0 0 auto' }}>
              <ConsolePreview 
                height={210} 
                connId={vmInfo?.connId}
                node={vmInfo?.node}
                type={vmInfo?.type}
                vmid={vmInfo?.vmid}
                vmStatus={vmState || undefined}
                osInfo={guestInfo?.osInfo}
                osLoading={guestInfoLoading}
              />
            </Box>
          </Box>
        ) : hostInfo ? (

          /* Affichage détaillé pour les Hosts - 3 colonnes */
          <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', xl: 'row' } }}>
            {/* Colonne 1 - CPU, Load, RAM, SWAP, IO delay, KSM */}
            <Box
              sx={{
                flex: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'grey.50' : undefined,
              }}
            >
              <UsageBar themeColor={primaryColor} label="CPU usage" used={cpuNowPct} capacity={100} mode="pct" />
              {hostInfo.loadAvg ? (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <i className="ri-dashboard-3-line" style={{ fontSize: 14, color: primaryColor }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
                      Load average
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{hostInfo.loadAvg}</Typography>
                </Box>
              ) : null}
              <UsageBar themeColor={primaryColor} label="RAM usage" used={memUsed} capacity={memCap} mode="bytes" />
              {swapCap > 0 ? (
                <UsageBar themeColor={primaryColor} label="SWAP usage" used={swapUsed} capacity={swapCap} mode="bytes" />
              ) : null}

              {/* IO delay + KSM */}
              {(hostInfo.ioDelay != null || hostInfo.ksmSharing != null) && (
                <>
                  <Divider sx={{ my: 1.25 }} />
                  <Stack spacing={1}>
                    {hostInfo.ioDelay != null && (
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <i className="ri-time-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>IO delay</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{hostInfo.ioDelay.toFixed(2)}%</Typography>
                        </Box>
                      </Box>
                    )}
                    {hostInfo.ksmSharing != null && (
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <i className="ri-share-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>KSM sharing</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{formatBytes(hostInfo.ksmSharing)}</Typography>
                        </Box>
                      </Box>
                    )}
                  </Stack>
                </>
              )}
            </Box>

            {/* Colonne 2 - Heatmap CPU/RAM */}
            <Box
              sx={{
                flex: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'grey.50' : undefined,
              }}
            >
              {connId && nodeName ? (
                <NodeHeatmap connId={connId} nodeName={nodeName} primaryColor={primaryColor} />
              ) : null}
            </Box>

            {/* Colonne 3 - Informations système */}
            <Box
              sx={{
                flex: 1,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'grey.50' : undefined,
              }}
            >
              <Stack spacing={1.25}>
                {hostInfo.cpuModel ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-cpu-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>CPU(s)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.cpuModel}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.kernelVersion ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-terminal-box-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Kernel Version</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.kernelVersion}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.bootMode ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-restart-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Boot Mode</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>{hostInfo.bootMode}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.pveVersion ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-server-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Manager Version</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.pveVersion}</Typography>
                    </Box>
                  </Box>
                ) : null}
              </Stack>
            </Box>

            {/* Colonne 4 - Mises à jour disponibles */}
            {hostInfo.updates && hostInfo.updates.length > 0 && (
              <Box
                sx={{
                  flex: hostBlocksCollapsed.updates ? '0 0 auto' : 1,
                  width: hostBlocksCollapsed.updates ? 44 : 'auto',
                  minWidth: hostBlocksCollapsed.updates ? 44 : undefined,
                  border: '1px solid',
                  borderColor: 'warning.main',
                  borderRadius: 2,
                  bgcolor: 'rgba(255, 152, 0, 0.05)',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                }}
              >
                {hostBlocksCollapsed.updates ? (
                  // Mode collapsé vertical - juste une icône cliquable
                  <Box 
                    onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, updates: false }))}
                    sx={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      minHeight: 150,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(255, 152, 0, 0.1)' }
                    }}
                  >
                    <i className="ri-download-cloud-line" style={{ fontSize: 20, color: '#ff9800' }} />
                    <Chip 
                      size="small" 
                      label={hostInfo.updates.length} 
                      color="warning"
                      sx={{ height: 18, fontSize: 11, fontWeight: 700, mt: 1 }}
                    />
                    <i className="ri-arrow-right-s-line" style={{ fontSize: 16, opacity: 0.5, marginTop: 8 }} />
                  </Box>
                ) : (
                  // Mode étendu
                  <>
                    <Box 
                      onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, updates: true }))}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        p: 1.25,
                        pb: 0.75,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(255, 152, 0, 0.08)' }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-download-cloud-line" style={{ fontSize: 16, color: '#ff9800' }} />
                        <Typography variant="body2" sx={{ fontWeight: 700, color: 'warning.main' }}>
                          {t('updates.availableUpdates')}
                        </Typography>
                        <Chip 
                          size="small" 
                          label={hostInfo.updates.length} 
                          color="warning"
                          sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                        />
                      </Box>
                      <i className="ri-arrow-left-s-line" style={{ fontSize: 18, opacity: 0.5 }} />
                    </Box>
                    
                    <Box sx={{ px: 1.25, pb: 1.25 }}>
                      <Box sx={{ maxHeight: 120, overflow: 'auto', mb: 1.5 }}>
                        {hostInfo.updates.slice(0, 5).map((update: any, idx: number) => (
                          <Box 
                            key={idx} 
                            sx={{ 
                              display: 'flex', 
                              justifyContent: 'space-between', 
                              alignItems: 'center',
                              py: 0.5,
                              borderBottom: idx < Math.min(hostInfo.updates.length, 5) - 1 ? '1px solid' : 'none',
                              borderColor: 'divider'
                            }}
                          >
                            <Typography variant="caption" sx={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {update.package}
                            </Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
                              <Typography variant="caption" sx={{ opacity: 0.5 }}>{update.currentVersion}</Typography>
                              <i className="ri-arrow-right-line" style={{ fontSize: 10, opacity: 0.5 }} />
                              <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 600 }}>{update.newVersion}</Typography>
                            </Box>
                          </Box>
                        ))}
                        {hostInfo.updates.length > 5 && (
                          <Typography variant="caption" sx={{ opacity: 0.6, display: 'block', mt: 0.5 }}>
                            +{hostInfo.updates.length - 5} {t('updates.morePackages')}
                          </Typography>
                        )}
                      </Box>
                      
                      <Stack direction="row" spacing={1}>
                        <Button 
                          size="small" 
                          variant="contained" 
                          color="warning"
                          startIcon={<i className="ri-download-line" />}
                          sx={{ flex: 1, fontSize: '0.7rem' }}
                          onClick={() => setUpgradeDialogOpen(true)}
                        >
                          {t('updates.upgrade')}
                        </Button>
                        <Button 
                          size="small" 
                          variant="outlined" 
                          color="warning"
                          startIcon={<i className="ri-file-list-line" />}
                          sx={{ fontSize: '0.7rem' }}
                          onClick={() => setChangelogDialogOpen(true)}
                        >
                          Changelog
                        </Button>
                      </Stack>
                    </Box>
                  </>
                )}
              </Box>
            )}

            {/* Colonne 5 - Subscription Status */}
            {hostInfo.subscription && (() => {
              // Calculer si l'échéance est proche (moins de 30 jours)
              const isActive = hostInfo.subscription.status === 'active'
              const nextDueDate = hostInfo.subscription.nextDueDate ? new Date(hostInfo.subscription.nextDueDate) : null
              const daysUntilDue = nextDueDate ? Math.ceil((nextDueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null
              const isExpiringSoon = isActive && daysUntilDue !== null && daysUntilDue <= 30 && daysUntilDue > 0
              const isExpired = !isActive || (daysUntilDue !== null && daysUntilDue <= 0)
              
              // Déterminer la couleur selon le statut
              const statusColor = isExpired ? '#f44336' : isExpiringSoon ? '#ff9800' : '#4caf50'
              const statusBgColor = isExpired ? 'rgba(244, 67, 54, 0.05)' : isExpiringSoon ? 'rgba(255, 152, 0, 0.05)' : 'rgba(76, 175, 80, 0.05)'
              const statusHoverBgColor = isExpired ? 'rgba(244, 67, 54, 0.1)' : isExpiringSoon ? 'rgba(255, 152, 0, 0.1)' : 'rgba(76, 175, 80, 0.1)'
              const chipColor = isExpired ? 'error' : isExpiringSoon ? 'warning' : 'success'
              
              return (
              <Box
                sx={{
                  flex: hostBlocksCollapsed.subscription ? '0 0 auto' : 1,
                  width: hostBlocksCollapsed.subscription ? 44 : 'auto',
                  minWidth: hostBlocksCollapsed.subscription ? 44 : undefined,
                  border: '1px solid',
                  borderColor: statusColor,
                  borderRadius: 2,
                  bgcolor: statusBgColor,
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                }}
              >
                {hostBlocksCollapsed.subscription ? (
                  // Mode collapsé vertical - juste une icône cliquable
                  <Box 
                    onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, subscription: false }))}
                    sx={{ 
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      minHeight: 150,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: statusHoverBgColor }
                    }}
                  >
                    <i className="ri-vip-crown-line" style={{ fontSize: 20, color: statusColor }} />
                    <Chip 
                      size="small" 
                      label={isExpired ? '✗' : isExpiringSoon ? '!' : '✓'}
                      color={chipColor}
                      sx={{ height: 18, fontSize: 11, fontWeight: 700, mt: 1 }}
                    />
                    <i className="ri-arrow-right-s-line" style={{ fontSize: 16, opacity: 0.5, marginTop: 8 }} />
                  </Box>
                ) : (
                  // Mode étendu
                  <>
                    <Box 
                      onClick={() => setHostBlocksCollapsed(prev => ({ ...prev, subscription: true }))}
                      sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        p: 1.25,
                        pb: 0.75,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: statusHoverBgColor }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <i className="ri-vip-crown-line" style={{ fontSize: 16, color: statusColor }} />
                        <Typography variant="body2" sx={{ fontWeight: 700, color: statusColor }}>
                          Subscription
                        </Typography>
                        <Chip 
                          size="small" 
                          label={isExpired ? t('subscription.inactive') : isExpiringSoon ? t('subscription.expiringSoon') : t('subscription.active')}
                          color={chipColor}
                          sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                        />
                      </Box>
                      <i className="ri-arrow-left-s-line" style={{ fontSize: 18, opacity: 0.5 }} />
                    </Box>
                    
                    <Box sx={{ px: 1.25, pb: 1.25 }}>
                      <Stack spacing={1}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.type')}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hostInfo.subscription.type}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.key')}</Typography>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10 }}>{hostInfo.subscription.key}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.serverId')}</Typography>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 9, opacity: 0.8 }}>{hostInfo.subscription.serverId?.substring(0, 16)}...</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.sockets')}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{hostInfo.subscription.sockets}</Typography>
                        </Box>
                        <Divider sx={{ my: 0.5 }} />
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.lastChecked')}</Typography>
                          <Typography variant="caption">{hostInfo.subscription.lastChecked}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" sx={{ opacity: 0.6 }}>{t('subscription.nextDueDate')}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {isExpiringSoon && <i className="ri-error-warning-line" style={{ fontSize: 12, color: '#ff9800' }} />}
                            <Typography variant="caption" sx={{ fontWeight: 600, color: statusColor }}>
                              {hostInfo.subscription.nextDueDate}
                              {isExpiringSoon && daysUntilDue !== null && ` (${daysUntilDue}j)`}
                            </Typography>
                          </Box>
                        </Box>
                      </Stack>
                      
                      <Box sx={{ mt: 1.5 }}>
                        <Button 
                          size="small" 
                          variant="outlined"
                          fullWidth
                          startIcon={checkingSubscription ? <CircularProgress size={12} /> : <i className="ri-refresh-line" />}
                          sx={{ fontSize: '0.65rem', borderColor: statusColor, color: statusColor }}
                          onClick={handleCheckSubscription}
                          disabled={checkingSubscription}
                        >
                          {t('subscription.check')}
                        </Button>
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
              )
            })()}
          </Box>
        ) : (
          <Box
            sx={{
              width: '100%',
              display: 'flex',
              gap: 2,
              alignItems: 'stretch',
              flexDirection: { xs: 'column', md: 'row' },
            }}
          >
            {/* Bloc CPU/RAM/Storage */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: (theme) => theme.palette.mode === 'light' ? 'grey.50' : undefined,
              }}
            >
              {/* Pour PBS et Datastore, n'afficher que Storage */}
              {kindLabel === 'PBS' || kindLabel === 'DATASTORE' ? (
                <UsageBar themeColor={primaryColor} label="Storage" used={diskUsed} capacity={diskCap} mode="bytes" />
              ) : (
                <>
                  <UsageBar themeColor={primaryColor} label="CPU" used={cpuNowPct} capacity={100} mode="pct" />
                  <UsageBar themeColor={primaryColor} label="Memory" used={memUsed} capacity={memCap} mode="bytes" />
                  <UsageBar themeColor={primaryColor} label="Storage" used={diskUsed} capacity={diskCap} mode="bytes" />
                </>
              )}
            </Box>

            {/* Bloc Health (uniquement pour CLUSTER) */}
          </Box>
        )}
      </CardContent>

      {/* Modal de mise à jour */}
      <Dialog 
        open={upgradeDialogOpen} 
        onClose={() => setUpgradeDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-download-cloud-line" style={{ fontSize: 24, color: '#ff9800' }} />
          {t('updates.upgradeTitle')}
        </DialogTitle>
        <DialogContent>
          {/* Résumé des mises à jour */}
          <Alert 
            severity={hasKernelUpdate ? 'warning' : 'info'} 
            sx={{ mb: 2 }}
            icon={hasKernelUpdate ? <i className="ri-restart-line" style={{ fontSize: 20 }} /> : <i className="ri-information-line" style={{ fontSize: 20 }} />}
          >
            <Box>
              <Typography variant="body2" fontWeight={600}>
                {hostInfo?.updates?.length || 0} {t('updates.packagesToUpdate')}
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

          {/* Liste des paquets */}
          <Box sx={{ 
            maxHeight: 300, 
            overflow: 'auto', 
            border: '1px solid', 
            borderColor: 'divider', 
            borderRadius: 1,
            mb: 2
          }}>
            {/* Header */}
            <Box sx={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 120px 120px',
              gap: 1,
              px: 1.5,
              py: 1,
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
            {hostInfo?.updates?.map((update: any, idx: number) => (
              <Box 
                key={idx}
                sx={{ 
                  display: 'grid', 
                  gridTemplateColumns: '1fr 120px 120px',
                  gap: 1,
                  px: 1.5,
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                  '&:hover': { bgcolor: 'action.hover' },
                  bgcolor: update.package?.toLowerCase().includes('kernel') ? 'rgba(255, 152, 0, 0.1)' : 'transparent'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {update.package?.toLowerCase().includes('kernel') && (
                    <i className="ri-restart-line" style={{ fontSize: 12, color: '#ff9800' }} />
                  )}
                  <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {update.package}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, opacity: 0.6 }}>
                  {update.currentVersion}
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11, color: 'success.main', fontWeight: 600 }}>
                  {update.newVersion}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Sélection du type de console */}
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('updates.selectConsole')}
          </Typography>
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              color="warning"
              startIcon={<i className="ri-terminal-box-line" />}
              onClick={() => handleStartUpgrade('xterm')}
              sx={{ flex: 1 }}
            >
              xterm.js
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<i className="ri-computer-line" />}
              onClick={() => handleStartUpgrade('novnc')}
              sx={{ flex: 1 }}
            >
              noVNC
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpgradeDialogOpen(false)}>
            {t('common.cancel')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Modal Changelog */}
      <Dialog 
        open={changelogDialogOpen} 
        onClose={() => setChangelogDialogOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-file-list-line" style={{ fontSize: 24, color: '#ff9800' }} />
          Changelog
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {/* Liste des paquets avec changelog */}
          <Box sx={{ maxHeight: 500, overflow: 'auto' }}>
            {hostInfo?.updates?.map((update: any, idx: number) => (
              <Accordion 
                key={idx} 
                disableGutters
                elevation={0}
                square
                sx={{ 
                  '&:before': { display: 'none' },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' }
                }}
              >
                <AccordionSummary 
                  expandIcon={<i className="ri-arrow-down-s-line" />}
                  sx={{ minHeight: 44, '& .MuiAccordionSummary-content': { my: 0 } }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>
                      {update.package}
                    </Typography>
                    <Chip 
                      size="small" 
                      label={`${update.currentVersion || 'null'} → ${update.newVersion}`}
                      sx={{ height: 20, fontSize: 10, fontFamily: 'monospace' }}
                    />
                  </Box>
                </AccordionSummary>
                <AccordionDetails sx={{ bgcolor: 'action.hover', py: 1.5 }}>
                  <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', opacity: 0.8 }}>
                    {update.description || t('updates.noChangelogAvailable')}
                  </Typography>
                </AccordionDetails>
              </Accordion>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChangelogDialogOpen(false)}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Console de mise à jour (xterm/VNC) */}
      <Dialog 
        open={upgradeConsoleOpen} 
        onClose={() => setUpgradeConsoleOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{ sx: { height: '80vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-terminal-box-line" style={{ fontSize: 24 }} />
            {t('updates.upgradeInProgress')}
          </Box>
          <IconButton onClick={() => setUpgradeConsoleOpen(false)} size="small">
            <i className="ri-close-line" />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
          {connId && nodeName && upgradeTaskId && (
            <Box sx={{ flex: 1, bgcolor: '#000', p: 1 }}>
              <iframe
                src={`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/console?type=xterm`}
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  border: 'none',
                  backgroundColor: '#000'
                }}
                title="Upgrade Console"
              />
            </Box>
          )}
          {!upgradeTaskId && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <CircularProgress />
            </Box>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}


/* ---------------------- Charts (filled areas) ---------------------- */

export default VCenterSummary
