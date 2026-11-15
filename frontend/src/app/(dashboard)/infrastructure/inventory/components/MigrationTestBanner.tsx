'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Button, CircularProgress, LinearProgress, Typography } from '@mui/material'

import {
  isTestActive, MIGRATION_TEST_STEP_INDEX, readTestState, type MigrationTestStep,
} from '@/lib/migration/warm/migration-test-state'
import { formatBytes } from '@/utils/format'

import { isTerminalJobStatus } from '../bulkJobList'
import ConsolePreview from './ConsolePreview'

type BannerJob = {
  id: string
  status: string
  targetConnectionId?: string | null
  targetNode?: string | null
  testRequest?: unknown
  testState?: unknown
}

const STEP_LABEL_KEYS: Record<MigrationTestStep, string> = {
  checks: 'testStepChecks',
  conversion: 'testStepConversion',
  overlay: 'testStepOverlay',
  boot: 'testStepBoot',
}

/** A test duration as the banner says it: "12 min", "4 h", "1 h 05 min". */
export function formatTestDuration(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')} min`
}

/** The time a preparation has been running, as a clock: "0:05", "1:15". */
export function formatTestClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Re-render every second while `on`, so the times the banner shows move. */
function useSecondTick(on: boolean): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [on])
  return tick
}

/**
 * The test of a waiting warm migration while it runs, in the migrate dialog:
 * where it stands with a bar, the screen of the test VM, its console and its
 * stop. The cutover waits for its end.
 */
export default function MigrationTestBanner({ job }: Readonly<{ job: BannerJob }>) {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const state = readTestState(job.testState)
  const visible = !isTerminalJobStatus(job.status) && isTestActive(job)
  useSecondTick(visible)
  if (!visible) return null
  const k = (key: string, values?: Record<string, string | number>) => t(`inventoryPage.esxiMigration.${key}`, values)

  const phase = state?.phase ?? 'requested'
  const runningVmid = phase === 'running' ? state?.testVmid : undefined
  const running = runningVmid !== undefined && runningVmid > 0
  const hasScreen = running && !!job.targetConnectionId && !!job.targetNode
  let text: string
  let time: string | null = null
  // null = a moving bar: the step has no measurable progress.
  let percent: number | null = null
  if (phase === 'stopping') text = k('testStopping')
  else if (phase === 'requested') text = k('testRequested')
  else if (runningVmid && state?.startedAt && state.endsAt) {
    const started = Date.parse(state.startedAt)
    const total = Date.parse(state.endsAt) - started
    const elapsed = Math.max(0, Date.now() - started)
    text = k('testRunning', { size: formatBytes(state.overlayBytes ?? 0, 0), vmid: runningVmid })
    time = `${formatTestDuration(elapsed / 1000)} / ${formatTestDuration(total / 1000)}`
    percent = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0
  } else {
    const step = state?.step ?? 'checks'
    text = k('testPreparing', { step: MIGRATION_TEST_STEP_INDEX[step], label: k(STEP_LABEL_KEYS[step]) })
    if (state?.preparingSince) time = formatTestClock((Date.now() - Date.parse(state.preparingSince)) / 1000)
  }

  const openConsole = () => {
    const url = `/novnc/console.html?connId=${encodeURIComponent(job.targetConnectionId || '')}&type=qemu&node=${encodeURIComponent(job.targetNode || '')}&vmid=${encodeURIComponent(String(runningVmid))}`
    window.open(url, `console-${runningVmid}`, 'width=1024,height=768,menubar=no,toolbar=no,location=no,status=no')
  }

  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/migrations/${encodeURIComponent(job.id)}/test`, { method: 'DELETE' })
      const payload = await res.json().catch(() => null)
      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  // The left column of the migrate dialog is narrow: the screen of the test
  // VM on the left once it runs (above the rest when the column is too
  // narrow); the state on its own line, the bar under it, then the two
  // actions with the time on the right, wrapping rather than overflowing.
  return (
    <Alert severity="info" icon={<i className="ri-flask-line" />} data-testid="migration-test-banner" sx={{ '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-start' }}>
        {hasScreen && (
          <Box data-testid="migration-test-screen" sx={{ width: 168, flexShrink: 0 }}>
            <ConsolePreview height={105} connId={job.targetConnectionId ?? undefined} node={job.targetNode ?? undefined} type="qemu" vmid={String(runningVmid)} vmStatus="running" />
          </Box>
        )}
        <Box sx={{ flex: '1 1 220px', minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontSize: 13 }}>{text}</Typography>
          <LinearProgress
            color="info"
            aria-label={text}
            variant={percent === null ? 'indeterminate' : 'determinate'}
            {...(percent === null ? {} : { value: percent })}
            sx={{ mt: 0.75, height: 6, borderRadius: 3 }}
          />
          {(running || phase !== 'stopping' || time !== null) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, mt: 0.75, ml: -0.75 }}>
              {running && (
                <Button size="small" color="inherit" startIcon={<i className="ri-terminal-box-line" />} onClick={openConsole} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                  {k('testConsole')}
                </Button>
              )}
              {phase !== 'stopping' && (
                <Button size="small" color="inherit" disabled={busy} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <i className="ri-stop-circle-line" />} onClick={stop} sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}>
                  {k('testStop')}
                </Button>
              )}
              {time && <Typography variant="body2" sx={{ fontSize: 13, ml: 'auto', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{time}</Typography>}
            </Box>
          )}
          {error && <Typography variant="caption" color="error" sx={{ display: 'block' }}>{error}</Typography>}
        </Box>
      </Box>
    </Alert>
  )
}
