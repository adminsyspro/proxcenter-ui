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
import { useTheme } from '@mui/material/styles'

import type { ReplicationJob, RecoveryPlan, RecoveryPlanGuestState, VMRestorePoints } from '@/lib/orchestrator/site-recovery.types'
import { countGuestsFailedOver, guestStateOf } from '@/lib/site-recovery/emergencyActions'
import { GuestGlyph } from '@/components/automation/drs/glyphs'

/** The title of the first case that holds: the reason a row action reads as it does. */
const firstReason = (...cases: Array<[boolean, string]>) => cases.find(([holds]) => holds)?.[1] ?? ''

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
  // Not a job state: this guest alone is out of its job's runs while its
  // replica is up on the DR site. Showing the job's own "synced" on that line
  // would tell the operator the opposite of what happens to that guest.
  replica_started: { icon: 'ri-skip-forward-line', color: 'warning.main', label: 'status.replicaStarted' },
  failed_over: { icon: 'ri-alarm-warning-line', color: 'error.main', label: 'status.failedOver' },
  // Per-guest DR states (ui#943): the guest's own state wins over its job's.
  failing_over: { icon: 'ri-loader-4-line', color: 'error.main', label: 'status.failingOver' },
  failing_back: { icon: 'ri-arrow-go-back-line', color: 'info.main', label: 'status.failingBack' },
}

// Mirror the Go destinationVMID logic
function destinationVMID(prefix: number, vmid: number): number {
  if (!prefix) return vmid
  const digits = String(vmid).length
  let multiplier = 1
  for (let i = 0; i < digits; i++) multiplier *= 10
  return prefix * multiplier + vmid
}

export interface DRReadyVM {
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
  planStatus?: string
  planActiveTest?: boolean
  tier?: number
  bootOrder?: number
  /** The guest's own DR state inside its plan (ui#943); null while it replicates. */
  guestState?: RecoveryPlanGuestState | null
  /** How many OTHER guests of the plan keep replicating while this one is on the DR site. */
  siblingCount?: number
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
  /** Production failover of ONE guest of its plan (ui#943), distinct from starting its replica. */
  onGuestFailover?: (vm: DRReadyVM) => void
  /** Failback of ONE failed-over guest, or the follow-up of one already failing back. */
  onGuestFailback?: (vm: DRReadyVM) => void
}

