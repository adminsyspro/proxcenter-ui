'use client'

// The terminal icon of a rule row: opens the firewall log narrowed to that
// rule (ui#1114). A rule at nolog writes nothing, so its button is disabled
// and says why; a group reference always logs through its group's rules.

import { useTranslations } from 'next-intl'
import { IconButton, Tooltip } from '@mui/material'

import type { FirewallRule } from '@/lib/api/firewall'

export function ruleLogs(rule: Pick<FirewallRule, 'type' | 'log'>): boolean {
  return rule.type === 'group' || (!!rule.log && rule.log !== 'nolog')
}

export default function RuleLogsButton({ rule, onClick }: { rule: Pick<FirewallRule, 'type' | 'log'>; onClick: () => void }) {
  const t = useTranslations()
  const enabled = ruleLogs(rule)

  return (
    <Tooltip title={enabled ? t('firewallLog.ruleLogs') : t('firewallLog.ruleNoLog')}>
      {/* The span keeps the tooltip alive on a disabled button. */}
      <span>
        <IconButton size="small" aria-label={t('firewallLog.ruleLogs')} onClick={onClick} disabled={!enabled}>
          <i className="ri-terminal-box-line" style={{ fontSize: 14 }} />
        </IconButton>
      </span>
    </Tooltip>
  )
}
