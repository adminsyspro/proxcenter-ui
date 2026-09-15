'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Skeleton,
  Snackbar,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'

import type { ReplicationJob, RecoveryPlan, VMRestorePoints } from '@/lib/orchestrator/site-recovery.types'

/**
 * Guest glyph, without the status dot the rest of the product carries: this
 * screen is about the DR site, where every replica sits stopped by design,
 * and the one power state that matters here already has its own column.
 */
const GuestGlyph = () => (
  <Box sx={{ width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <i className="ri-computer-line" style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
  </Box>
)

// The replication job state as one icon: the word lives in the tooltip, so a
// row carries glyphs instead of a wall of chips. An unknown value keeps a
// neutral icon and shows the raw value rather than disappearing.
const JOB_STATUS_ICONS: Record<string, { icon: string; color: string; label: string }> = {
  synced: { icon: 'ri-checkbox-circle-line', color: 'success.main', label: 'status.synced' },
  syncing: { icon: 'ri-refresh-line', color: 'info.main', label: 'status.syncing' },
  paused: { icon: 'ri-pause-circle-line', color: 'warning.main', label: 'status.paused' },
  pending: { icon: 'ri-time-line', color: 'text.disabled', label: 'status.pending' },
  error: { icon: 'ri-error-warning-line', color: 'error.main', label: 'status.error' },
  partial: { icon: 'ri-error-warning-line', color: 'warning.main', label: 'status.partial' },
  no_match: { icon: 'ri-filter-off-line', color: 'warning.main', label: 'status.noMatch' },
  suspended: { icon: 'ri-test-tube-line', color: 'warning.main', label: 'status.suspended' },
  failed_over: { icon: 'ri-alarm-warning-line', color: 'error.main', label: 'status.failedOver' },
}

// Mirror the Go destinationVMID logic
function destinationVMID(prefix: number, vmid: number): number {
  if (!prefix) return vmid
  const digits = String(vmid).length
  let multiplier = 1
  for (let i = 0; i < digits; i++) multiplier *= 10
  return prefix * multiplier + vmid
}

interface DRReadyVM {
  vmId: number
  vmName: string
  targetVmId: number
  sourceCluster: string
  targetCluster: string
  jobId: string
  jobStatus: string
  lastSync: string | null
  rpoTarget: number
  planId?: string
  planName?: string
  tier?: number
  bootOrder?: number
}

interface EmergencyDRTabProps {
  jobs: ReplicationJob[]
  plans: RecoveryPlan[]
  loading: boolean
  connections: Array<{ id: string; name: string }>
  vmNamesByConn: Record<string, Record<number, string>>
  /** connection id -> vmid -> PVE power state, for the DR replicas listed here. */
  vmStatesByConn: Record<string, Record<number, string>>
  onStartVM: (vmId: number, targetCluster: string, jobId: string, restorePoint?: string) => Promise<void>
  onStopVM: (vmId: number, targetCluster: string, jobId: string, resumeReplication: boolean) => Promise<void>
  /** Restore points of one replicated guest, loaded when its start dialog opens. */
  loadRestorePoints: (jobId: string, vmId: number) => Promise<VMRestorePoints>
  onExecuteFailover: (planId: string) => void
  onExecuteFailback: (planId: string) => void
  onDeletePlan?: (planId: string) => void
}

export default function EmergencyDRTab({
  jobs, plans, loading, connections, vmNamesByConn, vmStatesByConn, onStartVM, onStopVM, loadRestorePoints,
  onExecuteFailover, onExecuteFailback, onDeletePlan
}: EmergencyDRTabProps) {
  const t = useTranslations('siteRecovery')
  const tc = useTranslations('common')
  const [loadingVMs, setLoadingVMs] = useState<Record<string, 'starting' | 'stopping'>>({})
  const [deletePlanId, setDeletePlanId] = useState<string | null>(null)
  // Stop confirmation: the replica may be serving production right now, and
  // resuming replication rolls its image back to the last mirror snapshot,
  // so the operator confirms both the stop and the resume explicitly.
  const [stopTarget, setStopTarget] = useState<DRReadyVM | null>(null)
  const [resumeReplication, setResumeReplication] = useState(true)
  // Start confirmation: the operator picks the restore point to boot from and
  // reads what starting a single replica costs the rest of its job.
  const [startTarget, setStartTarget] = useState<DRReadyVM | null>(null)
  const [restorePoint, setRestorePoint] = useState('')
  const [restorePoints, setRestorePoints] = useState<{ loading: boolean; data: VMRestorePoints | null; failed: boolean }>({
    loading: false, data: null, failed: false
  })
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success'
  })

  const connMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of connections) m[c.id] = c.name
    return m
  }, [connections])

  // Build DR-ready VM list
  const { planVMs, standaloneVMs, planGroups } = useMemo(() => {
    const allDRVMs: DRReadyVM[] = []

    for (const job of jobs) {
      for (const vmId of (job.vm_ids || [])) {
        allDRVMs.push({
          vmId,
          vmName: vmNamesByConn[job.source_cluster]?.[vmId] || `VM ${vmId}`,
          targetVmId: destinationVMID(job.vmid_prefix, vmId),
          sourceCluster: job.source_cluster,
          targetCluster: job.target_cluster,
          jobId: job.id,
          jobStatus: job.status,
          lastSync: job.last_sync || null,
          rpoTarget: job.rpo_target,
        })
      }
    }

    // Attach plan info
    const vmInPlan = new Set<number>()
    for (const plan of plans) {
      for (const pvm of (plan.vms || [])) {
        vmInPlan.add(pvm.vm_id)
        const drvm = allDRVMs.find(v => v.vmId === pvm.vm_id && v.sourceCluster === plan.source_cluster)
        if (drvm) {
          drvm.planId = plan.id
          drvm.planName = plan.name
          drvm.tier = pvm.tier
          drvm.bootOrder = pvm.boot_order
        }
      }
    }

    const pVMs = allDRVMs.filter(v => v.planId)
    const sVMs = allDRVMs.filter(v => !v.planId)

    // Group by plan
    const groups: Record<string, { plan: RecoveryPlan; vms: DRReadyVM[] }> = {}
    for (const vm of pVMs) {
      if (!vm.planId) continue
      if (!groups[vm.planId]) {
        const plan = plans.find(p => p.id === vm.planId)!
        groups[vm.planId] = { plan, vms: [] }
      }
      groups[vm.planId].vms.push(vm)
    }

    // Sort VMs within each plan by tier then boot order
    for (const g of Object.values(groups)) {
      g.vms.sort((a, b) => (a.tier || 99) - (b.tier || 99) || (a.bootOrder || 99) - (b.bootOrder || 99))
    }

    return { planVMs: pVMs, standaloneVMs: sVMs, planGroups: groups }
  }, [jobs, plans, vmNamesByConn])

  const totalDR = planVMs.length + standaloneVMs.length
  const healthyJobs = jobs.filter(j => j.status === 'synced' || j.status === 'syncing').length
  const totalJobs = jobs.length

  const handleStartVM = async (vm: DRReadyVM, snapshot: string) => {
    const key = `${vm.vmId}`
    setLoadingVMs(prev => ({ ...prev, [key]: 'starting' }))
    try {
      await onStartVM(vm.vmId, vm.targetCluster, vm.jobId, snapshot || undefined)
      setSnackbar({ open: true, message: t('emergencyDR.vmStarted', { name: vm.vmName, vmid: vm.targetVmId }), severity: 'success' })
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.message || 'Failed to start VM', severity: 'error' })
    } finally {
      setLoadingVMs(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  const handleStopVM = async (vm: DRReadyVM, resume: boolean) => {
    const key = `${vm.vmId}`
    setLoadingVMs(prev => ({ ...prev, [key]: 'stopping' }))
    try {
      await onStopVM(vm.vmId, vm.targetCluster, vm.jobId, resume)
      setSnackbar({ open: true, message: t('emergencyDR.vmStopped', { name: vm.vmName, vmid: vm.targetVmId }), severity: 'success' })
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.message || 'Failed to stop VM', severity: 'error' })
    } finally {
      setLoadingVMs(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  const openStartDialog = (vm: DRReadyVM) => {
    setRestorePoint('')
    setStartTarget(vm)
    setRestorePoints({ loading: true, data: null, failed: false })
    loadRestorePoints(vm.jobId, vm.vmId)
      .then(data => setRestorePoints({ loading: false, data, failed: false }))
      .catch(() => setRestorePoints({ loading: false, data: null, failed: true }))
  }

  const openStopDialog = (vm: DRReadyVM) => {
    setResumeReplication(true)
    setStopTarget(vm)
  }

  // The DR replica's own power state, read from the cluster inventory the page
  // already loads. PVE reports a PAUSED guest as "running" too, which is why
  // the chip says started/stopped rather than running/paused.
  const replicaState = (vm: DRReadyVM) => vmStatesByConn[vm.targetCluster]?.[vm.targetVmId]

  // How many OTHER guests stop replicating while this one runs on the DR site:
  // the emergency start pauses the job, and a job can protect many guests.
  const jobSiblingCount = (vm: DRReadyVM) => {
    const job = jobs.find(j => j.id === vm.jobId)

    return Math.max(0, (job?.vm_ids?.length || 1) - 1)
  }

  const tierLabel = (tier?: number) => {
    switch (tier) {
      case 1: return t('plans.tierCritical')
      case 2: return t('plans.tierImportant')
      case 3: return t('plans.tierStandard')
      default: return '-'
    }
  }

  const tierColor = (tier?: number): 'error' | 'warning' | 'default' => {
    switch (tier) {
      case 1: return 'error'
      case 2: return 'warning'
      default: return 'default'
    }
  }

  // The plan status is a raw enum ("failed_over", "failing_back"): the same
  // translated labels RecoveryPlansTab uses, so the panic screen never shows
  // a key with an underscore in it. An unknown value falls back to itself.
  const planStatusLabel = (status: string) => {
    if (status === 'failing_back') return t('plans.statusFailingBack')

    const key = `planStatus.${status}`
    const label = t.has(key) ? t(key) : status

    return label
  }

  // started / stopped / unknown, never the raw PVE word: "running" there also
  // covers a paused guest, and an operator reading "running" on a DR row in
  // the middle of an incident must not be told the replica is serving.
  const replicaChip = (state?: string) => {
    if (!state) return <Typography variant="body2" color="text.disabled">-</Typography>

    const started = state === 'running' || state === 'paused'

    return (
      <Tooltip title={started ? t('emergencyDR.replicaStartedHint') : ''} disableHoverListener={!started} arrow>
        <Chip
          size="small"
          variant="outlined"
          color={started ? 'success' : 'default'}
          icon={<i className={started ? 'ri-play-circle-line' : 'ri-stop-circle-line'} style={{ fontSize: 14 }} />}
          label={started ? t('emergencyDR.replicaStarted') : t('emergencyDR.replicaStopped')}
        />
      </Tooltip>
    )
  }

  const statusIcon = (status: string) => {
    const spec = JOB_STATUS_ICONS[status]

    return (
      <Tooltip title={spec ? t(spec.label) : status} arrow>
        <Box
          component="i"
          className={spec?.icon || 'ri-question-line'}
          sx={{ fontSize: 18, color: spec?.color || 'text.disabled', display: 'inline-flex' }}
        />
      </Tooltip>
    )
  }

  const formatLastSync = (ls: string | null) => {
    if (!ls) return '-'
    const d = new Date(ls)
    const ago = Math.floor((Date.now() - d.getTime()) / 1000)
    if (ago < 60) return `${ago}s ago`
    if (ago < 3600) return `${Math.floor(ago / 60)}m ago`
    if (ago < 86400) return `${Math.floor(ago / 3600)}h ago`
    return `${Math.floor(ago / 86400)}d ago`
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Skeleton variant="rounded" height={60} />
        <Skeleton variant="rounded" height={300} />
      </Box>
    )
  }

  if (totalDR === 0) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ textAlign: 'center', py: 6 }}>
          <i className="ri-alarm-warning-line" style={{ fontSize: 48, opacity: 0.3 }} />
          <Typography variant="h6" sx={{ mt: 2, opacity: 0.7 }}>{t('emergencyDR.noVMs')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('emergencyDR.noVMsDesc')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  const renderVMTable = (vms: DRReadyVM[], showTier: boolean) => (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('emergencyDR.vmName')}</TableCell>
            <TableCell>{t('emergencyDR.sourceVMID')}</TableCell>
            <TableCell>{t('emergencyDR.drVMID')}</TableCell>
            <TableCell>{t('emergencyDR.replicaState')}</TableCell>
            <TableCell>{t('emergencyDR.replStatus')}</TableCell>
            <TableCell>{t('emergencyDR.lastSync')}</TableCell>
            <TableCell>{t('emergencyDR.rpo')}</TableCell>
            {showTier && <TableCell>{t('emergencyDR.tier')}</TableCell>}
            <TableCell align="right">{t('emergencyDR.actions')}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {vms.map(vm => {
            const key = `${vm.vmId}`
            const vmLoading = loadingVMs[key]
            return (
              <TableRow key={key} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <GuestGlyph />
                    <Typography variant="body2" fontWeight={500}>{vm.vmName}</Typography>
                  </Box>
                </TableCell>
                <TableCell><code>{vm.vmId}</code></TableCell>
                <TableCell><code>{vm.targetVmId}</code></TableCell>
                <TableCell>{replicaChip(replicaState(vm))}</TableCell>
                <TableCell>{statusIcon(vm.jobStatus)}</TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{formatLastSync(vm.lastSync)}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {vm.rpoTarget >= 3600 ? `${Math.floor(vm.rpoTarget / 3600)}h` : `${Math.floor(vm.rpoTarget / 60)}m`}
                  </Typography>
                </TableCell>
                {showTier && (
                  <TableCell>
                    <Chip size="small" label={tierLabel(vm.tier)} color={tierColor(vm.tier)} variant="outlined" />
                  </TableCell>
                )}
                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                    <Tooltip title={t('emergencyDR.startVM')}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={!!vmLoading}
                          onClick={() => openStartDialog(vm)}
                          sx={{ color: 'success.main', '&:hover': { bgcolor: 'success.main', color: 'white' } }}
                        >
                          {vmLoading === 'starting' ? <CircularProgress size={16} /> : <i className="ri-play-circle-line" style={{ fontSize: 18 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('emergencyDR.stopVM')}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={!!vmLoading}
                          onClick={() => openStopDialog(vm)}
                          sx={{ color: 'warning.main', '&:hover': { bgcolor: 'warning.main', color: 'white' } }}
                        >
                          {vmLoading === 'stopping' ? <CircularProgress size={16} /> : <i className="ri-stop-circle-line" style={{ fontSize: 18 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Summary bar */}
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 3, py: '12px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-alarm-warning-line" style={{ fontSize: 20, color: 'var(--mui-palette-warning-main)' }} />
            <Typography variant="subtitle2">{t('emergencyDR.title')}</Typography>
          </Box>
          <Chip label={`${totalDR} ${t('emergencyDR.drReadyVMs')}`} size="small" color="warning" variant="outlined" />
          <Chip label={`${planVMs.length} ${t('emergencyDR.inPlans')}`} size="small" variant="outlined" />
          <Chip label={`${standaloneVMs.length} ${t('emergencyDR.standalone')}`} size="small" variant="outlined" />
          <Box sx={{ ml: 'auto' }}>
            <Chip
              label={`${t('emergencyDR.replicationHealth')}: ${healthyJobs}/${totalJobs}`}
              size="small"
              color={healthyJobs === totalJobs ? 'success' : healthyJobs > 0 ? 'warning' : 'error'}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Plan groups */}
      {Object.entries(planGroups).map(([planId, { plan, vms }]) => (
        <Card key={planId} variant="outlined">
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <i className="ri-file-shield-2-line" style={{ fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600}>{plan.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {connMap[plan.source_cluster] || plan.source_cluster} → {connMap[plan.target_cluster] || plan.target_cluster}
                </Typography>
                <Chip size="small" label={planStatusLabel(plan.status)} color={
                  plan.status === 'ready' ? 'success' :
                  plan.status === 'failed_over' ? 'error' :
                  plan.status === 'executing' ? 'info' : 'warning'
                } />
                <Chip size="small" label={`${vms.length} VMs`} variant="outlined" />
              </Box>
            }
            action={
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  startIcon={<i className="ri-alarm-warning-line" />}
                  onClick={() => onExecuteFailover(planId)}
                  disabled={plan.status === 'executing' || plan.status === 'failed_over' || plan.status === 'failing_back'}
                >
                  {t('emergencyDR.emergencyFailover')}
                </Button>
                <Tooltip
                  title={t('emergencyDR.planFailbackDisabled')}
                  disableHoverListener={plan.status === 'failed_over' || plan.status === 'failing_back'}
                  arrow
                >
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<i className="ri-arrow-go-back-line" />}
                      onClick={() => onExecuteFailback(planId)}
                      disabled={plan.status !== 'failed_over' && plan.status !== 'failing_back'}
                    >
                      {plan.status === 'failing_back' ? t('emergencyDR.openPlanFailback') : t('emergencyDR.planFailback')}
                    </Button>
                  </span>
                </Tooltip>
                {onDeletePlan && (
                  <IconButton
                    size="small"
                    onClick={() => setDeletePlanId(planId)}
                    sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}
                  >
                    <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
                  </IconButton>
                )}
              </Box>
            }
            sx={{ pb: 0 }}
          />
          <CardContent sx={{ pt: 1 }}>
            {renderVMTable(vms, true)}
          </CardContent>
        </Card>
      ))}

      {/* Standalone VMs */}
      {standaloneVMs.length > 0 && (
        <Card variant="outlined">
          <CardHeader
            title={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <i className="ri-server-line" style={{ fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600}>{t('emergencyDR.standaloneTitle')}</Typography>
                <Chip size="small" label={`${standaloneVMs.length} VMs`} variant="outlined" />
              </Box>
            }
            sx={{ pb: 0 }}
          />
          <CardContent sx={{ pt: 1 }}>
            {renderVMTable(standaloneVMs, false)}
          </CardContent>
        </Card>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Start DR VM Dialog: restore point choice and what the start costs */}
      <Dialog open={!!startTarget} onClose={() => setStartTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-play-circle-line" style={{ fontSize: 20 }} />
          {t('emergencyDR.startVMTitle', { name: startTarget?.vmName || '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('emergencyDR.startVMBody', { vmid: startTarget?.targetVmId || 0 })}
          </Typography>

          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={500}>{t('failover.restorePoint')}</Typography>
            {restorePoints.loading ? <CircularProgress size={18} /> : (
              (restorePoints.data?.restore_points?.length || 0) === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {restorePoints.failed || restorePoints.data?.error
                    ? t('failover.restorePointsLoadFailed')
                    : t('failover.restorePointsNone')}
                </Typography>
              ) : (
                <Select
                  size="small"
                  displayEmpty
                  value={restorePoint}
                  onChange={e => setRestorePoint(e.target.value)}
                  sx={{ minWidth: 240, fontSize: '0.8rem' }}
                >
                  <MenuItem value="">{t('failover.restorePointLatest')}</MenuItem>
                  {(restorePoints.data?.restore_points || []).map(rp => (
                    <MenuItem key={rp.snapshot} value={rp.snapshot}>
                      <i className="ri-camera-line" style={{ fontSize: 13, marginRight: 6, opacity: 0.7 }} />
                      {rp.created_iso ? new Date(rp.created_iso).toLocaleString() : rp.snapshot}
                    </MenuItem>
                  ))}
                </Select>
              )
            )}
          </Box>

          <Alert severity="info" sx={{ mt: 2 }}>
            {t('emergencyDR.startPausesJob', { count: startTarget ? jobSiblingCount(startTarget) : 0 })}
          </Alert>
          {!!restorePoint && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {t('emergencyDR.restorePointKeepsNewer')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStartTarget(null)}>{tc('cancel')}</Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => {
              const vm = startTarget
              const snapshot = restorePoint

              setStartTarget(null)
              if (vm) handleStartVM(vm, snapshot)
            }}
          >
            {t('emergencyDR.startVM')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stop DR VM Confirmation Dialog */}
      <Dialog open={!!stopTarget} onClose={() => setStopTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-stop-circle-line" style={{ fontSize: 20 }} />
          {t('emergencyDR.stopVMTitle', { name: stopTarget?.vmName || '' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('emergencyDR.stopVMBody', { vmid: stopTarget?.targetVmId || 0 })}
          </Typography>
          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={<Switch checked={resumeReplication} onChange={e => setResumeReplication(e.target.checked)} />}
            label={t('emergencyDR.resumeReplication')}
          />
          {resumeReplication && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {t('emergencyDR.resumeReplicationWarning')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStopTarget(null)}>{tc('cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              const vm = stopTarget
              const resume = resumeReplication

              setStopTarget(null)
              if (vm) handleStopVM(vm, resume)
            }}
          >
            {t('emergencyDR.stopVM')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Plan Confirmation Dialog */}
      <Dialog open={!!deletePlanId} onClose={() => setDeletePlanId(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
          {t('plans.deletePlan')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('plans.deletePlanConfirm')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletePlanId(null)}>{tc('cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (deletePlanId && onDeletePlan) {
                onDeletePlan(deletePlanId)
              }
              setDeletePlanId(null)
            }}
          >
            {tc('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
