import type { MicrosegPolicy } from '@/lib/microseg/types'

export const MICROSEG_SUBTABS = ['overview', 'policy', 'observation', 'drifts', 'history'] as const

export type MicrosegSubTab = (typeof MICROSEG_SUBTABS)[number]

export function isMicrosegSubTab(value: unknown): value is MicrosegSubTab {
  return typeof value === 'string' && (MICROSEG_SUBTABS as readonly string[]).includes(value)
}

/** What MicrosegTab hands to the content of each sub-tab. */
export type MicrosegSubTabProps = {
  connectionId: string
  policy: MicrosegPolicy
  /** Re-reads the draft (after a write, or on a VERSION_CONFLICT). */
  reloadPolicy: () => Promise<unknown>
  goToSubTab: (tab: MicrosegSubTab) => void
  /** Undefined until the plan view is wired: buttons that open it must be disabled. */
  onOpenPlan?: () => void
}
