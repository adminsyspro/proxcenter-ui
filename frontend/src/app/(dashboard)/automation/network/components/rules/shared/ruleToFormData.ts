import type { FirewallRule } from '@/lib/api/firewall'
import { DEFAULT_LOG_LEVEL } from '@/components/firewall/logLevels'

import type { RuleFormData } from '../RuleFormDialog'
import { isRuleEnabled } from './isRuleEnabled'

/** Pre-fills a rule edit form from an existing rule, keeping a disabled rule disabled. */
export function ruleToFormData(rule: FirewallRule): RuleFormData {
  return {
    type: rule.type || 'in', action: rule.action || 'ACCEPT', enable: isRuleEnabled(rule) ? 1 : 0,
    proto: rule.proto || '', dport: rule.dport || '', sport: rule.sport || '',
    source: rule.source || '', dest: rule.dest || '', macro: rule.macro || '',
    iface: rule.iface || '', log: rule.log || DEFAULT_LOG_LEVEL, comment: rule.comment || '',
  }
}
