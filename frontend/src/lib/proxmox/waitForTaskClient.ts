// src/lib/proxmox/waitForTaskClient.ts
//
// Browser-side counterpart of src/lib/proxmox/tasks.ts (waitForTask). Server
// code talks to PVE directly; the browser goes through our task-status API
// route instead. Used by UI code that fired off a long-running PVE call
// (snapshot delete/create/rollback, ...) and wants to know the actual task
// result before claiming success to the user.
//
// GET /api/v1/tasks/{connId}/{node}/{upid} returns a bare object with:
//   - status === 'running'   → still in progress, retry after a delay
//   - status === 'stopped'   → terminal; exitstatus tells us OK vs error

export type PveTaskOutcome = 'ok' | 'failed' | 'timeout' | 'abandoned'

export interface WaitForPveTaskResult {
  outcome: PveTaskOutcome
  /** PVE exitstatus when outcome === 'failed'; '' when PVE gave no detail. */
  error?: string
}

export interface WaitForPveTaskOptions {
  /** Polling interval in ms. Default 2000. */
  intervalMs?: number
  /** Total budget in ms before giving up. Default 600_000 (10 min, matches waitForTask). */
  timeoutMs?: number
  /**
   * Checked before every poll. Return false to stop following (e.g. the user
   * navigated to another VM) — the caller then knows not to touch its state.
   */
  shouldContinue?: () => boolean
}

/**
 * Poll a PVE task through the task-status API route until it finishes.
 * Never throws: transient problems (HTTP errors, network blips, unparsable
 * bodies) are swallowed and retried until the time budget runs out, so a
 * single blip cannot abort the follow.
 */
export async function waitForPveTask(
  connId: string,
  node: string,
  upid: string,
  options: WaitForPveTaskOptions = {},
): Promise<WaitForPveTaskResult> {
  const intervalMs = options.intervalMs ?? 2_000
  const timeoutMs = options.timeoutMs ?? 600_000
  const url =
    `/api/v1/tasks/${encodeURIComponent(connId)}` +
    `/${encodeURIComponent(node)}/${encodeURIComponent(upid)}`
  const start = Date.now()

  for (;;) {
    if (options.shouldContinue?.() === false) return { outcome: 'abandoned' }

    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const status = await res.json()
        if (status?.status === 'stopped') {
          if (status.exitstatus === 'OK') return { outcome: 'ok' }
          return { outcome: 'failed', error: status.exitstatus || '' }
        }
      }
      // Non-ok HTTP responses fall through to the retry below.
    } catch {
      // Network error or unparsable JSON: retry until the budget runs out.
    }

    if (Date.now() - start >= timeoutMs) return { outcome: 'timeout' }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
