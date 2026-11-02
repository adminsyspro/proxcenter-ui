import type { MicrosegPolicy } from '@/lib/microseg/types'

export const MICROSEG_SUBTABS = ['overview', 'policy', 'observation', 'drifts', 'history'] as const

export type MicrosegSubTab = (typeof MICROSEG_SUBTABS)[number]

export function isMicrosegSubTab(value: unknown): value is MicrosegSubTab {
  return typeof value === 'string' && (MICROSEG_SUBTABS as readonly string[]).includes(value)
}

/** A run followed in the strip under the banner, whatever sub-tab is shown. */
export type TrackedRun = {
  runId: string
  /** What started it ("zoneState" today; the plan and apply runs of the plan window reuse the strip). */
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
  goToSubTab: (tab: MicrosegSubTab) => void
  /** Opens the plan window (computes the plan, then applies it). */
  onOpenPlan: () => void
  /** Follow a run in the strip under the banner; the policy and the status are refreshed when it ends. */
  startRun: (run: TrackedRun) => void
}
