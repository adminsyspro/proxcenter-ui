/**
 * The network and bookkeeping side of the Site Recovery page's per-VM actions,
 * kept out of the page component so each rule can be exercised on its own:
 * what an emergency start sends, how a refusal is turned into a message, and
 * when the screen has to look again at what it shows.
 */

/** connId -> vmid -> PVE power state, for the guests of every cluster. */
export interface InventoryVM {
  vmid?: number
  status?: string
  connId?: string
}

/**
 * Power states scoped per connection. A DR replica and its source can carry
 * the same VMID on the two clusters, so a flat map would resolve one of them
 * at random.
 */
export function buildVmStatesByConn(vms: InventoryVM[]): Record<string, Record<number, string>> {
  const byConn: Record<string, Record<number, string>> = {}

  for (const vm of vms) {
    if (!vm.vmid || !vm.status || !vm.connId) continue
    ;(byConn[vm.connId] ??= {})[vm.vmid] = vm.status
  }

  return byConn
}

/**
 * How long after an emergency action the screen keeps looking again. What it
 * shows moves for about a minute: the replica's power state first, then its
 * job walking pending -> syncing -> synced. A single refresh when the call
 * returns catches none of that, the VM inventory has no refresh interval of
 * its own, and the jobs list follows a cadence the user can switch off
 * entirely in Appearance.
 */
export const EMERGENCY_REFRESH_DELAYS = [3000, 8000, 15000, 30000, 60000]

/** Runs refresh now, then once per delay. Returns the timers to clear. */
export function scheduleRefreshes(
  refresh: () => void,
  delays: number[] = EMERGENCY_REFRESH_DELAYS
): ReturnType<typeof setTimeout>[] {
  const timers = delays.map(delay => setTimeout(refresh, delay))

  refresh()

  return timers
}

async function failureMessage(res: Response, conflictMessage: string, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}))

  // 409 is the orchestrator saying a test failover holds this guest, which
  // has its own wording; anything else carries its own message.
  return res.status === 409 ? conflictMessage : body.error || fallback
}

export interface EmergencyStartInput {
  vmId: number
  targetCluster: string
  jobId: string
  restorePoint?: string
  conflictMessage: string
}

/** Boots one replica on the DR site, optionally from an older restore point. */
export async function startDRVM(input: EmergencyStartInput): Promise<void> {
  const res = await fetch('/api/v1/orchestrator/replication/emergency/start-vm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vm_id: input.vmId,
      target_cluster: input.targetCluster,
      replication_job_id: input.jobId,
      restore_point: input.restorePoint,
    }),
  })

  if (!res.ok) throw new Error(await failureMessage(res, input.conflictMessage, 'Failed to start VM'))
}

export interface EmergencyStopInput {
  vmId: number
  targetCluster: string
  jobId: string
  resumeReplication: boolean
  conflictMessage: string
}

/** Stops one replica, and resumes its job when the operator asked for it. */
export async function stopDRVM(input: EmergencyStopInput): Promise<void> {
  const res = await fetch('/api/v1/orchestrator/replication/emergency/stop-vm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vm_id: input.vmId,
      target_cluster: input.targetCluster,
      replication_job_id: input.jobId,
      resume_replication: input.resumeReplication,
    }),
  })

  if (!res.ok) throw new Error(await failureMessage(res, input.conflictMessage, 'Failed to stop VM'))
}

/** Restore points of one replicated guest, for its start dialog. */
export async function loadVMRestorePoints(jobId: string, vmId: number): Promise<any> {
  const res = await fetch(`/api/v1/orchestrator/replication/jobs/${jobId}/vms/${vmId}/restore-points`)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))

    throw new Error(body.error || 'Failed to load restore points')
  }

  return res.json()
}

/**
 * Saves a recovery plan: the same form creates and edits, so the id decides
 * the verb and the URL. Returns the orchestrator's refusal rather than
 * swallowing it, since it refuses an edit during a failback for a reason.
 */
export async function saveRecoveryPlan(data: unknown, planId: string | null): Promise<{ error: string | null }> {
  const res = await fetch(
    planId ? `/api/v1/orchestrator/replication/plans/${planId}` : '/api/v1/orchestrator/replication/plans',
    {
      method: planId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  )

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))

    return { error: body.error || res.statusText }
  }

  return { error: null }
}
