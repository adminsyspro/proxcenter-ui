import type { FirewallRule } from '@/lib/api/firewall'

/**
 * Whether a rule is active. PVE always sends `enable` as 0 or 1, but the
 * orchestrator's `omitempty` drops the 0, so a disabled rule arrives with no
 * `enable` at all: only an explicit 1 means on (#1015).
 */
export function isRuleEnabled(rule: Pick<FirewallRule, 'enable'>): boolean {
  return Number(rule.enable) === 1
}
