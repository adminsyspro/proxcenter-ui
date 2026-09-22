/**
 * Per-type endpoints, actions and log extraction for the Task Center.
 *
 * Every type here can now be stopped from its row (#974), each through the
 * thing that actually does the work: the PVE task for a Proxmox task and for
 * a DRS migration, our own pipeline for an external migration, the
 * orchestrator for a rolling update, a replication run or a Site Recovery
 * execution.
 *
 * The page used to hardcode the rolling-updates routes whatever the job type
 * (#767): the detail dialog fetched its logs from /rolling-updates/{id} and
 * its Pause/Cancel buttons posted to /rolling-updates/{id}/{action}, so on a
 * DRS, replication or migration job the buttons were displayed and did
 * nothing, and the Logs panel was empty for every type but one. Kept in lib so
 * every branch is unit-tested and both surfaces that show a job detail (the
 * Task Center page and the ProxCenter tab of the taskbar) share it.
 */

export type JobLike = {
  id?: string
  type?: string
  status?: string
  metadata?: Record<string, any> | null
} | null | undefined

export type JobAction = 'pause' | 'resume' | 'approve' | 'cancel'

/** `UPID:pve1:0000ABCD:...` -> `pve1`. */
function upidNode(upid: string): string | null {
  const parts = String(upid).split(':')

  return parts[0] === 'UPID' && parts[1] ? parts[1] : null
}

/**
 * `/api/v1/tasks/{connectionId}/{node}/{upid}`: the one route that addresses a
 * PVE task, GET for its logs and DELETE to stop it. The node is read from the
 * UPID itself (UPID:<node>:...) and falls back to the recorded source node.
 */
export function pveTaskStopUrl(connectionId?: string | null, node?: string | null, upid?: string | null): string | null {
  if (!connectionId || !node || !upid) return null

  return `/api/v1/tasks/${encodeURIComponent(connectionId)}/${encodeURIComponent(node)}/${encodeURIComponent(upid)}`
}

/** Same URL, for a job whose work is really a PVE task (today: DRS). */
function pveTaskUrl(job: JobLike): string | null {
  const upid = job?.metadata?.taskId

  return pveTaskStopUrl(job?.metadata?.connectionId, upid ? upidNode(upid) || job?.metadata?.sourceNode : null, upid)
}

/**
 * Read-only detail endpoint carrying the job's logs, or null when its type
 * keeps none server-side.
 *
 * Every source has its own log store: the orchestrator for rolling updates
 * and replication, our database for migrations, PVE itself for a DRS
 * migration (the orchestrator only records the UPID it triggered).
 */
export function jobDetailUrl(job: JobLike): string | null {
  if (!job?.id) return null

  if (job.type === 'rolling_update') return `/api/v1/orchestrator/rolling-updates/${job.id}`

  // Migrations: the shared-task detail is gated on the same tasks.view
  // permission as this page (/api/v1/migrations/{id} requires vm.migrate).
  // history=1 drops its 30-minute recency window, which exists for the tasks
  // footer: this page lists the whole history, so a job that finished days ago
  // must still open with its logs.
  if (job.type === 'migration') return `/api/v1/tasks/shared/${job.id}?history=1`

  if (job.type === 'replication') return `/api/v1/orchestrator/replication/jobs/${job.id}/logs`

  // A DRS migration is a PVE task: the log lives on the node that ran it,
  // addressed by the UPID the orchestrator recorded.
  if (job.type === 'drs') return pveTaskUrl(job)

  // site_recovery: a RecoveryExecution has no log column at all, its record is
  // the per-VM results already carried by the row (see syntheticLogs).
  return null
}

/** Actions the backend can actually honour for this job, in display order. */
export function jobActions(job: JobLike): JobAction[] {
  if (!job) return []

  if (job.type === 'rolling_update') {
    if (job.status === 'running') return ['pause', 'cancel']
    // A run paused for a manual approval wants an approval, not a resume:
    // the orchestrator's approve action releases the gate without lifting
    // an operator pause, resume would do both.
    if (job.status === 'paused') return [job.metadata?.pendingApproval ? 'approve' : 'resume', 'cancel']

    return []
  }

  // metadata.cancellable is set by the jobs route from the row status: the
  // cancel endpoint answers 400 on an already-finished migration.
  if (job.type === 'migration') return job.metadata?.cancellable ? ['cancel'] : []

  // A DRS migration is a qmigrate running ON the node: the orchestrator only
  // polls the UPID it recorded, so cancelling it "in ProxCenter" would stop
  // nothing. The real stop is the PVE task, hence the DELETE in
  // jobActionRequest below. At the next tick the orchestrator sees a task that
  // is no longer running and files the row as failed, with its usual cooldown.
  if (job.type === 'drs') return job.status === 'running' && pveTaskUrl(job) ? ['cancel'] : []

  // A replication run: pausing the job never stopped the sync in flight, the
  // orchestrator grew a cancel route for #974. Only a run actually in flight
  // ("syncing" upstream) has anything to stop.
  if (job.type === 'replication') return job.status === 'running' ? ['cancel'] : []

  // A Site Recovery execution. The orchestrator decides what it accepts from
  // what the run has already done to the guests (a real failover that has
  // started promoting answers 409 with that sentence), so the button is
  // offered on any running execution and the refusal is shown as it comes.
  if (job.type === 'site_recovery') return job.status === 'running' ? ['cancel'] : []

  return []
}

export type JobActionRequest = { url: string; method: 'POST' | 'DELETE' }

/**
 * Endpoint backing an action, or null when unsupported. The verb is part of
 * the answer: every orchestrator action is a POST, but stopping a DRS job
 * means deleting the PVE task that does the work.
 */
