'use client'

import { paletteAlpha } from './paletteAlpha'
import { Box, Button, Paper, Skeleton, Stack, Tooltip, Typography, alpha, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { STATE_AMBER, STATE_GREEN, STATE_RED } from './dashboardColors'
import type { BlockPhase, TodoItem, TodoKind } from './dashboardModel'

/** Where each line leads. */
export type TodoActions = Record<TodoKind, () => void>

type Props = {
  phase: BlockPhase
  items: TodoItem[]
  actions: TodoActions
}

const SEVERITY: Record<TodoKind, string> = {
  stopHeld: STATE_RED,
  firewallOff: STATE_RED,
  managementRules: STATE_AMBER,
  policyIn: STATE_AMBER,
  unprotected: STATE_AMBER,
  unzoned: STATE_AMBER,
  pendingFlows: STATE_AMBER,
}

const ICON: Record<TodoKind, string> = {
  stopHeld: 'ri-alarm-warning-line',
  firewallOff: 'ri-shield-cross-line',
  managementRules: 'ri-key-2-line',
  policyIn: 'ri-arrow-down-line',
  unprotected: 'ri-computer-line',
  unzoned: 'ri-shape-line',
  pendingFlows: 'ri-eye-line',
}

const ACTION: Record<TodoKind, string> = {
  stopHeld: 'todoResume',
  firewallOff: 'todoOpenWizard',
  managementRules: 'todoOpenWizard',
  policyIn: 'todoOpenOptions',
  unprotected: 'todoShowThem',
  unzoned: 'todoOpenDrifts',
  pendingFlows: 'todoOpenObservation',
}

function useLineText() {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()

  return (item: TodoItem): string => {
    switch (item.kind) {
      case 'stopHeld': return t('stopHeldTitle')
      case 'firewallOff': return t('todoFirewallOff')
      case 'managementRules': {
        const ports = (item.ports ?? []).map(String)
        // "ports 8006 and 22", in the words of the locale.
        return t('todoManagementRules', { count: ports.length, ports: format.list(ports, { type: 'conjunction' }) })
      }
      case 'policyIn': return t('todoPolicyIn')
      case 'unprotected': return t('todoUnprotected', { count: item.count ?? 0 })
      case 'unzoned': return t('todoUnzoned', { count: item.count ?? 0 })
      default: return item.more ? t('todoPendingFlowsMore', { count: item.count ?? 0 }) : t('todoPendingFlows', { count: item.count ?? 0 })
    }
  }
}

/**
 * The "To do" list of the Dashboard: one line per thing to act on, icon first, the line in one row, and the button
 * that leads to it. "Nothing to do" when clean, a skeleton while the figures it is made of are not in.
 */
export default function DashboardTodo({ phase, items, actions }: Props) {
  const t = useTranslations('networkPage.dashboard')
  const theme = useTheme()
  const text = useLineText()

  let body: React.ReactNode
  if (phase === 'loading') {
    body = (
      <Stack spacing={1} data-testid='todo-loading'>
        <Skeleton variant='rounded' height={40} />
        <Skeleton variant='rounded' height={40} />
      </Stack>
    )
  } else if (phase === 'unavailable') {
    body = <Typography variant='body2' color='text.secondary' data-testid='todo-unavailable'>{t('todoUnavailable')}</Typography>
  } else if (items.length === 0) {
    body = (
      <Box data-testid='todo-empty' sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
        <i className='ri-checkbox-circle-line' style={{ fontSize: 20, color: STATE_GREEN }} />
        <Typography variant='body2' sx={{ fontWeight: 600 }}>{t('todoNothing')}</Typography>
      </Box>
    )
  } else {
    body = (
      <Stack spacing={1}>
        {items.map(item => {
          const color = SEVERITY[item.kind]
          const line = text(item)
          return (
            <Box
              key={item.kind}
              data-testid={`todo-${item.kind}`}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75, borderRadius: 1.5, bgcolor: alpha(color, 0.08), border: `1px solid ${alpha(color, 0.25)}`, minWidth: 0 }}
            >
              <i className={ICON[item.kind]} style={{ fontSize: 18, color, flexShrink: 0 }} aria-hidden />
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
              <Tooltip title={line}>
                <Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{line}</Typography>
              </Tooltip>
              <Button size='small' variant='outlined' onClick={actions[item.kind]} sx={{ flexShrink: 0 }} endIcon={<i className='ri-arrow-right-line' />}>
                {t(ACTION[item.kind])}
              </Button>
            </Box>
          )
        })}
      </Stack>
    )
  }

  return (
    <Paper data-testid='todo-card' sx={{ p: 2.5, border: `1px solid ${paletteAlpha(theme, 'divider', 0.1)}` }}>
      <Typography variant='subtitle2' sx={{ fontWeight: 700, color: 'text.secondary', mb: 1.5 }}>{t('todoTitle')}</Typography>
      {body}
    </Paper>
  )
}
