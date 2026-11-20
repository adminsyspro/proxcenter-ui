// Framework reports built in the background (Frameworks tab, "Download report").
//
// The click starts a job and returns at once; the browser follows the job from
// the ProxCenter tab of the taskbar and offers the PDF when it is ready, so the
// user keeps working and a slow cluster never meets the 60 s proxy timeout.
//
// In memory, on globalThis (a dev recompile must not start a second store): a
// job is lost on a restart, which the taskbar reports as an expired report. A
// job belongs to the caller that started it (tenant + user or API token) and
// nobody else can read it.
import { randomUUID } from 'node:crypto'

import { REPORT_JOB_TTL_MS } from '@/lib/compliance/report/reportJobConstants'

export { REPORT_JOB_TTL_MS }
/** Reports kept per caller, running and finished together. */
export const MAX_REPORT_JOBS_PER_OWNER = 5

export const E_TOO_MANY_REPORT_JOBS = 'E_TOO_MANY_REPORT_JOBS'

export type ReportJobStatus = 'running' | 'done' | 'error'

export interface ReportJob {
  id: string
  tenantId: string
  ownerKey: string
  frameworkId: string
  connectionId: string
  connectionName: string
  status: ReportJobStatus
  error?: string
  filename?: string
  pdf?: Buffer
  createdAt: number
  finishedAt?: number
}

/** What the API shows of a job: never the PDF bytes, never the owner. */
export type PublicReportJob = Omit<ReportJob, 'pdf' | 'ownerKey' | 'tenantId'>

const KEY = Symbol.for('proxcenter.complianceReportJobs')
const g = globalThis as unknown as Record<symbol, Map<string, ReportJob> | undefined>

function jobs(): Map<string, ReportJob> {
  return g[KEY] ?? (g[KEY] = new Map())
}

/** The caller a job belongs to: a session user or an API token. */
export function reportJobOwnerKey(principal: { kind: string; userId?: string; tokenId?: string }): string | null {
  const id = principal.kind === 'token' ? principal.tokenId : principal.userId

  return id ? `${principal.kind}:${id}` : null
}

function prune(now: number) {
  for (const [id, job] of jobs()) {
    if (job.finishedAt !== undefined && now - job.finishedAt > REPORT_JOB_TTL_MS) jobs().delete(id)
  }
}

export function publicReportJob(job: ReportJob): PublicReportJob {
  const { pdf: _pdf, ownerKey: _owner, tenantId: _tenant, ...rest } = job

  return rest
}

export interface StartReportJobInput {
  tenantId: string
  ownerKey: string
  frameworkId: string
  connectionId: string
  connectionName: string
  run: () => Promise<{ ok: true; pdf: Buffer; filename: string } | { ok: false; error: string }>
}

/**
 * Registers the job and starts `run` without waiting for it. Refused with
 * E_TOO_MANY_REPORT_JOBS when the caller already has as many reports running
 * as it may keep; otherwise its oldest finished report makes room.
 */
export function startReportJob(input: StartReportJobInput): ReportJob {
  const now = Date.now()
  prune(now)

  const mine = [...jobs().values()]
    .filter(j => j.tenantId === input.tenantId && j.ownerKey === input.ownerKey)
    .sort((a, b) => a.createdAt - b.createdAt)

  if (mine.filter(j => j.status === 'running').length >= MAX_REPORT_JOBS_PER_OWNER) {
    throw new Error(E_TOO_MANY_REPORT_JOBS)
  }

  const finished = mine.filter(j => j.status !== 'running')
  let excess = mine.length - MAX_REPORT_JOBS_PER_OWNER + 1
  for (const old of finished) {
    if (excess <= 0) break
    jobs().delete(old.id)
    excess--
  }

  const job: ReportJob = {
    id: randomUUID(),
    tenantId: input.tenantId,
    ownerKey: input.ownerKey,
    frameworkId: input.frameworkId,
    connectionId: input.connectionId,
    connectionName: input.connectionName,
    status: 'running',
    createdAt: now,
  }
  jobs().set(job.id, job)

  void (async () => {
    try {
      const out = await input.run()
      if ('error' in out) Object.assign(job, { status: 'error', error: out.error })
      else Object.assign(job, { status: 'done', pdf: out.pdf, filename: out.filename })
    } catch (e: any) {
      Object.assign(job, { status: 'error', error: e?.message || 'Report generation failed' })
    } finally {
      job.finishedAt = Date.now()
    }
  })()

  return job
}

/** The job, only for the caller that started it; null otherwise (and once expired). */
export function getReportJob(id: string, tenantId: string, ownerKey: string): ReportJob | null {
  prune(Date.now())
  const job = jobs().get(id)
  if (!job || job.tenantId !== tenantId || job.ownerKey !== ownerKey) return null

  return job
}

/** Tests only. */
export function resetReportJobs(): void {
  jobs().clear()
}
