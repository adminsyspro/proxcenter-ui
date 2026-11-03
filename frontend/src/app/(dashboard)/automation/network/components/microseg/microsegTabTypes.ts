import type { ClusterOptions, FirewallMode, FirewallRule } from '@/lib/api/firewall'
import type { MicrosegPolicy } from '@/lib/microseg/types'

export const MICROSEG_SUBTABS = ['overview', 'policy', 'observation', 'drifts', 'history'] as const

export type MicrosegSubTab = (typeof MICROSEG_SUBTABS)[number]

export function isMicrosegSubTab(value: unknown): value is MicrosegSubTab {
  return typeof value === 'string' && (MICROSEG_SUBTABS as readonly string[]).includes(value)
}

/** A run followed in the strip under the banner, whatever sub-tab is shown. */
export type TrackedRun = {
  runId: string
  /** What started it: "zoneState" (Policy), "apply" (plan window), "restore" (History) or "remove" (Settings). */
  kind: string
  /** Names the run in its finished messages (a zone name, "Plan"...). */
  label: string
  /** The translated line shown while it runs. */
  runningText: string
}

/** What MicrosegTab hands to the content of each sub-tab. */
export type MicrosegSubTabProps = {
  connectionId: string
  policy: MicrosegPolicy
  /** Re-reads the draft (after a write, or on a VERSION_CONFLICT). */
  reloadPolicy: () => Promise<unknown>
  /** Opens a sub-tab; the Drifts sub-tab can open on one zone's drifts. */
  goToSubTab: (tab: MicrosegSubTab, options?: { zoneId?: string }) => void
  /** The zone the Drifts sub-tab is filtered on (opened from a zone panel), null for every drift. */
  driftsZone?: string | null
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
}

/** What the deployment wizard (opened from a failed pre-flight check) needs from the firewall page. */
export type FirewallWizardData = {
  clusterOptions: ClusterOptions | null
  clusterRules: FirewallRule[]
  nodesList: string[]
  firewallMode: FirewallMode
  /** The page reloads its firewall data once the wizard has written. */
  onComplete: () => void
}
