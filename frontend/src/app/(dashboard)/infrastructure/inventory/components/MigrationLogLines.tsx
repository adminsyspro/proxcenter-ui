'use client'

import { useTranslations } from 'next-intl'
import Box from '@mui/material/Box'

import { logClock } from '../migrationLogText'

/**
 * Lines of a migration log, as every migration panel shows them: time, level
 * mark, optional VM name (bulk follow-up), message. A `step` entry (#1000) opens
 * a phase of a warm migration and renders as a section header, so the operator
 * sees at a glance where the run stands (planning, copy, delta, cutover,
 * integrity check, guest conversion, attach).
 */

export interface MigrationLogLine {
  ts: string
  msg: string
  level?: string
  /** Phase opened by a `step` entry; the header is its translation. */
  step?: string
  vmName?: string
}

/** Icon of each phase header. */
export const LOG_STEP_ICONS: Record<string, string> = {
  planning: 'ri-route-line',
  prepare: 'ri-tools-line',
  full_copy: 'ri-file-copy-2-line',
  delta: 'ri-refresh-line',
  cutover: 'ri-shut-down-line',
  verify: 'ri-shield-check-line',
  conversion: 'ri-magic-line',
  finish: 'ri-play-circle-line',
}

const MARK: Record<string, { char: string; color: string }> = {
  success: { char: '✓', color: 'success.main' },
  error: { char: '✗', color: 'error.main' },
  warn: { char: '⚠', color: 'warning.main' },
}

export default function MigrationLogLines({ logs, showVm = false }: Readonly<{ logs: MigrationLogLine[]; showVm?: boolean }>) {
  const t = useTranslations()

  // A known step shows its translated name; an unknown one keeps the engine's English title.
  const stepTitle = (log: MigrationLogLine) =>
    log.step && LOG_STEP_ICONS[log.step] ? t(`inventoryPage.esxiMigration.logSteps.${log.step}`) : log.msg

  // Lines sit under their phase header only when the job announces phases
  // (warm VMware); the other pipelines keep their flat log.
  const hasSteps = logs.some(l => l.level === 'step')

  return (
    <>
      {logs.map((log, i) => {
        const vm = showVm && log.vmName ? `[${log.vmName}] ` : ''
        if (log.level === 'step') {
          return (
            <Box
              key={i}
              data-testid="migration-log-step"
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                mt: i === 0 ? 0 : 1.25, mb: 0.25, pt: i === 0 ? 0 : 0.75,
                borderTop: i === 0 ? 'none' : '1px dashed', borderColor: 'divider',
                color: 'primary.main', fontWeight: 700,
              }}
            >
              <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>{logClock(log.ts)}</Box>
              <Box component="i" className={LOG_STEP_ICONS[log.step || ''] || 'ri-arrow-right-s-line'} sx={{ fontSize: 14 }} />
              <span>{vm}{stepTitle(log)}</span>
            </Box>
          )
        }
        const mark = MARK[log.level || '']
        return (
          <Box key={i} sx={{ pl: hasSteps ? 2 : 0 }}>
            <Box component="span" sx={{ color: 'text.secondary' }}>{logClock(log.ts)}</Box>{' '}
            {mark && <Box component="span" sx={{ color: mark.color }}>{mark.char} </Box>}
            {vm && <Box component="span" sx={{ fontWeight: 700, color: 'text.secondary' }}>{vm}</Box>}
            <Box component="span" sx={{ color: log.level === 'error' ? 'error.main' : 'text.primary' }}>{log.msg}</Box>
          </Box>
        )
      })}
    </>
  )
}
