// src/lib/guestFileRestore/registry.ts
//
// In-memory state of the jobs this process is running: the abort controller
// of each one and the concurrency gate. Lives on globalThis because Next dev
// hands a route compiled after a background task its own copy of every
// module; the cancel route must find the controller the runner created.

const REGISTRY_KEY = Symbol.for('proxcenter.guestFileRestore.registry')

export interface ActiveJob {
  controller: AbortController
  state: 'queued' | 'running'
}

interface Waiter {
  jobId: string
  max: number
  resolve: () => void
  reject: (err: Error) => void
}

interface Registry {
  jobs: Map<string, ActiveJob>
  running: number
  waiters: Waiter[]
}

export function registry(): Registry {
  const g = globalThis as unknown as Record<symbol, Registry | undefined>
  let reg = g[REGISTRY_KEY]
  if (!reg) {
    reg = { jobs: new Map(), running: 0, waiters: [] }
    g[REGISTRY_KEY] = reg
  }
  return reg
}

export function registerJob(jobId: string): ActiveJob {
  const entry: ActiveJob = { controller: new AbortController(), state: 'queued' }
  registry().jobs.set(jobId, entry)
  return entry
}

export function unregisterJob(jobId: string): void {
  registry().jobs.delete(jobId)
}

export function isJobActive(jobId: string): boolean {
  return registry().jobs.has(jobId)
}

export function activeJobState(jobId: string): ActiveJob['state'] | null {
  return registry().jobs.get(jobId)?.state ?? null
}

/** Abort a job of this process. False when it is not running here (stale row or other replica). */
export function abortJob(jobId: string): boolean {
  const entry = registry().jobs.get(jobId)
  if (!entry) return false
  entry.controller.abort(new Error('Cancelled'))
  return true
}

/**
 * Wait for a run slot. A job beyond `max` stays queued until a running one
 * releases its slot; an abort while waiting rejects.
 */
export function acquireSlot(jobId: string, max: number, signal: AbortSignal): Promise<void> {
  const reg = registry()
  if (signal.aborted) return Promise.reject(new Error('Cancelled'))
  if (reg.running < max) {
    reg.running++
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { jobId, max, resolve, reject }
    const onAbort = () => {
      const idx = reg.waiters.indexOf(waiter)
      if (idx >= 0) reg.waiters.splice(idx, 1)
      reject(new Error('Cancelled'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    waiter.resolve = () => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    reg.waiters.push(waiter)
  })
}

export function releaseSlot(): void {
  const reg = registry()
  reg.running = Math.max(0, reg.running - 1)
  const idx = reg.waiters.findIndex(w => reg.running < w.max)
  if (idx < 0) return
  const [next] = reg.waiters.splice(idx, 1)
  reg.running++
  next.resolve()
}

/** Test helper: forget every job and waiter. */
export function resetRegistry(): void {
  const reg = registry()
  reg.jobs.clear()
  reg.running = 0
  reg.waiters.splice(0)
}
