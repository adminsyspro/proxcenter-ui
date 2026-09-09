// src/lib/migration/ccm-prereqs.ts
//
// Cross-cluster migration prerequisites: capture, removal and restore of the
// three guest-level configurations PVE refuses to remote-migrate with.
//
// PVE 9.2.11 enforces all three itself, so ProxCenter can only clear them up
// front, never work around them:
//   - HA        PVE/API2/Qemu.pm, remote_migrate_vm:
//               "cannot remote-migrate VM that is configured for HA"
//   - replication  same method, plus PVE/QemuMigrate.pm handle_replication():
//               "cannot remote-migrate replicated VM"
//   - snapshots PVE/QemuMigrate.pm scan_local_volumes():
//               "remote migration with snapshots not supported yet"
//
// HA and replication are reversible, so we capture them before removal and can
// replay them on the target cluster (or back onto the source if the migration
// fails). Snapshot deletion is NOT reversible, which is why it stays a separate,
// explicitly named opt-in everywhere in this module and in the UI.

import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'
import type {
  CcmPrereqCapture,
  CcmRestorePlan,
  HaResourceCapture,
  ReplicationJobCapture,
  SiteRecoveryJobRef,
} from './ccm-prereqs.types'
import { waitForTask } from '@/lib/proxmox/tasks'

export type {
  HaResourceCapture,
  ReplicationJobCapture,
  CcmPrereqCapture,
  CcmRestorePlan,
} from './ccm-prereqs.types'
export { REPLICATION_CAPABLE_STORAGE_TYPES, storageSupportsReplication } from './ccm-prereqs.types'
export type { SiteRecoveryJobRef } from './ccm-prereqs.types'

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * True when a PVE error means "this HA resource is not configured" rather than
 * a real failure.
 *
 * ⚠️ Measured on PVE 9.2.11: GET /cluster/ha/resources/{sid} for an unmanaged
 * guest answers **HTTP 500** with `no such resource 'vm:100'`, NOT a 404.
 * Matching on the status alone made captureHaResource throw for every guest
 * that is not HA-managed, which is the common case.
 */
function isHaResourceAbsent(err: unknown): boolean {
  const msg = String((err as any)?.message || '')

  return msg.includes('404') || /no such resource/i.test(msg)
}

/**
 * Read the full HA resource config for a guest, or null when the guest is not
 * HA-managed. "Not managed" is not an error here.
 */
export async function captureHaResource(
  conn: ProxmoxClientOptions,
  sid: string,
): Promise<HaResourceCapture | null> {
  let raw: any
  try {
    raw = await pveFetch<any>(conn, `/cluster/ha/resources/${encodeURIComponent(sid)}`)
  } catch (e: any) {
    if (isHaResourceAbsent(e)) return null
    throw e
  }

  if (!raw) return null

  return {
    sid,
    state: raw.state ? String(raw.state) : undefined,
    group: raw.group ? String(raw.group) : undefined,
    comment: raw.comment ? String(raw.comment) : undefined,
    maxRestart: toNumber(raw.max_restart),
    maxRelocate: toNumber(raw.max_relocate),
    failback: toNumber(raw.failback),
    autoRebalance: toNumber(raw['auto-rebalance'] ?? raw.auto_rebalance),
  }
}

/**
 * HA rules (PVE 9) that name this guest. They are NOT restored on the target:
 * node-affinity rules reference source-cluster node names, and resource-affinity
 * rules reference sids that may not exist there. The caller warns instead.
 */
export async function findHaRulesForSid(
  conn: ProxmoxClientOptions,
  sid: string,
): Promise<string[]> {
  try {
    const rules = await pveFetch<any[]>(conn, '/cluster/ha/rules')
    if (!Array.isArray(rules)) return []

    return rules
      .filter((rule: any) => {
        const members = rule?.resources ?? rule?.services ?? rule?.sids
        if (Array.isArray(members)) return members.map(String).includes(sid)

        return String(members || '')
          .split(',')
          .map(s => s.trim())
          .includes(sid)
      })
      .map((rule: any) => String(rule?.rule ?? rule?.id ?? ''))
      .filter(Boolean)
  } catch {
    // /cluster/ha/rules only exists on PVE 9+; absence is not a problem.
    return []
  }
}

