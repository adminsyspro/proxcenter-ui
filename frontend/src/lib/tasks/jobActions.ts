/**
 * Per-type endpoints, actions and log extraction for the Task Center.
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
  // addressed by the UPID the orchestrator recorded. The node is read from the
  // UPID itself (UPID:<node>:...) and falls back to the recorded source node.
  if (job.type === 'drs') {
    const upid = job.metadata?.taskId
    const connectionId = job.metadata?.connectionId
    if (!upid || !connectionId) return null

    const node = upidNode(upid) || job.metadata?.sourceNode
    if (!node) return null

    return `/api/v1/tasks/${encodeURIComponent(connectionId)}/${encodeURIComponent(node)}/${encodeURIComponent(upid)}`
  }

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

  // DRS, replication and Site Recovery executions: the orchestrator exposes
  // no cancel route for them, so a button would be a dead end.
  return []
}

/** POST endpoint backing an action, or null when unsupported. */
export function jobActionUrl(job: JobLike, action: JobAction): string | null {
  if (!job?.id) return null
  if (job.type === 'rolling_update') return `/api/v1/orchestrator/rolling-updates/${job.id}/${action}`
  if (job.type === 'migration' && action === 'cancel') return `/api/v1/migrations/${job.id}/cancel`

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
  const url = jobActionUrl(job, action)
  if (!url) return { ok: false, error: `Unsupported action ${action}` }

  try {
    const res = await fetch(url, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))

      return { ok: false, error: data?.error || `Failed to ${action} job` }
    }

    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || `Failed to ${action} job` }
  }
}
