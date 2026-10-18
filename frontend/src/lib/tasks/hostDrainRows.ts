/**
 * Task Center rows of a host drain (#248): one row for the drain itself and
 * one per guest, so the operator follows each migration where every other
 * orchestrator job already shows up.
 *
 * Pure: the jobs route feeds it the orchestrator rows and its hostname
 * resolver, the tests feed it fixtures.
 */

export const HOST_DRAIN_JOB_TYPE = 'host_drain'

/** Separator between the drain id and the vmid in a guest row id. */
export const HOST_DRAIN_GUEST_SEPARATOR = '#vm'

export function isHostDrainGuestRow(id?: string | null): boolean {
  return !!id && id.includes(HOST_DRAIN_GUEST_SEPARATOR)
}

export function hostDrainParentId(id: string): string {
  const at = id.indexOf(HOST_DRAIN_GUEST_SEPARATOR)

  return at === -1 ? id : id.slice(0, at)
}

/** Drain status -> the vocabulary the Task Center renders. */
export function hostDrainStatus(status?: string): string {
  if (status === 'completed') return 'success'
  // A partial drain left guests on the node: the chip must say so.
  if (status === 'partial') return 'failed'
  if (status === 'failed' || status === 'cancelled' || status === 'pending') return status

  return 'running'
}

/** Guest status -> job status. */
export function hostDrainGuestStatus(status?: string): string {
  if (status === 'completed') return 'success'
  // A refused guest never moved: the row is a failure to the operator.
  if (status === 'failed' || status === 'skipped') return 'failed'
  if (status === 'migrating') return 'running'

  return 'pending'
}

function guestLabel(g: any): string {
  const kind = g?.type === 'lxc' ? 'CT' : 'VM'

  return g?.name ? `${kind} ${g.vmid} (${g.name})` : `${kind} ${g.vmid}`
}

function guestRoute(d: any, g: any): string {
  const target = g?.target_node || (g?.mode === 'ha' ? 'HA' : '?')

  return `${d.node} → ${target}`
}

export function hostDrainJobRows(drains: any[], resolve: (idOrName?: string | null) => string): any[] {
  if (!Array.isArray(drains)) return []
  const rows: any[] = []

  for (const d of drains) {
    if (!d?.id) continue
    const guests: any[] = Array.isArray(d.guests) ? d.guests : []
    const total = d.total_guests ?? guests.length
    const settled = (d.completed_guests ?? 0) + (d.failed_guests ?? 0) + (d.skipped_guests ?? 0)
    const status = hostDrainStatus(d.status)
    // A guest kept on purpose (stopped, "include stopped" off) is not in the way.
    const remaining = guests.filter(g => g?.status !== 'completed' && !g?.kept)
    const target = resolve(d.connection_id)
    let progress = 0
    if (status === 'success') progress = 100
    else if (total > 0) progress = Math.round((settled / total) * 100)

    let detail = `${d.node}: ${d.completed_guests ?? 0}/${total} guest(s) moved`
    if (status !== 'running' && remaining.length > 0) detail += `, ${remaining.length} still on ${d.node}`

    rows.push({
      id: d.id,
      name: `Host drain - ${d.node}`,
      type: HOST_DRAIN_JOB_TYPE,
      status,
      progress,
      startedAt: d.started_at || d.created_at,
      endedAt: d.completed_at,
      createdAt: d.created_at,
      detail,
      target,
      metadata: {
        connectionId: d.connection_id,
        node: d.node,
        totalGuests: total,
        completedGuests: d.completed_guests ?? 0,
        failedGuests: d.failed_guests ?? 0,
        skippedGuests: d.skipped_guests ?? 0,
        maintenanceEnabled: !!d.maintenance_enabled,
        guests,
        remaining: remaining.map(g => ({ vmid: g.vmid, name: g.name, type: g.type, reason: g.error || g.reason })),
        error: d.error,
      },
    })

    for (const g of guests) {
      const gStatus = hostDrainGuestStatus(g?.status)
      const reason = g?.failure_reason || g?.error || (g?.status === 'skipped' ? g?.reason : undefined)

      rows.push({
        id: `${d.id}${HOST_DRAIN_GUEST_SEPARATOR}${g.vmid}`,
        name: `Host drain - ${guestLabel(g)}`,
        type: HOST_DRAIN_JOB_TYPE,
        status: gStatus,
        progress: gStatus === 'success' ? 100 : 0,
        startedAt: g.started_at || d.started_at || d.created_at,
        endedAt: g.completed_at,
        createdAt: d.created_at,
        detail: `${guestRoute(d, g)}${g.mode ? ` (${g.mode})` : ''}${reason ? ` • ${reason}` : ''}`,
        target,
        metadata: {
          connectionId: d.connection_id,
          drainId: d.id,
          node: d.node,
          vmid: g.vmid,
          vmName: g.name,
          sourceNode: d.node,
          targetNode: g.target_node,
          mode: g.mode,
          taskId: g.task_id,
          error: reason,
        },
      })
    }
  }

  return rows
}
