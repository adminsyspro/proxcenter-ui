'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Box, Button, Chip, Tab, Tabs
} from '@mui/material'

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

  // All VMs for create job dialog
  const allVMs = useMemo(() =>
    (allVMsData?.data?.vms || []).map((vm: any) => ({
      vmid: parseInt(vm.vmid, 10) || 0,
      name: vm.name,
      node: vm.node || vm.host,
      connId: vm.connId,
      type: vm.type,
      status: vm.status
    }))
  , [allVMsData])

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
  }, [])

  const handleFailoverConfirm = useCallback(async () => {
    if (!failoverDialog.planId) return
    const endpoint = failoverDialog.type === 'test' ? 'test-failover' : failoverDialog.type

    try {
      const res = await fetch(`/api/v1/orchestrator/replication/plans/${failoverDialog.planId}/${endpoint}`, { method: 'POST' })
      const data = await res.json()

      setActiveExecution(data)
      mutatePlans()
    } catch (e) {
      console.error('Failed to execute:', e)
    }
  }, [failoverDialog, mutatePlans])

  return (
    <EnterpriseGuard requiredFeature={Features.CEPH_REPLICATION} featureName="Site Recovery">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Header actions */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
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

        {/* Tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            icon={<i className='ri-dashboard-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={t('siteRecovery.tabs.dashboard')}
          />
          <Tab
            icon={<i className='ri-shield-line' style={{ fontSize: 18 }} />}
            iconPosition='start'
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {t('siteRecovery.tabs.protection')}
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
        </Tabs>

        {/* Tab Content */}
        {tab === 0 && (
          <DashboardTab health={health} loading={healthLoading} />
        )}

        {tab === 1 && (
          <ProtectionTab
            jobs={jobs || []}
            loading={jobsLoading}
            logs={jobLogs || []}
            logsLoading={logsLoading}
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
          />
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
          execution={activeExecution}
        />
      </Box>
    </EnterpriseGuard>
  )
}
