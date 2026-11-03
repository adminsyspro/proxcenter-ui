'use client'

import { useMemo, useState } from 'react'
import { Box } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useVMFirewallCoverage, type FirewallCoverage } from '@/hooks/useZeroTrust'
import { PVE_DEFAULT_POLICY_IN } from '@/lib/firewall/pveDefaults'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegDrifts, useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'
import type { ListSuggestionsParams } from '@/lib/microseg/api'
import type { MicrosegPolicy, MicrosegStatus, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import DashboardTodo, { type TodoActions } from './DashboardTodo'
import { dashboardPhase, missingManagementPorts, todoItems, type BlockPhase } from './dashboardModel'
import {
  GROUP_BYS, POSTURE_SUGGESTIONS_LIMIT, isZoneGrouping, postureDistribution, postureGuests, postureTraffic, protectedRunning, topServices, zonesEnforced, type GroupBy,
} from './dashboardPosture'
import DeploymentWizard from './DeploymentWizard'
import FirewallLoadAlert from './FirewallLoadAlert'
import { TopServices, TrafficDistribution } from './ObservedTraffic'
import PostureChips from './PostureChips'
import TrafficByZone from './TrafficByZone'
import TrafficTimeline from './TrafficTimeline'
import { postureVolume, type TimelineRange, type TimelineVerdict } from './postureTimeline'
import { useTimelineRange } from './useTimelineRange'
import { useTrafficTimeline } from './useTrafficTimeline'
import { useStoredChoice } from './microseg/useStoredChoice'
import { usePostureVolume } from './usePostureVolume'
import { coverage as microsegCoverage } from './microseg/coverage'
import type { MicrosegSubTab } from './microseg/microsegTabTypes'
import { clusterFirewallOff, lastCheckAt, unzonedRunning } from './microseg/summaryModel'
import { useZoneGuests } from './microseg/useZoneGuests'
import type { PolicyGuest } from './microseg/zoneModel'

/** The guest filter Firewalling > VMs opens with from the "To do" list. */
export type GuestFilter = 'unprotected'

interface DashboardTabProps {
  // Data
  securityGroups: firewallAPI.SecurityGroup[]
  clusterOptions: firewallAPI.ClusterOptions | null
  clusterRules: firewallAPI.FirewallRule[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  firewallMode: firewallAPI.FirewallMode
  currentOptions: firewallAPI.ClusterOptions | firewallAPI.NodeOptions | null
  selectedConnection: string
  /** Name of the selected connection (the Posture layout does not show it). */
  connectionName?: string
  totalRules: number
  totalIPSetEntries: number
  nodesList: string[]
  /** What failed on the last load of the firewall data, null when it all loaded. */
  loadError?: string | null
  /** The firewall data is still loading: nothing can be said about the cluster yet. */
  loading?: boolean
  // Handlers
  reload: () => void
  // Navigation
  onNavigateTab: (tab: number) => void
  onNavigateRulesSubTab: (subTab: number) => void
  /** Firewalling > VMs, filtered on the guests without firewall when asked. */
  onOpenGuests?: (filter?: GuestFilter) => void
  /** The Micro-segmentation tab, on one of its sub-tabs when asked. */
  onOpenMicroseg?: (subTab?: MicrosegSubTab) => void
}

/** The pending observed flows, the same page as the zone map (one SWR key, one read for both). */
const PENDING_OBSERVED: ListSuggestionsParams = { status: 'pending', limit: POSTURE_SUGGESTIONS_LIMIT }

/** A read is settled once it answered or failed. */
const settled = (read: { data?: unknown; error?: unknown }) => !!read.data || !!read.error

/** The count of the pending flows read: a full page says "at least". */
function pendingFlowsOf(list: unknown[] | undefined): { count: number; more: boolean } | null {
  if (!list) return null

  return { count: list.length, more: list.length >= POSTURE_SUGGESTIONS_LIMIT }
}

/** A block made of micro-segmentation reads: a skeleton until they answered, not available when one failed. */
function microsegPhase(reads: { data?: unknown; error?: unknown }[]): BlockPhase {
  if (reads.some(r => !r.data && r.error)) return 'unavailable'

  return reads.every(r => r.data) ? 'ready' : 'loading'
}

/** What the header chips say of the engine: undefined while its status is read, null when it could not be. */
function engineFigures(status: MicrosegStatus | undefined, failed: boolean) {
  if (status) return { zones: zonesEnforced(status), lastCheck: lastCheckAt(status) }
  return failed ? { zones: null, lastCheck: null } : { zones: undefined, lastCheck: undefined }
}

/** The figures of the observed traffic blocks, from the policy, the pending flows and the guests. */
function usePostureFigures(policy: MicrosegPolicy | undefined, suggestions: MicrosegSuggestion[] | undefined, rows: FirewallCoverage['guests'], listed: PolicyGuest[] | null, groupBy: GroupBy) {
  return useMemo(() => {
    const zones = policy?.zones ?? []
    const tagPrefix = policy?.policy.tag_prefix ?? ''
    const flows = policy?.flows ?? []
    const seen = suggestions ?? []
    const addresses = listed !== null
    const guests = postureGuests(rows, listed)
    return {
      guests,
      traffic: postureTraffic({ groupBy, zones, tagPrefix, suggestions: seen, guests, addresses }),
      distribution: postureDistribution({ zones, tagPrefix, flows, suggestions: seen, guests, addresses }),
      services: topServices(seen, flows),
    }
  }, [policy, suggestions, rows, listed, groupBy])
}

const NO_ZONES: MicrosegZone[] = []
/** The grouping of the traffic block, remembered per browser. */
export const GROUP_BY_KEY = 'proxcenter.microseg.postureGroupBy'

/**
 * The time charts, on the groups of the donut. The events chart reads the persisted history of the range chosen when
 * grouped by zone (the only grouping the history carries), the events of the ring otherwise or when the orchestrator
 * does not serve the history; the Volume tab reads the sFlow bytes when sFlow sees the connection.
 */
function useTimelineFigures(
  connection: string | null, policy: MicrosegPolicy | undefined, posture: ReturnType<typeof usePostureFigures>,
  groupBy: GroupBy, verdict: TimelineVerdict, addresses: boolean, range: TimelineRange,
) {
  const { timeline, answer, rangeLock, now } = useTrafficTimeline({
    connection, zones: policy?.zones ?? NO_ZONES, slices: posture.traffic.slices, groupBy, verdict, range, guests: posture.guests, addresses,
  })
  // The sFlow window moves at each edge of its windows, on the same minute clock.
  const sflow = usePostureVolume(connection, posture.guests, now, range)
  const volume = useMemo(() => (sflow.available ? postureVolume({
    series: sflow.series, groupBy, zones: policy?.zones ?? [], tagPrefix: policy?.policy.tag_prefix ?? '', guests: posture.guests,
    slices: posture.traffic.slices, range, from: sflow.from, to: sflow.to,
  }) : null), [sflow.available, sflow.series, sflow.from, sflow.to, range, groupBy, policy, posture])
  return { timeline, volume, answer, rangeLock }
}

/**
 * The "Posture" Dashboard of /automation/network (UA50): the header chips (cluster firewall and inbound policy, or the
 * emergency stop; zones enforced; running guests protected; last check), the observed traffic per zone (donut and
 * chords), its distribution and top services, then the "To do" list. Its reads: the firewall data the page loads, the
 * coverage route (computed and cached on the server), the micro-segmentation status, policy, drifts and pending flows
 * (orchestrator memory), the events ring for the time chart (orchestrator memory, every minute, only when grouped by VLAN or node or when the history route is not served), the persisted history of the flows for the zone grouping (the range chosen, remembered per browser), the sFlow pairs and
 * time series for its Volume tab (orchestrator and InfluxDB). The guest list (the inventory route, one guest config per guest on Proxmox) is read only once
 * a grouping by VLAN or node asks for it, shared with the zone map.
 */
export default function DashboardTab({
  firewallMode, currentOptions,
  selectedConnection, clusterOptions, clusterRules, nodesList,
  securityGroups, loadError, loading = false,
  reload, onNavigateTab, onNavigateRulesSubTab, onOpenGuests, onOpenMicroseg,
}: DashboardTabProps) {
  const [deployWizardOpen, setDeployWizardOpen] = useState(false)
  const [groupBy, setGroupBy] = useStoredChoice<GroupBy>(GROUP_BY_KEY, GROUP_BYS, 'zone')
  // Once a grouping by VLAN or node asked for the guests, they stay (a zone grouping then tells the unzoned apart).
  const [guestsWanted, setGuestsWanted] = useState(() => !isZoneGrouping(groupBy))
  const [verdict, setVerdict] = useState<TimelineVerdict>('all')
  const [range, setRange] = useTimelineRange()
  const connection = selectedConnection || null

  // Read once when the tab shows (this component mounts with it), computed and cached on the server (UA44).
  const coverageRead = useVMFirewallCoverage(connection)
  const coverage = coverageRead.data?.computedAt ? coverageRead.data : null
  const microsegStatus = useMicrosegStatus(connection)
  const microsegPolicy = useMicrosegPolicy(connection)
  const drifts = useMicrosegDrifts(connection)
  const pending = useMicrosegSuggestions(connection, PENDING_OBSERVED)
  const zoneGuests = useZoneGuests(guestsWanted ? connection : null)

  // Node options carry no policy: a host follows the cluster's, and an unset policy is PVE's default, not ACCEPT (#1065).
  const policyIn = clusterOptions?.policy_in || PVE_DEFAULT_POLICY_IN
  const firewallOn = currentOptions?.enable === 1

  const status = microsegStatus.data
  const policy = microsegPolicy.data
  const stopped = status?.emergency_stop ?? policy?.policy.emergency_stop ?? false
  const stopHoldsFirewall = stopped && clusterFirewallOff(status, policy)

  const phase = dashboardPhase({
    firewallLoading: loading,
    loadError: !!loadError,
    coverageIn: !!coverage,
    coverageFailed: !coverage && !!coverageRead.error,
    stopStateIn: settled(microsegStatus) && settled(microsegPolicy),
    microsegListsIn: settled(drifts) && settled(pending),
  })

  const addresses = guestsWanted && zoneGuests.status === 'ready'
  const listsPhase = microsegPhase([microsegPolicy, pending])
  // A grouping by VLAN or node waits for the guests it is made of.
  const trafficPhase = listsPhase === 'ready' && !isZoneGrouping(groupBy) && zoneGuests.status === 'loading' ? 'loading' : listsPhase
  const posture = usePostureFigures(policy, pending.data, coverage?.guests, addresses ? zoneGuests.guests : null, groupBy)
  const { timeline, volume, answer, rangeLock } = useTimelineFigures(connection, policy, posture, groupBy, verdict, addresses, range)
  const timelinePhase = microsegPhase([microsegPolicy, answer])

  const items = todoItems({
    firewallOn,
    stopped,
    stopHoldsFirewall,
    policyIn,
    missingManagement: missingManagementPorts(clusterRules, securityGroups),
    unprotected: coverage ? coverage.disabled : null,
    unzoned: unzonedRunning(status ? microsegCoverage(status) : null, drifts.data),
    pendingFlows: pendingFlowsOf(pending.data),
  })

  const openRules = (subTab: number) => () => { onNavigateTab(1); onNavigateRulesSubTab(subTab) }
  const openGuests = (filter?: GuestFilter) => {
    if (onOpenGuests) onOpenGuests(filter)
    else openRules(2)()
  }
  const openMicroseg = (subTab?: MicrosegSubTab) => {
    if (onOpenMicroseg) onOpenMicroseg(subTab)
    else onNavigateTab(6)
  }
  const actions: TodoActions = {
    stopHeld: () => openMicroseg('overview'),
    firewallOff: () => setDeployWizardOpen(true),
    managementRules: () => setDeployWizardOpen(true),
    policyIn: openRules(0),
    unprotected: () => openGuests('unprotected'),
    unzoned: () => openMicroseg('drifts'),
    pendingFlows: () => openMicroseg('observation'),
  }
  const changeGroupBy = (next: GroupBy) => {
    setGroupBy(next)
    if (!isZoneGrouping(next)) setGuestsWanted(true)
  }

  if (!selectedConnection) return <Box sx={{ p: 3 }} />

  const engine = engineFigures(status, !!microsegStatus.error)

  return (
    <Box sx={{ p: 3 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />

      <DeploymentWizard
        open={deployWizardOpen}
        onClose={() => setDeployWizardOpen(false)}
        selectedConnection={selectedConnection}
        clusterOptions={clusterOptions}
        clusterRules={clusterRules}
        nodesList={nodesList}
        firewallMode={firewallMode}
        onComplete={reload}
      />

      {/* 1. Header chips */}
      <PostureChips
        clusterPhase={phase.cluster}
        firewallMode={firewallMode}
        firewallOn={firewallOn}
        policyIn={policyIn}
        stopped={stopped}
        stopHoldsFirewall={stopHoldsFirewall}
        zones={engine.zones}
        guests={protectedRunning(coverage)}
        lastCheck={engine.lastCheck}
        coverageAt={coverage?.computedAt}
        coverageBusy={coverageRead.refreshing || !!coverageRead.data?.computing}
        onRefreshCoverage={() => { void coverageRead.refresh() }}
        onOpenCluster={stopped ? () => openMicroseg('overview') : openRules(0)}
        onOpenMicroseg={() => openMicroseg()}
        onOpenGuests={() => openGuests()}
      />

      {/* 2. Observed traffic: by zone on the left, its distribution and top services on the right */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2.5, mb: 2.5 }}>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 7' }, minWidth: 0 }}>
          <TrafficByZone
            phase={trafficPhase}
            traffic={posture.traffic}
            groupBy={groupBy}
            onGroupBy={changeGroupBy}
            truncated={(pending.data?.length ?? 0) >= POSTURE_SUGGESTIONS_LIMIT}
            addresses={addresses}
            footer={<TrafficTimeline phase={timelinePhase} timeline={timeline} verdict={verdict} onVerdict={setVerdict} volume={volume} volumeSent={groupBy === 'zone'} range={range} onRange={setRange} rangeLock={rangeLock} />}
          />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 5' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <TrafficDistribution phase={listsPhase} distribution={posture.distribution} />
          <TopServices phase={listsPhase} rows={posture.services} />
        </Box>
      </Box>

      {/* 3. To do */}
      <DashboardTodo phase={phase.todo} items={items} actions={actions} />
    </Box>
  )
}
