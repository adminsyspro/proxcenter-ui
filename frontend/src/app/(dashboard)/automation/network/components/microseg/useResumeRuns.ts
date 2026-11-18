'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { GroupRun, MicrosegRun } from '@/lib/microseg/types'

import { shownClusterName } from './ClusterRunRow'
import type { TrackedRun } from './microsegTabTypes'

/** The newest runs looked at for one still running: the engine records a few runs a minute, an application lasts minutes at most. */
export const RESUME_LOOKBACK = 100

/** The clusters sharing the policy, as `useMicrosegGroup` reads them. */
export type ResumeGroup = {
  ids: readonly string[]
  /** True until the group has answered: nothing is resumed before (the group decides which clusters are read). */
  loading: boolean
  /** The name of a cluster of the group, for a removal running on another cluster. */
  clusterName?: (id: string) => string
}

/**
 * Follows again, when the tab opens, the application or the removal still running on any cluster of the group: a page
 * reloaded mid-run, or a run another admin started, shows its line and its progress. One read of the run history per
 * cluster, through that cluster, no call to Proxmox. The applications running on several clusters are one group
 * action (the backend runs one at a time): they share one line, keyed by the run of the opened connection. A policy
 * that is not shared reads its connection alone and resumes its runs exactly as before. The history does not say
 * which zone or revision the run is about: the line names the plan.
 */
export function useResumeRuns(connectionId: string, connectionName: string, startRun: (run: TrackedRun) => void, group?: ResumeGroup) {
  const tp = useTranslations('microsegPilot.plan')
  const ts = useTranslations('microsegPilot.settings')
  // Read through a ref: the effect runs once per group, whatever re-renders hand new functions.
  const latest = useRef({ tp, ts, connectionName, startRun, clusterName: group?.clusterName })
  useEffect(() => {
    latest.current = { tp, ts, connectionName, startRun, clusterName: group?.clusterName }
  })

  const waiting = !!group?.loading
  const idsKey = (group?.ids.length ? group.ids : [connectionId]).join('\n')

  useEffect(() => {
    if (!connectionId || waiting) return
    let alive = true
    const ids = idsKey.split('\n')
    void Promise.allSettled(ids.map(id => microsegApi(id).listRuns({ limit: RESUME_LOOKBACK }))).then(answers => {
      if (!alive) return
      const { tp, ts, connectionName, startRun, clusterName } = latest.current
      if (ids.length === 1) {
        // A policy that is not shared: every running application or removal of the connection, as before.
        if (answers[0].status !== 'fulfilled') return
        for (const run of answers[0].value.runs) {
          if (run.status !== 'running') continue
          if (run.kind === 'apply') startRun({ runId: run.id, kind: 'apply', label: tp('applyLabel'), runningText: tp('stripRunning') })
          if (run.kind === 'remove') startRun({ runId: run.id, kind: 'remove', label: connectionName, runningText: ts('remove.running', { label: connectionName }) })
        }
        return
      }
      const running = (kind: string) => ids.flatMap((id, i) => {
        const answer = answers[i]
        if (answer.status !== 'fulfilled') return []
        return answer.value.runs.filter((r: MicrosegRun) => r.status === 'running' && r.kind === kind).map(r => ({ connectionId: id, run: r }))
      })

      const applies = running('apply')
      if (applies.length > 0) {
        const onTab = applies.find(a => a.connectionId === connectionId)
        const runs: GroupRun[] = applies.map(a => ({ connection_id: a.connectionId, run_id: a.run.id }))
        const only = applies.length === 1 && onTab
        startRun({ runId: (onTab ?? applies[0]).run.id, kind: 'apply', label: tp('applyLabel'), runningText: tp('stripRunning'), ...(only ? {} : { runs }) })
      }

      for (const { connectionId: id, run } of running('remove')) {
        const label = id === connectionId ? connectionName : shownClusterName(id, connectionId, clusterName, tp('cluster.other'))
        startRun({ runId: run.id, kind: 'remove', label, runningText: ts('remove.running', { label }), ...(id === connectionId ? {} : { runs: [{ connection_id: id, run_id: run.id }] }) })
      }
    })
    return () => { alive = false }
  }, [connectionId, idsKey, waiting])
}
