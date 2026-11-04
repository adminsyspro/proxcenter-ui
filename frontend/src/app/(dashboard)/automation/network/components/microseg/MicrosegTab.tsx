'use client'

import { useCallback, useState } from 'react'
import NextLink from 'next/link'
import { Alert, Box, CircularProgress, IconButton, Link, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'

import { microsegBaseUrl } from '@/lib/microseg/api'
import { isRunAffectedKey } from '@/lib/microseg/runRefresh'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'

import DeploymentWizard from '../DeploymentWizard'
import CheckNowButton from './CheckNowButton'
import DriftsPanel from './DriftsPanel'
import FirstRunGuide from './FirstRunGuide'
import HistoryPanel from './HistoryPanel'
import MicrosegBanner from './MicrosegBanner'
import EmergencyStopButton from './EmergencyStopButton'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import ObservationPanel from './ObservationPanel'
import PlanDialog from './PlanDialog'
import PolicyPanel from './PolicyPanel'
import PreflightPanel from './PreflightPanel'
import RunStrip from './RunStrip'
import SettingsDialog from './SettingsDialog'
import { useMicrosegControls } from './useMicrosegControls'
import { CHECK_STATUS_POLL_MS } from './useMicrosegCheck'
import { MicrosegActionsSlot, MicrosegWriteContext, useCanManageMicroseg } from './microsegAccess'
import ZoneMap from './ZoneMap'
import {
  MICROSEG_SUBTABS, isMicrosegSubTab, type FirewallWizardData, type MicrosegSubTab, type MicrosegSubTabProps, type TrackedRun,
} from './microsegTabTypes'

const STORAGE_KEY = 'microseg.subTab'

function readStoredSubTab(): MicrosegSubTab | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return isMicrosegSubTab(stored) ? stored : null
  } catch {
    return null
  }
}

