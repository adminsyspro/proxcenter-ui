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
  Skeleton,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'

import type { ReplicationJob, RecoveryPlan } from '@/lib/orchestrator/site-recovery.types'

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
  vmNameMap: Record<number, string>
  onStartVM: (vmId: number, targetCluster: string, jobId: string) => Promise<void>
  onStopVM: (vmId: number, targetCluster: string, jobId: string, resumeReplication: boolean) => Promise<void>
  onExecuteFailover: (planId: string) => void
}

export default function EmergencyDRTab({
  jobs, plans, loading, connections, vmNameMap, onStartVM, onStopVM, onExecuteFailover
}: EmergencyDRTabProps) {
  const t = useTranslations('siteRecovery')
  const [loadingVMs, setLoadingVMs] = useState<Record<string, 'starting' | 'stopping'>>({})
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
          vmName: vmNameMap[vmId] || `VM ${vmId}`,
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
        const drvm = allDRVMs.find(v => v.vmId === pvm.vm_id)
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
  }, [jobs, plans, vmNameMap])

  const totalDR = planVMs.length + standaloneVMs.length
  const healthyJobs = jobs.filter(j => j.status === 'synced' || j.status === 'syncing').length
  const totalJobs = jobs.length

  const handleStartVM = async (vm: DRReadyVM) => {
    const key = `${vm.vmId}`
    setLoadingVMs(prev => ({ ...prev, [key]: 'starting' }))
    try {
      await onStartVM(vm.vmId, vm.targetCluster, vm.jobId)
      setSnackbar({ open: true, message: t('emergencyDR.vmStarted', { name: vm.vmName, vmid: vm.targetVmId }), severity: 'success' })
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.message || 'Failed to start VM', severity: 'error' })
    } finally {
      setLoadingVMs(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  const handleStopVM = async (vm: DRReadyVM) => {
    const key = `${vm.vmId}`
    setLoadingVMs(prev => ({ ...prev, [key]: 'stopping' }))
    try {
      await onStopVM(vm.vmId, vm.targetCluster, vm.jobId, true)
      setSnackbar({ open: true, message: t('emergencyDR.vmStopped', { name: vm.vmName, vmid: vm.targetVmId }), severity: 'success' })
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.message || 'Failed to stop VM', severity: 'error' })
    } finally {
      setLoadingVMs(prev => { const n = { ...prev }; delete n[key]; return n })
    }
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

  const statusChip = (status: string) => {
    const colorMap: Record<string, 'success' | 'warning' | 'error' | 'default' | 'info'> = {
      synced: 'success', syncing: 'info', paused: 'warning', error: 'error', pending: 'default',
    }
    return <Chip size="small" label={status} color={colorMap[status] || 'default'} sx={{ textTransform: 'capitalize' }} />
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
                  <Typography variant="body2" fontWeight={500}>{vm.vmName}</Typography>
                </TableCell>
                <TableCell><code>{vm.vmId}</code></TableCell>
                <TableCell><code>{vm.targetVmId}</code></TableCell>
                <TableCell>{statusChip(vm.jobStatus)}</TableCell>
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
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          disabled={!!vmLoading}
                          onClick={() => handleStartVM(vm)}
                          sx={{ minWidth: 36, px: 1 }}
                        >
                          {vmLoading === 'starting' ? <CircularProgress size={16} /> : <i className="ri-play-line" />}
                        </Button>
                      </span>
                    </Tooltip>
                    <Tooltip title={t('emergencyDR.stopVM')}>
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          disabled={!!vmLoading}
                          onClick={() => handleStopVM(vm)}
                          sx={{ minWidth: 36, px: 1 }}
                        >
                          {vmLoading === 'stopping' ? <CircularProgress size={16} /> : <i className="ri-stop-line" />}
                        </Button>
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
                <Chip size="small" label={plan.status} color={
                  plan.status === 'ready' ? 'success' :
                  plan.status === 'failed_over' ? 'error' :
                  plan.status === 'executing' ? 'info' : 'warning'
                } sx={{ textTransform: 'capitalize' }} />
                <Chip size="small" label={`${vms.length} VMs`} variant="outlined" />
              </Box>
            }
            action={
              <Button
                variant="contained"
                color="error"
                size="small"
                startIcon={<i className="ri-alarm-warning-line" />}
                onClick={() => onExecuteFailover(planId)}
                disabled={plan.status === 'executing' || plan.status === 'failed_over'}
              >
                {t('emergencyDR.emergencyFailover')}
              </Button>
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
    </Box>
  )
}
