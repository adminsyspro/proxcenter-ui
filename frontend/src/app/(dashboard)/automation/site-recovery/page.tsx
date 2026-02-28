'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Box, Button, Chip, Tab, Tabs
} from '@mui/material'

import { Typography } from '@mui/material'

import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
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
  RecoveryPlansTab,
  EmergencyDRTab,
  SimulationTab,
  CreateJobDialog,
  CreatePlanDialog,
  FailoverDialog
} from '@/components/automation/site-recovery'

import type { RecoveryPlan, RecoveryExecution } from '@/lib/orchestrator/site-recovery.types'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export default function SiteRecoveryPage() {
  const t = useTranslations()
  const { isEnterprise } = useLicense()
  const { setPageInfo } = usePageTitle()

  // Tab state
  const [tab, setTab] = useState(0)

  // Dialog states
  const [createJobOpen, setCreateJobOpen] = useState(false)
  const [createPlanOpen, setCreatePlanOpen] = useState(false)
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

  // Cleanup state
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<any>(null)

  // SWR hooks
  const { data: health, isLoading: healthLoading } = useReplicationHealth(isEnterprise)
  const { data: jobs, isLoading: jobsLoading, mutate: mutateJobs } = useReplicationJobs(isEnterprise)
  const { data: plans, isLoading: plansLoading, mutate: mutatePlans } = useRecoveryPlans(isEnterprise)
  const { data: jobLogs, isLoading: logsLoading } = useReplicationJobLogs(selectedJobId, !!selectedJobId)
  const { data: planHistory, isLoading: historyLoading } = useRecoveryHistory(selectedPlanId)

  // Real data: PVE connections and all VMs
  const { data: connectionsData } = useSWR<{ data: any[] }>('/api/v1/connections?type=pve', fetcher)
  const { data: allVMsData } = useSWR<{ data: { vms: any[] } }>('/api/v1/vms', fetcher)

  // Page title
  useEffect(() => {
    setPageInfo(t('siteRecovery.title'), t('siteRecovery.subtitle'), 'ri-shield-star-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // Error count for badge
  const errorCount = useMemo(() =>
    (jobs || []).filter((j: any) => j.status === 'error').length
  , [jobs])

  // PVE connections for dialogs
  const connections = useMemo(() =>
    (connectionsData?.data || []).map((c: any) => ({ id: c.id, name: c.name, hasCeph: c.hasCeph }))
  , [connectionsData])

  const cephClusterCount = connections.filter(c => c.hasCeph).length
  const hasEnoughCephClusters = cephClusterCount >= 2
  const connectionsLoaded = !!connectionsData

  // All VMs for create job dialog
  const allVMs = useMemo(() =>
    (allVMsData?.data?.vms || []).map((vm: any) => ({
      vmid: parseInt(vm.vmid, 10) || 0,
      name: vm.name,
      node: vm.node || vm.host,
      connId: vm.connId,
      type: vm.type,
      status: vm.status,
      tags: Array.isArray(vm.tags) ? vm.tags : vm.tags ? String(vm.tags).split(';').filter(Boolean) : []
    }))
  , [allVMsData])

  // VM name map for display (vmid → name)
  const vmNameMap = useMemo(() => {
    const m: Record<number, string> = {}
    for (const vm of allVMs) if (vm.vmid && vm.name) m[vm.vmid] = vm.name
    return m
  }, [allVMs])

  // Selected plan for failover dialog
  const failoverPlan = useMemo(() =>
    (plans || []).find((p: RecoveryPlan) => p.id === failoverDialog.planId) || null
  , [plans, failoverDialog.planId])

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

  const handleSyncJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/orchestrator/replication/jobs/${id}/sync`, { method: 'POST' })
      mutateJobs()
    } catch (e) {
      console.error('Failed to sync job:', e)
    }
  }, [mutateJobs])

  const handlePauseJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/orchestrator/replication/jobs/${id}/pause`, { method: 'POST' })
      mutateJobs()
    } catch (e) {
      console.error('Failed to pause job:', e)
    }
  }, [mutateJobs])

  const handleResumeJob = useCallback(async (id: string) => {
    try {
      await fetch(`/api/v1/orchestrator/replication/jobs/${id}/resume`, { method: 'POST' })
      mutateJobs()
    } catch (e) {
      console.error('Failed to resume job:', e)
    }
  }, [mutateJobs])

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
  }, [])

  const handleFailoverConfirm = useCallback(async () => {
    if (!failoverDialog.planId) return
    const endpoint = failoverDialog.type === 'test' ? 'test-failover' : failoverDialog.type

    const body = failoverDialog.type === 'test'
      ? JSON.stringify({ network_isolated: true })
      : undefined

    try {
      const res = await fetch(`/api/v1/orchestrator/replication/plans/${failoverDialog.planId}/${endpoint}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body
      })
      const data = await res.json()

      setActiveExecution(data)
      mutatePlans()
    } catch (e) {
      console.error('Failed to execute:', e)
    }
  }, [failoverDialog, mutatePlans])

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

  const handleStartDRVM = useCallback(async (vmId: number, targetCluster: string, jobId: string) => {
    const res = await fetch('/api/v1/orchestrator/replication/emergency/start-vm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_id: vmId, target_cluster: targetCluster, replication_job_id: jobId })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to start VM')
    }
    mutateJobs()
  }, [mutateJobs])

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
    <EnterpriseGuard requiredFeature={Features.CEPH_REPLICATION} featureName="Site Recovery">
      {connectionsLoaded && !hasEnoughCephClusters ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          {/* Icon cluster */}
          <Box sx={{ position: 'relative', width: 120, height: 120, mb: 3 }}>
            <Box sx={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 80, height: 80, borderRadius: '50%',
              bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ri-database-2-line" style={{ fontSize: 36, opacity: 0.25 }} />
            </Box>
            <Box sx={{
              position: 'absolute', top: 0, right: 6,
              width: 36, height: 36, borderRadius: '50%',
              bgcolor: 'background.paper', border: '2px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ri-shield-star-line" style={{ fontSize: 18, opacity: 0.35 }} />
            </Box>
            <Box sx={{
              position: 'absolute', bottom: 2, left: 4,
              width: 36, height: 36, borderRadius: '50%',
              bgcolor: 'background.paper', border: '2px solid', borderColor: 'divider',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <i className="ri-refresh-line" style={{ fontSize: 18, opacity: 0.35 }} />
            </Box>
          </Box>

          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
            {cephClusterCount === 0 ? t('siteRecovery.noCeph') : t('siteRecovery.oneCeph')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, textAlign: 'center', mb: 3 }}>
            {cephClusterCount === 0 ? t('siteRecovery.noCephDesc') : t('siteRecovery.oneCephDesc')}
          </Typography>

          {/* Feature hints */}
          <Box sx={{ display: 'flex', gap: 3 }}>
            {[
              { icon: 'ri-refresh-line', label: t('siteRecovery.noCephFeatureReplication') },
              { icon: 'ri-file-shield-2-line', label: t('siteRecovery.noCephFeatureRecovery') },
              { icon: 'ri-alarm-warning-line', label: t('siteRecovery.noCephFeatureEmergency') },
            ].map((f) => (
              <Box key={f.icon} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, opacity: 0.5 }}>
                <i className={f.icon} style={{ fontSize: 16 }} />
                <Typography variant="caption">{f.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      ) : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Tabs + Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            sx={{ flex: 1 }}
          >
          <Tab
            icon={<i className='ri-dashboard-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.dashboard')}
          />
          <Tab
            icon={<i className='ri-refresh-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
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
            icon={<i className='ri-file-shield-2-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.recoveryPlans')}
          />
          <Tab
            icon={<i className='ri-alarm-warning-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.emergencyDR')}
          />
          <Tab
            icon={<i className='ri-test-tube-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.simulation')}
          />
        </Tabs>
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto', pl: 2 }}>
            <Button
              variant='outlined'
              size='small'
              startIcon={<i className='ri-add-line' />}
              onClick={() => setCreatePlanOpen(true)}
            >
              {t('siteRecovery.createPlan.title')}
            </Button>
            <Button
              variant='contained'
              size='small'
              startIcon={<i className='ri-add-line' />}
              onClick={() => setCreateJobOpen(true)}
            >
              {t('siteRecovery.createJob.title')}
            </Button>
          </Box>
        </Box>

        {/* Tab Content */}
        {tab === 0 && (
          <DashboardTab health={health} loading={healthLoading} jobs={jobs || []} connections={connections} />
        )}

        {tab === 1 && (
          <ProtectionTab
            jobs={jobs || []}
            loading={jobsLoading}
            logs={jobLogs || []}
            logsLoading={logsLoading}
            connections={connections}
            vmNameMap={vmNameMap}
            onSyncJob={handleSyncJob}
            onPauseJob={handlePauseJob}
            onResumeJob={handleResumeJob}
            onDeleteJob={handleDeleteJob}
            selectedJobId={selectedJobId}
            onSelectJob={setSelectedJobId}
          />
        )}

        {tab === 2 && (
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
            connections={connections}
          />
        )}

        {tab === 3 && (
          <EmergencyDRTab
            jobs={jobs || []}
            plans={plans || []}
            loading={jobsLoading || plansLoading}
            connections={connections}
            vmNameMap={vmNameMap}
            onStartVM={handleStartDRVM}
            onExecuteFailover={(planId) => openFailoverDialog(planId, 'failover')}
            onExecuteFailback={(planId) => openFailoverDialog(planId, 'failback')}
          />
        )}

        {tab === 4 && (
          <SimulationTab connections={connections} isEnterprise={isEnterprise} />
        )}

        {/* Dialogs */}
        <CreateJobDialog
          open={createJobOpen}
          onClose={() => setCreateJobOpen(false)}
          onSubmit={handleCreateJob}
          connections={connections}
          allVMs={allVMs}
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
          targetConnId={failoverPlan?.target_cluster}
          connections={connections}
        />
      </Box>
      )}
    </EnterpriseGuard>
  )
}
