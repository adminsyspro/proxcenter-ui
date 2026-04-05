'use client'

import { Chip, alpha } from '@mui/material'

import type { FirewallRule } from './types'

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */

export const LOG_LEVELS = ['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']

export const MONO_STYLE = { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: 13 }

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER COMPONENTS
═══════════════════════════════════════════════════════════════════════════ */

export const ActionChip = ({ action }: { action: string }) => {
  const colors: Record<string, string> = { ACCEPT: '#22c55e', DROP: '#ef4444', REJECT: '#f59e0b' }
  const color = colors[action] || '#94a3b8'


return (
    <Chip
      size="small"
      label={action}
      sx={{
        height: 22,
        fontSize: 11,
        fontWeight: 700,
        bgcolor: alpha(color, 0.15),
        color,
        border: `1px solid ${alpha(color, 0.3)}`,
        minWidth: 70
      }}
    />
  )
}

export const PolicyChip = ({ policy }: { policy: string }) => {
  const color = policy === 'DROP' ? '#ef4444' : policy === 'REJECT' ? '#f59e0b' : '#22c55e'


return (
    <Chip
      size="small"
      label={policy}
      sx={{
        height: 26,
        fontSize: 12,
        fontWeight: 700,
        bgcolor: alpha(color, 0.15),
        color
      }}
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPER FUNCTIONS
═══════════════════════════════════════════════════════════════════════════ */

export function normalizeRules(rulesData: any[]): FirewallRule[] {
  return (Array.isArray(rulesData) ? rulesData : []).map((rule: any) => ({
    ...rule,
    enable: rule.enable === 1 || rule.enable === '1' ? 1 : 0
  }))
}

export function formatService(rule: FirewallRule): string {
  if (rule.type === 'group') return '-'
  if (rule.macro) return rule.macro
  const proto = rule.proto?.toUpperCase() || ''
  const port = rule.dport || ''
  if (!proto && !port) return 'any'
  if (proto && port) return `${proto}/${port}`
  return proto || port
}

/** Clean source/dest before sending to Proxmox: "any" is not a valid alias */
export function cleanSourceDest(value: string | undefined): string {
  if (!value || value.trim().toLowerCase() === 'any') return ''
  return value.trim()
}
