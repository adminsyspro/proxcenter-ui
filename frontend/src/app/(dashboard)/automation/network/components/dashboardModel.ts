import type { FirewallCoverage } from '@/hooks/useZeroTrust'

export type CoverageFigures = Pick<FirewallCoverage, 'enabled' | 'disabled' | 'unknown' | 'measured' | 'total'>

/** Share of the guests told apart that are filtered; null when none could be told. Unknown guests are left out. */
export function coveragePercent(c: CoverageFigures | null | undefined): number | null {
  if (!c) return null
  const known = c.enabled + c.disabled

  return known > 0 ? (c.enabled / known) * 100 : null
}

export type RecommendationKind = 'stopHeld' | 'firewallOff' | 'policyIn' | 'vms' | 'ok'

/**
 * The Zero Trust recommendations, in order. While the emergency stop holds the cluster firewall off, that is said
 * instead of "enable the firewall": switching it on by hand would undo the stop.
 */
export function recommendationKinds(input: {
  firewallOn: boolean
  stopHoldsFirewall: boolean
  policyIn: string
  unprotected: number
}): RecommendationKind[] {
  const kinds: RecommendationKind[] = []

  if (input.stopHoldsFirewall) kinds.push('stopHeld')
  else if (!input.firewallOn) kinds.push('firewallOff')
  if (input.policyIn !== 'DROP') kinds.push('policyIn')
  if (input.unprotected > 0) kinds.push('vms')

  return kinds.length > 0 ? kinds : ['ok']
}

/** What each block of the Dashboard can show: figures, a skeleton, or "not available". */
export type DashboardPhase = { hero: 'unavailable' | 'loading' | 'ready'; advice: 'unavailable' | 'loading' | 'ready' }

/**
 * One neutral skeleton while the figures are not all in, never a score or advice made of empty data: the hero waits for
 * the firewall data and the coverage, and "enable the firewall" waits for the stop state too, since the emergency stop
 * may be what holds it off.
 */
export function dashboardPhase(input: {
  connection: boolean
  firewallLoading: boolean
  loadError: boolean
  coverageIn: boolean
  coverageFailed: boolean
  firewallOn: boolean
  stopStateIn: boolean
}): DashboardPhase {
  if (input.loadError || input.coverageFailed) return { hero: 'unavailable', advice: 'unavailable' }
  if (!input.connection) return { hero: 'ready', advice: 'ready' }
  const heroLoading = input.firewallLoading || !input.coverageIn
  const adviceLoading = heroLoading || (!input.firewallOn && !input.stopStateIn)

  return { hero: heroLoading ? 'loading' : 'ready', advice: adviceLoading ? 'loading' : 'ready' }
}