/** Every pvesr job configured for this guest, across the whole cluster. */
export async function captureReplicationJobs(
  conn: ProxmoxClientOptions,
  vmid: string | number,
): Promise<ReplicationJobCapture[]> {
  const jobs = await pveFetch<any[]>(conn, '/cluster/replication')
  if (!Array.isArray(jobs)) return []

  return jobs
    .filter((job: any) => String(job?.guest) === String(vmid))
    .map((job: any) => ({
      id: String(job.id),
      guest: Number(job.guest),
      target: String(job.target || ''),
      schedule: job.schedule ? String(job.schedule) : undefined,
      rate: toNumber(job.rate),
      comment: job.comment ? String(job.comment) : undefined,
      disable: toNumber(job.disable),
    }))
}

export async function removeHaResource(conn: ProxmoxClientOptions, sid: string): Promise<void> {
  await pveFetch(conn, `/cluster/ha/resources/${encodeURIComponent(sid)}`, { method: 'DELETE' })
}

/**
 * Ask PVE to remove replication jobs, cleaning up local replication snapshots
 * and the replicated volumes on the target node.
 *
 * ⚠️ DELETE only MARKS the job (`remove_job = full`); the config entry stays
 * until pvescheduler runs the removal, within about a minute. Until then
 * ReplicationConfig::check_for_existing_jobs still sees an entry for the guest
 * and remote_migrate still refuses, so callers MUST wait for the entries to
 * disappear rather than migrating straight after this returns.
 *
 * `force` would drop the entry instantly but skips cleanup, orphaning the
 * replicated volumes on the replication target for good, so it is not offered.
 */
export async function markReplicationJobsForRemoval(
  conn: ProxmoxClientOptions,
  jobIds: string[],
): Promise<{ marked: string[]; alreadyGone: string[] }> {
  const marked: string[] = []
  const alreadyGone: string[] = []

  for (const id of jobIds) {
    try {
      await pveFetch(conn, `/cluster/replication/${encodeURIComponent(id)}`, { method: 'DELETE' })
      marked.push(id)
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('404') || msg.includes('no such job')) {
        alreadyGone.push(id)
        continue
      }
      throw e
    }
  }

  return { marked, alreadyGone }
}

/**
 * Poll until none of the given job ids remain in the cluster replication config.
 * Returns the ids still present when the budget runs out, so the caller can say
 * so instead of starting a migration PVE will reject.
 */
