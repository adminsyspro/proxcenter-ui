'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, CircularProgress, IconButton, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'

import { microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { isRunAffectedKey, refreshZoneGuestsAfterRun } from '@/lib/microseg/runRefresh'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { isClustersKey, useMicrosegGroup } from '@/lib/microseg/useMicrosegGroup'

import { NamedNetworksProvider } from './namedNetworksContext'
import DeploymentWizard from '../DeploymentWizard'
import CheckNowButton from './CheckNowButton'
import type { NamedConnection } from './clusterModel'
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
import { RECOMMENDED_OBSERVE_LOG_RATE } from './preflightModel'
import RunStrip from './RunStrip'
import SettingsDialog from './SettingsDialog'
import { RunsInProgressProvider, useTrackedRuns } from './runsInProgress'
import { useMicrosegControls } from './useMicrosegControls'
import { useResumeRuns } from './useResumeRuns'
import { CHECK_STATUS_POLL_MS } from './useMicrosegCheck'
import { MicrosegAccessProvider, MicrosegActionsSlot, useMicrosegAccess } from './microsegAccess'
import ZoneMap from './ZoneMap'
import {
  MICROSEG_SUBTABS, isMicrosegSubTab, type FirewallWizardData, type MicrosegSubTab, type MicrosegSubTabProps, type ObservationFocus,
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
  /** What the Observation sub-tab opens filtered on, from a figure of the Dashboard. */
  initialObservation?: ObservationFocus | null
  /** The VMID of a `?vm=` link: the Overview targets that guest (the page also opens the Overview for it). */
  targetVm?: string | null
  /** The PVE connections the user sees: names of the clusters sharing the policy, and those that can join it. */
  connections?: NamedConnection[]
  /** The connections already sharing a policy, from the page's groups: never proposed for an association. */
  groupedConnections?: string[]
  /** A cluster left the group (who left, who remains): the page keeps its selection on a cluster that remains. */
  onDissociated?: (left: string, remaining: string[]) => void
}

const NO_CONNECTIONS: NamedConnection[] = []
const NOT_GROUPED: string[] = []

/** The Micro-segmentation tab of /automation/network: banner, first run guide and the five sub-tabs. */
export default function MicrosegTab({ connectionId, connectionName, firewall, initialSubTab, initialObservation = null, targetVm, connections = NO_CONNECTIONS, groupedConnections = NOT_GROUPED, onDissociated }: Props) {
  const t = useTranslations('microsegPilot')
  const { data: policy, loading, error, reload } = useMicrosegPolicy(connectionId || null)
  // The clusters sharing the policy of the selected connection (the connection alone until the backend answers).
  const group = useMicrosegGroup(connectionId)
  const clusterName = useMemo(() => {
    const names = new Map(connections.map(c => [c.id, c.name]))
    return (id: string) => names.get(id) ?? (id === connectionId && connectionName ? connectionName : id)
  }, [connections, connectionId, connectionName])
  // While a manual check waits in the queue, the status (shared with the banner and the button) is read faster.
  const [checkQueued, setCheckQueued] = useState(false)
  // A shared policy reads its draft again after a stop or a lift: the follow-up of the lift reads its links.
  const controls = useMicrosegControls(connectionId, checkQueued ? CHECK_STATUS_POLL_MS : undefined, clusterName, group.shared ? reload : undefined)
  // A read-only user (no node.manage on the connection) sees every write control disabled, with the reason. On a shared
  // policy a write on the whole policy needs the right on every cluster of the draft already read (the content shows
  // once it is): no request of its own, and nothing writable while the rights load.
  const linkedIds = useMemo(() => (policy?.clusters ?? []).map(c => c.connection_id), [policy?.clusters])
  const access = useMicrosegAccess(connectionId, linkedIds)
  // Read once: nothing of the sub-tab shows before the policy has loaded, so this never differs from a server render.
  const [subTab, setSubTab] = useState<MicrosegSubTab>(() => initialSubTab ?? readStoredSubTab() ?? 'overview')

  // The clusters never applied (link inactive), from the policy already read: their lines in the run strip do not
  // promise a catch-up, they ask to apply again.
  const policyClusters = policy?.clusters
  const inactiveClusters = useMemo(() => new Set((policyClusters ?? []).filter(c => !c.active).map(c => c.connection_id)), [policyClusters])
  // The runs live here, not in a sub-tab: switching sub-tab must not lose them.
  const { runs, startRun, endRun, removeRun, inProgress } = useTrackedRuns()
  // Resumed on every cluster of the group, once the group has answered.
  useResumeRuns(connectionId, connectionName || connectionId, startRun, { ids: group.ids, loading: group.loading, clusterName })
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
  // What the Dashboard opened the Observation sub-tab on (cleared by any other way to a sub-tab).
  const [observationFocus, setObservationFocus] = useState<ObservationFocus | null>(initialObservation)
  // The wizard changes the cluster: the pre-flight checks are read again once it is done.
  const [preflightRound, setPreflightRound] = useState(0)
  // The row of the sub-tabs hosts the actions of the active sub-tab (a state, so they render once it is mounted).
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null)
  const { mutate } = useSWRConfig()

  // A run changes Proxmox and records what it did: the draft, the status, the runs and revisions, the drifts
  // and the zone members (tags) are read again, so no list or count stays stale until a manual reload.
  const groupIds = group.ids.join('\n')
  // The zone members are read from a guest list the server keeps for a while: they are asked for again, fresh.
  const guestsRefresh = useRef<(() => void) | null>(null)
  const refreshGuests = useCallback((ids: readonly string[]) => {
    guestsRefresh.current?.()
    guestsRefresh.current = refreshZoneGuestsAfterRun(mutate, ids)
  }, [mutate])
  useEffect(() => () => guestsRefresh.current?.(), [])
  const refreshAfterRun = useCallback(() => {
    void reload()
    // Every cluster of the group: a group action changed each of them.
    const ids = groupIds.split('\n')
    void mutate(isRunAffectedKey(ids))
    refreshGuests(ids)
  }, [reload, mutate, groupIds, refreshGuests])
  // A removal on a shared policy takes its cluster out of the group: every group read is read again (the tab's own
  // included, which then holds the tab's cluster alone when that one left), with the draft and what the run changed on
  // the tab's cluster, never the clusters of the group it had (they would be read for a group that no longer is).
  const groupShared = group.shared
  const runFinished = useCallback((runId: string) => {
    const finished = runs.find(r => r.runId === runId)
    endRun(runId)
    if (finished?.kind === 'remove' && groupShared) {
      void reload()
      void mutate(isRunAffectedKey(connectionId))
      void mutate(isClustersKey)
      refreshGuests([connectionId])
      return
    }
    refreshAfterRun()
  }, [runs, endRun, refreshAfterRun, groupShared, reload, mutate, connectionId, refreshGuests])
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
    setObservationFocus(null)
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
  // Built only past the `!connectionId` return above: an empty anchor never reaches a sub-tab.
  const contentProps: MicrosegSubTabProps = {
    connectionId, policy, reloadPolicy: reload, goToSubTab, onOpenPlan, startRun, onOpenSettings, onOpenPreflight, targetVm, driftsZone, observationZone, observationFocus, pveNodes: firewall?.nodesList, pveNodeStatus: firewall?.nodeStatus,
    anchor: group.loading ? undefined : group.anchor, clusterIds: group.ids, clusterName,
  }

  return (
    <MicrosegAccessProvider value={access}>
    <NamedNetworksProvider networks={policy?.policy.settings?.networks}>
    <MicrosegActionsSlot.Provider value={actionsSlot}>
    <RunsInProgressProvider value={inProgress}>
    <Box sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <MicrosegBanner
        connectionId={connectionId}
        policy={policy}
        controls={controls}
        onOpenPlan={onOpenPlan}
        clusterIds={group.loading ? undefined : group.ids}
      />
      <RunStrip connectionId={connectionId} runs={runs} onFinished={runFinished} onRemove={removeRun} clusterName={clusterName} inactiveClusters={inactiveClusters} />
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
        <Box data-testid='microseg-actions' sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap', ml: 'auto', minWidth: 0, flex: '1 1 auto' }}>
          <Box ref={setActionsSlot} data-testid='microseg-actions-slot' sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0, justifyContent: 'flex-end' }} />
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
            activeIds={group.loading ? undefined : group.activeIds}
            clusterName={clusterName}
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
        clusterName={clusterName}
      />
      {settingsOpen && (
        <SettingsDialog
          connectionId={connectionId}
          connectionName={connectionName || connectionId}
          policy={policy}
          reloadPolicy={reload}
          startRun={startRun}
          onClose={() => setSettingsOpen(false)}
          connections={connections}
          groupedElsewhere={groupedConnections}
          clusterName={clusterName}
          maxClusters={group.max}
          onClustersChanged={group.reload}
          onDissociated={onDissociated}
        />
      )}
      {preflightOpen && (
        <PreflightPanel
          open
          connectionId={connectionId}
          refreshKey={preflightRound}
          onClose={() => setPreflightOpen(false)}
          anchor={group.loading ? undefined : group.anchor}
          clusterIds={group.ids}
          clusterName={clusterName}
          onOpenWizard={firewall ? () => setWizardOpen(true) : undefined}
          onResume={() => { setPreflightOpen(false); controls.ask('resume') }}
          rateLimit={{
            observe: policy.policy.settings.observe_log_rate_limit ?? '',
            // A draft setting: nothing is written to Proxmox here, the engine raises the rate with the next plan.
            onRaise: async () => {
              await microsegApi(connectionId).savePolicy({ version: policy.version, settings: { observe_log_rate_limit: RECOMMENDED_OBSERVE_LOG_RATE } })
              await reload()
            },
          }}
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
    </RunsInProgressProvider>
    </MicrosegActionsSlot.Provider>
    </NamedNetworksProvider>
    </MicrosegAccessProvider>
  )
}