function storeSubTab(tab: MicrosegSubTab) {
  try {
    window.localStorage.setItem(STORAGE_KEY, tab)
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

/** Content of one sub-tab. */
function SubTabContent({ tab, ...props }: { tab: MicrosegSubTab } & MicrosegSubTabProps) {
  return (
    <Box role='tabpanel' id={`microseg-panel-${tab}`} aria-labelledby={`microseg-tab-${tab}`} sx={{ pt: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {tab === 'overview' && <ZoneMap {...props} />}
      {tab === 'policy' && <PolicyPanel {...props} />}
      {tab === 'observation' && <ObservationPanel {...props} />}
      {tab === 'drifts' && <DriftsPanel {...props} />}
      {tab === 'history' && <HistoryPanel {...props} />}
    </Box>
  )
}

type Props = {
  connectionId: string
  /** Typed to confirm the removal; the id when the page does not know the name. */
  connectionName?: string
  /** What the deployment wizard needs; without it a failed pre-flight check has no wizard to open. */
  firewall?: FirewallWizardData
  /** The sub-tab to open on, from a link or a line of the Dashboard's "To do" list; else the one last shown. */
  initialSubTab?: MicrosegSubTab
  /** The VMID of a `?vm=` link: the Overview targets that guest (the page also opens the Overview for it). */
  targetVm?: string | null
}

/** The Micro-segmentation tab of /automation/network: banner, first run guide and the five sub-tabs. */
export default function MicrosegTab({ connectionId, connectionName, firewall, initialSubTab, targetVm }: Props) {
  const t = useTranslations('microsegPilot')
  const { data: policy, loading, error, reload } = useMicrosegPolicy(connectionId || null)
  // While a manual check waits in the queue, the status (shared with the banner and the button) is read faster.
  const [checkQueued, setCheckQueued] = useState(false)
  const controls = useMicrosegControls(connectionId, checkQueued ? CHECK_STATUS_POLL_MS : undefined)
  // A read-only user (no node.manage on the connection) sees every write control disabled, with the reason.
  const canWrite = useCanManageMicroseg(connectionId)
  // Read once: nothing of the sub-tab shows before the policy has loaded, so this never differs from a server render.
  const [subTab, setSubTab] = useState<MicrosegSubTab>(() => initialSubTab ?? readStoredSubTab() ?? 'overview')

  // The runs live here, not in a sub-tab: switching sub-tab must not lose them.
  const [runs, setRuns] = useState<TrackedRun[]>([])
  // The plan window is opened by the banner, the pending changes bar and the first run guide.
  const [planOpen, setPlanOpen] = useState(false)
  const onOpenPlan = useCallback(() => setPlanOpen(true), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const onOpenSettings = useCallback(() => setSettingsOpen(true), [])
  const [preflightOpen, setPreflightOpen] = useState(false)
  const onOpenPreflight = useCallback(() => setPreflightOpen(true), [])
  const [wizardOpen, setWizardOpen] = useState(false)
  // The zone a zone panel opened the Drifts sub-tab on (cleared by any other way to a sub-tab).
  const [driftsZone, setDriftsZone] = useState<string | null>(null)
  const [observationZone, setObservationZone] = useState<string | null>(null)
  // The wizard changes the cluster: the pre-flight checks are read again once it is done.
  const [preflightRound, setPreflightRound] = useState(0)
  // The row of the sub-tabs hosts the actions of the active sub-tab (a state, so they render once it is mounted).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const { mutate } = useSWRConfig()

  const startRun = useCallback((run: TrackedRun) => {
    setRuns(prev => (prev.some(r => r.runId === run.runId) ? prev : [...prev, run]))
  }, [])
  const removeRun = useCallback((runId: string) => setRuns(prev => prev.filter(r => r.runId !== runId)), [])
  // A run changes Proxmox and records what it did: the draft, the status, the runs and revisions, the drifts
  // and the zone members (tags) are read again, so no list or count stays stale until a manual reload.
  const refreshAfterRun = useCallback(() => {
    void reload()
    void mutate(isRunAffectedKey(connectionId))
  }, [reload, mutate, connectionId])
  // A check also reads the logs: the suggestions it learnt are read again with the rest.
  const refreshAfterCheck = useCallback(() => {
    refreshAfterRun()
    const suggestions = `${microsegBaseUrl(connectionId)}/suggestions`
    void mutate((key: unknown) => Array.isArray(key) && key[0] === suggestions)
  }, [refreshAfterRun, mutate, connectionId])

  const goToSubTab = (tab: MicrosegSubTab, options?: { zoneId?: string }) => {
    setSubTab(tab)
    storeSubTab(tab)
    setDriftsZone(tab === 'drifts' ? options?.zoneId ?? null : null)
    setObservationZone(tab === 'observation' ? options?.zoneId ?? null : null)
  }

  if (!connectionId) return <Alert severity='info' sx={{ m: 3 }}>{t('noConnection')}</Alert>

  if (!policy) {
    return (
      <Box sx={{ p: 3 }}>
        {error ? (
          <MicrosegErrorAlert error={error} onRetry={reload} />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CircularProgress size={20} />
            <Typography color='text.secondary'>{loading ? t('loading') : ''}</Typography>
          </Box>
        )}
      </Box>
    )
  }

  const firstRun = !policy.last_revision && policy.zones.length === 0
  const contentProps: MicrosegSubTabProps = {
    connectionId, policy, reloadPolicy: reload, goToSubTab, onOpenPlan, startRun, onOpenSettings, onOpenPreflight, targetVm, driftsZone, observationZone,
  }

  return (
    <MicrosegWriteContext.Provider value={canWrite}>
    <MicrosegActionsSlot.Provider value={actionsSlot}>
    <Box sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <MicrosegBanner
        connectionId={connectionId}
        policy={policy}
        controls={controls}
        onOpenPlan={onOpenPlan}
        onOpenWizard={firewall ? () => setWizardOpen(true) : undefined}
      />
      <RunStrip connectionId={connectionId} runs={runs} onFinished={refreshAfterRun} onRemove={removeRun} />
      {firstRun && <FirstRunGuide goToSubTab={goToSubTab} onOpenPlan={onOpenPlan} onOpenPreflight={onOpenPreflight} />}
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <Tabs
          value={subTab}
          onChange={(_, v: MicrosegSubTab) => goToSubTab(v)}
          variant='scrollable'
          scrollButtons='auto'
          aria-label={t('subTabs.label')}
          // Never narrower than the five sub-tabs from md up: the actions go to the next line instead of the tabs scrolling.
          sx={{ flex: '1 1 auto', minWidth: { xs: 0, md: 'max-content' } }}
        >
          {MICROSEG_SUBTABS.map(tab => (
            <Tab
              key={tab}
              value={tab}
              id={`microseg-tab-${tab}`}
              aria-controls={`microseg-panel-${tab}`}
              label={t(`subTabs.${tab}`)}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            />
          ))}
        </Tabs>
        {/* The actions of the row as one group: it wraps whole, to the right, when the row is too narrow. */}
        <Box data-testid='microseg-actions' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', ml: 'auto', minWidth: 0 }}>
          <Box ref={setActionsSlot} data-testid='microseg-actions-slot' sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} />
          {subTab === 'overview' && (
            <Tooltip describeChild title={t('trafficLens.openFlowsTip')}>
              <Link component={NextLink} href={`/operations/network-flows?groupBy=zone&connection=${encodeURIComponent(connectionId)}`} underline='hover' sx={{ fontSize: 13, flexShrink: 0 }}>
                {t('trafficLens.summary.title')}
              </Link>
            </Tooltip>
          )}
          <CheckNowButton
            connectionId={connectionId}
            deployed={!!policy.last_revision}
            status={controls.status}
            statusError={controls.statusError}
            reloadStatus={controls.reload}
            onQueued={setCheckQueued}
            startRun={startRun}
            onDone={refreshAfterCheck}
            onOpenDrifts={() => goToSubTab('drifts')}
          />
          <EmergencyStopButton controls={controls} deployed={!!policy.last_revision} />
          <Tooltip title={t('settings.open')}>
            <IconButton aria-label={t('settings.open')} onClick={onOpenSettings} sx={{ flexShrink: 0 }}>
              <i className='ri-settings-3-line' />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      <SubTabContent tab={subTab} {...contentProps} />
      <PlanDialog
        open={planOpen}
        connectionId={connectionId}
        policy={policy}
        reloadPolicy={reload}
        startRun={startRun}
        onClose={() => setPlanOpen(false)}
      />
      {settingsOpen && (
        <SettingsDialog
          connectionId={connectionId}
          connectionName={connectionName || connectionId}
          policy={policy}
          reloadPolicy={reload}
          startRun={startRun}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {preflightOpen && (
        <PreflightPanel
          open
          connectionId={connectionId}
          refreshKey={preflightRound}
          onClose={() => setPreflightOpen(false)}
          onOpenWizard={firewall ? () => setWizardOpen(true) : undefined}
          onResume={() => { setPreflightOpen(false); controls.ask('resume') }}
        />
      )}
      {firewall && (
        <DeploymentWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          selectedConnection={connectionId}
          clusterOptions={firewall.clusterOptions}
          clusterRules={firewall.clusterRules}
          nodesList={firewall.nodesList}
          firewallMode={firewall.firewallMode}
          onComplete={() => { firewall.onComplete(); setPreflightRound(n => n + 1) }}
        />
      )}
    </Box>
    </MicrosegActionsSlot.Provider>
    </MicrosegWriteContext.Provider>
  )
}
