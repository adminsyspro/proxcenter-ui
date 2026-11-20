'use client'

import { useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import { useTranslations } from 'next-intl'

import * as firewallAPI from '@/lib/api/firewall'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'
import type { ListSuggestionsParams } from '@/lib/microseg/api'
import type { MicrosegPolicy, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import ClusterStrip from './ClusterStrip'
import {
  clusterFilter, guestsByCluster, guestsOf, pendingClusters, policyScope, seriesOf, shownFlows, shownIds, type PolicyScope,
} from './dashboardAggregate'
import { policyPeerOf, topConversations, type RemotePeer } from './dashboardConversations'
import type { BlockPhase } from './dashboardModel'
import {
  GROUP_BYS, POSTURE_SUGGESTIONS_LIMIT, isZoneGrouping, postureDistribution, postureTraffic, topServices, type GroupBy, type PostureGuest,
} from './dashboardPosture'
import FirewallLoadAlert from './FirewallLoadAlert'
import { TopServices, TrafficDistribution } from './ObservedTraffic'
import TopConversations from './TopConversations'
import TrafficByZone from './TrafficByZone'
import TrafficTimeline from './TrafficTimeline'
import { postureVolume, type TimelineRange, type TimelineVerdict } from './postureTimeline'
import { useTimelineRange } from './useTimelineRange'
import { useTrafficTimeline } from './useTrafficTimeline'
import { usePolicyCoverage } from './usePolicyReads'
import { useStoredChoice } from './microseg/useStoredChoice'
import { usePostureVolume } from './usePostureVolume'
import type { MicrosegSubTab, ObservationFocus } from './microseg/microsegTabTypes'
import { shownClusterName } from './microseg/ClusterRunRow'
import { useGroupGuests } from './microseg/useGroupGuests'
import { useZoneGuests } from './microseg/useZoneGuests'
import type { PolicyGuest } from './microseg/zoneModel'
import { TAB } from '../networkLink'

/** The guest filter Firewalling > VMs can open with. */
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
  /** The PVE connections the user sees: the names of the clusters sharing the micro-segmentation policy. */
  connections?: { id: string; name: string }[]
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
  /** The Micro-segmentation tab, on one of its sub-tabs when asked; the Observation one on a type of flow or a service. */
  onOpenMicroseg?: (subTab?: MicrosegSubTab, focus?: ObservationFocus) => void
}

/** The pending observed flows, the same page as the zone map (one SWR key, one read for both). */
const PENDING_OBSERVED: ListSuggestionsParams = { status: 'pending', limit: POSTURE_SUGGESTIONS_LIMIT }

/** A block made of micro-segmentation reads: a skeleton until they answered, not available when one failed. */
function microsegPhase(reads: { data?: unknown; error?: unknown }[]): BlockPhase {
  if (reads.some(r => !r.data && r.error)) return 'unavailable'

  return reads.every(r => r.data) ? 'ready' : 'loading'
}

/** The figures of the observed traffic blocks, from the policy, the pending flows and the guests. */
function usePostureFigures(policy: MicrosegPolicy | undefined, suggestions: MicrosegSuggestion[] | undefined, guests: PostureGuest[], addresses: boolean, groupBy: GroupBy) {
  return useMemo(() => {
    const zones = policy?.zones ?? []
    const tagPrefix = policy?.policy.tag_prefix ?? ''
    const flows = policy?.flows ?? []
    const seen = suggestions ?? []
    return {
      guests,
      traffic: postureTraffic({ groupBy, zones, tagPrefix, suggestions: seen, guests, addresses }),
      distribution: postureDistribution({ zones, tagPrefix, flows, suggestions: seen, guests, addresses }),
      services: topServices(seen, flows),
      servicesTotal: topServices(seen, flows, Number.POSITIVE_INFINITY).length,
    }
  }, [policy, suggestions, guests, addresses, groupBy])
}

const NO_ZONES: MicrosegZone[] = []
const NO_NAME = (): string | undefined => undefined
const NO_IDS: string[] = []
const NO_GUESTS: PostureGuest[] = []
const NO_MISSING: ReadonlySet<string> = new Set()
const NO_CONNECTIONS: { id: string; name: string }[] = []
/** The chip of a cluster the user cannot see: one colour for all of them, never its ID. */
const OTHER_CLUSTER = 'other'
/** The longest the conversations wait for the guests of the other clusters before they show without them. */
export const PEER_GUESTS_WAIT_MS = 3000

/** True while `waiting` and for at most `ms` after it started for this `key` (a new key waits again). */
function useBoundedWait(waiting: boolean, key: string, ms: number): boolean {
  const [expired, setExpired] = useState<string | null>(null)
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setExpired(key), ms)
    return () => clearTimeout(timer)
  }, [waiting, key, ms])
  return waiting && expired !== key
}

