'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'

import type { TrackedRun } from './microsegTabTypes'

/** The newest runs looked at for one still running: the engine records a few runs a minute, an application lasts minutes at most. */
export const RESUME_LOOKBACK = 100

/**
 * Follows again, when the tab opens, the application or the removal still running on the connection: a page
 * reloaded mid-run, or a run another admin started, shows its line and its progress. One read of the run history,
 * no call to Proxmox. The history does not say which zone or revision the run is about: the line names the plan.
 */
export function useResumeRuns(connectionId: string, connectionName: string, startRun: (run: TrackedRun) => void) {
  const tp = useTranslations('microsegPilot.plan')
  const ts = useTranslations('microsegPilot.settings')
  // Read through a ref: the effect runs once per connection, whatever re-renders hand new functions.
  const latest = useRef({ tp, ts, connectionName, startRun })
  useEffect(() => {
    latest.current = { tp, ts, connectionName, startRun }
  })

  useEffect(() => {
    if (!connectionId) return
    let alive = true
    microsegApi(connectionId).listRuns({ limit: RESUME_LOOKBACK }).then(({ runs }) => {
      if (!alive) return
      const { tp, ts, connectionName, startRun } = latest.current
      for (const run of runs) {
        if (run.status !== 'running') continue
        if (run.kind === 'apply') startRun({ runId: run.id, kind: 'apply', label: tp('applyLabel'), runningText: tp('stripRunning') })
        if (run.kind === 'remove') startRun({ runId: run.id, kind: 'remove', label: connectionName, runningText: ts('remove.running', { label: connectionName }) })
      }
    }).catch(() => undefined)
    return () => { alive = false }
  }, [connectionId])
}
