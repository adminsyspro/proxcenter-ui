'use client'

import { useEffect, useMemo, useState } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, CircularProgress, IconButton, Tab, Tabs, Tooltip } from '@mui/material'

import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { useGpuReport } from '@/components/gpu/useGpuReport'
import { Features } from '@/contexts/LicenseContext'
import { usePageTitle } from '@/contexts/PageTitleContext'
import { useRBAC } from '@/contexts/RBACContext'
import { useTenant } from '@/contexts/TenantContext'
import type { GpuReportDevice } from '@/lib/gpu/report'

import { AttachDialog, GpuActionsContext, MoveDialog, ReleaseDialog, type MoveVm, type ReleaseTarget } from './components/GpuActionDialogs'
import GpuMetricsSettingsDialog from './components/GpuMetricsSettingsDialog'
import OverviewTab from './components/OverviewTab'
import ProfilesTab, { ProfilesToggle } from './components/ProfilesTab'
import VgpuTab, { VgpuAttachButton, vgpuCards } from './components/VgpuTab'
import WorkloadsTab, { WorkloadFilters } from './components/WorkloadsTab'
import { NO_FILTER, type GpuFilterState } from './components/GpuFilters'

type TabId = 'overview' | 'vgpu' | 'profiles' | 'workloads'

const TABS: TabId[] = ['overview', 'workloads']

/**
 * GPU page (#672), Enterprise, for the provider and the MSP tenants running
 * their own clusters. A vDC tenant has no GPU page: the menu hides it, the
 * routes answer 404, and this page says so to one who types its address.
 */
export default function GpuPage() {
  const t = useTranslations('gpu.page')
  const { currentTenant, loading } = useTenant()
  const isVdcTenant = !!currentTenant && currentTenant.id !== 'default' && currentTenant.operatingModel !== 'msp'
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={28} />
      </Box>
    )
  }
  if (isVdcTenant) return <Alert severity='info' data-testid='gpu-vdc-unavailable'>{t('vdcUnavailable')}</Alert>
  return <GpuPageContent />
}

function GpuPageContent() {
  const t = useTranslations('gpu.page')
  const tg = useTranslations('gpu')
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setPageInfo } = usePageTitle()
  const { report, loading, error, refresh } = useGpuReport()

  useEffect(() => {
    setPageInfo(t('title'), t('subtitle'), 'ri-cpu-line')

    return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // The load settings are provider-wide, like the routes behind them.
  const { hasPermission } = useRBAC()
  const { currentTenant } = useTenant()
  const canConfigure = currentTenant?.id === 'default' && hasPermission('admin.settings')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  // Attach and release act on Proxmox through mappings, provider tenant only (api/v1/gpu/actions).
  const canAct = currentTenant?.id === 'default' && hasPermission('vm.config.hardware')
  const [attachDevice, setAttachDevice] = useState<GpuReportDevice | null>(null)
  const [releaseTarget, setReleaseTarget] = useState<ReleaseTarget | null>(null)
  // Moving is a migration: vm.migrate, which a vDC tenant never holds (migrate route).
  const canMove = currentTenant?.id === 'default' && hasPermission('vm.migrate')
  const [moveVm, setMoveVm] = useState<MoveVm | null>(null)
  // The Workloads filters sit in the page bar, next to Refresh.
  const [workloadFilter, setWorkloadFilter] = useState<GpuFilterState>(NO_FILTER)
  // The Profiles tab shows the compute profiles (Q, C); this switch adds the B and A ones.
  const [allProfiles, setAllProfiles] = useState(false)
  const actions = useMemo(
    () => ({ canAct, canMove, refresh, attach: setAttachDevice, release: setReleaseTarget, move: setMoveVm }),
    [canAct, canMove, refresh],
  )

  // The vGPU tab shows once a card of the provider's clusters is in vGPU mode.
  const cardsInVgpu = useMemo(() => (report ? vgpuCards(report) : []), [report])
  const hasVgpu = cardsInVgpu.length > 0
  // Without any GPU, the workloads tab would only list zeros: the overview says why.
  const hasGpu = !!report?.devices.some(d => d.kind === 'gpu')
  const providerTabs: TabId[] = hasVgpu ? ['overview', 'vgpu', 'profiles', 'workloads'] : hasGpu ? TABS : ['overview']
  const tabs: TabId[] = providerTabs
  const requested = searchParams.get('tab') as TabId | null
  const tab: TabId = requested && tabs.includes(requested) ? requested : tabs[0]

  return (
    <EnterpriseGuard requiredFeature={Features.GPU_MANAGEMENT} featureName={t('title')}>
      <GpuActionsContext.Provider value={actions}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-testid='gpu-page'>
        {/* Title and subtitle live in the top bar (setPageInfo), like the other Infrastructure pages. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={report ? tab : false} onChange={(_, next: TabId) => router.replace(`?tab=${next}`)} sx={{ flex: 1, minWidth: 0 }}>
            {tabs.map(id => <Tab key={id} value={id} label={t(`tabs.${id}`)} disabled={!report} />)}
          </Tabs>
          {canConfigure && (
            <Tooltip title={t('settings')}>
              <IconButton size='small' aria-label={t('settings')} onClick={() => setSettingsOpen(true)}>
                <i className='ri-settings-3-line' />
              </IconButton>
            </Tooltip>
          )}
          {tab === 'profiles' && <ProfilesToggle value={allProfiles} onChange={setAllProfiles} />}
          {tab === 'workloads' && report && <WorkloadFilters report={report} value={workloadFilter} onChange={setWorkloadFilter} />}
          {tab === 'vgpu' && canAct && hasVgpu && <VgpuAttachButton cards={cardsInVgpu} onPick={setAttachDevice} />}
          <Button
            size='small'
            variant='outlined'
            onClick={refresh}
            disabled={loading}
            startIcon={loading ? <CircularProgress size={14} /> : <i className='ri-refresh-line' />}
          >
            {tg('refresh')}
          </Button>
        </Box>

        {error && <Alert severity='error'>{tg('loadError')}: {error}</Alert>}

        {report ? (
          <>
            {tab === 'overview' && (
              <OverviewTab key={settingsVersion} report={report} onConfigure={canConfigure ? () => setSettingsOpen(true) : undefined} />
            )}
            {tab === 'vgpu' && <VgpuTab report={report} />}
            {tab === 'profiles' && <ProfilesTab report={report} showAll={allProfiles} />}
            {tab === 'workloads' && <WorkloadsTab report={report} filter={workloadFilter} />}
          </>
        ) : (
          !error && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          )
        )}
      </Box>
      {canAct && <AttachDialog device={attachDevice} onClose={() => setAttachDevice(null)} onDone={refresh} />}
      {canAct && <ReleaseDialog target={releaseTarget} onClose={() => setReleaseTarget(null)} onDone={refresh} />}
      {canMove && <MoveDialog vm={moveVm} report={report} onClose={() => setMoveVm(null)} onDone={refresh} />}
      </GpuActionsContext.Provider>
      {canConfigure && (
        <GpuMetricsSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={() => setSettingsVersion(v => v + 1)} />
      )}
    </EnterpriseGuard>
  )
}