/** The guest that carries an address, once the guest list is read (a grouping by VLAN or node asked for it). */
function useGuestNames(guests: readonly PolicyGuest[] | null): (ip: string) => string | undefined {
  return useMemo(() => {
    if (!guests) return NO_NAME
    const byIp = new Map<string, string>()
    for (const g of guests) for (const ip of g.ips ?? []) byIp.set(ip, g.name)
    return (ip: string) => byIp.get(ip)
  }, [guests])
}

/**
 * The guests of every cluster of a shared policy the user sees (the inventory route, the same key as the zone map), read
 * once each, so the end of an observed flow that is a member of another cluster than the one that logged it is named
 * with its zone and its cluster. A cluster the user cannot see is never read: an address in a zone that no guest read
 * carries is then on "another cluster". Nothing is read for a policy of one cluster.
 */
function useRemotePeers(connection: string | null, policy: MicrosegPolicy | undefined, scope: PolicyScope, connections: readonly { id: string; name: string }[], connectionName: string | undefined) {
  const tc = useTranslations('microsegPilot.plan.cluster')
  const readIds = scope.shared ? scope.readIds : NO_IDS
  const group = useGroupGuests(readIds)
  // A slow cluster delays the conversations by PEER_GUESTS_WAIT_MS at most: they show, then name its members once in.
  const waiting = useBoundedWait(readIds.length > 0 && group.loading, readIds.join('|'), PEER_GUESTS_WAIT_MS)
  const zones = policy?.zones ?? NO_ZONES
  const tagPrefix = policy?.policy.tag_prefix ?? ''
  const hidden = scope.hidden > 0
  const peerOf = useMemo(() => (scope.shared && connection
    ? policyPeerOf({ fallback: connection, guests: group.guests, zones, tagPrefix, hiddenClusters: hidden })
    : undefined), [scope.shared, connection, group.guests, zones, tagPrefix, hidden])
  const peerCluster = useMemo(() => {
    const names = new Map(connections.map(c => [c.id, c.name]))
    const nameOf = (id: string) => names.get(id) ?? (id === connection && connectionName ? connectionName : id)
    return (cluster: RemotePeer['cluster']) => (cluster
      ? { id: cluster, name: shownClusterName(cluster, connection ?? '', nameOf, tc('other')) }
      : { id: OTHER_CLUSTER, name: tc('other') })
  }, [connections, connection, connectionName, tc])
  return { shared: scope.shared, peerOf, peerCluster, group, waiting }
}

/** The grouping of the traffic block, remembered per browser. */
export const GROUP_BY_KEY = 'proxcenter.microseg.postureGroupBy'

/**
 * The time charts, on the groups of the donut. The events chart reads the persisted history of the range chosen when
 * grouped by zone (the only grouping the history carries), the events of the ring otherwise or when the orchestrator
 * does not serve the history; the Volume tab reads the sFlow bytes when sFlow sees the connection. On a shared policy
 * each cluster read is merged (`useTrafficTimeline`); the sFlow series are read for the guests of every cluster read
 * and those of the shown guests are drawn, so the strip's filter reads nothing again.
 */