export async function waitForReplicationJobsGone(
  conn: ProxmoxClientOptions,
  jobIds: string[],
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<string[]> {
  if (jobIds.length === 0) return []

  const timeoutMs = options.timeoutMs ?? 150_000
  const intervalMs = options.intervalMs ?? 5_000
  const start = Date.now()
  let remaining = [...jobIds]

  for (;;) {
    let present: Set<string>
    try {
      const jobs = await pveFetch<any[]>(conn, '/cluster/replication')
      present = new Set((Array.isArray(jobs) ? jobs : []).map((job: any) => String(job?.id)))
    } catch {
      // Transient read failure tells us nothing about the config; retry.
      present = new Set(remaining)
    }

    remaining = remaining.filter(id => present.has(id))
    if (remaining.length === 0) return []

    if (Date.now() - start >= timeoutMs) return remaining

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/**
 * Delete guest snapshots one at a time, waiting for each PVE task, and stop at
 * the first failure. Sequential on purpose: concurrent snapshot deletes on the
 * same guest fight over the config lock.
 *
 * ⛔ Irreversible. Callers must have the explicit, per-name consent of the user.
 */
export async function deleteGuestSnapshots(
  conn: ProxmoxClientOptions,
  node: string,
  type: string,
  vmid: string | number,
  names: string[],
): Promise<{ deleted: string[]; failed?: { name: string; error: string } }> {
  const deleted: string[] = []

  for (const name of names) {
    try {
      const upid = await pveFetch<string>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${encodeURIComponent(type)}/${encodeURIComponent(String(vmid))}/snapshot/${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      )
      if (typeof upid === 'string' && upid.startsWith('UPID:')) {
        await waitForTask(conn, node, upid)
      }
      deleted.push(name)
    } catch (e: any) {
      return { deleted, failed: { name, error: String(e?.message || e) } }
    }
  }

  return { deleted }
}

/**
 * True when the target cluster still knows this HA group. PVE 9 migrated groups
 * to HA rules and answers "ha groups have been migrated to rules" on the groups
 * endpoint, so a captured group name must never be replayed blindly.
 */
export async function haGroupExists(
  conn: ProxmoxClientOptions,
  group?: string,
): Promise<boolean> {
  if (!group) return false

  try {
    const groups = await pveFetch<any[]>(conn, '/cluster/ha/groups')
    if (!Array.isArray(groups)) return false

    return groups.some((g: any) => String(g?.group) === group)
  } catch {
    return false
  }
}

/**
 * Recreate an HA resource from a capture, on any cluster.
 *
 * `sid` is passed explicitly because a cross-cluster migration may land the
 * guest under a different VMID, and the captured sid then names the wrong guest.
 * The captured group is only replayed when the destination still has it.
 */
export async function restoreHaResource(
  conn: ProxmoxClientOptions,
  capture: HaResourceCapture,
  sid: string,
  overrides: { state?: string } = {},
): Promise<void> {
  const params: Record<string, string> = { sid }

  const state = overrides.state || capture.state
  if (state) params.state = state
  if (capture.comment) params.comment = capture.comment
  if (capture.maxRestart !== undefined) params.max_restart = String(capture.maxRestart)
  if (capture.maxRelocate !== undefined) params.max_relocate = String(capture.maxRelocate)
  if (capture.failback !== undefined) params.failback = String(capture.failback)
  if (capture.autoRebalance !== undefined) params['auto-rebalance'] = String(capture.autoRebalance)

  if (await haGroupExists(conn, capture.group)) {
    params.group = capture.group as string
  }

  await pveFetch(conn, '/cluster/ha/resources', {
    method: 'POST',
    body: new URLSearchParams(params).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
}

/**
 * Lowest free `<vmid>-<n>` replication job id on a cluster. PVE derives the
 * guest from the id, so the numbering has to be picked per guest.
 */
export async function nextReplicationJobId(
  conn: ProxmoxClientOptions,
  vmid: string | number,
): Promise<string> {
  let used = new Set<number>()
  try {
    const jobs = await pveFetch<any[]>(conn, '/cluster/replication')
    used = new Set(
      (Array.isArray(jobs) ? jobs : [])
        .filter((job: any) => String(job?.guest) === String(vmid))
        .map((job: any) => Number(String(job?.id).split('-')[1] || '0'))
        .filter((n: number) => Number.isFinite(n)),
    )
  } catch {
    // Unreadable config: fall back to 0 and let PVE reject a collision.
  }

  let num = 0
  while (used.has(num)) num++

  return `${vmid}-${num}`
}

/**
 * Create a replication job for a guest on the cluster it now lives on.
 *
 * ⚠️ A freshly created job does a FULL initial sync of every volume, which the
 * UI announces before offering this.
 */
export async function restoreReplicationJob(
  conn: ProxmoxClientOptions,
  params: {
    vmid: string | number
    target: string
    schedule?: string
    rate?: number
    comment?: string
    disable?: number
  },
): Promise<string> {
  const id = await nextReplicationJobId(conn, params.vmid)

  const body: Record<string, string> = {
    id,
    target: params.target,
    type: 'local',
  }

  if (params.schedule) body.schedule = params.schedule
  if (params.rate !== undefined) body.rate = String(params.rate)
  if (params.comment) body.comment = params.comment
  if (params.disable) body.disable = '1'

  await pveFetch(conn, '/cluster/replication', {
    method: 'POST',
    body: new URLSearchParams(body).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })

  return id
}

/**
 * Replay a restore plan on the cluster the guest now lives on.
 *
 * Never throws: this runs from the detached post-migration watcher, where a
 * failed restore must be reported, not allowed to kill the remaining cleanup.
 * Every problem comes back as a string for the caller to log and surface.
 */
export async function applyRestorePlan(
  conn: ProxmoxClientOptions,
  plan: CcmRestorePlan,
  guest: { vmid: string | number; type: string; node?: string },
): Promise<{ restored: string[]; errors: string[] }> {
  const restored: string[] = []
  const errors: string[] = []

  const sidPrefix = guest.type === 'lxc' ? 'ct' : 'vm'
  const sid = `${sidPrefix}:${guest.vmid}`

  if (plan.restoreHa && plan.capture.ha) {
    try {
      await restoreHaResource(conn, plan.capture.ha, sid, { state: plan.haState })
      restored.push(`ha:${sid}`)
    } catch (e: any) {
      errors.push(`HA resource ${sid}: ${String(e?.message || e)}`)
    }
  }

  if (plan.restoreReplication && plan.replicationTarget) {
    const source = plan.capture.replication[0]
    try {
      const id = await restoreReplicationJob(conn, {
        vmid: guest.vmid,
        target: plan.replicationTarget,
        schedule: plan.replicationSchedule || source?.schedule,
        rate: plan.replicationRate ?? source?.rate,
        comment: source?.comment,
      })
      restored.push(`replication:${id}`)
    } catch (e: any) {
      errors.push(`Replication job for guest ${guest.vmid}: ${String(e?.message || e)}`)
    }
  }

  return { restored, errors }
}

/**
 * Put back on the SOURCE what we removed to unblock a migration that then
 * failed. The guest never moved, so the captured sid and job ids are still the
 * right ones and are replayed verbatim.
 *
 * Snapshots are absent by construction: they cannot be restored.
 */
export async function rollbackPrereqsOnSource(
  conn: ProxmoxClientOptions,
  capture: CcmPrereqCapture,
): Promise<{ restored: string[]; errors: string[] }> {
  const restored: string[] = []
  const errors: string[] = []

  if (capture.ha) {
    try {
      await restoreHaResource(conn, capture.ha, capture.ha.sid)
      restored.push(`ha:${capture.ha.sid}`)
    } catch (e: any) {
      errors.push(`HA resource ${capture.ha.sid}: ${String(e?.message || e)}`)
    }
  }

  for (const job of capture.replication) {
    try {
      const body: Record<string, string> = {
        id: job.id,
        target: job.target,
        type: 'local',
      }
      if (job.schedule) body.schedule = job.schedule
      if (job.rate !== undefined) body.rate = String(job.rate)
      if (job.comment) body.comment = job.comment
      if (job.disable) body.disable = '1'

      await pveFetch(conn, '/cluster/replication', {
        method: 'POST',
        body: new URLSearchParams(body).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      restored.push(`replication:${job.id}`)
    } catch (e: any) {
      errors.push(`Replication job ${job.id}: ${String(e?.message || e)}`)
    }
  }

  return { restored, errors }
}

/**
 * ProxCenter Site Recovery jobs that cover this guest on this cluster.
 *
 * ⚠️ Not a prerequisite and never auto-cleared. Unlike a pvesr job, which
 * PVE binds to exactly ONE guest (ReplicationConfig.pm derives `guest` from the
 * `<vmid>-<jobnum>` id), a Site Recovery job carries a LIST of VMIDs, or a set
 * of tags. Dropping such a job to unblock one guest would stop replicating
 * every other guest in it, so the UI only warns and leaves the edit to a human.
 *
 * Returns [] when the orchestrator is unreachable or Site Recovery is not
 * licensed: this is advisory, it must never break a migration preflight.
 */
export async function findSiteRecoveryJobsForGuest(
  connectionId: string,
  vmid: string | number,
): Promise<SiteRecoveryJobRef[]> {
  try {
    const { getOrchestratorClient } = await import('@/lib/orchestrator/client')
    const response = await getOrchestratorClient().getReplicationJobs()
    const jobs = Array.isArray(response?.data) ? response.data : []
    const target = Number(vmid)

    return jobs
      .filter((job: any) => job?.source_cluster === connectionId)
      .filter((job: any) => (Array.isArray(job?.vm_ids) ? job.vm_ids : []).map(Number).includes(target))
      .map((job: any) => ({
        id: String(job.id),
        name: String(job.name || job.id),
        otherVmids: (Array.isArray(job.vm_ids) ? job.vm_ids : [])
          .map(Number)
          .filter((id: number) => id !== target),
        byTag: Array.isArray(job.tags) && job.tags.length > 0,
      }))
  } catch {
    return []
  }
}