export default function EmergencyDRTab({
  jobs, plans, loading, connections, vmNamesByConn, vmStatesByConn, onStartVM, onStopVM, loadRestorePoints,
  onExecuteFailover, onExecuteFailback, onDeletePlan, onGuestFailover, onGuestFailback
}: EmergencyDRTabProps) {
  const t = useTranslations('siteRecovery')
  const theme = useTheme()
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
          jobStatus: (job.suspended_vmids || []).includes(vmId) ? 'replica_started' : job.status,
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
          drvm.planStatus = plan.status
          drvm.planActiveTest = !!plan.active_test_execution_id
          drvm.tier = pvm.tier
          drvm.bootOrder = pvm.boot_order
          drvm.siblingCount = Math.max(0, (plan.vms || []).length - 1)
          // The guest's own DR state replaces its job's status on the row:
          // a job reading "synced" says nothing about a guest whose replica
          // is production on the DR site.
          const guest = guestStateOf(plan, pvm.vm_id)
          drvm.guestState = guest?.state || null
          if (guest) drvm.jobStatus = guest.state
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

  // The orchestrator refuses to start a replica while its job is mid-transfer
  // (the rollback and the boot would race the import-diff writing those same
  // disks). Read it live rather than from the row captured when the dialog
  // opened: the jobs list refreshes underneath, so the operator sees the
  // button unlock on its own when the sync ends.
  const startJobSyncing = !!startTarget && jobs.find(j => j.id === startTarget.jobId)?.status === 'syncing'

  // Only a job the start emptied entirely is paused, so only there does the
  // stop have a job to resume. Everywhere else the guest simply rejoins the
  // next run, and a switch would suggest a choice that does not exist.
  const stopJobPaused = !!stopTarget && jobs.find(j => j.id === stopTarget.jobId)?.status === 'paused'

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
  // A partially failed over plan counts its guests (ui#943).
  const planStatusLabel = (plan: RecoveryPlan) => {
    const status = plan.status as string

    if (status === 'failing_back') return t('plans.statusFailingBack')
    if (status === 'partially_failed_over') {
      return t('emergencyDR.planGuestsOver', { over: countGuestsFailedOver(plan), total: (plan.vms || []).length })
    }

    const key = `planStatus.${status}`
    const label = t.has(key) ? t(key) : status

    return label
  }

  const planStatusColor = (status: string): 'success' | 'error' | 'info' | 'warning' => {
    if (status === 'ready') return 'success'
    if (status === 'failed_over') return 'error'
    if (status === 'executing' || status === 'failing_back') return 'info'

    return 'warning'
  }

  // Which per-guest action the row offers (ui#943). The plan's own
  // execution, a test on the DR site or the plan failed over as a whole
  // lock the failover; the guest's own state decides between the rest.
  const planBusy = (vm: DRReadyVM) =>
    vm.planStatus === 'executing' || vm.planStatus === 'failing_back' || vm.planStatus === 'failed_over' || !!vm.planActiveTest

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
            // Each action follows the replica it acts on: starting a replica
            // that already runs does nothing but pause its job again, and
            // stopping one that is already down is just as empty. An unknown
            // state (the inventory has no row for that replica) leaves both
            // enabled rather than locking the operator out during an incident.
            const state = replicaState(vm)
            const replicaStarted = state === 'running' || state === 'paused'
            const replicaStopped = state === 'stopped'
            // A failed over guest's replica IS production: starting it again
            // would roll it back, stopping it would hand it to the next sync.
            // Both actions step aside for the failback (ui#943).
            const guestLocked = !!vm.guestState
            const startTitle = firstReason(
              [guestLocked, t('emergencyDR.guestActionsLocked')],
              [replicaStarted, t('emergencyDR.startVMAlreadyStarted')],
              [true, t('emergencyDR.startReplica')],
            )
            const stopTitle = firstReason(
              [guestLocked, t('emergencyDR.guestActionsLocked')],
              [replicaStopped, t('emergencyDR.stopVMAlreadyStopped')],
              [true, t('emergencyDR.stopReplica')],
            )
            const failoverTitle = firstReason(
              [vm.guestState === 'failing_over', t('emergencyDR.guestFailingOver')],
              [!!vm.guestState, t('emergencyDR.guestActionsLocked')],
              [planBusy(vm), t('emergencyDR.planBusyForGuest')],
              [true, t('emergencyDR.failoverVM')],
            )
            const failbackTitle = vm.guestState === 'failing_back' ? t('emergencyDR.openGuestFailback') : t('emergencyDR.failbackVM')

            return (
              <TableRow key={key} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {/* The source VM, with its power dot like every guest row of the product. */}
                    <GuestGlyph status={vmStatesByConn[vm.sourceCluster]?.[vm.vmId]} dotBorder={theme.palette.background.paper} />
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
                    <Tooltip title={startTitle}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={!!vmLoading || replicaStarted || guestLocked}
                          onClick={() => openStartDialog(vm)}
                          sx={{ color: 'success.main', '&:hover': { bgcolor: 'success.main', color: 'white' } }}
                        >
                          {vmLoading === 'starting' ? <CircularProgress size={16} /> : <i className="ri-play-circle-line" style={{ fontSize: 18 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={stopTitle}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={!!vmLoading || replicaStopped || guestLocked}
                          onClick={() => openStopDialog(vm)}
                          sx={{ color: 'warning.main', '&:hover': { bgcolor: 'warning.main', color: 'white' } }}
                        >
                          {vmLoading === 'stopping' ? <CircularProgress size={16} /> : <i className="ri-stop-circle-line" style={{ fontSize: 18 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    {/* Production failover and failback of this ONE guest (ui#943):
                        the plan keeps replicating its other guests. Only a guest
                        of a plan carries them, a standalone replica has no plan
                        to hold its state. */}
                    {vm.planId && onGuestFailover && (
                      vm.guestState === 'failed_over' || vm.guestState === 'failing_back' ? (
                        <Tooltip title={failbackTitle}>
                          <span>
                            <IconButton
                              size="small"
                              data-testid={`guest-failback-${vm.vmId}`}
                              disabled={!!vmLoading || !onGuestFailback}
                              onClick={() => onGuestFailback?.(vm)}
                              sx={{ color: 'info.main', '&:hover': { bgcolor: 'info.main', color: 'white' } }}
                            >
                              <i className="ri-arrow-go-back-line" style={{ fontSize: 18 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip title={failoverTitle}>
                          <span>
                            <IconButton
                              size="small"
                              data-testid={`guest-failover-${vm.vmId}`}
                              disabled={!!vmLoading || guestLocked || planBusy(vm)}
                              onClick={() => onGuestFailover(vm)}
                              sx={{ color: 'error.main', '&:hover': { bgcolor: 'error.main', color: 'white' } }}
                            >
                              {vm.guestState === 'failing_over' ? <CircularProgress size={16} color="error" /> : <i className="ri-shield-star-line" style={{ fontSize: 18 }} />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      )
                    )}
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
                <Chip size="small" label={planStatusLabel(plan)} color={planStatusColor(plan.status)} />
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
                  title={plan.status === 'partially_failed_over' ? t('emergencyDR.planFailbackPartial') : t('emergencyDR.planFailbackDisabled')}
                  disableHoverListener={plan.status === 'failed_over' || plan.status === 'failing_back'}
                  arrow
                >
                  <span>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<i className="ri-arrow-go-back-line" />}
                      onClick={() => onExecuteFailback(planId)}
                      disabled={plan.status !== 'failed_over' && plan.status !== 'failing_back' && plan.status !== 'partially_failed_over'}
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

          {startJobSyncing && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t('emergencyDR.startVMJobSyncing')}
            </Alert>
          )}
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
            disabled={startJobSyncing}
            onClick={() => {
              const vm = startTarget
              const snapshot = restorePoint

              setStartTarget(null)
              if (vm) void handleStartVM(vm, snapshot)
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
          {stopJobPaused ? (
            <>
              <FormControlLabel
                sx={{ mt: 1.5 }}
                control={<Switch checked={resumeReplication} onChange={e => setResumeReplication(e.target.checked)} />}
                label={t('emergencyDR.resumeReplication')}
              />
            </>
          ) : (
            <Typography variant="body2" sx={{ mt: 1.5 }} color="text.secondary">
              {t('emergencyDR.stopVMGuestRejoins')}
            </Typography>
          )}
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('emergencyDR.resumeReplicationWarning')}
          </Alert>
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
              if (vm) void handleStopVM(vm, resume)
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