export function jobActionRequest(job: JobLike, action: JobAction): JobActionRequest | null {
  if (!job?.id) return null

  if (job.type === 'rolling_update') {
    return { url: `/api/v1/orchestrator/rolling-updates/${job.id}/${action}`, method: 'POST' }
  }

  if (job.type === 'migration' && action === 'cancel') {
    return { url: `/api/v1/migrations/${job.id}/cancel`, method: 'POST' }
  }

  if (job.type === 'drs' && action === 'cancel') {
    const url = pveTaskUrl(job)

    return url ? { url, method: 'DELETE' } : null
  }

  if (job.type === 'replication' && action === 'cancel') {
    return { url: `/api/v1/orchestrator/replication/jobs/${job.id}/cancel`, method: 'POST' }
  }

  // The row's id IS the execution id (the jobs route builds it from the plan
  // history), which is what the orchestrator's cancel route addresses.
  if (job.type === 'site_recovery' && action === 'cancel') {
    return { url: `/api/v1/orchestrator/replication/executions/${job.id}/cancel`, method: 'POST' }
  }

  return null
}

/** URL alone, for callers that only need to know an action is routable. */
export function jobActionUrl(job: JobLike, action: JobAction): string | null {
  return jobActionRequest(job, action)?.url ?? null
}

/**
 * Permission the route behind an action enforces, so a row can hide a button
 * that would only ever answer 403. The three cancel routes disagree: a PVE
 * task (and therefore a DRS migration) is node.manage, an external migration
 * is vm.migrate, a rolling update is automation.execute.
 */
export const PVE_TASK_STOP_PERMISSION = 'node.manage'

export function jobActionPermission(job: JobLike): string | null {
  if (job?.type === 'rolling_update') return 'automation.execute'
  if (job?.type === 'migration') return 'vm.migrate'
  if (job?.type === 'drs') return PVE_TASK_STOP_PERMISSION
  if (job?.type === 'replication' || job?.type === 'site_recovery') return 'automation.manage'

  return null
}

/**
 * Pull the log array out of a detail payload. The four endpoints disagree:
 * rolling updates and migrations answer {data:{logs:[...]}}, the replication
 * logs route answers a bare array, a PVE task answers {logs:[...]}.
 */
export function extractLogs(payload: any): any[] {
  if (Array.isArray(payload)) return payload

  const detail = payload?.data ?? payload
  if (Array.isArray(detail)) return detail
  if (Array.isArray(detail?.logs)) return detail.logs

  return []
}

/**
 * Site Recovery keeps no log: what a failover, failback or test failover
 * leaves behind is one result per VM. Render those as log lines so the panel
 * says what happened instead of "no logs available".
 */
export function syntheticLogs(job: JobLike): any[] {
  if (job?.type !== 'site_recovery') return []

  const results = job.metadata?.vmResults
  if (!Array.isArray(results)) return []

  return results.map((vm: any) => {
    const name = vm?.vm_name || (vm?.vm_id ? `VM ${vm.vm_id}` : 'VM')
    const target = vm?.target_node ? ` on ${vm.target_node}` : ''
    const vmid = vm?.target_vmid ? ` (VMID ${vm.target_vmid})` : ''
    const restore = vm?.restore_point ? `, restore point ${vm.restore_point}` : ''
    const step = !vm?.error && vm?.step ? `, step ${vm.step}` : ''
    const status = vm?.status || 'unknown'

    return {
      node: name,
      message: vm?.error
        ? `${status}${target}${vmid}: ${vm.error}`
        : `${status}${target}${vmid}${step}${restore}`,
      level: status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info',
    }
  })
}

export type NormalizedLog = {
  timestamp: string | null
  node: string | null
  message: string
  level: string
}

/**
 * One shape out of four: rolling updates log {timestamp,node,message,level},
 * migration pipelines {ts,msg,level}, replication {created_at,message,vmid},
 * PVE task lines {n,t} (line number and text, no timestamp).
 */
export function normalizeLog(entry: any): NormalizedLog {
  if (typeof entry === 'string') return { timestamp: null, node: null, message: entry, level: 'info' }

  const vmid = entry?.vmid
  const node = entry?.node || (vmid ? `VM ${vmid}` : null)

  return {
    timestamp: entry?.timestamp || entry?.ts || entry?.created_at || null,
    node,
    message: entry?.message || entry?.msg || entry?.t || '',
    level: entry?.level || 'info',
  }
}

/**
 * Run one action on a job. Both callers (the Task Center page and the taskbar)
 * then refresh their own SWR cache and surface `error` to the operator: a
 * silent no-op on click is exactly what #767 reported.
 */
export async function runJobAction(job: JobLike, action: JobAction): Promise<{ ok: boolean; error?: string }> {
  const request = jobActionRequest(job, action)
  if (!request) return { ok: false, error: `Unsupported action ${action}` }

  try {
    const res = await fetch(request.url, { method: request.method })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))

      return { ok: false, error: data?.error || `Failed to ${action} job` }
    }

    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || `Failed to ${action} job` }
  }
}

/**
 * Stop a Proxmox task from its row, without opening its detail dialog: the
 * same DELETE the dialog has always sent (#974). PVE answers 200 as soon as it
 * has signalled the worker, the row flips on the next poll.
 */
export async function runPveTaskStop(
  connectionId?: string | null,
  node?: string | null,
  upid?: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const url = pveTaskStopUrl(connectionId, node, upid)
  if (!url) return { ok: false, error: 'Unknown task' }

  try {
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))

      return { ok: false, error: data?.error || 'Failed to stop task' }
    }

    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to stop task' }
  }
}
