import type { CrossClusterMigrateParams } from '@/components/MigrateVmDialog'

export type CrossClusterMigrateTarget = {
  connId: string
  node: string
  type: string
  vmid: string | number
}

export type CrossClusterMigrateResult = {
  upid: string | null
  raw: unknown
  /** Where `upid` runs: the source cluster, or the target one for a move without copy. */
  taskConnectionId: string
  taskNode: string
  /** A move without copy that succeeded, but whose start on the target failed. */
  startError?: string
}

/**
 * Single source of truth for POST /remote-migrate calls from the UI.
 *
 * Owns the body-shape contract with the route (notably the `delete` field
 * remap from the dialog's `deleteSource`), so callers cannot forget the
 * remap and silently disable source deletion. `restore` is passed through untouched.
 *
 * Throws on non-2xx with the route's error message when available.
 */
export async function crossClusterMigrate(
  target: CrossClusterMigrateTarget,
  params: CrossClusterMigrateParams,
): Promise<CrossClusterMigrateResult> {
  const { connId, node, type, vmid } = target
  const base = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${encodeURIComponent(type)}/${encodeURIComponent(node)}/${encodeURIComponent(String(vmid))}/remote-migrate`

  // ui#1460: without copy only the configuration moves; the start task, if
  // any, runs on the target cluster.
  const request = params.handover
    ? {
        url: `${base}/handover`,
        body: {
          targetConnectionId: params.targetConnectionId,
          targetNode: params.targetNode,
          targetBridge: params.targetBridge,
          start: !!params.start,
        },
      }
    : {
        url: base,
        body: {
          targetConnectionId: params.targetConnectionId,
          targetNode: params.targetNode,
          targetVmid: params.targetVmid,
          targetStorage: params.targetStorage,
          targetBridge: params.targetBridge,
          online: params.online,
          delete: params.deleteSource,
          bwlimit: params.bwlimit,
          restore: params.restore,
        },
      }

  const res = await fetch(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error || res.statusText || `HTTP ${res.status}`)
  }

  const json = await res.json().catch(() => ({}))
  const upid = typeof json?.data === 'string' && json.data.startsWith('UPID:') ? json.data : null
  const task = params.handover ? json?.task : null
  const where = params.handover
    ? { connectionId: params.targetConnectionId, node: params.targetNode }
    : { connectionId: connId, node }

  const startError = typeof json?.handover?.startError === 'string' ? json.handover.startError : undefined

  return {
    upid,
    raw: json,
    taskConnectionId: typeof task?.connectionId === 'string' ? task.connectionId : where.connectionId,
    taskNode: typeof task?.node === 'string' ? task.node : where.node,
    ...(startError ? { startError } : {}),
  }
}