function useTimelineFigures(
  connection: string | null, policy: MicrosegPolicy | undefined, posture: ReturnType<typeof usePostureFigures>, guests: PostureGuest[],
  view: { groupBy: GroupBy; verdict: TimelineVerdict; addresses: boolean; range: TimelineRange },
  scope: PolicyScope, shown: string[], allGuests: PostureGuest[], filtered: boolean,
) {
  const { groupBy, verdict, addresses, range } = view
  const { timeline, answer, rangeLock, now, missing, pending } = useTrafficTimeline({
    connection, zones: policy?.zones ?? NO_ZONES, slices: posture.traffic.slices, groupBy, verdict, range, guests, addresses,
    clusters: scope.shared ? scope.readIds : undefined, shown: scope.shared ? shown : undefined,
  })
  // The sFlow window moves at each edge of its windows, on the same minute clock.
  const sflow = usePostureVolume(connection, allGuests, now, range)
  const series = useMemo(() => (filtered ? seriesOf(sflow.series, guests) : sflow.series), [filtered, sflow.series, guests])
  const available = sflow.available && (!filtered || series.some(vm => (vm.points ?? []).length > 0))
  const volume = useMemo(() => (available ? postureVolume({
    series, groupBy, zones: policy?.zones ?? [], tagPrefix: policy?.policy.tag_prefix ?? '', guests,
    slices: posture.traffic.slices, range, from: sflow.from, to: sflow.to,
  }) : null), [available, series, sflow.from, sflow.to, range, groupBy, policy, guests, posture])
  return { timeline, volume, answer, rangeLock, missing, pending }
}

/**
 * The "Posture" Dashboard of /automation/network (UA50): the observed traffic per zone (donut, chords and timeline),
 * its distribution and top services, then the busiest conversations down to the bottom of the page. Its reads: the
 * coverage route (computed and cached on the server; its guests' nodes, tags and VLANs), the micro-segmentation policy and pending flows
 * (orchestrator memory), the events ring for the time chart (orchestrator memory, every minute, only when grouped by VLAN or node or when the history route is not served), the persisted history of the flows for the zone grouping (the range chosen, remembered per browser), the sFlow pairs and
 * time series for its Volume tab (orchestrator and InfluxDB). The guest list (the inventory route, one guest config per guest on Proxmox) is read only once
 * a grouping by VLAN or node asks for it, shared with the zone map. On a policy shared by several clusters every figure
 * is the whole policy's: the observed flows are read once for the policy (every cluster's rows), the coverage, the
 * history or the ring and the guests once per cluster the user sees, and merged (`dashboardAggregate`); a zone on two
 * clusters adds up. A strip of tiles, one per cluster (`ClusterStrip`), filters every block on one of them out of what
 * was read, without another read; a conversation with a member of another cluster names its zone and its cluster.
 */
