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
}

/**
 * Single source of truth for POST /remote-migrate calls from the UI.
 *
 * Owns the body-shape contract with the route (notably the `delete` field
 * remap from the dialog's `deleteSource`), so callers cannot forget the
 * remap and silently disable source deletion.
 *
 * Throws on non-2xx with the route's error message when available.
 */
export async function crossClusterMigrate(
  target: CrossClusterMigrateTarget,
  params: CrossClusterMigrateParams,
): Promise<CrossClusterMigrateResult> {
  const { connId, node, type, vmid } = target

  const res = await fetch(
    `/api/v1/connections/${encodeURIComponent(connId)}/guests/${encodeURIComponent(type)}/${encodeURIComponent(node)}/${encodeURIComponent(String(vmid))}/remote-migrate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetConnectionId: params.targetConnectionId,
        targetNode: params.targetNode,
        targetVmid: params.targetVmid,
        targetStorage: params.targetStorage,
        targetBridge: params.targetBridge,
        online: params.online,
        delete: params.deleteSource,
        bwlimit: params.bwlimit,
      }),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))

    throw new Error(err?.error || res.statusText || `HTTP ${res.status}`)
  }

  const json = await res.json().catch(() => ({}))
  const upid = typeof json?.data === 'string' && json.data.startsWith('UPID:') ? json.data : null

  return { upid, raw: json }
}
