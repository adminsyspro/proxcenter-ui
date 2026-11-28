'use client'

import { useCallback, useRef, useState } from 'react'

import { sendCephTask, type CephProvisionResult } from '@/lib/ceph/provisionClient'
import { waitForPveTask } from '@/lib/proxmox/waitForTaskClient'

/*
   Send one Ceph provisioning call and follow the PVE task it started
   (ui#1450). A call answered 200 only says PVE accepted it: the pool, the OSD
   or the initialization can still fail in the task, so success is the task
   ending OK. A second run while one is under way is ignored (double click).
*/

export type CephTaskPhase = 'idle' | 'sending' | 'following'

export interface CephTaskFailure {
  /** The route refused the call (its error and details), or the task failed (reason). */
  message: string
  /** The PVE task itself failed (message = its reason). */
  task?: boolean
  /** The task was still running when the follow gave up: it may yet succeed. */
  timeout?: boolean
  result?: CephProvisionResult
}

export type CephTaskOutcome =
  | { ok: true; result: CephProvisionResult }
  | { ok: false; failure: CephTaskFailure }
  | { ok: null }

/** Ten minutes, like waitForPveTask's own budget: OSD creation on a large disk takes a while. */
const FOLLOW_BUDGET_MS = 600_000

export function useCephTask(connId: string) {
  const [phase, setPhase] = useState<CephTaskPhase>('idle')
  const [failure, setFailure] = useState<CephTaskFailure | null>(null)
  const running = useRef(false)

  const run = useCallback(async (url: string, method: 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<CephTaskOutcome> => {
    if (running.current) return { ok: null }
    running.current = true
    setFailure(null)
    setPhase('sending')
    try {
      const result = await sendCephTask(url, method, body)
      if (!result.ok) {
        const f = { message: result.error || `HTTP ${result.status}`, result }
        setFailure(f)
        return { ok: false, failure: f }
      }
      if (!result.upid || !result.node) return { ok: true, result }

      setPhase('following')
      const task = await waitForPveTask(connId, result.node, result.upid, { timeoutMs: FOLLOW_BUDGET_MS })
      if (task.outcome === 'ok') return { ok: true, result }
      const f: CephTaskFailure = task.outcome === 'failed'
        ? { message: task.reason || task.error || '', task: true, result }
        : { message: '', timeout: true, result }
      setFailure(f)
      return { ok: false, failure: f }
    } finally {
      running.current = false
      setPhase('idle')
    }
  }, [connId])

  const clear = useCallback(() => setFailure(null), [])

  return { phase, busy: phase !== 'idle', failure, run, clear }
}
