import type { ClusterOptions, FirewallMode, FirewallRule } from '@/lib/api/firewall'
import type { GroupRun, MicrosegPolicy, SuggestionKind } from '@/lib/microseg/types'

export const MICROSEG_SUBTABS = ['overview', 'policy', 'observation', 'drifts', 'history'] as const

export type MicrosegSubTab = (typeof MICROSEG_SUBTABS)[number]

export function isMicrosegSubTab(value: unknown): value is MicrosegSubTab {
  return typeof value === 'string' && (MICROSEG_SUBTABS as readonly string[]).includes(value)
}

/** A service of the Dashboard: its name and what it is made of ("SSH" is tcp/22 and udp/22). */
export type ObservedService = { label: string; tokens: string[] }

/**
 * What the Observation sub-tab opens filtered on, from a figure of the Dashboard: a type of flow, a service, a zone,
 * or the flows whose source is in no zone; `cluster`, on a shared policy, the cluster the Dashboard was showing.
 */
export type ObservationFocus = { kind?: SuggestionKind; service?: ObservedService; zoneId?: string; source?: 'unknown'; cluster?: string }

/** A run followed in the strip under the banner, whatever sub-tab is shown. */
export type TrackedRun = {
  runId: string
  /** What started it: "zoneState" (Policy), "apply" (plan window), "restore" (History) or "remove" (Settings). */
  kind: string
  /** Names the run in its finished messages (a zone name, "Plan"...). */
  label: string
  /** The translated line shown while it runs. */
  runningText: string
  /** The zone whose state the run changes: its card says so while the run goes on. */
  zoneId?: string
  /**
   * The run of each cluster when the action was started on several clusters of a shared policy (or on another cluster
   * than the tab's), each followed through its own cluster. Absent: `runId` is a run of the tab's connection.
   */
  runs?: GroupRun[]
}

/** What MicrosegTab hands to the content of each sub-tab. */
export type MicrosegSubTabProps = {
  connectionId: string
  policy: MicrosegPolicy
  /** Re-reads the draft (after a write, or on a VERSION_CONFLICT). */
  reloadPolicy: () => Promise<unknown>
  /** Opens a sub-tab; the Drifts and Observation sub-tabs can open on one zone. */
  goToSubTab: (tab: MicrosegSubTab, options?: { zoneId?: string }) => void
  /** The zone the Drifts sub-tab is filtered on (opened from a zone panel), null for every drift. */
  driftsZone?: string | null
  /** The zone the Observation sub-tab opens filtered on (from a Policy zone group), null for every zone. */
  observationZone?: string | null
  /** The type of flow and the service the Observation sub-tab opens filtered on (from the Dashboard). */
  observationFocus?: ObservationFocus | null
  /** Opens the plan window (computes the plan, then applies it). */
  onOpenPlan: () => void
  /** Follow a run in the strip under the banner; the policy and the status are refreshed when it ends. */
  startRun: (run: TrackedRun) => void
  /** Opens the Settings of the tab (Observation links to it); the link is disabled when absent. */
  onOpenSettings?: () => void
  /** Opens the pre-flight checks. */
  onOpenPreflight?: () => void
  /** The VMID of a `?vm=` link, handed by the page: the Overview targets that guest. */
  targetVm?: string | null
  /** The Proxmox nodes of the connection, when the page knows them: the node view of the map draws the empty ones too. */
  pveNodes?: string[]
  /** The status of those nodes ("online"...), when the page knows it. */
  pveNodeStatus?: Record<string, string>
  /**
   * The smallest connection ID of the group sharing the policy, the same from every cluster of the group: SWR keys
   * of group-wide reads are built from it. Undefined while the group is still read, so no key is built before.
   */
  anchor?: string
  /** The clusters sharing the policy, sorted; the connection alone for a policy that is not shared. */
  clusterIds?: string[]
  /** The name of a cluster of the group, as the user sees it. */
  clusterName?: (id: string) => string
}

/** What the deployment wizard (opened from a failed pre-flight check) needs from the firewall page. */
export type FirewallWizardData = {
  clusterOptions: ClusterOptions | null
  clusterRules: FirewallRule[]
  nodesList: string[]
  /** The status of the nodes ("online"...); the wizard does not read it, the node view of the map does. */
  nodeStatus?: Record<string, string>
  firewallMode: FirewallMode
  /** The page reloads its firewall data once the wizard has written. */
  onComplete: () => void
}
