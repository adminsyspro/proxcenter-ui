'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert, Box, Button, Chip, CircularProgress, Tab, Tabs
} from '@mui/material'

import { Typography } from '@mui/material'

import ReplicationStorageDiscovery, { type StorageDiscoveryState } from '@/components/automation/site-recovery/ReplicationStorageDiscovery'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import ProviderTenantGuard from '@/components/guards/ProviderTenantGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'
import { usePageTitle } from '@/contexts/PageTitleContext'

import {
  useReplicationHealth,
  useReplicationJobs,
  useRecoveryPlans,
  useReplicationJobLogs,
  useRecoveryHistory
} from '@/hooks/useSiteRecovery'

import {
  DashboardTab,
  ProtectionTab,
  SnapshotsTab,
  RecoveryPlansTab,
  EmergencyDRTab,
  SimulationTab,
  CreateJobDialog,
  CreatePlanDialog,
  EditJobDialog,
  FailoverDialog
} from '@/components/automation/site-recovery'

import type {
  RecoveryPlan, RecoveryExecution, StorageEngine, UpdateReplicationJobRequest, TestFailoverOptions
} from '@/lib/orchestrator/site-recovery.types'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export default function SiteRecoveryPage() {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const { setPageInfo } = usePageTitle()

  // The default tab is chosen after discovery and the existing inventory settle.
  const [tab, setTab] = useState(0)
  const [tabInitialized, setTabInitialized] = useState(false)

  // Dialog states
  const [createJobOpen, setCreateJobOpen] = useState(false)
  const [createPlanOpen, setCreatePlanOpen] = useState(false)
  const [editJobId, setEditJobId] = useState<string | null>(null)
  const [failoverDialog, setFailoverDialog] = useState<{
    open: boolean
    planId: string | null
    type: 'test' | 'failover' | 'failback'
  }>({ open: false, planId: null, type: 'test' })

  // Selection states
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)

  // Execution tracking
  const [activeExecution, setActiveExecution] = useState<RecoveryExecution | null>(null)
  const [failoverError, setFailoverError] = useState<string | null>(null)
  const [failoverErrorStatus, setFailoverErrorStatus] = useState<number | null>(null)
  const [operationError, setOperationError] = useState<string | null>(null)

  // Cleanup state
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<any>(null)

  // SWR hooks
  const { data: health, isLoading: healthLoading } = useReplicationHealth(isEnterprise)
  const { data: jobs, isLoading: jobsLoading, mutate: mutateJobs } = useReplicationJobs(isEnterprise)
  const { data: plans, isLoading: plansLoading, mutate: mutatePlans } = useRecoveryPlans(isEnterprise)
  const { data: jobLogs, isLoading: logsLoading } = useReplicationJobLogs(selectedJobId, !!selectedJobId)
  const { data: planHistory, isLoading: historyLoading, mutate: mutateHistory } = useRecoveryHistory(selectedPlanId)

  // Real data: PVE connections and all VMs
  const { data: connectionsData, error: connectionsError, isLoading: connectionsLoading } = useSWR<{ data: Array<{ id: string; name: string; hasCeph: boolean }> }>('/api/v1/connections?type=pve', fetcher)
  const { data: allVMsData } = useSWR<{ data: { vms: any[] } }>('/api/v1/vms', fetcher)

  // Restore points for the plan currently open in the failover dialog (test/failover only — failback has no selector)
  const { data: restorePoints, error: restorePointsError, isLoading: restorePointsLoading, mutate: mutateRestorePoints } = useSWR(
    failoverDialog.open && failoverDialog.planId && failoverDialog.type !== 'failback'
      ? `/api/v1/orchestrator/replication/plans/${failoverDialog.planId}/restore-points`
      : null,
    (url: string) => fetch(url).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
  )

  // Drop the cached list on every dialog open: RBD snapshots move with each
  // sync, and a reopened dialog must never offer points from a previous look.
  useEffect(() => {
    if (failoverDialog.open && failoverDialog.planId && failoverDialog.type !== 'failback') {
      mutateRestorePoints(undefined, { revalidate: true })
    }
  }, [failoverDialog.open, failoverDialog.planId, failoverDialog.type, mutateRestorePoints])

  // Page title
  useEffect(() => {
    setPageInfo(t('siteRecovery.title'), t('siteRecovery.subtitle'), 'ri-shield-star-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Error count for badge
  const errorCount = useMemo(() =>
    (jobs || []).filter((j: any) => j.status === 'error').length
  , [jobs])

  const [discovery, setDiscovery] = useState<Record<string, StorageDiscoveryState>>({})
  const updateDiscovery = useCallback((id: string, state: StorageDiscoveryState) => {
    setDiscovery(previous => ({ ...previous, [id]: state }))
  }, [])
  const connections = useMemo(() => (connectionsData?.data || []).map(connection => ({
    ...connection,
    engines: discovery[connection.id]?.error ? [] : discovery[connection.id]?.data?.engines || [],
  })), [connectionsData, discovery])
  const engines: StorageEngine[] = health?.engines ?? (health ? ['rbd'] : [])
  const discoveryLoading = connectionsLoading || connections.some(connection => !discovery[connection.id] || discovery[connection.id].loading)
  const discoveryError = !!connectionsError || connections.some(connection => discovery[connection.id]?.error)
  const canCreateProtection = engines.some(engine => connections.filter(connection => connection.engines.includes(engine)).length >= 2)
  const canOperate = !!jobs?.length || !!plans?.length
  const canAccessRecovery = canCreateProtection || canOperate

  useEffect(() => {
    if (!discoveryLoading && !jobsLoading && !plansLoading && !healthLoading && !tabInitialized) {
      if (!canAccessRecovery) setTab(5)
      setTabInitialized(true)
    }
  }, [discoveryLoading, jobsLoading, plansLoading, healthLoading, canAccessRecovery, tabInitialized])

  // All VMs for create job dialog
  const allVMs = useMemo(() =>
    (allVMsData?.data?.vms || []).map((vm: any) => ({
      vmid: Number.parseInt(vm.vmid, 10) || 0,
      name: vm.name,
      node: vm.node || vm.host,
      connId: vm.connId,
      type: vm.type,
      status: vm.status,
      diskGb: vm.diskGb || 0,
      tags: (Array.isArray(vm.tags) ? vm.tags : vm.tags ? String(vm.tags).split(';') : [])
        .map((t: string) => t.trim()).filter(Boolean)
    }))
  , [allVMsData])

  // VM names scoped per connection (connId → vmid → name): the same VMID can
  // exist on both sites, so a flat map resolves nondeterministically.
  const vmNamesByConn = useMemo(() => {
    const m: Record<string, Record<number, string>> = {}
    for (const vm of allVMs) {
      if (!vm.vmid || !vm.name || !vm.connId) continue
      ;(m[vm.connId] ??= {})[vm.vmid] = vm.name
    }
    return m
  }, [allVMs])

  // Selected plan for failover dialog
  const failoverPlan = useMemo(() =>
    (plans || []).find((p: RecoveryPlan) => p.id === failoverDialog.planId) || null
  , [plans, failoverDialog.planId])

  // Selected job for edit dialog
  const editJob = editJobId ? (jobs || []).find((j: any) => j.id === editJobId) ?? null : null

  // ── Handlers ──────────────────────────────────────────────────────

  const handleCreateJob = useCallback(async (data: any) => {
    try {
      await fetch('/api/v1/orchestrator/replication/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      mutateJobs()
    } catch (e) {
      console.error('Failed to create job:', e)
    }
  }, [mutateJobs])

  const handleUpdateJob = async (id: string, req: UpdateReplicationJobRequest) => {
    const res = await fetch(`/api/v1/orchestrator/replication/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }))
      const err = new Error(errBody.error || res.statusText) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    mutateJobs()
  }

  const handleCreatePlan = useCallback(async (data: any) => {
    try {
      await fetch('/api/v1/orchestrator/replication/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      mutatePlans()
    } catch (e) {
      console.error('Failed to create plan:', e)
    }
  }, [mutatePlans])

  const handleJobAction = useCallback(async (id: string, action: 'sync' | 'resume') => {
    try {
      const response = await fetch(`/api/v1/orchestrator/replication/jobs/${id}/${action}`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setOperationError(response.status === 409 ? t('siteRecovery.failover.testActiveConflict') : data.error || response.statusText)
        return
      }
      setOperationError(null)
      mutateJobs()
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error))
    }
  }, [mutateJobs, t])

  const handleSyncJob = useCallback((id: string) => handleJobAction(id, 'sync'), [handleJobAction])

  const handlePauseJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/orchestrator/replication/jobs/${id}/pause`, { method: 'POST' })
      mutateJobs()
    } catch (e) {
      console.error('Failed to pause job:', e)
    }
  }, [mutateJobs])

  const handleResumeJob = useCallback((id: string) => handleJobAction(id, 'resume'), [handleJobAction])

  const handleDeleteJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/orchestrator/replication/jobs/${id}`, { method: 'DELETE' })
      mutateJobs()
    } catch (e) {
      console.error('Failed to delete job:', e)
    }
  }, [mutateJobs])

  const handleDeletePlan = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/orchestrator/replication/plans/${id}`, { method: 'DELETE' })
      mutatePlans()
    } catch (e) {
      console.error('Failed to delete plan:', e)
    }
  }, [mutatePlans])

  const openFailoverDialog = useCallback((planId: string, type: 'test' | 'failover' | 'failback') => {
    setFailoverDialog({ open: true, planId, type })
    setActiveExecution(null)
    setCleanupResult(null)
    setCleanupLoading(false)
    setFailoverError(null)
    setFailoverErrorStatus(null)

    // Rehydration: a test failover started before a reload has no in-memory
    // `activeExecution` — refetch it from its id on the plan so the dialog
    // can land directly on the Cleanup block instead of showing "confirm".
    if (type === 'test') {
      const plan = (plans || []).find((p: RecoveryPlan) => p.id === planId)
      if (plan?.active_test_execution_id) {
        fetch(`/api/v1/orchestrator/replication/executions/${plan.active_test_execution_id}`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => { if (data) setActiveExecution(data) })
          .catch(() => { /* ignore — dialog shows the warning banner instead */ })
      }
    }

    // Same rehydration for a failback in progress: a failing_back plan
    // carries the running execution's id so reopening the dialog (or
    // reloading the page) lands back on the reverse-sync/cutover view
    // instead of the initial confirm screen.
    if (type === 'failback') {
      const plan = (plans || []).find((p: RecoveryPlan) => p.id === planId)
      if (plan?.active_failback_execution_id) {
        fetch(`/api/v1/orchestrator/replication/executions/${plan.active_failback_execution_id}`)
          .then(res => (res.ok ? res.json() : null))
          .then(data => { if (data) setActiveExecution(data) })
          .catch(() => { /* ignore — dialog shows the initial confirm screen instead */ })
      }
    }
  }, [plans])

  const handleFailoverConfirm = useCallback(async (options?: TestFailoverOptions) => {
    if (!failoverDialog.planId) return
    const endpoint = failoverDialog.type === 'test' ? 'test-failover' : failoverDialog.type

    const body = failoverDialog.type === 'test'
      ? JSON.stringify({
        network_isolated: options?.networkIsolated ?? true,
        ...(options?.screenshotDelaySeconds != null ? { screenshot_delay_seconds: options.screenshotDelaySeconds } : {}),
        ...(options?.restorePoints ? { restore_points: options.restorePoints } : {})
      })
      : failoverDialog.type === 'failover'
        ? (options?.restorePoints ? JSON.stringify({ restore_points: options.restorePoints }) : undefined)
        : undefined

    try {
      const res = await fetch(`/api/v1/orchestrator/replication/plans/${failoverDialog.planId}/${endpoint}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailoverErrorStatus(res.status)
        setFailoverError(data?.error || t('siteRecovery.failover.testConflict'))
        mutatePlans()
        return
      }
      setFailoverError(null)
      setFailoverErrorStatus(null)
      setActiveExecution(data)
      mutatePlans()
    } catch (e) {
      console.error('Failed to execute:', e)
    }
  }, [failoverDialog, mutatePlans, t])

  const handleCleanupTest = useCallback(async () => {
    if (!failoverDialog.planId) return
    setCleanupLoading(true)
    try {
      const res = await fetch(`/api/v1/orchestrator/replication/plans/${failoverDialog.planId}/cleanup-test`, { method: 'POST' })
      const data = await res.json()
      setCleanupResult(data)
      mutateJobs()
      mutatePlans()
    } catch (e) {
      console.error('Failed to cleanup test:', e)
    } finally {
      setCleanupLoading(false)
    }
  }, [failoverDialog.planId, mutateJobs, mutatePlans])

  const handleFailbackCutover = useCallback(async (planId: string) => {
    try {
      const res = await fetch(`/api/v1/orchestrator/replication/plans/${planId}/failback-cutover`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailoverError(data?.error || 'Failed to execute failback cutover')
        mutatePlans()
        return
      }
      setFailoverError(null)
      // Refetch the execution so the dialog picks up the 'cutover' phase
      // right away instead of waiting for the next poll tick.
      if (activeExecution) {
        const execRes = await fetch(`/api/v1/orchestrator/replication/executions/${activeExecution.id}`)
        const execData = await execRes.json().catch(() => null)
        if (execData) setActiveExecution(execData)
      }
      mutatePlans()
    } catch (e) {
      console.error('Failed to execute failback cutover:', e)
    }
  }, [activeExecution, mutatePlans])

  const handleFailbackCancel = useCallback(async (planId: string) => {
    try {
      const res = await fetch(`/api/v1/orchestrator/replication/plans/${planId}/failback-cancel`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFailoverError(data?.error || 'Failed to cancel failback')
        mutatePlans()
        return
      }
      setFailoverError(null)
      setActiveExecution(null)
      setFailoverDialog({ open: false, planId: null, type: 'test' })
      mutatePlans()
    } catch (e) {
      console.error('Failed to cancel failback:', e)
    }
  }, [mutatePlans])

  const handleStartDRVM = useCallback(async (vmId: number, targetCluster: string, jobId: string) => {
    const res = await fetch('/api/v1/orchestrator/replication/emergency/start-vm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_id: vmId, target_cluster: targetCluster, replication_job_id: jobId })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(res.status === 409 ? t('siteRecovery.failover.testActiveConflict') : data.error || 'Failed to start VM')
    }
    mutateJobs()
  }, [mutateJobs, t])

  // Poll execution status every 3s while running
  useEffect(() => {
    if (!activeExecution || activeExecution.status !== 'running') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/orchestrator/replication/executions/${activeExecution.id}`)
        const data = await res.json()
        setActiveExecution(data)
        if (data.status !== 'running') {
          clearInterval(interval)
          mutatePlans()
        }
      } catch (e) {
        console.error('Failed to poll execution:', e)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [activeExecution?.id, activeExecution?.status, mutatePlans])

  return (
    <ProviderTenantGuard>
    <EnterpriseGuard requiredFeature={Features.CEPH_REPLICATION} featureName="Site Recovery">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {(connectionsData?.data || []).map(connection => (
          <ReplicationStorageDiscovery key={connection.id} connectionId={connection.id} onChange={updateDiscovery} />
        ))}
        {discoveryLoading && <Alert severity='info' icon={<CircularProgress size={18} />}>{t('siteRecovery.discoveryLoading')}</Alert>}
        {operationError && <Alert severity='error' onClose={() => setOperationError(null)}>{operationError}</Alert>}
        {discoveryError && <Alert severity='warning'>{t('siteRecovery.discoveryError')}</Alert>}
        {!discoveryLoading && !discoveryError && !canCreateProtection && (
          <Alert severity='info'>
            <Typography variant='subtitle2'>{t(connections.some(connection => connection.engines.length) ? 'siteRecovery.oneCeph' : 'siteRecovery.noCeph')}</Typography>
            {t(connections.some(connection => connection.engines.length) ? 'siteRecovery.oneCephDesc' : 'siteRecovery.noCephDesc')}
          </Alert>
        )}
        {/* Tabs + Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tab}
            onChange={(_, v) => {
              // Recovery remains usable during a site outage.
              if (!canAccessRecovery && v !== 5) return
              setTab(v)
            }}
            sx={{ flex: 1 }}
          >
          <Tab
            icon={<i className='ri-dashboard-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.dashboard')}
            disabled={!canAccessRecovery}
          />
          <Tab
            icon={<i className='ri-refresh-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            disabled={!canAccessRecovery}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {t('siteRecovery.tabs.replication')}
                {errorCount > 0 && (
                  <Chip size='small' label={errorCount} color='error' sx={{ height: 18, fontSize: '0.65rem' }} />
                )}
              </Box>
            }
          />
          <Tab
            icon={<i className='ri-camera-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.snapshots')}
            disabled={!canAccessRecovery}
          />
          <Tab
            icon={<i className='ri-file-shield-2-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.recoveryPlans')}
            disabled={!canAccessRecovery}
          />
          <Tab
            icon={<i className='ri-alarm-warning-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.emergencyDR')}
            disabled={!canAccessRecovery}
          />
          <Tab
            icon={<i className='ri-test-tube-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.simulation')}
          />
        </Tabs>
          {canAccessRecovery && (
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto', pl: 2 }}>
            <Button
              variant='outlined'
              size='small'
              startIcon={<i className='ri-add-line' />}
              onClick={() => setCreatePlanOpen(true)}
              disabled={!jobs?.length}
            >
              {t('siteRecovery.createPlan.title')}
            </Button>
            <Button
              variant='contained'
              size='small'
              startIcon={<i className='ri-add-line' />}
              onClick={() => setCreateJobOpen(true)}
              disabled={!canCreateProtection}
            >
              {t('siteRecovery.createJob.title')}
            </Button>
          </Box>
          )}
        </Box>

        {/* Tab Content */}
        {tab === 0 && canAccessRecovery && (
          <DashboardTab health={health} loading={healthLoading} jobs={jobs || []} connections={connections} vmNamesByConn={vmNamesByConn} onSyncJob={handleSyncJob} />
        )}

        {tab === 1 && canAccessRecovery && (
          <ProtectionTab
            jobs={jobs || []}
            loading={jobsLoading}
            logs={jobLogs || []}
            logsLoading={logsLoading}
            connections={connections}
            vmNamesByConn={vmNamesByConn}
            onSyncJob={handleSyncJob}
            onPauseJob={handlePauseJob}
            onResumeJob={handleResumeJob}
            onDeleteJob={handleDeleteJob}
            onEditJob={setEditJobId}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
          />
        )}

        {tab === 2 && canAccessRecovery && (
          <SnapshotsTab connections={connections} vmNamesByConn={vmNamesByConn} />
        )}

        {tab === 3 && canAccessRecovery && (
          <RecoveryPlansTab
            plans={plans || []}
            loading={plansLoading}
            history={planHistory || []}
            historyLoading={historyLoading}
            selectedPlanId={selectedPlanId}
            onSelectPlan={setSelectedPlanId}
            onTestFailover={(id) => openFailoverDialog(id, 'test')}
            onFailover={(id) => openFailoverDialog(id, 'failover')}
            onFailback={(id) => openFailoverDialog(id, 'failback')}
            onDeletePlan={handleDeletePlan}
            onCleanupTest={(id) => openFailoverDialog(id, 'test')}
            onHistoryCleared={() => mutateHistory()}
            connections={connections}
          />
        )}

        {tab === 4 && canAccessRecovery && (
          <EmergencyDRTab
            jobs={jobs || []}
            plans={plans || []}
            loading={jobsLoading || plansLoading}
            connections={connections}
            vmNamesByConn={vmNamesByConn}
            onStartVM={handleStartDRVM}
            onExecuteFailover={(planId) => openFailoverDialog(planId, 'failover')}
            onExecuteFailback={(planId) => openFailoverDialog(planId, 'failback')}
            onDeletePlan={handleDeletePlan}
          />
        )}

        {tab === 5 && (
          <SimulationTab connections={connections} isEnterprise={isEnterprise} />
        )}

        {/* Dialogs */}
        <CreateJobDialog
          open={createJobOpen}
          onClose={() => setCreateJobOpen(false)}
          onSubmit={handleCreateJob}
          connections={connections}
          allVMs={allVMs}
          engines={engines}
        />

        <EditJobDialog
          open={editJobId !== null}
          job={editJob}
          onClose={() => setEditJobId(null)}
          onSubmit={handleUpdateJob}
          connections={connections}
        />

        <CreatePlanDialog
          open={createPlanOpen}
          onClose={() => setCreatePlanOpen(false)}
          onSubmit={handleCreatePlan}
          connections={connections}
          jobs={jobs || []}
        />

        <FailoverDialog
          open={failoverDialog.open}
          onClose={() => setFailoverDialog({ open: false, planId: null, type: 'test' })}
          plan={failoverPlan}
          type={failoverDialog.type}
          onConfirm={handleFailoverConfirm}
          onCleanup={handleCleanupTest}
          cleanupLoading={cleanupLoading}
          cleanupResult={cleanupResult}
          execution={activeExecution}
          errorMessage={failoverError}
          errorStatus={failoverErrorStatus}
          targetConnId={failoverPlan?.target_cluster}
          connections={connections}
          vmNameMap={failoverPlan ? vmNamesByConn[failoverPlan.source_cluster] : undefined}
          restorePoints={restorePoints}
          restorePointsLoading={restorePointsLoading}
          restorePointsError={!!restorePointsError}
          onFailbackCutover={handleFailbackCutover}
          onFailbackCancel={handleFailbackCancel}
        />
      </Box>
    </EnterpriseGuard>
    </ProviderTenantGuard>
  )
}