export default function DashboardTab({
  selectedConnection, connectionName, connections = NO_CONNECTIONS, loadError, reload, onNavigateTab, onOpenMicroseg,
}: DashboardTabProps) {
  const [groupBy, setGroupBy] = useStoredChoice<GroupBy>(GROUP_BY_KEY, GROUP_BYS, 'zone')
  // Once a grouping by VLAN or node asked for the guests, they stay (a zone grouping then tells the unzoned apart).
  const [guestsWanted, setGuestsWanted] = useState(() => !isZoneGrouping(groupBy))
  const [verdict, setVerdict] = useState<TimelineVerdict>('all')
  const [range, setRange] = useTimelineRange()
  const connection = selectedConnection || null

  const microsegPolicy = useMicrosegPolicy(connection)
  const policy = microsegPolicy.data
  const policyId = policy?.policy.id
  // The clusters read: the connection alone, or every linked cluster the user sees on a shared policy.
  const scope = useMemo(() => policyScope(policy?.clusters, connection, connections), [policy?.clusters, connection, connections])
  // The strip's filter, local to the Dashboard and to the policy it was picked on; null shows the whole policy.
  const [picked, setPicked] = useState<{ policyId: string; cluster: string } | null>(null)
  const filter = clusterFilter(picked, policyId, scope)
  const shownKey = shownIds(scope, filter).join('|')
  const shown = useMemo(() => (shownKey ? shownKey.split('|') : NO_IDS), [shownKey])
  // Read once per cluster when the tab shows (this component mounts with it), computed and cached on the server (UA44).
  const coverage = usePolicyCoverage(scope.readIds)
  const remote = useRemotePeers(connection, policy, scope, connections, connectionName)
  // One read of the observed flows for the whole policy (a shared policy answers every cluster's rows, each with its
  // cluster): the shown clusters' rows are kept, a cluster the user cannot see is left out.
  const pending = useMicrosegSuggestions(connection, PENDING_OBSERVED)
  const observed = useMemo(() => shownFlows(pending.data, scope, shown), [pending.data, scope, shown])
  const zoneGuests = useZoneGuests(guestsWanted ? connection : null)
  const guestList = scope.shared ? remote.group : zoneGuests

  const addresses = guestsWanted && guestList.status === 'ready'
  const listsPhase = microsegPhase([microsegPolicy, pending])
  // A grouping by VLAN or node waits for the guests it is made of.
  // A count that adds up the clusters is a total only once every cluster's read answered or failed: until then the
  // guests are held back (the legend says no count, a grouping that is made of them waits), never a partial sum.
  const guestsPending = scope.shared && pendingClusters(shown, coverage).length > 0
  const allGuestsPending = scope.shared && pendingClusters(scope.readIds, coverage).length > 0
  const guestsWait = guestsPending && (!isZoneGrouping(groupBy) || addresses)
  const trafficPhase = listsPhase === 'ready' && ((!isZoneGrouping(groupBy) && guestList.status === 'loading') || guestsWait) ? 'loading' : listsPhase
  const distributionPhase = listsPhase === 'ready' && addresses && guestsPending ? 'loading' : listsPhase
  const byCluster = useMemo(() => guestsByCluster(scope, coverage.byCluster, addresses ? guestList.guests : null), [scope, coverage.byCluster, addresses, guestList.guests])
  const guests = useMemo(() => (guestsPending ? NO_GUESTS : guestsOf(byCluster, shown)), [guestsPending, byCluster, shown])
  const allGuests = useMemo(() => (allGuestsPending ? NO_GUESTS : guestsOf(byCluster, scope.readIds)), [allGuestsPending, byCluster, scope.readIds])
  const posture = usePostureFigures(policy, observed, guests, addresses, groupBy)
  const { timeline, volume, answer, rangeLock, missing: timelineMissing, pending: timelinePending } = useTimelineFigures(
    connection, policy, posture, guests, { groupBy, verdict, addresses, range }, scope, shown, allGuests, filter !== null,
  )
  const { peerOf } = remote
  const conversations = useMemo(() => topConversations(observed ?? [], undefined, peerOf), [observed, peerOf])
  // A shared policy names an address after the guest of any cluster the user sees.
  const named = useMemo(() => {
    if (scope.shared) return remote.group.guests
    return addresses ? zoneGuests.guests : null
  }, [scope.shared, remote.group.guests, addresses, zoneGuests.guests])
  const guestName = useGuestNames(named)
  const answered = microsegPhase([microsegPolicy, answer])
  const timelinePhase = answered === 'ready' && (timelinePending || (guestsPending && !isZoneGrouping(groupBy))) ? 'loading' : answered
  // The rows wait a little for the guests of the other clusters: a pair of a member there is a row of its own.
  const conversationsPhase = listsPhase === 'ready' && remote.waiting ? 'loading' : listsPhase
  // The clusters whose figures are missing (a read that failed): their tile says so, the others are shown.
  const groupErrors = remote.group.errors
  const missing = useMemo(() => (scope.shared
    ? new Set([...Object.keys(coverage.errors), ...timelineMissing, ...(guestsWanted ? Object.keys(groupErrors) : [])])
    : NO_MISSING), [scope.shared, coverage.errors, timelineMissing, guestsWanted, groupErrors])

  const openMicroseg = (subTab?: MicrosegSubTab, asked?: ObservationFocus) => {
    // A shared policy filtered on one cluster: the Observation opens on that cluster, the one these figures are about.
    const focus = filter && subTab === 'observation' ? { ...asked, cluster: filter } : asked
    if (!onOpenMicroseg) onNavigateTab(TAB.microseg)
    else if (focus) onOpenMicroseg(subTab, focus)
    else onOpenMicroseg(subTab)
  }
  const changeGroupBy = (next: GroupBy) => {
    setGroupBy(next)
    if (!isZoneGrouping(next)) setGuestsWanted(true)
  }

  if (!selectedConnection) return <Box sx={{ p: 3 }} />

  return (
    <Box data-testid='dashboard' sx={{ p: 3, flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />

      {/* 0. The clusters of a shared policy, one tile each, that filter the blocks (nothing for a policy of one cluster) */}
      {scope.shared && policy?.clusters && policyId && (
        <Box sx={{ mb: 2.5 }}>
          <ClusterStrip
            connectionId={selectedConnection}
            connectionName={connectionName}
            links={policy.clusters}
            connections={connections}
            selected={filter}
            missing={missing}
            onSelect={cluster => setPicked(cluster ? { policyId, cluster } : null)}
            onOpenDrifts={() => openMicroseg('drifts')}
          />
        </Box>
      )}

      {/* 1. Observed traffic: by zone and its timeline on the left, its distribution and top services on the right */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 2.5, mb: 2.5 }}>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 7' }, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TrafficByZone
            phase={trafficPhase}
            traffic={posture.traffic}
            groupBy={groupBy}
            onGroupBy={changeGroupBy}
            truncated={(pending.data?.length ?? 0) >= POSTURE_SUGGESTIONS_LIMIT}
            addresses={addresses}
            onOpenZone={zoneId => openMicroseg('observation', { zoneId })}
            onOpenUnknown={() => openMicroseg('observation', { source: 'unknown' })}
            footer={<TrafficTimeline fill phase={timelinePhase} timeline={timeline} verdict={verdict} onVerdict={setVerdict} volume={volume} volumeSent={groupBy === 'zone'} range={range} onRange={setRange} rangeLock={rangeLock} />}
          />
        </Box>
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 5' }, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <TrafficDistribution
            phase={distributionPhase}
            distribution={posture.distribution}
            onOpenObserved={kind => openMicroseg('observation', { kind })}
            onOpenUnknown={() => openMicroseg('observation', { source: 'unknown' })}
            onOpenPolicy={() => openMicroseg('policy')}
          />
          <TopServices
            phase={listsPhase}
            rows={posture.services}
            total={posture.servicesTotal}
            onOpenAll={() => openMicroseg('observation')}
            onOpenService={(service, kind) => openMicroseg('observation', { service, kind })}
            onOpenPolicy={() => openMicroseg('policy')}
          />
        </Box>
      </Box>

      {/* 2. Who talks to whom, down to the bottom of the page */}
      <Box sx={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <TopConversations
          phase={conversationsPhase}
          rows={conversations.rows}
          total={conversations.total}
          zones={policy?.zones ?? NO_ZONES}
          guestName={guestName}
          peerCluster={remote.shared ? remote.peerCluster : undefined}
          onOpen={focus => openMicroseg('observation', focus)}
          onOpenAll={() => openMicroseg('observation')}
        />
      </Box>
    </Box>
  )
}
