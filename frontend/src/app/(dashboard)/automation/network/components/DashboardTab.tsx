'use client'

import { useMemo, useState } from 'react'
import { Box } from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useVMFirewallCoverage, type FirewallCoverage } from '@/hooks/useZeroTrust'
import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'
import type { ListSuggestionsParams } from '@/lib/microseg/api'
import type { MicrosegPolicy, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { topConversations } from './dashboardConversations'
import type { BlockPhase } from './dashboardModel'
import {
  GROUP_BYS, POSTURE_SUGGESTIONS_LIMIT, isZoneGrouping, postureDistribution, postureGuests, postureTraffic, topServices, type GroupBy,
} from './dashboardPosture'
import FirewallLoadAlert from './FirewallLoadAlert'
import { TopServices, TrafficDistribution } from './ObservedTraffic'
import TopConversations from './TopConversations'
import TrafficByZone from './TrafficByZone'
import TrafficTimeline from './TrafficTimeline'
import { postureVolume, type TimelineRange, type TimelineVerdict } from './postureTimeline'
import { useTimelineRange } from './useTimelineRange'
import { useTrafficTimeline } from './useTrafficTimeline'
import { useStoredChoice } from './microseg/useStoredChoice'
import { usePostureVolume } from './usePostureVolume'
import type { MicrosegSubTab, ObservationFocus } from './microseg/microsegTabTypes'
import { useZoneGuests } from './microseg/useZoneGuests'
import type { PolicyGuest } from './microseg/zoneModel'

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
      servicesTotal: topServices(seen, flows, Number.POSITIVE_INFINITY).length,
    }
  }, [policy, suggestions, rows, listed, groupBy])
}

const NO_ZONES: MicrosegZone[] = []
const NO_NAME = (): string | undefined => undefined

/** The guest that carries an address, once the guest list is read (a grouping by VLAN or node asked for it). */
function useGuestNames(guests: readonly PolicyGuest[] | null): (ip: string) => string | undefined {
  return useMemo(() => {
    if (!guests) return NO_NAME
    const byIp = new Map<string, string>()
    for (const g of guests) for (const ip of g.ips ?? []) byIp.set(ip, g.name)
    return (ip: string) => byIp.get(ip)
  }, [guests])
}
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
 * The "Posture" Dashboard of /automation/network (UA50): the observed traffic per zone (donut, chords and timeline),
 * its distribution and top services, then the busiest conversations down to the bottom of the page. Its reads: the
 * coverage route (computed and cached on the server; its guests' nodes, tags and VLANs), the micro-segmentation policy and pending flows
 * (orchestrator memory), the events ring for the time chart (orchestrator memory, every minute, only when grouped by VLAN or node or when the history route is not served), the persisted history of the flows for the zone grouping (the range chosen, remembered per browser), the sFlow pairs and
 * time series for its Volume tab (orchestrator and InfluxDB). The guest list (the inventory route, one guest config per guest on Proxmox) is read only once
 * a grouping by VLAN or node asks for it, shared with the zone map.
 */
export default function DashboardTab({
  selectedConnection, loadError, reload, onNavigateTab, onOpenMicroseg,
}: DashboardTabProps) {
  const [groupBy, setGroupBy] = useStoredChoice<GroupBy>(GROUP_BY_KEY, GROUP_BYS, 'zone')
  // Once a grouping by VLAN or node asked for the guests, they stay (a zone grouping then tells the unzoned apart).
  const [guestsWanted, setGuestsWanted] = useState(() => !isZoneGrouping(groupBy))
  const [verdict, setVerdict] = useState<TimelineVerdict>('all')
  const [range, setRange] = useTimelineRange()
  const connection = selectedConnection || null

  // Read once when the tab shows (this component mounts with it), computed and cached on the server (UA44).
  const coverageRead = useVMFirewallCoverage(connection)
  const coverage = coverageRead.data?.computedAt ? coverageRead.data : null
  const microsegPolicy = useMicrosegPolicy(connection)
  const pending = useMicrosegSuggestions(connection, PENDING_OBSERVED)
  const zoneGuests = useZoneGuests(guestsWanted ? connection : null)

  const policy = microsegPolicy.data

  const addresses = guestsWanted && zoneGuests.status === 'ready'
  const listsPhase = microsegPhase([microsegPolicy, pending])
  // A grouping by VLAN or node waits for the guests it is made of.
  const trafficPhase = listsPhase === 'ready' && !isZoneGrouping(groupBy) && zoneGuests.status === 'loading' ? 'loading' : listsPhase
  const posture = usePostureFigures(policy, pending.data, coverage?.guests, addresses ? zoneGuests.guests : null, groupBy)
  const { timeline, volume, answer, rangeLock } = useTimelineFigures(connection, policy, posture, groupBy, verdict, addresses, range)
  const conversations = useMemo(() => topConversations(pending.data ?? []), [pending.data])
  const guestName = useGuestNames(addresses ? zoneGuests.guests : null)
  const timelinePhase = microsegPhase([microsegPolicy, answer])

  const openMicroseg = (subTab?: MicrosegSubTab, focus?: ObservationFocus) => {
    if (!onOpenMicroseg) onNavigateTab(6)
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
            phase={listsPhase}
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
          phase={listsPhase}
          rows={conversations.rows}
          total={conversations.total}
          zones={policy?.zones ?? NO_ZONES}
          guestName={guestName}
          onOpen={focus => openMicroseg('observation', focus)}
          onOpenAll={() => openMicroseg('observation')}
        />
      </Box>
    </Box>
  )
}
