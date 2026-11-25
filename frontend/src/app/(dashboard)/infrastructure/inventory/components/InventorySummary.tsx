'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'
import { lighten } from '@mui/material/styles'

import DOMPurify from 'dompurify'
import { formatBytes } from '@/utils/format'

import type { NodeSensors } from '@/lib/sensors/hwmon'

import type { Status, Kpi, DetailsPayload, SeriesPoint } from '../types'
import { formatBps, formatUptime } from '../helpers'
import { computeNodeProvisioning, describeNodeProvisioning, type ProvisioningLabels } from '../nodeProvisioning'
import { ProvisioningChip, ProvisioningTooltip } from './ProvisioningInfo'
import { hostSummaryRowSx } from './hostSummaryLayout'
import { SensorTemp } from './SensorTemp'
import UsageBar from './UsageBar'
import ConsolePreview from './ConsolePreview'
import StatusChip from './StatusChip'
import { jsonInit, requireOk } from '@/lib/api/fetchJsonSafe'

/* ------------------------------------------------------------------ */
/* HA State Selector                                                   */
/* ------------------------------------------------------------------ */

const HA_STATES = ['started', 'stopped', 'enabled', 'disabled', 'ignored'] as const

function HaStateSelector({ haState, haGroup, vmInfo, readOnly, t }: {
  haState?: string | null
  haGroup?: string | null
  vmInfo?: { connId: string; node: string; type: string; vmid: string } | null
  // Tenant admins see HA as informational — they can't change state or
  // group. The chip stays visible (read-only) with an explicit lock icon
  // so the policy is obvious instead of mysteriously non-clickable.
  readOnly?: boolean
  t: (key: string, values?: any) => string
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const [saving, setSaving] = useState(false)
  const [displayState, setDisplayState] = useState(haState || '')

  React.useEffect(() => { setDisplayState(haState || '') }, [haState])

  const handleChange = async (newState: string) => {
    setAnchorEl(null)
    if (readOnly || !vmInfo || newState === displayState) return
    setDisplayState(newState)
    setSaving(true)
    const haSid = `${vmInfo.type === 'lxc' ? 'ct' : 'vm'}:${vmInfo.vmid}`
    try {
      await requireOk(
        `/api/v1/connections/${encodeURIComponent(vmInfo.connId)}/ha/${encodeURIComponent(haSid)}`,
        jsonInit('POST', { state: newState, group: haGroup || undefined }),
      )
    } catch {
      // PVE kept the previous state: show it again rather than the requested one.
      setDisplayState(haState || '')
    }
    setSaving(false)
  }

  const stateColor = (s: string) => {
    if (s === 'started') return 'success'
    if (s === 'error') return 'error'
    if (s === 'stopped' || s === 'disabled') return 'default'
    return 'warning'
  }

  // Treat readOnly as "no vmInfo for write": skip menu/click handlers and
  // drop the dropdown caret. Keeps a single source of truth for the
  // interactive vs informational rendering.
  const interactive = !!vmInfo && !readOnly

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <i className={readOnly ? 'ri-shield-keyhole-line' : 'ri-shield-check-line'} style={{ fontSize: 14, opacity: 0.6 }} />
      <Typography variant="body2" sx={{ opacity: 0.7 }}>HA:</Typography>
      {displayState ? (
        <>
          <Chip
            size="small"
            icon={<i className="ri-shield-check-fill" style={{ fontSize: 12, marginLeft: 6 }} />}
            label={`${displayState}${haGroup ? ` (${haGroup})` : ''}`}
            color={stateColor(displayState) as any}
            variant="outlined"
            onClick={interactive ? (e) => setAnchorEl(e.currentTarget) : undefined}
            deleteIcon={interactive ? <i className="ri-arrow-down-s-line" style={{ fontSize: 14 }} /> : undefined}
            onDelete={interactive ? (e: any) => setAnchorEl(e.currentTarget.closest('.MuiChip-root')) : undefined}
            sx={{ height: 20, fontSize: '0.75rem', cursor: interactive ? 'pointer' : 'default', '& .MuiChip-deleteIcon': { fontSize: 14, ml: -0.25, color: 'inherit', opacity: 0.6 } }}
          />
          {saving && <CircularProgress size={12} />}
          <Menu
            anchorEl={anchorEl}
            open={!!anchorEl}
            onClose={() => setAnchorEl(null)}
            slotProps={{ paper: { sx: { minWidth: 150 } } }}
          >
            {HA_STATES.map(s => {
              const meta: Record<string, { color: string; icon: string }> = {
                started:  { color: '#22c55e', icon: 'ri-play-circle-line' },
                stopped:  { color: '#9ca3af', icon: 'ri-stop-circle-line' },
                enabled:  { color: '#3b82f6', icon: 'ri-checkbox-circle-line' },
                disabled: { color: '#6b7280', icon: 'ri-forbid-line' },
                ignored:  { color: '#f59e0b', icon: 'ri-eye-off-line' },
              }
              const { color, icon } = meta[s]
              return (
                <MenuItem
                  key={s}
                  selected={s === displayState}
                  onClick={() => handleChange(s)}
                  sx={{ fontSize: 13, py: 0.75, gap: 1 }}
                >
                  <i className={icon} style={{ fontSize: 16, color, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: s === displayState ? 700 : 400, color, textTransform: 'capitalize' }}>
                    {s}
                  </Typography>
                </MenuItem>
              )
            })}
          </Menu>
        </>
      ) : interactive ? (
        <>
          <Chip
            size="small"
            label={t('common.disabled')}
            variant="outlined"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            deleteIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 14 }} />}
            onDelete={(e: any) => setAnchorEl(e.currentTarget.closest('.MuiChip-root'))}
            sx={{ height: 20, fontSize: '0.75rem', cursor: 'pointer', opacity: 0.5, '& .MuiChip-deleteIcon': { fontSize: 14, ml: -0.25, color: 'inherit', opacity: 0.6 } }}
          />
          {saving && <CircularProgress size={12} />}
          <Menu
            anchorEl={anchorEl}
            open={!!anchorEl}
            onClose={() => setAnchorEl(null)}
            slotProps={{ paper: { sx: { minWidth: 150 } } }}
          >
            {HA_STATES.map(s => {
              const meta: Record<string, { color: string; icon: string }> = {
                started:  { color: '#22c55e', icon: 'ri-play-circle-line' },
                stopped:  { color: '#9ca3af', icon: 'ri-stop-circle-line' },
                enabled:  { color: '#3b82f6', icon: 'ri-checkbox-circle-line' },
                disabled: { color: '#6b7280', icon: 'ri-forbid-line' },
                ignored:  { color: '#f59e0b', icon: 'ri-eye-off-line' },
              }
              const { color, icon } = meta[s]
              return (
                <MenuItem
                  key={s}
                  onClick={() => handleChange(s)}
                  sx={{ fontSize: 13, py: 0.75, gap: 1 }}
                >
                  <i className={icon} style={{ fontSize: 16, color, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ color, textTransform: 'capitalize' }}>
                    {s}
                  </Typography>
                </MenuItem>
              )
            })}
          </Menu>
        </>
      ) : (
        <Typography variant="body2" sx={{ opacity: 0.4 }}>
          {t('common.disabled')}
        </Typography>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

function InventorySummary({
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
  cephHealth,
  nodesOnline,
  nodesTotal,
  haState,
  haGroup,
  agentEnabled,
  ioSeries,
  isTemplate,
  vmNotes,
  disksInfo,
  cpuInfo,
  sensors,
  nodeVms,
}: {
  sensors?: NodeSensors | null
  kindLabel: string
  status: Status
  subtitle?: string
  metrics?: DetailsPayload['metrics']
  vmState?: string | null
  showConsole?: boolean
  hostInfo?: DetailsPayload['hostInfo']
  kpis?: Kpi[]
  vmInfo?: { connId: string; node: string; type: string; vmid: string } | null
  guestInfo?: { ip?: string; uptime?: number; diskUsage?: { used: number; total: number }; osInfo?: { type: 'linux' | 'windows' | 'other'; name: string | null; version: string | null; kernel: string | null } | null } | null
  guestInfoLoading?: boolean
  clusterPveVersion?: string
  cephHealth?: string
  nodesOnline?: number
  nodesTotal?: number
  haState?: string | null
  haGroup?: string | null
  agentEnabled?: boolean | null
  ioSeries?: SeriesPoint[]
  isTemplate?: boolean
  vmNotes?: string | null
  disksInfo?: { id: string; storage: string; size: string; format?: string; isCdrom?: boolean; isUnused?: boolean; isEfi?: boolean; isTpm?: boolean }[]
  cpuInfo?: { sockets?: number; cores?: number }
  /** Guests of the selected node, for the provisioned totals on its gauges (#969). */
  nodeVms?: DetailsPayload['vmsData']
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

  // I/O: latest values from RRD series
  const latestIo = ioSeries?.length ? ioSeries[ioSeries.length - 1] : null
  const diskReadBps = latestIo?.diskReadBps ?? 0
  const diskWriteBps = latestIo?.diskWriteBps ?? 0
  const netInBps = latestIo?.netInBps ?? 0
  const netOutBps = latestIo?.netOutBps ?? 0

  const consoleWidth = { xs: '100%', md: 360 }
  const { isAdmin } = useRBAC()

  // Provisioned vCPU / RAM for the selected node (#969). The figures ride on
  // the node's own gauges without adding a line to the card: the fill stays
  // real usage, the dashed marker is what the running guests hold, a chip by
  // the label carries the overcommit ratio and the marker's tooltip holds the
  // breakdown. Nothing renders for a node without guests.
  //
  // Admin only, and not for tidiness: /cluster/resources hands a non-admin only
  // the guests they may see, so their totals would describe their own share of
  // the node while reading as the node's overcommit. No figure beats a wrong one.
  const provisioning = React.useMemo(() => {
    if (!isAdmin) return null

    const totals = computeNodeProvisioning(nodeVms, { logicalCpus: hostInfo?.cpuTotal, memBytes: memCap })

    return totals ? describeNodeProvisioning(totals, { t, formatBytes }) : null
  }, [isAdmin, nodeVms, hostInfo?.cpuTotal, memCap, t])

  const markerFor = (labels?: ProvisioningLabels) =>
    labels?.markerPct != null
      ? { pct: labels.markerPct, label: labels.markerLabel, tooltip: <ProvisioningTooltip labels={labels} /> }
      : undefined
  // HA management is provider-only — tenant admins see HA state but
  // can't change it (cluster-level concern, not vDC-scoped).
  const { currentTenant, loading: tenantLoading } = useTenant()
  const isProviderTenant = !tenantLoading && currentTenant?.id === 'default'

  // Formater l'uptime
  const formatUptime = (secs?: number) => {
    if (!secs) return null
    const days = Math.floor(secs / 86400)
    const hours = Math.floor((secs % 86400) / 3600)
    const mins = Math.floor((secs % 3600) / 60)

    if (days > 0) return `${days}d ${hours}h ${mins}m`
    if (hours > 0) return `${hours}h ${mins}m`

return `${mins}m`
  }

  // Composant pour une ligne d'info host
  const InfoRow = ({ icon, label, value }: { icon: string; label: string; value: React.ReactNode }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
      <i className={icon} style={{ opacity: 0.6, fontSize: 14, width: 16 }} />
      <Typography variant="body2" sx={{ opacity: 0.7, minWidth: 120 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 500, textAlign: 'right', flex: 1 }}>{value}</Typography>
    </Box>
  )

  return (
    <Card variant="outlined" sx={{ width: '100%', borderRadius: 2 }}>
      <CardContent sx={{ p: 1.5 }}>
        {/* Header seulement pour les Clusters (pas pour les VMs ni les hosts) */}
        {!showConsole && !hostInfo ? (
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1, gap: 1, flexWrap: 'wrap' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              {kindLabel !== 'DATASTORE' && <Typography fontWeight={500}>{t('inventory.summary')}</Typography>}
              <Chip size="small" label={kindLabel} variant="outlined" />
              {kindLabel !== 'DATASTORE' && (vmState ? (
                <Chip
                  size="small"
                  label={vmState}
                  variant="outlined"
                  sx={{
                    borderColor: stateColor ? stateColor : 'divider',
                    color: stateColor ? stateColor : 'text.secondary',
                    bgcolor: stateColor ? `${stateColor}14` : 'transparent',
                    fontWeight: 500,
                  }}
                />
              ) : (
                <StatusChip status={status} />
              ))}
              {/* KPIs pour les clusters */}
              {kpis && kpis.length > 0 ? (
                kpis.map((kpi, idx) => (
                  <Chip
                    key={idx}
                    size="small"
                    label={`${kpi.label}: ${kpi.value}`}
                    variant="outlined"
                    sx={{ fontWeight: 500 }}
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
                  sx={{ fontWeight: 500 }}
                />
              )}
            </Stack>
          </Stack>
        ) : null}

        {showConsole || isTemplate ? (
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
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                pb: 1,
                bgcolor: 'background.paper',
              }}
            >
              {!isTemplate && (
                <>
                  <UsageBar
                    themeColor={primaryColor}
                    label="CPU"
                    used={cpuNowPct}
                    capacity={100}
                    mode="pct"
                    extra={cpuInfo ? (
                      <Chip
                        size="small"
                        label={`${(cpuInfo.sockets || 1) * (cpuInfo.cores || 1)} vCPU${(cpuInfo.sockets || 1) * (cpuInfo.cores || 1) > 1 ? 's' : ''} (${cpuInfo.sockets || 1}s × ${cpuInfo.cores || 1}c)`}
                        variant="outlined"
                        sx={{ height: 18, fontSize: 11, '& .MuiChip-label': { px: 0.75 } }}
                      />
                    ) : undefined}
                  />
                  <UsageBar
                    themeColor={primaryColor}
                    label={t('inventory.memoryLabel')}
                    used={memUsed}
                    capacity={memCap}
                    mode="bytes"
                    extra={memCap > 0 ? (
                      <Chip
                        size="small"
                        label={`${(memCap / 1073741824).toFixed(memCap / 1073741824 >= 1 ? 0 : 1)} GiB`}
                        variant="outlined"
                        sx={{ height: 18, fontSize: 11, '& .MuiChip-label': { px: 0.75 } }}
                      />
                    ) : undefined}
                  />
                  {guestInfo?.diskUsage && guestInfo.diskUsage.total > 0 && (
                    <UsageBar
                      themeColor={primaryColor}
                      label={t('inventory.storageLabel')}
                      used={guestInfo.diskUsage.used}
                      capacity={guestInfo.diskUsage.total}
                      mode="bytes"
                      extra={disksInfo && disksInfo.filter(d => !d.isUnused && !d.isCdrom).length > 0 ? (
                        <>
                          {disksInfo.filter(d => !d.isUnused && !d.isCdrom).map(disk => (
                            <Chip
                              key={disk.id}
                              size="small"
                              label={`${disk.id}: ${disk.storage} (${disk.size})`}
                              variant="outlined"
                              sx={{ height: 18, fontSize: 11, '& .MuiChip-label': { px: 0.75 } }}
                            />
                          ))}
                        </>
                      ) : undefined}
                    />
                  )}
                </>
              )}


              {/* Spacer to push IP/Uptime/HA to bottom */}
              <Box sx={{ flex: 1 }} />

              {/* IP, Uptime, HA */}
              <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-global-line" style={{ fontSize: 14, opacity: 0.6 }} />
                    <Typography variant="body2" sx={{ opacity: 0.7 }}>IP:</Typography>
                    {guestInfoLoading ? (
                      <CircularProgress size={12} />
                    ) : guestInfo?.ip ? (
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {guestInfo.ip}
                      </Typography>
                    ) : (
                      <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-time-line" style={{ fontSize: 14, opacity: 0.6 }} />
                    <Typography variant="body2" sx={{ opacity: 0.7 }}>{t('inventory.uptime')}:</Typography>
                    {guestInfoLoading ? (
                      <CircularProgress size={12} />
                    ) : formatUptime(guestInfo?.uptime) ? (
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {formatUptime(guestInfo?.uptime)}
                      </Typography>
                    ) : (
                      <Typography variant="body2" sx={{ opacity: 0.4 }}>—</Typography>
                    )}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-robot-line" style={{ fontSize: 14, opacity: 0.6 }} />
                    <Typography variant="body2" sx={{ opacity: 0.7 }}>QEMU-GA:</Typography>
                    <Chip
                      size="small"
                      label={agentEnabled ? t('common.enabled') : t('common.disabled')}
                      color={agentEnabled ? 'success' : 'default'}
                      variant="outlined"
                      sx={{ height: 20, fontSize: '0.75rem' }}
                    />
                  </Box>
                  <HaStateSelector haState={haState} haGroup={haGroup} vmInfo={vmInfo} readOnly={!isProviderTenant} t={t} />
                </Box>
              </Box>
            </Box>

            {!isTemplate && (
              <Box sx={{ width: consoleWidth, flex: '0 0 auto', display: 'flex', flexDirection: 'column' }}>
                <ConsolePreview
                  height="100%"
                  connId={vmInfo?.connId}
                  node={vmInfo?.node}
                  type={vmInfo?.type}
                  vmid={vmInfo?.vmid}
                  vmStatus={vmState || undefined}
                  osInfo={guestInfo?.osInfo}
                  osLoading={guestInfoLoading}
                />
              </Box>
            )}
          </Box>
        ) : hostInfo ? (

          /* Affichage détaillé pour les Hosts - 3 colonnes */
          <Box sx={{ containerType: 'inline-size' }}>
          <Box sx={hostSummaryRowSx()}>
            {/* Colonne 1 - CPU, Load, RAM, SWAP, IO delay, KSM */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                bgcolor: 'background.paper',
              }}
            >
              <UsageBar
                themeColor={primaryColor}
                label="CPU usage"
                used={cpuNowPct}
                capacity={100}
                mode="pct"
                extra={
                  <>
                    <SensorTemp sensors={sensors} role="cpu" />
                    {provisioning ? <ProvisioningChip labels={provisioning.cpu} /> : null}
                  </>
                }
                marker={markerFor(provisioning?.cpu)}
              />
              {hostInfo.loadAvg ? (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <i className="ri-dashboard-3-line" style={{ fontSize: 14, color: primaryColor }} />
                    <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>
                      Load average
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>{hostInfo.loadAvg}</Typography>
                </Box>
              ) : null}
              <UsageBar
                themeColor={primaryColor}
                label={hostInfo.ksmSharing != null ? `RAM usage (KSM: ${formatBytes(hostInfo.ksmSharing)})` : "RAM usage"}
                used={memUsed}
                capacity={memCap}
                mode="bytes"
                extra={
                  <>
                    <SensorTemp sensors={sensors} role="memory" />
                    {provisioning ? <ProvisioningChip labels={provisioning.memory} /> : null}
                  </>
                }
                marker={markerFor(provisioning?.memory)}
              />
              {swapCap > 0 ? (
                <UsageBar themeColor={primaryColor} label="SWAP usage" used={swapUsed} capacity={swapCap} mode="bytes" />
              ) : null}
              {/* Proxmox fills a node's disk/maxdisk from df('/'), so this is the
                  host root filesystem and NOT the datastores listed in the tree.
                  Labelled explicitly: calling it "Storage" is what made a customer
                  read a root-filesystem alert as a datastore filling up.
                  No drive temperature here: a filesystem has none, and the hottest
                  drive is often not the one holding '/'. Each drive's own reading
                  is in its SMART detail, under the node's Disks tab. */}
              {diskCap > 0 ? (
                <UsageBar
                  themeColor={primaryColor}
                  label="Root FS usage"
                  icon="ri-hard-drive-2-line"
                  used={diskUsed}
                  capacity={diskCap}
                  mode="bytes"
                />
              ) : null}

            </Box>

            {/* Colonne 2 - Informations système */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                p: 1.25,
                position: 'relative',
                overflow: 'hidden',
                bgcolor: 'background.paper',
              }}
            >
              {/* The usage-bar column sets the row height, so these rows spread to
                  fill it instead of stacking at the top over dead space. spacing
                  stays the floor when there is nothing extra to distribute. */}
              <Stack spacing={2.5} sx={{ flex: 1, justifyContent: 'space-between' }}>
                {hostInfo.cpuModel ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-cpu-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>CPU(s)</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.cpuModel}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.kernelVersion ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-terminal-box-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t('inventory.kernelVersion')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.kernelVersion}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.bootMode ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-restart-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t('inventory.bootMode')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>{hostInfo.bootMode}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.pveVersion ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-server-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t('inventory.managerVersion')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary', wordBreak: 'break-word' }}>{hostInfo.pveVersion}</Typography>
                    </Box>
                  </Box>
                ) : null}
                {hostInfo.uptime ? (
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                    <i className="ri-time-line" style={{ fontSize: 14, color: primaryColor, marginTop: 2 }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t('inventory.uptime')}</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500, color: 'text.primary' }}>{formatUptime(hostInfo.uptime)}</Typography>
                    </Box>
                  </Box>
                ) : null}
              </Stack>
            </Box>
          </Box>
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
            {/* Bloc CPU/RAM/Storage (masqué pour DATASTORE car déjà dans Storage Usage) */}
            {kindLabel !== 'DATASTORE' && (
              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 2,
                  p: 1.25,
                  bgcolor: 'background.paper',
                }}
              >
                {kindLabel === 'PBS' || kindLabel === 'STORAGE' ? (
                  <UsageBar themeColor={primaryColor} label={t('inventory.storageLabel')} used={diskUsed} capacity={diskCap} mode="bytes" />
                ) : (
                  <>
                    <UsageBar themeColor={primaryColor} label="CPU" used={cpuNowPct} capacity={100} mode="pct" />
                    <UsageBar themeColor={primaryColor} label={t('inventory.memoryLabel')} used={memUsed} capacity={memCap} mode="bytes" />
                  </>
                )}
              </Box>
            )}

            {/* Bloc Health (uniquement pour CLUSTER) */}
          </Box>
        )}
      </CardContent>

    </Card>
  )
}


/* ---------------------- Charts (filled areas) ---------------------- */

export default InventorySummary
